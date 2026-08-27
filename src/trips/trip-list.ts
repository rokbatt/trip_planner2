import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import { signOut } from '../auth/auth';
import { openCreateTripModal } from './trip-create';
import { openEditTripModal } from './trip-edit';
import { toAirportCode, toAirportCityEn, airportCityEnByCode } from './airports';
import type { Database } from '../types/database';
import './trip-list.css';

type Trip = Database['public']['Tables']['trips']['Row'];

/* ── SVG ── */
const ICON_SUITCASE = `<svg class="trip-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><rect x="3" y="7" width="18" height="14"/><path d="M8 7V4H16V7"/></svg>`;
const ICON_ROUTE_ARROW = `<svg class="route-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12H19M13 6L19 12L13 18"/></svg>`;
const ICON_EDIT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
const ICON_PLANE = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 16.5v-2l-8.5-5V3.5c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v6l-8.5 5v2l8.5-2.5V19l-2.5 2v1.5l4-1 4 1V21l-2.5-2v-5.5l8.5 2.5z"/></svg>`;

/**
 * 바코드/QR은 실제 정보를 담지 않는 장식이라 무작위 패턴으로 그린다. 다만 Math.random을
 * 그대로 쓰면 카드가 다시 그려질 때마다 모양이 바뀌어 깜빡이므로, 트립 id를 시드로 쓰는
 * xorshift32로 "트립마다 다르지만 항상 같은" 무작위 패턴을 만든다.
 */
function seededRandom(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h ^ seed.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h = (h ^ (h << 13)) >>> 0;
    h = (h ^ (h >>> 17)) >>> 0;
    h = (h ^ (h << 5)) >>> 0;
    return h / 4294967296;
  };
}

/** 실제 항공권 하단의 굵기가 제각각인 세로 막대 바코드 */
function barcodeSvg(seed: string): string {
  const rand = seededRandom(seed);
  const bars: string[] = [];
  let x = 0;
  while (x < 168) {
    const w = 1 + Math.floor(rand() * 3);
    bars.push(`<rect x="${x}" y="0" width="${w}" height="30"/>`);
    x += w + 1 + Math.floor(rand() * 2);
  }
  return `<svg viewBox="0 0 ${x} 30" preserveAspectRatio="none" fill="#1E3A6B">${bars.join('')}</svg>`;
}

/** 모바일 탑승권의 QR — 모서리 3곳의 인식 패턴(finder)만 실제 QR처럼 두고 나머지는 무작위 */
function qrSvg(seed: string): string {
  const rand = seededRandom(seed + ':qr');
  const N = 21; // 실제 QR 최소 버전과 같은 21×21 격자
  const inFinder = (r: number, c: number) =>
    (r < 8 && c < 8) || (r < 8 && c >= N - 8) || (r >= N - 8 && c < 8);
  const cells: string[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (inFinder(r, c) || rand() > 0.45) continue;
      cells.push(`<rect x="${c}" y="${r}" width="1" height="1"/>`);
    }
  }
  const finder = (x: number, y: number) =>
    `<rect x="${x}" y="${y}" width="7" height="7"/>` +
    `<rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#FFFFFF"/>` +
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`;
  return (
    `<svg viewBox="0 0 ${N} ${N}" fill="#1E3A6B">` +
    cells.join('') +
    finder(0, 0) +
    finder(N - 7, 0) +
    finder(0, N - 7) +
    '</svg>'
  );
}
const DI = {
  trip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><rect x="3" y="5" width="18" height="16"/><path d="M3 10H21M8 3V7M16 3V7"/></svg>`,
  setting: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><rect x="4" y="4" width="16" height="16"/><path d="M9 4V20M4 9H20"/></svg>`,
  help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5C9.5 8 10.5 7 12 7C13.5 7 14.5 8 14.5 9.5C14.5 11 12 11 12 13"/><circle cx="12" cy="16.5" r="0.5"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><rect x="3" y="4" width="10" height="16"/><path d="M21 12H9M17 8L21 12L17 16"/></svg>`,
};

/* 도시 → IATA 공항코드 매핑은 airports.ts 한 곳에서 관리한다(workspace.ts와 공유) */

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

/** 스텁의 TRIP ID — 예약번호를 지어내는 대신 이 트립의 실제 정보(출발지·도착지·출발일)를
 * 조합해 만든다. 예: MGS-ICNBKK-1026 */
function tripIdCode(destCode: string, start: string | null): string {
  const mmdd = start ? formatMMDD(start).replace('.', '') : '0000';
  return `MGS-ICN${destCode}-${mmdd}`;
}

/** 스텁의 DATE — "10.26 – 10.30, 2026" */
function formatStubRange(start: string | null, end: string | null): string {
  if (!start || !end) return '-';
  return `${formatMMDD(start)} – ${formatMMDD(end)}, ${new Date(start).getFullYear()}`;
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

/* ── 여행 카드 (보딩 패스) ── */
function createTripCard(trip: Trip, index: number, onChanged: () => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'trip-card';
  card.style.animationDelay = `${index * 0.1}s`;

  const destCity = trip.destinations?.[0] ?? trip.name;
  const destCode = toAirportCode(destCity);
  const destCityEn = toAirportCityEn(destCity);
  const dday = formatDDay(trip.start_date);

  card.innerHTML = `
    <button class="trip-card-edit" id="edit-${trip.id}" title="편집">${ICON_EDIT}</button>
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
      <div class="trip-card-stub">
        <div class="stub-head">
          <div>
            <span class="stub-label">TRIP ID</span>
            <span class="stub-tripid">${escapeHtml(tripIdCode(destCode, trip.start_date))}</span>
          </div>
          <span class="stub-plane">${ICON_PLANE}</span>
        </div>

        <div class="stub-fields">
          <div class="stub-field">
            <span class="stub-label">DATE</span>
            <span class="stub-value">${formatStubRange(trip.start_date, trip.end_date)}</span>
          </div>
          <div class="stub-field">
            <span class="stub-label">FROM</span>
            <span class="stub-value"><b>ICN</b><span class="stub-city">${airportCityEnByCode('ICN') ?? ''}</span></span>
          </div>
          <div class="stub-field">
            <span class="stub-label">TO</span>
            <span class="stub-value"><b>${escapeHtml(destCode)}</b><span class="stub-city">${escapeHtml(destCityEn ?? '')}</span></span>
          </div>
          <div class="stub-field">
            <span class="stub-label">PAX</span>
            <span class="stub-value">${trip.headcount ?? '-'}</span>
          </div>
          <div class="stub-field">
            <span class="stub-label">DAYS</span>
            <span class="stub-value">${formatDays(trip.start_date, trip.end_date)}</span>
          </div>
        </div>

        <div class="stub-foot">
          <div class="stub-qr">${qrSvg(trip.id)}</div>
          <div class="stub-code">
            <div class="stub-barcode">${barcodeSvg(trip.id)}</div>
            <span class="stub-brand">MONGSIL TRAVEL WORKSPACE</span>
          </div>
        </div>
      </div>
    </div>
  `;

  // 카드 클릭 → 보드 이동
  card.addEventListener('click', () => {
    store.set('currentTrip', trip);
    navigate(`board/${trip.id}`);
  });

  // 편집 버튼 클릭 → 카드 클릭 이벤트로 전파 안 되게 막고 편집 모달 오픈
  // (제목·여행지 추가/변경/삭제·여행 삭제를 모두 여기서 처리)
  const editBtn = card.querySelector(`#edit-${trip.id}`) as HTMLButtonElement;
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditTripModal(trip, onChanged);
  });

  return card;
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
