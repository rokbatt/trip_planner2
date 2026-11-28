/**
 * 여행 멤버 창 · 이 여행에서 나가기 — 계정은 그대로 두고 이 여행에서만 빠진다.
 *
 *  · 헤더의 멤버 아바타(PC)와 Companion 메뉴(폰)가 이 창을 연다.
 *  · 서버 함수 `leave_trip`(supabase/leave_trip.sql)이 한 트랜잭션으로 처리한다: 방장이면 가장 먼저 참여한 멤버에게 넘기고,
 *    이 여행의 내 개인 문서와 이름 사본을 지우고 멤버십을 지운다. 같이 만든 장소·일정·지출·공용 서류·채팅은 남는다.
 *  · 멤버가 나 하나뿐이면 나갈 수 없다(여행 삭제는 별도 기능 — 데이터 삭제를 이 창이 부르지 않는다).
 *  · 개인 문서 **파일**은 SQL로 못 지우므로 서버 함수를 부르기 전에(아직 멤버일 때) 먼저 지운다(account/tripFiles.ts).
 */

import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import { escapeHtml, safeHttpUrl } from '../utils/html';
import { removeFiles } from '../account/tripFiles';
import { isFunctionMissing, pickSuccessor, type MemberRow } from '../account/accountStore';
import { clearUnlockedUser } from '../docs/docsStore';
import './leaveTrip.css';

/* ══════════════ 순수 계산 ══════════════ */

export interface LeaveMember extends MemberRow {
  avatar_url: string | null;
  role: string;
}

export type LeavePlan =
  | { canLeave: false; reason: 'only_member' | 'not_member' }
  | { canLeave: true; isOwner: boolean; successorName: string | null };

/** 나갈 수 있는지와 무엇이 달라지는지 — 서버 함수와 같은 규칙(혼자면 불가, 방장이면 가장 먼저 참여한 사람에게) */
export function planLeave(me: string, ownerId: string | null, members: LeaveMember[]): LeavePlan {
  if (!members.some((m) => m.user_id === me)) return { canLeave: false, reason: 'not_member' };
  if (members.length <= 1) return { canLeave: false, reason: 'only_member' };
  const isOwner = ownerId === me;
  return { canLeave: true, isOwner, successorName: isOwner ? pickSuccessor(me, members)?.display_name ?? null : null };
}

/** 서버가 돌려준 오류 → 사용자에게 보일 문장 */
export function leaveErrorMessage(error: { code?: string; message?: string } | null): string {
  const m = error?.message ?? '';
  if (/only_member/.test(m)) return '이 여행에 멤버가 나 혼자예요. 나가는 대신 여행을 삭제할 수 있어요.';
  if (/not_member/.test(m)) return '이미 이 여행의 멤버가 아니에요.';
  return '나가지 못했어요. 잠시 후 다시 시도해 주세요. 계속 안 되면 help@mongsil2.com으로 알려 주세요.';
}

/* ══════════════ 불러오기 · 실행 ══════════════ */

interface Info {
  tripId: string;
  tripName: string;
  ownerId: string | null;
  members: LeaveMember[];
  /** 이 여행의 내 개인 문서 파일 경로 */
  personalPaths: string[];
  /** 내가 낸 공동 지출 중 정산이 안 끝난 건수 */
  unsettled: number;
}

async function loadInfo(tripId: string, me: string): Promise<Info | null> {
  const [trip, members] = await Promise.all([
    supabase.from('trips').select('id, name, owner_id').eq('id', tripId).maybeSingle(),
    supabase.from('trip_members').select('id, trip_id, user_id, joined_at, display_name, avatar_url, role').eq('trip_id', tripId).order('joined_at', { ascending: true }),
  ]);
  if (trip.error || !trip.data || members.error) return null;
  const list = (members.data ?? []) as LeaveMember[];

  let personalPaths: string[] = [];
  const profiles = await supabase.from('trip_doc_users').select('id').eq('trip_id', tripId).eq('user_id', me);
  if (!profiles.error && profiles.data?.length) {
    const docs = await supabase.from('trip_documents').select('file_path').in('owner_id', profiles.data.map((p) => p.id));
    personalPaths = (docs.data ?? []).map((d) => d.file_path).filter((p): p is string => !!p);
  }
  const exp = await supabase.from('trip_expenses').select('id').eq('trip_id', tripId).eq('paid_by', me).eq('split_mode', 'SHARED').eq('is_paid', true).is('settled_at', null);
  return { tripId, tripName: trip.data.name, ownerId: trip.data.owner_id, members: list, personalPaths, unsettled: exp.error ? 0 : (exp.data ?? []).length };
}

export type LeaveResult = { ok: true; filesFailed: boolean } | { ok: false; unavailable: boolean; message: string };

async function leave(info: Info): Promise<LeaveResult> {
  let filesFailed = false;
  if (info.personalPaths.length) {
    const r = await removeFiles(info.personalPaths);
    if (r.failed) filesFailed = true;
  }
  const { error } = await supabase.rpc('leave_trip', { p_trip_id: info.tripId });
  if (error) {
    if (isFunctionMissing(error)) return { ok: false, unavailable: true, message: '나가기 기능을 준비하고 있어요. 급하면 help@mongsil2.com으로 알려 주세요.' };
    return { ok: false, unavailable: false, message: leaveErrorMessage(error) };
  }
  clearUnlockedUser(info.tripId);
  try { sessionStorage.removeItem('mongsil:openTrip'); } catch { /* 저장소 차단 환경 */ }
  return { ok: true, filesFailed };
}

/* ══════════════ 화면 ══════════════ */

let overlayEl: HTMLElement | null = null;

function close(): void {
  overlayEl?.remove();
  overlayEl = null;
  document.removeEventListener('keydown', onKey);
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
}

function avatar(m: LeaveMember): string {
  const url = safeHttpUrl(m.avatar_url ?? '');
  return '<span class="lv-av">' + (url ? '<img src="' + escapeHtml(url) + '" alt="" referrerpolicy="no-referrer"/>' : escapeHtml((m.display_name || '?').charAt(0))) + '</span>';
}

function membersHtml(info: Info, me: string): string {
  return (
    '<ul class="lv-list">' +
    info.members
      .map((m) =>
        '<li>' + avatar(m) + '<span class="lv-name">' + escapeHtml(m.display_name || '멤버') + '</span>' +
        (m.user_id === me ? '<i class="lv-chip">나</i>' : '') +
        (info.ownerId === m.user_id ? '<i class="lv-chip is-owner">방장</i>' : '') + '</li>')
      .join('') +
    '</ul>'
  );
}

/** 멤버 창 — 멤버 목록 + 나가기 */
export async function openTripMembers(tripId: string): Promise<void> {
  const me = store.get('user')?.id;
  if (!me || overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.className = 'lv-backdrop';
  overlayEl.innerHTML = '<div class="lv-modal" role="dialog" aria-modal="true" aria-label="여행 멤버"><div class="lv-wait">불러오는 중…</div></div>';
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlayEl);

  const info = await loadInfo(tripId, me);
  const modal = overlayEl?.querySelector('.lv-modal') as HTMLElement | null;
  if (!modal) return;
  if (!info) {
    modal.innerHTML = '<div class="lv-head"><h2>여행 멤버</h2><button class="lv-x" data-lv="close" aria-label="닫기">✕</button></div><p class="lv-msg">멤버를 불러오지 못했어요. 잠시 후 다시 열어 주세요.</p>';
    modal.querySelector('[data-lv="close"]')?.addEventListener('click', close);
    return;
  }
  showList(modal, info, me);
}

function showList(modal: HTMLElement, info: Info, me: string): void {
  const plan = planLeave(me, info.ownerId, info.members);
  modal.innerHTML = [
    '<div class="lv-head"><div><h2>여행 멤버</h2><p>' + escapeHtml(info.tripName) + ' · ' + info.members.length + '명</p></div><button class="lv-x" data-lv="close" aria-label="닫기">✕</button></div>',
    membersHtml(info, me),
    plan.canLeave
      ? '<button class="lv-leave" data-lv="ask">이 여행에서 나가기</button>'
      : plan.reason === 'only_member'
      ? '<p class="lv-msg">멤버가 나 혼자예요. 나가는 대신 여행 설정에서 여행을 삭제할 수 있어요.</p>'
      : '',
  ].join('');
  modal.querySelector('[data-lv="close"]')?.addEventListener('click', close);
  modal.querySelector('[data-lv="ask"]')?.addEventListener('click', () => showConfirm(modal, info, me));
}

function showConfirm(modal: HTMLElement, info: Info, me: string, error = ''): void {
  const plan = planLeave(me, info.ownerId, info.members);
  if (!plan.canLeave) { showList(modal, info, me); return; }
  modal.innerHTML = [
    '<div class="lv-head"><h2>이 여행에서 나갈까요?</h2><button class="lv-x" data-lv="close" aria-label="닫기">✕</button></div>',
    '<p class="lv-lead">' + escapeHtml(info.tripName) + '</p>',
    '<ul class="lv-points">',
    '<li>나갈 수 있는 건 이 여행뿐이에요. 계정과 다른 여행은 그대로예요.</li>',
    plan.isOwner ? '<li>방장은 <b>' + escapeHtml(plan.successorName ?? '가장 먼저 참여한 멤버') + '</b>님에게 넘어가요.</li>' : '',
    '<li>이 여행에 올린 <b>개인 문서</b>' + (info.personalPaths.length ? '(파일 ' + info.personalPaths.length + '개)' : '') + '는 지워지고 되돌릴 수 없어요.</li>',
    '<li>함께 만든 장소·일정·공용 서류·지출·채팅은 남고, 내 이름은 기록에서 지워져요.</li>',
    info.unsettled ? '<li class="is-warn">아직 정산이 끝나지 않은 내 공동 지출이 <b>' + info.unsettled + '건</b> 있어요. 나가기 전에 정산을 마치는 게 좋아요.</li>' : '',
    '<li>다시 들어오려면 초대 링크가 필요해요.</li>',
    '</ul>',
    error ? '<p class="lv-error">' + escapeHtml(error) + '</p>' : '',
    '<div class="lv-actions"><button class="lv-cancel" data-lv="back">취소</button><button class="lv-danger" data-lv="go">나가기</button></div>',
  ].join('');
  modal.querySelector('[data-lv="close"]')?.addEventListener('click', close);
  modal.querySelector('[data-lv="back"]')?.addEventListener('click', () => showList(modal, info, me));
  modal.querySelector('[data-lv="go"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '나가는 중…';
    const r = await leave(info);
    if (r.ok) {
      close();
      navigate('trips');
      return;
    }
    showConfirm(modal, info, me, r.message);
  });
}
