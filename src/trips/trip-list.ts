import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import { signOut } from '../auth/auth';
import type { Database } from '../types/database';
import './trip-list.css';

type Trip = Database['public']['Tables']['trips']['Row'];

/* ── SVG ── */
const ICON_SUITCASE = `<svg class="trip-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><rect x="3" y="7" width="18" height="14"/><path d="M8 7V4H16V7"/></svg>`;
const ICON_PIN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><path d="M12 21C12 21 19 14.5 19 9.5C19 5.9 15.9 3 12 3C8.1 3 5 5.9 5 9.5C5 14.5 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.2"/></svg>`;
const DI = {
  trip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><rect x="3" y="5" width="18" height="16"/><path d="M3 10H21M8 3V7M16 3V7"/></svg>`,
  setting: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><rect x="4" y="4" width="16" height="16"/><path d="M9 4V20M4 9H20"/></svg>`,
  help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5C9.5 8 10.5 7 12 7C13.5 7 14.5 8 14.5 9.5C14.5 11 12 11 12 13"/><circle cx="12" cy="16.5" r="0.5"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><rect x="3" y="4" width="10" height="16"/><path d="M21 12H9M17 8L21 12L17 16"/></svg>`,
};

/* ── 유저 정보 ── */
function getUserInfo() {
  const user = store.get('user');
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  return {
    name: meta.full_name ?? meta.name ?? user.email?.split('@')[0] ?? '사용자',
    avatar: meta.avatar_url ?? meta.picture ?? '',
    email: user.email ?? '',
  };
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ── 날짜 포매팅: 연도(11px용) / MM.DD — MM.DD ── */
function formatDateBlock(start: string | null, end: string | null): { year: string; range: string } {
  if (!start) return { year: '', range: 'DATE TBD' };
  const s = new Date(start);
  const pad = (n: number) => String(n).padStart(2, '0');
  const mmdd = (d: Date) => `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;

  const year = String(s.getFullYear());
  if (!end) return { year, range: mmdd(s) };

  const e = new Date(end);
  return { year, range: `${mmdd(s)}<span class="sep">—</span>${mmdd(e)}` };
}

/* ── D-Day 계산 ── */
function formatDDay(start: string | null): string | null {
  if (!start) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(start);
  target.setHours(0, 0, 0, 0);

  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'D-DAY';
  if (diffDays > 0) return `D-${diffDays}`;
  return `D+${Math.abs(diffDays)}`;
}

/* ── 내 여행 목록 로드 ── */
async function loadTrips(): Promise<Trip[]> {
  const user = store.get('user');
  if (!user) return [];

  const { data, error } = await supabase
    .from('trip_members')
    .select('trip_id, trips(*)')
    .eq('user_id', user.id);

  if (error) {
    console.error('여행 목록 로드 실패:', error.message);
    return [];
  }

  return (data ?? [])
    .map((row: { trips: Trip | null }) => row.trips)
    .filter((t): t is Trip => t !== null)
    .sort((a: Trip, b: Trip) => {
      const aTime = a.start_date ? new Date(a.start_date).getTime() : 0;
      const bTime = b.start_date ? new Date(b.start_date).getTime() : 0;
      return bTime - aTime;
    });
}

/* ── 여행 카드 (보딩 패스 구조) ── */
function createTripCard(trip: Trip, index: number): HTMLElement {
  const card = document.createElement('div');
  card.className = 'trip-card';
  card.style.animationDelay = `${index * 0.1}s`;

  const { year, range } = formatDateBlock(trip.start_date, trip.end_date);
  const dday = formatDDay(trip.start_date);
  const cityCode = trip.destinations?.join(' · ') || 'NO CITY';

  card.innerHTML = `
    <div class="trip-card-info">
      <div class="trip-card-city">${ICON_PIN}<span>${escapeHtml(cityCode)}</span></div>
      <h3 class="trip-card-name">${escapeHtml(trip.name)}</h3>
      <div class="trip-card-dates">
        ${year ? `<span class="trip-card-year">${year}</span>` : ''}
        <span class="trip-card-mmdd">${range}</span>
      </div>
      ${dday ? `<span class="trip-card-dday">${dday}</span>` : ''}
    </div>
    <div class="trip-card-img-wrap">
      <div class="trip-card-img" id="trip-img-${trip.id}"></div>
    </div>
  `;

  card.addEventListener('click', () => {
    store.set('currentTrip', trip);
    navigate(`board/${trip.id}`);
  });

  if (trip.destinations?.[0]) {
    loadCityImage(trip.destinations[0]).then((url) => {
      if (url) {
        const imgEl = card.querySelector(`#trip-img-${trip.id}`) as HTMLElement | null;
        if (imgEl) imgEl.style.backgroundImage = `url('${url}')`;
      }
    });
  }

  return card;
}

async function loadCityImage(cityKo: string): Promise<string | null> {
  const cacheKey = `city_img_${cityKo}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    const parsed: { url: string; ts: number } = JSON.parse(cached);
    if (Date.now() - parsed.ts < 24 * 60 * 60 * 1000) return parsed.url;
  }

  const { data } = await supabase
    .from('city_images')
    .select('image_url')
    .eq('city_ko', cityKo)
    .single<{ image_url: string }>();

  const url = data?.image_url ?? null;
  if (url) localStorage.setItem(cacheKey, JSON.stringify({ url, ts: Date.now() }));
  return url;
}

/* ── 네비 렌더 ── */
function navHtml(): string {
  const info = getUserInfo();
  const avatarInner = info?.avatar
    ? `<img src="${info.avatar}" alt="" referrerpolicy="no-referrer" />`
    : escapeHtml(info?.name.charAt(0) ?? '?');

  return `
    <nav class="tl-nav" id="tl-nav">
      <div class="tl-nav-logo" id="tl-logo">몽실이</div>
      <div class="tl-nav-profile">
        <button class="tl-nav-avatar-btn" id="tl-avatar">${avatarInner}</button>
        <div class="tl-dropdown" id="tl-dropdown">
          <div class="tl-dropdown-header">
            <div class="tl-dropdown-name">${escapeHtml(info?.name ?? '')}</div>
            <div class="tl-dropdown-email">${escapeHtml(info?.email ?? '')}</div>
          </div>
          <button class="tl-dropdown-item" id="tl-dd-trips">${DI.trip}<span>내 여행</span></button>
          <button class="tl-dropdown-item" id="tl-dd-settings">${DI.setting}<span>설정</span></button>
          <button class="tl-dropdown-item" id="tl-dd-help">${DI.help}<span>문의하기</span></button>
          <div class="tl-dropdown-divider"></div>
          <button class="tl-dropdown-item logout" id="tl-dd-logout">${DI.logout}<span>로그아웃</span></button>
        </div>
      </div>
    </nav>`;
}

/* ── 여행 목록 뷰 렌더 ── */
export async function renderTripList(): Promise<HTMLElement> {
  const page = document.createElement('div');
  page.className = 'trip-list-page';

  page.innerHTML = `
    ${navHtml()}
    <div class="trip-list-body">
      <div class="trip-list-header">
        <div>
          <h1 class="trip-list-title">내 여행</h1>
          <p class="trip-list-sub">MY TRIPS</p>
        </div>
        <div class="trip-list-actions">
          <button class="btn-new-trip" id="btn-new-trip">+ 새 여행</button>
        </div>
      </div>
      <div class="trip-grid" id="trip-grid">
        <div class="trip-grid-loading">LOADING…</div>
      </div>
    </div>
  `;

  page.querySelector('#tl-logo')!.addEventListener('click', () => navigate('trips'));

  const avatarBtn = page.querySelector('#tl-avatar');
  const dropdown = page.querySelector('#tl-dropdown');
  if (avatarBtn && dropdown) {
    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => dropdown.classList.remove('open'));
    dropdown.addEventListener('click', (e) => e.stopPropagation());
  }

  page.querySelector('#tl-dd-trips')?.addEventListener('click', () => navigate('trips'));
  page.querySelector('#tl-dd-settings')?.addEventListener('click', () => alert('설정 페이지는 곧 구현 예정이에요!'));
  page.querySelector('#tl-dd-help')?.addEventListener('click', () => alert('문의하기 기능은 곧 구현 예정이에요!'));
  page.querySelector('#tl-dd-logout')?.addEventListener('click', signOut);

  page.querySelector('#btn-new-trip')!.addEventListener('click', () => {
    alert('여행 생성 모달은 다음 단계에서 구현 예정!');
  });

  const trips = await loadTrips();
  const grid = page.querySelector('#trip-grid')!;

  if (trips.length === 0) {
    grid.innerHTML = `
      <div class="trip-empty">
        ${ICON_SUITCASE}
        <p class="trip-empty-text">아직 여행이 없어요</p>
        <p class="trip-empty-hint">새 여행을 만들어서 친구들을 초대해보세요</p>
      </div>
    `;
  } else {
    grid.innerHTML = '';
    trips.forEach((trip, i) => grid.appendChild(createTripCard(trip, i)));
  }

  return page;
}
