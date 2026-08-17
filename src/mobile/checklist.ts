/**
 * MOBILE(Companion) 전용 — 여행 준비 체크리스트의 I/O.
 *
 * `stopProgress.ts`와 같은 뼈대(graceful degradation, self-write echo suppression)를 따른다.
 * 화면(mobile.ts)은 이 파일이 돌려준 배열을 그리기만 하고, 쿼리·실시간·실패 처리는 전부 여기 있다.
 *
 * 목록이 **트립 공유**인 이유는 supabase/trip_checklist.sql 상단 주석 참고 —
 * 요약하면 실제로 빠뜨려서 문제가 되는 건 개인 짐이 아니라 "아무도 안 산 유심" 쪽이다.
 */

import { supabase } from '../supabase';
import { store } from '../store';
import type { TripChecklistItem } from '../types/database';
import type { RealtimeChannel } from '@supabase/supabase-js';

/** 저장소를 쓸 수 있는지 — false면 마이그레이션 전이라 체크리스트를 숨긴다 */
let storageAvailable: boolean | null = null;
export function isChecklistStorageReady(): boolean {
  return storageAvailable === true;
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || /relation .* does not exist/i.test(error.message ?? '');
}

function currentUserSnapshot(): { id: string | null; name: string | null } {
  const user = store.get('user');
  if (!user) return { id: null, name: null };
  const meta = user.user_metadata ?? {};
  return { id: user.id, name: meta.full_name || meta.name || user.email || null };
}

/* ══════════════ 불러오기 ══════════════ */

/**
 * 이 트립의 체크리스트 전체를 불러온다.
 * 반환이 null이면 "저장소를 못 씀"(마이그레이션 전) — 호출부는 섹션을 접는다.
 *
 * 정렬은 **미완료 먼저, 그 안에서 sort_order**다. 여행 준비 중에 보고 싶은 건 "남은 것"이고,
 * 끝낸 항목이 위에서 자리를 차지하면 스크롤이 늘어난다.
 */
export async function loadChecklist(tripId: string): Promise<TripChecklistItem[] | null> {
  const { data, error } = await supabase
    .from('trip_checklist')
    .select('*')
    .eq('trip_id', tripId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    if (isMissingTable(error)) {
      storageAvailable = false;
      return null;
    }
    console.error('[Checklist] 로드 실패:', error.message);
    return null;
  }
  storageAvailable = true;

  const items = (data ?? []) as TripChecklistItem[];
  return [...items].sort((a, b) => {
    const done = Number(a.checked_at != null) - Number(b.checked_at != null);
    if (done !== 0) return done;
    return a.sort_order - b.sort_order;
  });
}

/* ══════════════ 쓰기 ══════════════ */

let selfWriteUntil = 0;
function markSelfWrite(): void {
  selfWriteUntil = Date.now() + 1500;
}
function isSelfEcho(): boolean {
  return Date.now() < selfWriteUntil;
}

/** 새 항목을 목록 맨 뒤에 추가한다. 실패하면 null. */
export async function addChecklistItem(tripId: string, title: string, sortOrder: number): Promise<TripChecklistItem | null> {
  if (storageAvailable === false) return null;
  const trimmed = title.trim();
  if (!trimmed) return null;
  const { id: createdBy } = currentUserSnapshot();

  markSelfWrite();
  const { data, error } = await supabase
    .from('trip_checklist')
    .insert({ trip_id: tripId, title: trimmed, sort_order: sortOrder, created_by: createdBy })
    .select()
    .single();

  if (error) {
    if (isMissingTable(error)) storageAvailable = false;
    else console.error('[Checklist] 추가 실패:', error.message);
    return null;
  }
  markSelfWrite();
  return data as TripChecklistItem;
}

/**
 * 체크/해제를 토글한다. `checked`가 true면 지금 시각과 누른 사람을 같이 남기고,
 * false면 셋 다 비운다 — 해제한 뒤에도 이전 기록이 남아 있으면 "누가 했지?"가 거짓이 된다.
 */
export async function setChecklistChecked(id: string, checked: boolean): Promise<boolean> {
  if (storageAvailable === false) return false;
  const { id: userId, name } = currentUserSnapshot();

  markSelfWrite();
  const { error } = await supabase
    .from('trip_checklist')
    .update(
      checked
        ? { checked_at: new Date().toISOString(), checked_by: userId, checked_by_name: name }
        : { checked_at: null, checked_by: null, checked_by_name: null }
    )
    .eq('id', id);

  if (error) {
    if (isMissingTable(error)) storageAvailable = false;
    else console.error('[Checklist] 체크 저장 실패:', error.message);
    return false;
  }
  markSelfWrite();
  return true;
}

export async function deleteChecklistItem(id: string): Promise<boolean> {
  if (storageAvailable === false) return false;

  markSelfWrite();
  const { error } = await supabase.from('trip_checklist').delete().eq('id', id);
  if (error) {
    if (isMissingTable(error)) storageAvailable = false;
    else console.error('[Checklist] 삭제 실패:', error.message);
    return false;
  }
  markSelfWrite();
  return true;
}

/* ══════════════ 실시간 동기화 ══════════════ */

let channel: RealtimeChannel | null = null;

/** 다른 멤버가 항목을 추가하거나 체크하면 onRemoteChange를 호출한다. */
export function subscribeChecklist(tripId: string, onRemoteChange: () => void): void {
  unsubscribeChecklist();
  if (storageAvailable === false) return;

  channel = supabase
    .channel('mb-checklist:' + tripId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trip_checklist', filter: 'trip_id=eq.' + tripId },
      () => { if (!isSelfEcho()) onRemoteChange(); }
    )
    .subscribe();
}

export function unsubscribeChecklist(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}

/** 테스트/재진입을 위해 저장소 가용 여부 캐시를 초기화 */
export function resetChecklistStorageProbe(): void {
  storageAvailable = null;
}
