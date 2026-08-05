/**
 * ROUTE 동선 영속화 + 협업 동기화.
 *
 * Claude.md의 기존 패턴(destinations.ts)을 그대로 따른다 —
 * **마이그레이션(supabase/route_plan.sql)을 아직 실행하지 않았어도 앱이 정상 동작**해야 하므로,
 * 테이블이 없으면 조용히 "세션 메모리 전용" 모드로 떨어진다(기존 동작과 동일).
 *
 * 저장 단위
 *   route_days  : 여행지 안의 하루 (day_index 0 = DAY 1)
 *   route_stops : 그 하루의 방문 순서. 숙소(basecamp)는 stay_segments가 이미 갖고 있으므로
 *                 저장하지 않고 화면에서 항상 맨 앞에 붙인다.
 *
 * 동시 편집: 저장은 "그 DAY의 정류지 전체를 지우고 다시 넣기"(replace) 방식이라 단순하지만,
 * 다른 멤버의 변경을 덮어쓸 수 있다. 그래서 저장 직후 스스로 유발한 realtime 이벤트를
 * 무시(echo suppression)하고, 남의 변경이 오면 화면을 다시 불러온다.
 */

import { supabase } from '../supabase';
import type { Database } from '../types/database';
import type { RealtimeChannel } from '@supabase/supabase-js';

type RouteDayRow = Database['public']['Tables']['route_days']['Row'];
type RouteStopRow = Database['public']['Tables']['route_stops']['Row'];

/** 화면이 쓰는 정류지 표현 (place_id 기반 + 지도에 직접 찍은 임시 지점 모두 수용) */
export interface StoredStop {
  placeId: string | null;
  customName: string | null;
  customLat: number | null;
  customLng: number | null;
  arriveTime: string | null;
  memo: string | null;
  travelMode: string | null;
  /** 비어있으면 일반 정류지, 있으면 "숙소 들르기" 같은 특수 목적 스탑의 목적 텍스트 */
  purpose: string | null;
}

export interface StoredDay {
  dayIndex: number;
  stops: StoredStop[];
}

/** 저장소를 쓸 수 있는지 — false면 세션 메모리 전용(마이그레이션 전) */
let storageAvailable: boolean | null = null;
export function isRouteStorageReady(): boolean {
  return storageAvailable === true;
}

/** Postgres "relation does not exist" — 마이그레이션 전임을 뜻함 */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || /relation .* does not exist/i.test(error.message ?? '');
}

/** PostgREST "스키마 캐시에 그 컬럼이 없음" — route_stop_purpose.sql 마이그레이션 전임을 뜻함
 *  (supabase/destination_arrival.sql 때 겪었던 것과 같은 에러 모양). 이 컬럼 하나가 없다고
 *  저장 전체를 실패시키지 않고, 그 필드만 빼고 재시도한다. */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return /Could not find the '.*' column/i.test(error.message ?? '');
}

/* ══════════════ 불러오기 ══════════════ */

/**
 * 이 여행지의 저장된 동선을 전부 불러온다.
 * 반환이 null이면 "저장소를 못 씀"(마이그레이션 전) — 호출부는 기존 초기값 로직을 쓴다.
 */
export async function loadRoutePlan(destinationId: string): Promise<StoredDay[] | null> {
  const { data: dayRows, error: dayErr } = await supabase
    .from('route_days')
    .select('*')
    .eq('destination_id', destinationId)
    .order('day_index', { ascending: true });

  if (dayErr) {
    if (isMissingTable(dayErr)) {
      storageAvailable = false;
      return null;
    }
    console.error('[Route] route_days 로드 실패:', dayErr.message);
    return null;
  }
  storageAvailable = true;

  const days = (dayRows ?? []) as RouteDayRow[];
  if (days.length === 0) return [];

  const { data: stopRows, error: stopErr } = await supabase
    .from('route_stops')
    .select('*')
    .in('route_day_id', days.map((d) => d.id))
    .order('sort_order', { ascending: true });

  if (stopErr) {
    console.error('[Route] route_stops 로드 실패:', stopErr.message);
    return days.map((d) => ({ dayIndex: d.day_index, stops: [] }));
  }

  const byDay = new Map<string, StoredStop[]>();
  ((stopRows ?? []) as RouteStopRow[]).forEach((s) => {
    const list = byDay.get(s.route_day_id) ?? [];
    list.push({
      placeId: s.place_id,
      customName: s.custom_name,
      customLat: s.custom_lat,
      customLng: s.custom_lng,
      arriveTime: s.arrive_time,
      memo: s.memo,
      travelMode: s.travel_mode,
      purpose: s.stop_purpose ?? null,
    });
    byDay.set(s.route_day_id, list);
  });

  return days.map((d) => ({ dayIndex: d.day_index, stops: byDay.get(d.id) ?? [] }));
}

/* ══════════════ 저장 ══════════════ */

/** 저장이 유발한 realtime 이벤트를 내 화면에서 무시하기 위한 표식 */
let selfWriteUntil = 0;
function markSelfWrite(): void {
  selfWriteUntil = Date.now() + 1500;
}
function isSelfEcho(): boolean {
  return Date.now() < selfWriteUntil;
}

/** 해당 DAY 행을 확보(없으면 생성)하고 id를 반환 */
async function ensureDayRow(tripId: string, destinationId: string, dayIndex: number): Promise<string | null> {
  const { data: found, error: findErr } = await supabase
    .from('route_days')
    .select('id')
    .eq('destination_id', destinationId)
    .eq('day_index', dayIndex)
    .maybeSingle();

  if (findErr) {
    if (isMissingTable(findErr)) { storageAvailable = false; return null; }
    console.error('[Route] route_days 조회 실패:', findErr.message);
    return null;
  }
  if (found) return found.id;

  const { data: created, error: insErr } = await supabase
    .from('route_days')
    .insert({ trip_id: tripId, destination_id: destinationId, day_index: dayIndex })
    .select('id')
    .single();

  if (insErr) {
    if (isMissingTable(insErr)) { storageAvailable = false; return null; }
    // unique 제약 충돌 = 다른 멤버가 같은 순간에 만든 것 → 다시 조회해서 그 행을 쓴다
    const { data: retry } = await supabase
      .from('route_days')
      .select('id')
      .eq('destination_id', destinationId)
      .eq('day_index', dayIndex)
      .maybeSingle();
    if (retry) return retry.id;
    console.error('[Route] route_days 생성 실패:', insErr.message);
    return null;
  }
  return created?.id ?? null;
}

/** 한 DAY의 정류지를 통째로 교체 저장 */
export async function saveRouteDay(
  tripId: string,
  destinationId: string,
  dayIndex: number,
  stops: StoredStop[]
): Promise<boolean> {
  if (storageAvailable === false) return false;

  const dayId = await ensureDayRow(tripId, destinationId, dayIndex);
  if (!dayId) return false;

  markSelfWrite();

  const { error: delErr } = await supabase.from('route_stops').delete().eq('route_day_id', dayId);
  if (delErr) {
    if (isMissingTable(delErr)) { storageAvailable = false; return false; }
    console.error('[Route] route_stops 삭제 실패:', delErr.message);
    return false;
  }

  if (stops.length === 0) {
    markSelfWrite();
    return true;
  }

  const rows = stops.map((s, i) => ({
    route_day_id: dayId,
    trip_id: tripId,
    place_id: s.placeId,
    sort_order: i,
    arrive_time: s.arriveTime,
    memo: s.memo,
    travel_mode: s.travelMode,
    custom_name: s.placeId ? null : s.customName,
    custom_lat: s.placeId ? null : s.customLat,
    custom_lng: s.placeId ? null : s.customLng,
    stop_purpose: s.purpose,
  }));

  const { error: insErr } = await supabase.from('route_stops').insert(rows);
  if (insErr) {
    // stop_purpose 컬럼 마이그레이션 전이면 그 필드만 빼고 재시도 — "숙소 들르기" 목적 텍스트만
    // 빠질 뿐 나머지 동선 저장은 그대로 되게(원칙: 마이그레이션 전에도 앱은 동작해야 함).
    if (isMissingColumn(insErr)) {
      const fallbackRows = rows.map(({ stop_purpose: _stop_purpose, ...rest }) => rest);
      const { error: retryErr } = await supabase.from('route_stops').insert(fallbackRows);
      if (retryErr) {
        console.error('[Route] route_stops 저장 실패(재시도):', retryErr.message);
        return false;
      }
      markSelfWrite();
      return true;
    }
    console.error('[Route] route_stops 저장 실패:', insErr.message);
    return false;
  }
  markSelfWrite();
  return true;
}

/** 이 여행지의 모든 DAY 삭제 (동선 전체 초기화) */
export async function clearRoutePlan(destinationId: string): Promise<void> {
  if (storageAvailable === false) return;
  markSelfWrite();
  const { error } = await supabase.from('route_days').delete().eq('destination_id', destinationId);
  if (error && !isMissingTable(error)) console.error('[Route] 동선 초기화 실패:', error.message);
  markSelfWrite();
}

/* ══════════════ 실시간 동기화 ══════════════ */

let channel: RealtimeChannel | null = null;

/**
 * 같은 트립의 다른 멤버가 동선을 바꾸면 onRemoteChange를 호출한다.
 * 내가 방금 저장해서 생긴 이벤트(echo)는 걸러낸다.
 */
export function subscribeRoutePlan(tripId: string, onRemoteChange: () => void): void {
  unsubscribeRoutePlan();
  if (storageAvailable === false) return;

  channel = supabase
    .channel('route-plan:' + tripId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'route_stops', filter: 'trip_id=eq.' + tripId },
      () => { if (!isSelfEcho()) onRemoteChange(); }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'route_days', filter: 'trip_id=eq.' + tripId },
      () => { if (!isSelfEcho()) onRemoteChange(); }
    )
    .subscribe();
}

export function unsubscribeRoutePlan(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}

/** 테스트/재진입을 위해 저장소 가용 여부 캐시를 초기화 */
export function resetRouteStorageProbe(): void {
  storageAvailable = null;
}
