/**
 * 회원 탈퇴 — 미리보기 계산과 실행.
 *
 * 실제 삭제는 서버 함수 delete_my_account()(supabase/delete_my_account.sql)가 한 트랜잭션으로
 * 한다. 이 파일은 (1) 그 함수가 무슨 일을 할지 **미리 계산해 사용자에게 보여 주고**, (2) 함수를
 * 부르기 전에 클라이언트만 할 수 있는 일(Storage 파일 삭제)을 하고, (3) 끝난 뒤 이 기기를 정리한다.
 *
 * planDeletion()은 SQL 함수와 **같은 규칙**을 복제한 것이다 — 화면이 약속한 대로 서버가 움직여야
 * 하므로, 한쪽을 고치면 다른 쪽도 고쳐야 한다(방장이면: 혼자면 삭제, 아니면 가장 먼저 참여한
 * 다른 멤버에게 승계).
 */

import { supabase } from '../supabase';
import { bucket, removeFiles, removeTripFiles, type StorageBucketLike } from './tripFiles';

/* ══════════════ 미리보기(순수 계산) ══════════════ */

export interface TripRow { id: string; name: string; owner_id: string }
export interface MemberRow { id: string; trip_id: string; user_id: string; joined_at: string; display_name: string | null }

export interface TripOutcome {
  tripId: string;
  name: string;
  /** delete: 여행이 지워진다 / transfer: 여행은 남고 방장이 넘어간다 / leave: 나만 빠진다 */
  kind: 'delete' | 'transfer' | 'leave';
  successorName?: string | null;
}

/** 서버 함수와 같은 순서 — 가장 먼저 참여한 사람, 같으면 id 순 */
export function pickSuccessor(me: string, members: MemberRow[]): MemberRow | null {
  const others = members.filter((m) => m.user_id !== me);
  if (others.length === 0) return null;
  others.sort((a, b) => {
    const d = Date.parse(a.joined_at) - Date.parse(b.joined_at);
    return d !== 0 && !Number.isNaN(d) ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return others[0];
}

export function planDeletion(me: string, trips: TripRow[], members: MemberRow[]): TripOutcome[] {
  return trips.map((t): TripOutcome => {
    const mine = members.filter((m) => m.trip_id === t.id);
    if (t.owner_id !== me) return { tripId: t.id, name: t.name, kind: 'leave' };
    const next = pickSuccessor(me, mine);
    if (!next) return { tripId: t.id, name: t.name, kind: 'delete' };
    return { tripId: t.id, name: t.name, kind: 'transfer', successorName: next.display_name };
  });
}

export interface DeletionPreview {
  outcomes: TripOutcome[];
  /** 탈퇴하면 지워지는 내 개인 문서 파일 경로 */
  personalDocPaths: string[];
  /** 남는 여행에서 내가 낸 공동 지출 중 아직 정산이 안 끝난 건수 */
  unsettledCount: number;
}

/** 테이블이 없는(마이그레이션 전) 경우를 빈 결과로 취급 — 앱 전반의 "없어도 동작" 원칙 */
function rowsOrEmpty<T>(res: { data: T[] | null; error: unknown }): T[] {
  return res.error || !res.data ? [] : res.data;
}

export async function loadDeletionPreview(me: string): Promise<DeletionPreview | null> {
  // 내 여행 목록 — trip-list.ts와 같은 경로(내 멤버십 → 여행)
  const mine = await supabase.from('trip_members').select('trip_id, trips(id, name, owner_id)').eq('user_id', me);
  if (mine.error) return null; // 여기서 실패하면 "무엇이 지워지는지" 모르는 채로 탈퇴시키게 되므로 미리보기 자체를 포기한다

  const trips: TripRow[] = [];
  for (const row of mine.data ?? []) {
    const t = Array.isArray(row.trips) ? row.trips[0] : row.trips;
    if (t) trips.push({ id: t.id, name: t.name, owner_id: t.owner_id });
  }
  const ids = trips.map((t) => t.id);

  let members: MemberRow[] = [];
  if (ids.length) {
    const res = await supabase.from('trip_members').select('id, trip_id, user_id, joined_at, display_name').in('trip_id', ids);
    if (res.error) return null;
    members = (res.data ?? []) as MemberRow[];
  }
  const outcomes = planDeletion(me, trips, members);

  // 내 개인 문서(프로필 → 문서 파일 경로)
  const profiles = rowsOrEmpty(await supabase.from('trip_doc_users').select('id').eq('user_id', me));
  let personalDocPaths: string[] = [];
  if (profiles.length) {
    const docs = rowsOrEmpty(
      await supabase.from('trip_documents').select('file_path').in('owner_id', profiles.map((p) => p.id))
    );
    personalDocPaths = docs.map((d) => d.file_path).filter((p): p is string => !!p);
  }

  // 남는 여행에서 정산이 안 끝난 내 공동 지출 — 탈퇴하면 결제자가 지워져 정산에서 빠진다
  const surviving = outcomes.filter((o) => o.kind !== 'delete').map((o) => o.tripId);
  let unsettledCount = 0;
  if (surviving.length) {
    const exp = rowsOrEmpty(
      await supabase
        .from('trip_expenses')
        .select('id')
        .in('trip_id', surviving)
        .eq('paid_by', me)
        .eq('split_mode', 'SHARED')
        .eq('is_paid', true)
        .is('settled_at', null)
    );
    unsettledCount = exp.length;
  }

  return { outcomes, personalDocPaths, unsettledCount };
}

/* ══════════════ 실행 ══════════════ */

export type DeleteResult =
  | { ok: true; filesFailed: boolean }
  | { ok: false; reason: 'unavailable' | 'error'; message?: string };

/** 서버 함수가 아직 없는 경우(SQL 미실행)를 일반 오류와 구분한다 */
export function isFunctionMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // PGRST202: PostgREST가 함수를 못 찾음 / 42883: undefined_function
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function|function .* does not exist/i.test(error.message ?? '');
}

export async function deleteMyAccount(
  preview: DeletionPreview,
  onStep: (label: string) => void = () => {},
  b: StorageBucketLike = bucket()
): Promise<DeleteResult> {
  let filesFailed = false;

  // 1) 파일부터 — 계정이 살아 있고 아직 멤버일 때만 지울 권한이 있다(tripFiles.ts 머리말 참고)
  onStep('문서 파일을 지우는 중…');
  for (const o of preview.outcomes.filter((x) => x.kind === 'delete')) {
    const r = await removeTripFiles(o.tripId, b);
    if (r.failed) filesFailed = true;
  }
  if (preview.personalDocPaths.length) {
    const r = await removeFiles(preview.personalDocPaths, b);
    if (r.failed) filesFailed = true;
  }

  // 2) 계정과 데이터 — 한 트랜잭션
  onStep('계정을 지우는 중…');
  const { error } = await supabase.rpc('delete_my_account');
  if (error) {
    if (isFunctionMissing(error)) return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: 'error', message: error.message };
  }

  // 3) 이 기기 정리 — 로컬 로그아웃(서버 세션은 이미 사라졌다). SIGNED_OUT 이벤트가
  //    오프라인 여행 데이터·서류 캐시를 지운다(main.ts). 동의 기록도 새 가입에서 다시 받도록 지운다.
  onStep('이 기기를 정리하는 중…');
  try { localStorage.removeItem('mongsil:consent'); } catch { /* 저장소 차단 환경 */ }
  try { sessionStorage.clear(); } catch { /* 위와 같음 */ }
  await supabase.auth.signOut({ scope: 'local' });

  return { ok: true, filesFailed };
}

