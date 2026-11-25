import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import { signInWithGoogle } from '../auth/auth';
import './trip-join.css';
import { parseISODate } from '../utils/dates';
import { escapeHtml } from '../utils/html';
// 여행 목록 카드와 같은 공항 코드 표를 쓴다(따로 두면 같은 여행이 목록엔 PRG, 초대장엔 "프라하"로 보인다)
import { toAirportCode } from './airports';

const PENDING_INVITE_KEY = 'mongsil_pending_invite';

const ICON_ROUTE_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const ICON_USERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
/** 구글 로그인 버튼 아이콘 — 랜딩 시작 버튼과 같은 그림 */
const ICON_GOOGLE = '<svg class="tj-google-ic" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.3 35.4 26.8 36 24 36c-5.3 0-9.6-3.1-11.3-7.6l-6.5 5C9.6 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.3 5.3C40.5 36.6 44 30.9 44 24c0-1.3-.1-2.7-.4-3.5z"/></svg>';
const ICON_WARNING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>';

function formatDateShort(d: string): string {
  const dt = parseISODate(d);
  return (dt.getMonth() + 1) + '.' + String(dt.getDate()).padStart(2, '0');
}

function renderErrorState(container: HTMLElement, title: string, desc: string): void {
  container.innerHTML = [
    '<div class="tj-page">',
    '  <div class="tj-card">',
    '    <div class="tj-error-icon">' + ICON_WARNING + '</div>',
    '    <div class="tj-error-title">' + escapeHtml(title) + '</div>',
    '    <div class="tj-error-desc">' + escapeHtml(desc) + '</div>',
    '    <button class="tj-btn" id="tj-go-trips">내 여행으로</button>',
    '  </div>',
    '</div>',
  ].join('\n');
  container.querySelector('#tj-go-trips')?.addEventListener('click', () => navigate('trips'));
}

export async function renderJoinPage(inviteCode: string | undefined): Promise<HTMLElement> {
  const page = document.createElement('div');

  if (!inviteCode) {
    renderErrorState(page, '잘못된 초대 링크예요', '초대 코드가 없어요. 링크를 다시 확인해주세요.');
    return page;
  }

  // 로그인 안 되어 있으면: 코드를 저장해두고 로그인부터
  const user = store.get('user');
  if (!user) {
    sessionStorage.setItem(PENDING_INVITE_KEY, inviteCode);
    page.innerHTML = [
      '<div class="tj-page">',
      '  <div class="tj-card">',
      '    <div class="tj-brand"><img src="/favicon.svg" alt="" width="22" height="22" />몽실이</div>',
      '    <div class="tj-eyebrow">TRAVEL INVITATION</div>',
      '    <div class="tj-name">여행에 초대되었어요</div>',
      '    <div class="tj-dates" style="margin-bottom:24px;">로그인하면 여행 정보를 보고 바로 참여할 수 있어요</div>',
      '    <button class="tj-btn tj-btn-google" id="tj-login">' + ICON_GOOGLE + '<span>Google 계정으로 계속하기</span></button>',
      '    <div class="tj-hint">처음이라면 로그인 뒤 이용 동의를 한 번 받아요</div>',
      '  </div>',
      '</div>',
    ].join('\n');
    page.querySelector('#tj-login')?.addEventListener('click', signInWithGoogle);
    return page;
  }

  page.innerHTML = '<div class="tj-page"><div class="tj-loading">초대 정보를 확인하는 중...</div></div>';

  const { data, error } = await supabase.rpc('get_trip_by_invite_code', { p_invite_code: inviteCode });

  if (error || !data || data.length === 0) {
    renderErrorState(page, '초대 링크를 찾을 수 없어요', '코드가 만료되었거나 잘못됐을 수 있어요. 초대한 분에게 새 링크를 요청해주세요.');
    return page;
  }

  const trip = data[0];

  // 이미 멤버인지 확인
  const { data: existingMember } = await supabase
    .from('trip_members')
    .select('id')
    .eq('trip_id', trip.id)
    .eq('user_id', user.id)
    .maybeSingle();

  const destCity = trip.destinations && trip.destinations[0] ? trip.destinations[0] : trip.name;
  const destCode = toAirportCode(destCity);
  const dateRange = trip.start_date && trip.end_date
    ? formatDateShort(trip.start_date) + ' – ' + formatDateShort(trip.end_date)
    : '날짜 미정';

  page.innerHTML = [
    '<div class="tj-page">',
    '  <div class="tj-card">',
    '    <div class="tj-eyebrow">TRAVEL INVITATION</div>',
    '    <div class="tj-route"><span>ICN</span>' + ICON_ROUTE_ARROW + '<span>' + escapeHtml(destCode) + '</span></div>',
    '    <div class="tj-name">' + escapeHtml(trip.name) + '</div>',
    '    <div class="tj-dates">' + escapeHtml(dateRange) + '</div>',
    '    <div class="tj-members">' + ICON_USERS + '<span>' + trip.member_count + '명 참여 중</span></div>',
    '    <button class="tj-btn" id="tj-join">' + (existingMember ? '여행으로 이동' : '참여하기') + '</button>',
    (existingMember ? '' : '    <div class="tj-hint">참여하면 다른 멤버들과 함께 계획을 볼 수 있어요</div>'),
    '  </div>',
    '</div>',
  ].join('\n');

  const joinBtn = page.querySelector('#tj-join') as HTMLButtonElement;
  joinBtn.addEventListener('click', async () => {
    joinBtn.disabled = true;

    if (!existingMember) {
      const meta = user.user_metadata ?? {};
      const { error: insertError } = await supabase.from('trip_members').insert({
        trip_id: trip.id,
        user_id: user.id,
        role: 'member',
        display_name: meta.full_name ?? meta.name ?? user.email ?? '익명',
        avatar_url: meta.avatar_url ?? meta.picture ?? null,
      });

      if (insertError) {
        console.error('여행 참여 실패:', insertError.message);
        joinBtn.disabled = false;
        joinBtn.textContent = '참여 실패 · 다시 시도';
        return;
      }
    }

    navigate('trip/' + trip.id + '/ideas');
  });

  return page;
}

/** main.ts에서 로그인 직후 대기 중인 초대코드가 있으면 처리 */
export function consumePendingInvite(): string | null {
  const code = sessionStorage.getItem(PENDING_INVITE_KEY);
  if (code) sessionStorage.removeItem(PENDING_INVITE_KEY);
  return code;
}
