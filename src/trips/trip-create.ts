import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import { signOut } from '../auth/auth';
import { openCreateTripModal } from './trip-create';
import type { Database } from '../types/database';
import './trip-list.css';

type Trip = Database['public']['Tables']['trips']['Row'];

/* ── SVG ── */
const ICON_SUITCASE = `<svg class="trip-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><rect x="3" y="7" width="18" height="14"/><path d="M8 7V4H16V7"/></svg>`;
const ICON_ROUTE_ARROW = `<svg class="route-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12H19M13 6L19 12L13 18"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>`;
const ICON_WARNING = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>`;
const DI = {
  trip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><rect x="3" y="5" width="18" height="16"/><path d="M3 10H21M8 3V7M16 3V7"/></svg>`,
  setting: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><rect x="4" y="4" width="16" height="16"/><path d="M9 4V20M4 9H20"/></svg>`,
  help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5C9.5 8 10.5 7 12 7C13.5 7 14.5 8 14.5 9.5C14.5 11 12 11 12 13"/><circle cx="12" cy="16.5" r="0.5"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><rect x="3" y="4" width="10" height="16"/><path d="M21 12H9M17 8L21 12L17 16"/></svg>`,
};

/* ── 도시 → IATA 공항코드 매핑 ── */
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

/* ── 날짜 포매팅 ── */
function formatMMDD(dateStr: string | null): string {
  if (!dateStr) return '--.--';
  const d = new Date(dateStr);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function formatDays(start: string | null, end: string | null): string {
  if (!start || !end) return '-';
  const s = new Date(start);
  const e = new Date(end);
  const diff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
  return `${diff + 1}일`;
}

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

/* ── 여행 삭제 ── */
async function deleteTrip(tripId: string): Promise<{ success: boolean; error?: string }> {
  // trip_members 먼저 정리 (FK 제약 대비)
  const { error: memberError } = await supabase.from('trip_members').delete().eq('trip_id', tripId);
  if (memberError) return { success: false, error: memberError.message };

  const { error: tripError } = await supabase.from('trips').delete().eq('id', tripId);
  if (tripError) return { success: false, error: tripError.message };

  return { success: true };
}

/* ── 삭제 확인 모달 ── */
function openDeleteConfirm(trip: Trip, onDeleted: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'tdel-overlay';

  overlay.innerHTML = [
    '<div class="tdel-modal">',
    `  <div class="tdel-icon">${ICON_WARNING}</div>`,
    '  <div class="tdel-title">여행을 삭제할까요?</div>',
    `  <div class="tdel-desc"><strong>${escapeHtml(trip.name)}</strong> 여행을 삭제하시겠습니까?<br>이 작업은 되돌릴 수 없어요.</div>`,
    '  <div class="tdel-actions">',
    '    <button class="tdel-btn-cancel" id="tdel-cancel">취소</button>',
    '    <button class="tdel-btn-confirm" id="tdel-confirm">삭제하기</button>',
    '  </div>',
    '</div>',
  ].join('\n');

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 200);
  };

  overlay.querySelector('#tdel-cancel')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  const confirmBtn = overlay.querySelector('#tdel-confirm') as HTMLButtonElement;
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '삭제 중...';

    const result = await deleteTrip(trip.id);

    if (result.success) {
      close();
      onDeleted();
    } else {
      console.error('여행 삭제 실패:', result.error);
      confirmBtn.disabled = false;
      confirmBtn.textContent = '삭제하기';
      alert('삭제하지 못했어요. 잠시 후 다시 시도해주세요.');
    }
  });
}

/* ── 여행 카드 (보딩 패스) ── */
function createTripCard(trip: Trip, index: number, onDeleted: () => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'trip-card';
  card.style.animationDelay = `${index * 0.1}s`;

  const destCity = trip.destinations?.[0] ?? trip.name;
  const destCode = toAirportCode(destCity);
  const dday = formatDDay(trip.start_date);

  card.innerHTML = `
    <button class="trip-card-delete" id="del-${trip.id}" title="삭제">${ICON_TRASH}</button>
    <div class="trip-card-clip">
      <div class="trip-card-info">
        <span class="trip-pass-label">TRAVEL PASS</span>
        <div class="trip-card-route">
          <span>ICN</span>${ICON_ROUTE_ARROW}<span>${escapeHtml(destCode)}</span>
        </div>
        <div class="trip-card-name">${escapeHtml(trip.name)}</div>
        <div class="trip-info-divider"></div>

        <div class="trip-card-flightinfo">
          <div class="fi-col">
            <span class="fi-label">DEPART</span>
            <span class="fi-value">${formatMMDD(trip.start_date)}</span>
          </div>
          <div class="fi-col">
            <span class="fi-label">ARRIVE</span>
            <span class="fi-value">${formatMMDD(trip.end_date)}</span>
          </div>
          <div class="fi-col">
            <span class="fi-label">DAYS</span>
            <span class="fi-value">${formatDays(trip.start_date, trip.end_date)}</span>
          </div>
        </div>

        ${dday ? `<span class="fi-dday">${dday}</span>` : ''}
      </div>
      <div class="trip-card-img-wrap">
        <div class="trip-card-img" id="trip-img-${trip.id}"></div>
        <div class="trip-card-barcode"></div>
      </div>
    </div>
  `;

  // 카드 클릭 → 보드 이동
  card.addEventListener('click', () => {
    store.set('currentTrip', trip);
    navigate(`board/${trip.id}`);
  });

  // 삭제 버튼 클릭 → 카드 클릭 이벤트로 전파 안 되게 막고 확인 모달 오픈
  const deleteBtn = card.querySelector(`#del-${trip.id}`) as HTMLButtonElement;
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDeleteConfirm(trip, onDeleted);
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

  const refresh = async () => {
    const newPage = await renderTripList();
    document.getElementById('app')!.replaceChildren(newPage);
  };

  page.querySelector('#btn-new-trip')!.addEventListener('click', () => {
    openCreateTripModal(refresh);
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
    trips.forEach((trip, i) => grid.appendChild(createTripCard(trip, i, refresh)));
  }

  return page;
}
