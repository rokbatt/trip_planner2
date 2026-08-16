/**
 * MOBILE(Companion) 전용 — 정류지의 실제 도착/출발 기록.
 *
 * `route/routeStore.ts`와 같은 뼈대(graceful degradation, self-write echo suppression)를
 * 따르되, 대상이 다르다 — routeStore가 "계획"(route_stops)을 다루는 반면 이 파일은
 * "실제로 일어난 일"(trip_stop_progress)만 다룬다. 계획은 손대지 않는다.
 *
 * 키는 route_stops.id가 아니라 `dayModel.ts`의 `TlStop.key`다 — 이유는
 * supabase/trip_stop_progress.sql 상단 주석과 dayModel.ts의 StopProgress 참고.
 */

import { supabase } from '../supabase';
import { store } from '../store';
import type { StopProgress, ProgressMap } from '../timeline/dayModel';
import type { Database } from '../types/database';
import type { RealtimeChannel } from '@supabase/supabase-js';

type Row = Database['public']['Tables']['trip_stop_progress']['Row'];

/** 저장소를 쓸 수 있는지 — false면 이번 세션에서 기록이 저장되지 않는다(마이그레이션 전) */
let storageAvailable: boolean | null = null;
export function isStopProgressStorageReady(): boolean {
  return storageAvailable === true;
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || /relation .* does not exist/i.test(error.message ?? '');
}

function rowToProgress(r: Row): StopProgress {
  const status = r.status === 'arrived' || r.status === 'departed' || r.status === 'skipped' ? r.status : 'pending';
  return { status, actualArriveAt: r.actual_arrive_at, actualDepartAt: r.actual_depart_at };
}

/* ══════════════ 불러오기 ══════════════ */

/**
 * 이 여행지·이 DAY의 정류지별 진행 상황을 불러온다.
 * 반환이 null이면 "저장소를 못 씀"(마이그레이션 전) — 호출부는 빈 진행 상황으로 취급한다.
 */
export async function loadStopProgress(destinationId: string, dayIndex: number): Promise<ProgressMap | null> {
  const { data, error } = await supabase
    .from('trip_stop_progress')
    .select('*')
    .eq('destination_id', destinationId)
    .eq('day_index', dayIndex);

  if (error) {
    if (isMissingTable(error)) {
      storageAvailable = false;
      return null;
    }
    console.error('[StopProgress] 로드 실패:', error.message);
    return null;
  }
  storageAvailable = true;

  const map: ProgressMap = new Map();
  (data ?? []).forEach((r) => map.set(r.stop_key, rowToProgress(r)));
  return map;
}

/* ══════════════ 기록 ══════════════ */

/** 저장이 유발한 realtime 이벤트를 내 화면에서 무시하기 위한 표식 */
let selfWriteUntil = 0;
function markSelfWrite(): void {
  selfWriteUntil = Date.now() + 1500;
}
function isSelfEcho(): boolean {
  return Date.now() < selfWriteUntil;
}

function currentUserSnapshot(): { id: string | null; name: string | null } {
  const user = store.get('user');
  if (!user) return { id: null, name: null };
  const meta = user.user_metadata ?? {};
  return { id: user.id, name: meta.full_name || meta.name || user.email || null };
}

/**
 * 정류지 하나의 진행 상황을 upsert한다. `patch`는 부분 갱신 — 예를 들어 "출발"을 누를 때는
 * status와 actual_depart_at만 바꾸고 actual_arrive_at은 이미 저장된 값을 그대로 둔다.
 */
async function upsertProgress(
  tripId: string,
  destinationId: string,
  dayIndex: number,
  stopKey: string,
  patch: Partial<Pick<Row, 'status' | 'actual_arrive_at' | 'actual_depart_at'>>
): Promise<boolean> {
  if (storageAvailable === false) return false;
  const { id: recordedBy, name: recordedByName } = currentUserSnapshot();

  markSelfWrite();
  const { error } = await supabase.from('trip_stop_progress').upsert(
    {
      trip_id: tripId,
      destination_id: destinationId,
      day_index: dayIndex,
      stop_key: stopKey,
      recorded_by: recordedBy,
      recorded_by_name: recordedByName,
      updated_at: new Date().toISOString(),
      ...patch,
    },
    { onConflict: 'destination_id,day_index,stop_key' }
  );

  if (error) {
    if (isMissingTable(error)) {
      storageAvailable = false;
      return false;
    }
    console.error('[StopProgress] 저장 실패:', error.message);
    return false;
  }
  storageAvailable = true;
  markSelfWrite();
  return true;
}

export function markArrived(tripId: string, destinationId: string, dayIndex: number, stopKey: string): Promise<boolean> {
  return upsertProgress(tripId, destinationId, dayIndex, stopKey, {
    status: 'arrived',
    actual_arrive_at: new Date().toISOString(),
  });
}

export function markDeparted(tripId: string, destinationId: string, dayIndex: number, stopKey: string): Promise<boolean> {
  return upsertProgress(tripId, destinationId, dayIndex, stopKey, {
    status: 'departed',
    actual_depart_at: new Date().toISOString(),
  });
}

export function markSkipped(tripId: string, destinationId: string, dayIndex: number, stopKey: string): Promise<boolean> {
  return upsertProgress(tripId, destinationId, dayIndex, stopKey, { status: 'skipped' });
}

/** 잘못 눌렀을 때 되돌리기 — pending으로 리셋하고 기록된 시각도 지운다 */
export function resetProgress(tripId: string, destinationId: string, dayIndex: number, stopKey: string): Promise<boolean> {
  return upsertProgress(tripId, destinationId, dayIndex, stopKey, {
    status: 'pending',
    actual_arrive_at: null,
    actual_depart_at: null,
  });
}

/* ══════════════ 실시간 동기화 ══════════════ */

let channel: RealtimeChannel | null = null;

/** 같은 트립의 다른 멤버가 도착/출발을 기록하면 onRemoteChange를 호출한다. */
export function subscribeStopProgress(tripId: string, onRemoteChange: () => void): void {
  unsubscribeStopProgress();
  if (storageAvailable === false) return;

  channel = supabase
    .channel('stop-progress:' + tripId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trip_stop_progress', filter: 'trip_id=eq.' + tripId },
      () => { if (!isSelfEcho()) onRemoteChange(); }
    )
    .subscribe();
}

export function unsubscribeStopProgress(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}

/** 테스트/재진입을 위해 저장소 가용 여부 캐시를 초기화 */
export function resetStopProgressStorageProbe(): void {
  storageAvailable = null;
}
