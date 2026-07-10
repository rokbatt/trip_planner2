import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import { signInWithGoogle } from '../auth/auth';
import './trip-join.css';

const PENDING_INVITE_KEY = 'mongsil_pending_invite';

const ICON_ROUTE_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const ICON_USERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
const ICON_WARNING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>';

const AIRPORT_CODE: Record<string, string> = {
  '서울': 'ICN', '인천': 'ICN', '뉴욕': 'JFK', '방콕': 'BKK', '도쿄': 'NRT',
  '오사카': 'KIX', '파리': 'CDG', '런던': 'LHR', '로마': 'FCO', '바르셀로나': 'BCN',
  '싱가포르': 'SIN', '홍콩': 'HKG', '타이베이': 'TPE', '하노이': 'HAN',
  '다낭': 'DAD', '나트랑': 'CXR', '발리': 'DPS', '푸켓': 'HKT', '오키나와': 'OKA',
  '시드니': 'SYD', '두바이': 'DXB', '로스앤젤레스': 'LAX', '샌프란시스코': 'SFO',
  '미국': 'JFK', '베트남': 'HAN', '태국': 'BKK', '일본': 'NRT', '유럽': 'CDG',
};

function toAirportCode(city: string): string {
  const cleaned = city.trim();
  if (AIRPORT_CODE[cleaned]) return AIRPORT_CODE[cleaned];
  return cleaned.slice(0, 3).toUpperCase();
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDateShort(d: string): string {
  const dt = new Date(d);
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
      '    <div class="tj-eyebrow">TRAVEL INVITATION</div>',
      '    <div class="tj-name">여행에 초대되었어요</div>',
      '    <div class="tj-dates" style="margin-bottom:24px;">로그인하면 자동으로 참여돼요</div>',
      '    <button class="tj-btn" id="tj-login">Google 계정으로 로그인</button>',
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
    : 'DATE TBD';

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
