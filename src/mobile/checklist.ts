/**
 * 여행 준비 체크리스트의 I/O — MOBILE(Companion)·TIMELINE(장소 상세 패널)·PC CHECKLIST 게이트가
 * 같은 목록을 쓴다. PC 전용 추가 정보(분류·중요도·담당자 등, trip_checklist_v2.sql)도 여기서만 읽고 쓴다.
 *
 * `stopProgress.ts`와 같은 뼈대(graceful degradation, self-write echo suppression)를 따른다.
 * 화면은 이 파일이 돌려준 배열을 그리기만 하고, 쿼리·실시간·실패 처리는 전부 여기 있다.
 *
 * 장소별 항목: TIMELINE에서 "이 장소 준비물"로 넣은 항목은 `place_key`/`place_name`이 붙는다.
 * 목록 자체는 하나(트립 공유)라 MOBILE에서도 그대로 보이고, 어느 장소 것인지만 같이 표시된다 —
 * 장소별로 목록을 따로 두면 "어디에 적었더라"가 생겨 오히려 빠뜨리기 쉬워진다(아래 주석과 같은 이유).
 *
 * 목록이 **트립 공유**인 이유는 supabase/trip_checklist.sql 상단 주석 참고 —
 * 요약하면 실제로 빠뜨려서 문제가 되는 건 개인 짐이 아니라 "아무도 안 산 유심" 쪽이다.
 */

import { supabase } from '../supabase';
import { store } from '../store';
import type { Database, TripChecklistItem } from '../types/database';

type ChecklistInsert = Database['public']['Tables']['trip_checklist']['Insert'];
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

/** 체크리스트 항목이 딸린 장소 — key는 장소 신원, name은 표시용 */
export interface ChecklistPlace {
  key: string;
  name: string;
}

/** 장소 컬럼이 없는(마이그레이션 전) DB에서 장소 항목을 구분하는 제목 접두어 구분자 */
const PLACE_SEP = ' · ';

/** PostgREST "스키마 캐시에 그 컬럼이 없음" — trip_checklist_place.sql을 아직 안 돌렸다는 뜻 */
function isMissingColumn(error: { message?: string } | null): boolean {
  return /Could not find the '.*' column/i.test(error?.message ?? '');
}

/**
 * 이 항목이 그 장소에 딸린 것인지. 장소 컬럼이 있으면 key로, 마이그레이션 전에 저장된
 * 항목이면 제목 접두어("왓 아룬 · ")로 판단한다 — 어느 쪽이든 같은 화면 결과가 나오게.
 */
export function isChecklistItemForPlace(item: TripChecklistItem, place: ChecklistPlace): boolean {
  const key = item.place_key ?? null;
  if (key) return key === place.key;
  return item.title.startsWith(place.name + PLACE_SEP);
}

/** 장소 패널에서 보여줄 제목 — 접두어로 장소를 표시해 둔 항목이면 그 접두어를 뗀다 */
export function checklistTitleForPlace(item: TripChecklistItem, place: ChecklistPlace): string {
  if (!item.place_key && item.title.startsWith(place.name + PLACE_SEP)) {
    return item.title.slice(place.name.length + PLACE_SEP.length);
  }
  return item.title;
}

/**
 * 새 항목을 목록 맨 뒤에 추가한다. 실패하면 null.
 * `place`를 주면 그 장소에 딸린 항목으로 저장한다. 장소 컬럼 마이그레이션 전이면 컬럼 없이
 * 다시 넣되 제목 앞에 장소 이름을 붙인다 — 항목이 사라지지 않고, MOBILE에서도 어디 것인지 읽힌다.
 */
export async function addChecklistItem(
  tripId: string,
  title: string,
  sortOrder: number,
  place?: ChecklistPlace
): Promise<TripChecklistItem | null> {
  if (storageAvailable === false) return null;
  const trimmed = title.trim();
  if (!trimmed) return null;
  const { id: createdBy } = currentUserSnapshot();
  const base: ChecklistInsert = { trip_id: tripId, title: trimmed, sort_order: sortOrder, created_by: createdBy };
  const row: ChecklistInsert = place ? { ...base, place_key: place.key, place_name: place.name } : base;

  markSelfWrite();
  let { data, error } = await supabase
    .from('trip_checklist')
    .insert(row)
    .select()
    .single();

  if (error && place && isMissingColumn(error)) {
    ({ data, error } = await supabase
      .from('trip_checklist')
      .insert({ ...base, title: place.name + PLACE_SEP + trimmed })
      .select()
      .single());
  }

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

/* ══════════════ PC CHECKLIST — 분류·중요도·담당자 등 추가 정보 ══════════════ */

/** trip_checklist_v2.sql 컬럼이 있는지 — null이면 아직 확인 전 */
let extendedAvailable: boolean | null = null;
export function isChecklistExtendedReady(): boolean {
  return extendedAvailable === true;
}

/**
 * 추가 정보 컬럼이 있는지 한 번만 확인한다. 행이 0개인 트립에서도 판별돼야 해서
 * 응답 행을 보는 대신 컬럼을 콕 집어 select한다(없으면 PostgREST가 컬럼 오류를 낸다).
 */
export async function probeChecklistExtended(tripId: string): Promise<boolean> {
  if (extendedAvailable !== null) return extendedAvailable;
  const { error } = await supabase.from('trip_checklist').select('id, category').eq('trip_id', tripId).limit(1);
  if (error) {
    const missingColumn = /column .* does not exist|Could not find the '.*' column/i.test(error.message ?? '');
    if (isMissingTable(error)) storageAvailable = false;
    extendedAvailable = false;
    if (!missingColumn && !isMissingTable(error)) console.error('[Checklist] 확장 컬럼 확인 실패:', error.message);
    return false;
  }
  extendedAvailable = true;
  return true;
}

/** 항목 하나의 편집 가능한 필드 — 제목 말고는 전부 선택 */
export interface ChecklistDraft {
  title: string;
  category: string | null;
  priority: string | null;
  assignee_member_id: string | null;
  assignee_all: boolean;
  due_date: string | null;
  memo: string | null;
  linked_doc_id: string | null;
  suggestion_key?: string | null;
}

function extendedFields(draft: Partial<ChecklistDraft>): Partial<ChecklistInsert> {
  const out: Partial<ChecklistInsert> = {};
  if ('category' in draft) out.category = draft.category ?? null;
  if ('priority' in draft) out.priority = draft.priority ?? null;
  if ('assignee_member_id' in draft) out.assignee_member_id = draft.assignee_member_id ?? null;
  if ('assignee_all' in draft) out.assignee_all = !!draft.assignee_all;
  if ('due_date' in draft) out.due_date = draft.due_date || null;
  if ('memo' in draft) out.memo = draft.memo?.trim() || null;
  if ('linked_doc_id' in draft) out.linked_doc_id = draft.linked_doc_id ?? null;
  if ('suggestion_key' in draft) out.suggestion_key = draft.suggestion_key ?? null;
  return out;
}

/**
 * 분류·중요도 등을 담아 새 항목을 추가한다. 추가 정보 컬럼이 아직 없으면(마이그레이션 전)
 * 제목만 저장한다 — 항목 자체가 사라지는 것보다 낫고, 화면은 분류를 제목으로 추정해서 보여준다.
 */
export async function addChecklistItemDetailed(
  tripId: string,
  draft: ChecklistDraft,
  sortOrder: number
): Promise<TripChecklistItem | null> {
  if (storageAvailable === false) return null;
  const title = draft.title.trim();
  if (!title) return null;
  const { id: createdBy } = currentUserSnapshot();
  const base: ChecklistInsert = { trip_id: tripId, title, sort_order: sortOrder, created_by: createdBy };
  const row: ChecklistInsert = extendedAvailable ? { ...base, ...extendedFields(draft) } : base;

  markSelfWrite();
  let { data, error } = await supabase.from('trip_checklist').insert(row).select().single();
  if (error && isMissingColumn(error)) {
    extendedAvailable = false;
    ({ data, error } = await supabase.from('trip_checklist').insert(base).select().single());
  }
  if (error) {
    if (isMissingTable(error)) storageAvailable = false;
    else console.error('[Checklist] 추가 실패:', error.message);
    return null;
  }
  markSelfWrite();
  return data as TripChecklistItem;
}

/** 제목·분류·담당자 등을 고친다. 추가 정보 컬럼이 없으면 제목만 고친다. */
export async function updateChecklistItem(id: string, patch: Partial<ChecklistDraft>): Promise<boolean> {
  if (storageAvailable === false) return false;
  const update: Partial<ChecklistInsert> = extendedAvailable ? extendedFields(patch) : {};
  if (patch.title != null) {
    const title = patch.title.trim();
    if (!title) return false;
    update.title = title;
  }
  if (Object.keys(update).length === 0) return true;

  markSelfWrite();
  const { error } = await supabase.from('trip_checklist').update(update).eq('id', id);
  if (error) {
    if (isMissingColumn(error)) extendedAvailable = false;
    if (isMissingTable(error)) storageAvailable = false;
    else console.error('[Checklist] 수정 실패:', error.message);
    return false;
  }
  markSelfWrite();
  return true;
}

/**
 * 끌어서 바꾼 순서를 저장한다 — sort_order가 실제로 바뀐 행만 보낸다.
 * 모바일 MORE 탭도 같은 sort_order를 쓰므로 순서가 양쪽에서 같게 보인다.
 */
export async function saveChecklistOrder(changes: Array<{ id: string; sort_order: number }>): Promise<boolean> {
  if (storageAvailable === false || changes.length === 0) return changes.length === 0;
  markSelfWrite();
  const results = await Promise.all(
    changes.map((c) => supabase.from('trip_checklist').update({ sort_order: c.sort_order }).eq('id', c.id))
  );
  markSelfWrite();
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    console.error('[Checklist] 순서 저장 실패:', failed.error.message);
    return false;
  }
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

/**
 * 다른 화면(TIMELINE)용 독립 구독 — 해제 함수를 돌려준다.
 * 위의 subscribeChecklist는 모듈에 채널 하나만 들고 있어서, 두 화면이 같이 쓰면 게이트를
 * 오가는 순서에 따라 한쪽 teardown이 다른 쪽 구독을 끊어버린다. 그래서 채널 이름도 따로 쓴다.
 */
export function subscribeChecklistScoped(tripId: string, scope: string, onRemoteChange: () => void): () => void {
  if (storageAvailable === false) return () => {};
  const ch = supabase
    .channel(scope + '-checklist:' + tripId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trip_checklist', filter: 'trip_id=eq.' + tripId },
      () => { if (!isSelfEcho()) onRemoteChange(); }
    )
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/** 테스트/재진입을 위해 저장소 가용 여부 캐시를 초기화 */
export function resetChecklistStorageProbe(): void {
  storageAvailable = null;
  extendedAvailable = null;
}
