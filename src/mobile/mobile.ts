/**
 * MOBILE — 여행 중 Companion 화면.
 *
 * 데스크톱 TIMELINE을 반응형으로 줄인 게 아니라, **역할이 다른 두 번째 표면**이다.
 *   PC     = PLANNER    : 4개 게이트로 "어디를 갈지" 결정한다
 *   MOBILE = COMPANION  : 확정된 하루를 "지금 어디로"만 보고 따라간다
 * (자세한 배경은 docs/MOBILE_STRATEGY.md)
 *
 * 그래서 편집 UI(순서 변경·이동수단 선택·지도 편집)는 여기 없다. 대신 한 손으로 읽기 좋은
 * 밀도와, 카드를 누르면 장소 상세로 밀려 들어가는 두 화면 구조만 갖는다.
 *
 * **길찾기는 원터치, 자체 지도 없이.** 카드 우상단(`.mb-card-nav`), Overview·Guide 탭의
 * "길찾기" 링크가 전부 `directionsHref(stop)` 하나를 쓴다 — Google Maps 딥링크(`/maps/dir/`)
 * 조합뿐이라 API 비용이 0(원칙 3-2)이고, 출발지를 일부러 안 넣어서 앱이 위치 권한을 따로
 * 요청할 필요가 없다(생략하면 Google Maps가 여는 기기의 현재 위치를 자동으로 쓴다).
 * 자체 내비게이션·지도 타일 캐싱은 만들지 않는다 — 실시간 교통정보를 우리가 지어낼 수 없고
 * (원칙 3-1), 만들 이유도 없다.
 *
 * 컬러는 Light가 기본(프로젝트 원래 Airport Lounge Premium Light)이고, 기기가 다크모드면
 * "Night Lounge"로 바뀐다. 색의 의미 고정은 mobile.css 상단 주석 참고 —
 * 골드 = AI가 만든 값·별점 / 파랑 = 우리 DB의 실제 값·링크 / 회색 = 추정 / 주황 = 지금.
 *
 * ⚠️ 일정 데이터·시각 계산은 **직접 하지 않는다.** `timeline/dayModel.ts`의 loadDayModel과
 *    scheduleFor를 그대로 쓴다 — 같은 DAY인데 PC와 폰의 도착 시각이 다르면 그 자체가
 *    버그이기 때문이다(Claude.md 5-3). 이 파일에는 표현(마크업·색·아이콘)만 있다.
 *
 * **실제 도착 기록 → 남은 일정 자동 재계산.** 오늘 DAY의 카드에서 "도착"을 누르면
 * `stopProgress.ts`가 `trip_stop_progress`에 실제 시각을 저장하고, `scheduleFor`에 그 값을
 * 넘기면 이후 정류지들의 예상 시각이 자동으로 다시 계산된다(계획을 덮어쓰지 않는다 —
 * 자세한 이유는 stopProgress.ts와 supabase/trip_stop_progress.sql 참고). 이 기록은 오늘
 * DAY에서만 뜬다 — 지난 날·미래 날에는 "도착"이 의미가 없다.
 *
 * 원칙 3-1 — 화면에 뜨는 값의 출처를 섞지 않는다.
 *   · 평점·영업시간·주소  : DB에 저장된 실제 값이 있을 때만
 *   · 도착 시각·체류·이동 : 추정치(구간마다 "추정" 표기, 헤더에 안내)
 *   · 요약·놓치지 말 것    : Gemini(`AI` 태그 필수) — 없으면 만들지 않고 생성 버튼만 둔다
 *   입장료·예약 필요 여부처럼 근거가 아예 없는 값은 지어내지 않고 "확인 필요"로 남긴다.
 */

import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import { subscribeRoutePlan, unsubscribeRoutePlan, resetRouteStorageProbe } from '../route/routeStore';
import { loadDayModel, scheduleFor, stopLegKey, todaysHoursLine } from '../timeline/dayModel';
import type { TlDay, TlStop, DaySchedule, RealLegMap, ProgressMap, StopProgress } from '../timeline/dayModel';
import {
  loadStopProgress,
  markArrived,
  markDeparted,
  markSkipped,
  resetProgress,
  subscribeStopProgress,
  unsubscribeStopProgress,
  resetStopProgressStorageProbe,
} from './stopProgress';
import {
  modeLabel,
  fmtMin,
  fmtKm,
  minToHHMM,
  dwellMinutes,
  CAT_LABEL,
} from '../utils/travelEstimate';
import type { RealLeg, TravelMode } from '../utils/travelEstimate';
import {
  loadExpenseCtx,
  buildExpensePayload,
  fetchRate,
  computeSettlement,
  memberName,
  sumPaid,
  sumPaidOn,
  getTotalBudget,
  krwOf,
  categoryOf,
  fmtKRW,
  fmtAmount,
  symbolOf,
  unconvertedCount,
  EXPENSE_CATEGORIES,
  CATEGORY_META,
  CURRENCIES,
} from '../expense/expenseModel';
import type { ExpenseCtx, ExpenseCategory } from '../expense/expenseModel';
import { requestPlaceBrief, placeBriefKey } from '../timeline/placeBrief';
import type { PlaceBrief, PlaceBriefRequest } from '../timeline/placeBrief';
import type { Database, TripDestination } from '../types/database';
import './mobile.css';

type Place = Database['public']['Tables']['places']['Row'];
type Trip = Database['public']['Tables']['trips']['Row'];

/* ══════════════ 아이콘 (얇은 선 — 이모지 금지, Claude.md 5-3) ══════════════ */

const IC = {
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12l20-7-7 20-3-8-8-3z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 6-3 7-3 7h18s-3-1-3-7"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  chevDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  chevRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.8 5.9 20.4 7.2 13.7 2.2 9l6.8-.8z"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-4.5L5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  walk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="M11 8l-3 3 2 7M11 8l3 2 3-1M8 11l-3 2v6M13 10l2 4-2 6"/></svg>',
  transit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="14" rx="2"/><path d="M4 11h16M8 21l2-4h4l2 4M8 7h.01M16 7h.01"/></svg>',
  taxi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M5 17l1.5-5h11L19 17M8 12V8h8v4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3Z"/></svg>',
  starLine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l2.6 5.5 5.9.8-4.3 4.1 1.1 5.9L12 17l-5.3 2.8 1.1-5.9L3.5 9.8l5.9-.8z"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="14" rx="2.5"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M9 11v6M15 11v6"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.4"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5z"/><path d="M14.5 6.5 17.5 9.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/></svg>',
  route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H14a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h5.5"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M17 14.5h.01"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 8h16M4 14h16"/></svg>',
  navigate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  padDel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9L3 12l6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="M17 9.5 12.5 14M12.5 9.5 17 14"/></svg>',
};

const MODE_ICON: Record<TravelMode, string> = { WALK: IC.walk, TRANSIT: IC.transit, TAXI: IC.taxi };

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

type MbTab = 'today' | 'timeline' | 'wallet' | 'more';
type PdTab = 'overview' | 'guide' | 'reviews';

/* ══════════════ 모듈 상태 ══════════════ */

let container: HTMLElement | null = null;
let currentTripId = '';
let currentTrip: Trip | null = null;
let activeDestId: string | null = null;
let allDestinations: TripDestination[] = [];

let days: TlDay[] = [];
let activeDayIndex = 0;
let activeTab: MbTab = 'today';

/** 열려 있는 장소 상세의 stop key (null이면 목록 화면) */
let detailKey: string | null = null;
let detailTab: PdTab = 'overview';

let placeBriefs = new Map<string, PlaceBrief>();
let placeBriefLoading = new Set<string>();
let placeBriefErrors = new Map<string, string>();

let realLegs: RealLegMap = new Map();
let realLegPending = false;

/** 활성 DAY(오늘 보고 있는 하루)의 정류지별 실제 도착/출발 기록 — 활성 DAY만 불러온다(원칙 3-2와
 *  같은 절제: 안 보는 날의 진행 기록까지 매번 조회하지 않는다). 키는 TlStop.key. */
let progress: ProgressMap = new Map();

let daySheetOpen = false;
let nowTimer: ReturnType<typeof setInterval> | null = null;

/* ── WALLET ── */
/** 지출·예산·멤버. WALLET 탭을 처음 열 때만 불러온다(원칙 3-2 — 안 보는 탭을 미리 조회하지 않음) */
let expenseCtx: ExpenseCtx | null = null;
let expenseLoading = false;
let expenseChannel: ReturnType<typeof supabase.channel> | null = null;
/** 숫자패드 시트 상태 */
let padOpen = false;
let padAmount = '';
let padCurrency = 'KRW';
let padCategory: ExpenseCategory = 'ETC';
let padSaving = false;
/** 현재 통화의 환율 미리보기(≈₩) — fetchRate가 통화당 1회만 조회하고 캐시한다 */
let padRate: { rate: number | null; source: string } | null = null;

export function teardownMobile(): void {
  unsubscribeRoutePlan();
  resetRouteStorageProbe();
  unsubscribeStopProgress();
  resetStopProgressStorageProbe();
  if (nowTimer) {
    clearInterval(nowTimer);
    nowTimer = null;
  }
  container = null;
  currentTripId = '';
  currentTrip = null;
  activeDestId = null;
  allDestinations = [];
  days = [];
  activeDayIndex = 0;
  activeTab = 'today';
  detailKey = null;
  detailTab = 'overview';
  placeBriefs = new Map();
  placeBriefLoading = new Set();
  placeBriefErrors = new Map();
  realLegs = new Map();
  realLegPending = false;
  progress = new Map();
  daySheetOpen = false;
  if (expenseChannel) {
    supabase.removeChannel(expenseChannel);
    expenseChannel = null;
  }
  expenseCtx = null;
  expenseLoading = false;
  padOpen = false;
  padAmount = '';
  padCurrency = 'KRW';
  padCategory = 'ETC';
  padSaving = false;
  padRate = null;
}

/* ══════════════ 유틸 ══════════════ */

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function todayISO(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** 오늘이 여행 기간 안이면 그 DAY 인덱스, 아니면 -1 */
function todayDayIndex(): number {
  const t = todayISO();
  return days.findIndex((d) => d.date === t);
}

function activeDay(): TlDay | null {
  return days[activeDayIndex] ?? null;
}

/** "10.26 (일)" */
function dateLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return (d.getMonth() + 1) + '.' + String(d.getDate()).padStart(2, '0') + ' (' + WEEKDAY[d.getDay()] + ')';
}

function destName(): string {
  const d = allDestinations.find((x) => x.id === activeDestId);
  return d?.name ?? currentTrip?.destinations?.[0] ?? '여행';
}

async function loadTrip(tripId: string): Promise<Trip | null> {
  const cached = store.get('currentTrip');
  if (cached && cached.id === tripId) return cached;
  const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).single();
  if (error) {
    console.error('[Mobile] Trip load error:', error.message);
    return null;
  }
  return data;
}

function gotoGate(gate: string): void {
  if (!currentTripId) return;
  navigate('trip/' + currentTripId + '/' + gate);
}

/**
 * 이 정류지로 가는 길찾기 링크(Google Maps). URL 조합뿐이라 API 비용이 0(원칙 3-2).
 * 목적지는 좌표가 있으면 좌표로, 없으면 이름으로 잡는다. 출발지는 일부러 넣지 않는다 —
 * 비워두면 Google Maps가 이 링크를 여는 기기의 현재 위치를 출발지로 자동으로 잡아준다
 * (우리가 위치 권한을 따로 요청할 필요가 없다).
 * 이 정류지로 "들어오는" 구간에 사용자가 직접 지정한 이동수단이 있으면 힌트로 같이 넘긴다 —
 * 없으면 Google Maps가 알아서 고른다.
 */
function directionsHref(stop: TlStop): string {
  const dest = stop.lat != null && stop.lng != null ? stop.lat + ',' + stop.lng : stop.name;
  const mode =
    stop.travelMode === 'WALK' ? 'walking' : stop.travelMode === 'TRANSIT' ? 'transit' : stop.travelMode === 'TAXI' ? 'driving' : null;
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(dest) + (mode ? '&travelmode=' + mode : '');
}

/* ══════════════ 진입점 ══════════════ */

export async function renderMobileContent(host: HTMLElement, tripId: string): Promise<void> {
  teardownMobile();
  container = host;
  currentTripId = tripId;

  host.innerHTML = '<div class="mb-app"><div class="mb-loading"><span class="mb-spinner"></span>일정 불러오는 중…</div></div>';

  const trip = await loadTrip(tripId);
  currentTrip = trip;
  if (!trip) {
    host.innerHTML = '<div class="mb-app"><div class="mb-loading">여행 정보를 찾을 수 없어요.</div></div>';
    return;
  }

  const model = await loadDayModel(trip);
  days = model.days;
  allDestinations = model.destinations;
  activeDestId = model.activeDestId;

  // 여행 중이면 오늘 DAY로, 아니면 일정이 처음 들어 있는 DAY로 연다
  const today = todayDayIndex();
  const firstFilled = days.findIndex((d) => d.stops.length > 0);
  activeDayIndex = today >= 0 ? today : firstFilled >= 0 ? firstFilled : 0;

  render();

  subscribeRoutePlan(tripId, () => { void reloadFromRemote(); });
  subscribeStopProgress(tripId, () => { void loadProgressForActiveDay(); });
  void loadRealLegsForActiveDay();
  void loadProgressForActiveDay();

  // "지금" 표시는 분 단위로만 움직이면 충분하다
  nowTimer = setInterval(() => { if (todayDayIndex() >= 0 && !detailKey) render(); }, 60_000);
}

async function reloadFromRemote(): Promise<void> {
  if (!currentTrip) return;
  const model = await loadDayModel(currentTrip);
  days = model.days;
  allDestinations = model.destinations;
  activeDestId = model.activeDestId;
  if (activeDayIndex >= days.length) activeDayIndex = Math.max(0, days.length - 1);
  render();
}

/** 활성 DAY의 진행 기록만 불러온다(원칙 3-2). DAY를 옮길 때마다 다시 호출한다. */
async function loadProgressForActiveDay(): Promise<void> {
  if (!activeDestId) {
    if (progress.size) { progress = new Map(); render(); }
    return;
  }
  const map = await loadStopProgress(activeDestId, activeDayIndex);
  if (!map) return; // 저장소를 못 씀(마이그레이션 전) — 조용히 유지
  progress = map;
  render();
}

/* ══════════════ 실측 경로 (활성 DAY만) ══════════════ */

/**
 * 원칙 3-2 — 화면에 들어올 때마다 전부 조회하지 않는다. 지금 보고 있는 DAY의, 아직 안 받은
 * 구간만 묻는다(TIMELINE과 같은 전략). 실패하면 조용히 추정치를 유지한다.
 */
async function loadRealLegsForActiveDay(): Promise<void> {
  const day = activeDay();
  if (!day || realLegPending) return;
  const stops = day.stops.filter((s) => s.lat != null && s.lng != null);
  if (stops.length < 2) return;

  const pending: Array<{ id: string; from: { lat: number; lng: number }; to: { lat: number; lng: number } }> = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const key = stopLegKey(stops[i], stops[i + 1]);
    if (realLegs.has(key) || pending.some((p) => p.id === key)) continue;
    pending.push({
      id: key,
      from: { lat: stops[i].lat!, lng: stops[i].lng! },
      to: { lat: stops[i + 1].lat!, lng: stops[i + 1].lng! },
    });
  }
  if (!pending.length) return;

  realLegPending = true;
  try {
    const res = await fetch('/api/route-matrix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs: pending, modes: ['WALK', 'TRANSIT', 'DRIVE'] }),
    });
    if (!res.ok) return;
    const json = await res.json();
    const results: Array<{ id: string; modes: Record<string, RealLeg> }> = json?.results ?? [];
    let got = false;
    results.forEach((r) => {
      if (r.modes && Object.keys(r.modes).length) {
        realLegs.set(r.id, r.modes);
        got = true;
      }
    });
    if (got) render();
  } catch (e) {
    console.error('[Mobile] /api/route-matrix 요청 실패:', e);
  } finally {
    realLegPending = false;
  }
}

/* ══════════════ 렌더 ══════════════ */

function render(): void {
  if (!container) return;
  const scrollTop = (container.querySelector('.mb-scroll') as HTMLElement | null)?.scrollTop ?? 0;

  container.innerHTML = '<div class="mb-app">' + appHtml() + '</div>';
  applyPhotos();
  bind();

  // 목록으로 돌아왔을 때 보던 위치를 잃지 않게(상세를 열고 닫으면 위로 튀는 걸 막음)
  const scroller = container.querySelector('.mb-scroll') as HTMLElement | null;
  if (scroller && !detailKey) scroller.scrollTop = scrollTop;
}

function appHtml(): string {
  if (detailKey) return detailHtml();
  return [
    topBarHtml(),
    '<main class="mb-scroll">' + tabBodyHtml() + '</main>',
    tabBarHtml(),
    daySheetOpen ? daySheetHtml() : '',
    padOpen ? padSheetHtml() : '',
  ].join('');
}

function tabBodyHtml(): string {
  if (activeTab === 'today') return todayTabHtml();
  if (activeTab === 'timeline') return allDaysTabHtml();
  if (activeTab === 'wallet') return walletTabHtml();
  return comingSoonHtml();
}

/* ── 상단 바 ── */

function topBarHtml(): string {
  const day = activeDay();
  const isToday = day?.date === todayISO();
  const brandRow = [
    '<header class="mb-top">',
    '  <div class="mb-brand"><span class="mb-brand-mark">' + IC.logo + '</span>몽실이</div>',
    '  <div class="mb-top-actions">',
    '    <button class="mb-icon-btn" id="mb-links" aria-label="링크">' + IC.bell + '</button>',
    '    <button class="mb-icon-btn" id="mb-menu" aria-label="메뉴">' + IC.menu + '</button>',
    '  </div>',
    '</header>',
  ].join('');

  // DAY를 고르는 건 일정 화면에서만 의미가 있다 — 지갑은 하루가 아니라 여행 전체를 다룬다
  if (activeTab === 'wallet') {
    return [
      brandRow,
      '<div class="mb-daybar"><span class="mb-screen-title">지갑</span></div>',
      '<div class="mb-daymeta">',
      '  <span class="mb-date">' + escapeHtml(destName()) + ' · 여행 전체</span>',
      '</div>',
    ].join('');
  }

  return [
    brandRow,
    '<div class="mb-daybar">',
    '  <button class="mb-daypick" id="mb-daypick">',
    '    <span class="mb-daypick-dest">' + escapeHtml(destName().toUpperCase()) + '</span>',
    '    <span class="mb-daypick-sep">·</span>',
    '    <span class="mb-daypick-day">' + escapeHtml(day?.label ?? 'DAY 1') + '</span>',
    '    <span class="mb-daypick-chev">' + IC.chevDown + '</span>',
    '  </button>',
    '</div>',
    '<div class="mb-daymeta">',
    isToday ? '  <span class="mb-today-chip">TODAY</span>' : '',
    '  <span class="mb-date">' + escapeHtml(dateLabel(day?.date ?? null)) + '</span>',
    '</div>',
  ].join('');
}

/* ── 하단 탭 ── */

function tabBarHtml(): string {
  const items: Array<{ key: MbTab; label: string; icon: string }> = [
    { key: 'today', label: 'TODAY', icon: IC.home },
    { key: 'timeline', label: 'TIMELINE', icon: IC.route },
    { key: 'wallet', label: 'WALLET', icon: IC.wallet },
    { key: 'more', label: 'MORE', icon: IC.dots },
  ];
  return (
    '<nav class="mb-tabs">' +
    items
      .map(
        (t) =>
          '<button class="mb-tab' + (t.key === activeTab ? ' active' : '') + '" data-tab="' + t.key + '">' +
          '<span class="mb-tab-ic">' + t.icon + '</span>' +
          '<span class="mb-tab-label">' + t.label + '</span>' +
          '</button>'
      )
      .join('') +
    '</nav>'
  );
}

/* ══════════════ TODAY 탭 — 시간축 위의 하루 ══════════════ */

function todayTabHtml(): string {
  const day = activeDay();
  if (!day) return emptyHtml('일정이 아직 없어요', 'PC에서 ROUTE로 동선을 먼저 만들어 주세요.');
  if (!day.stops.length) return emptyHtml('이 날은 비어 있어요', '다른 DAY를 보거나, PC에서 일정을 채워 주세요.');

  const s = scheduleFor(day, realLegs, progress);
  const isToday = day.date === todayISO();
  const now = nowMinutes();

  // "지금 진행 중"인 정류지 — 사용자가 직접 "도착"을 기록했으면 그게 가장 확실한 신호다.
  // 아직 아무도 기록하지 않았으면 지금 시각이 예상 도착~출발 사이인 정류지로 추정한다
  // (원칙 3-1: 실제 기록 > 추정. 여행 중이 아니면 아예 띄우지 않는다).
  let nowIdx = -1;
  if (isToday) {
    const arrivedIdx = day.stops.findIndex((st) => progress.get(st.key)?.status === 'arrived');
    nowIdx = arrivedIdx >= 0 ? arrivedIdx : day.stops.findIndex((_, i) => now >= s.arriveMin[i] && now < s.departMin[i]);
  }

  const rows: string[] = [];
  day.stops.forEach((stop, i) => {
    rows.push(stopCardHtml(stop, i, s, day.date, i === nowIdx, isToday, progress.get(stop.key)));
    if (i < day.stops.length - 1) rows.push(legNodeHtml(s.legs[i], i));
  });

  return [
    '<div class="mb-daysum">',
    '  <span>' + minToHHMM(s.spanStartMin) + ' – ' + minToHHMM(s.spanEndMin) + '</span>',
    '  <span class="mb-daysum-dot">·</span>',
    '  <span>' + day.stops.length + '곳</span>',
    s.legCount ? '  <span class="mb-daysum-dot">·</span><span>이동 ' + fmtMin(s.totalMoveMin) + '</span>' : '',
    '</div>',
    // 원칙 3-1 — 개별 구간마다 "추정"을 반복하는 대신 하루 단위로 한 번 밝힌다
    s.legCount > s.realLegCount
      ? '<p class="mb-estimate-note">* 이동·체류 시간은 추정치예요.</p>'
      : '',
    '<div class="mb-thread">',
    '  <div class="mb-spine" aria-hidden="true"></div>',
    rows.join(''),
    '</div>',
    '<button class="mb-add" id="mb-add">' + IC.plus + ' 일정 추가</button>',
  ].join('');
}

/**
 * 일정 카드 한 장. 사진이 카드 전체를 채우고 그 위에 어둡게 깔린 그라데이션 위로 글자가 올라간다.
 * 번호 배지는 좌상단, 북마크는 우상단 — 사진 레퍼런스와 같은 배치.
 *
 * `showTrack`(오늘 DAY일 때만 true)이면 도착/출발/건너뛰기 버튼을 카드 하단에 붙인다 —
 * 지난 날·미래 날에는 "도착"이 의미가 없으므로 아예 렌더링하지 않는다.
 */
function stopCardHtml(
  stop: TlStop,
  i: number,
  s: DaySchedule,
  dateISO: string | null,
  isNow: boolean,
  showTrack: boolean,
  prog: StopProgress | undefined
): string {
  const place = stop.place;
  const photo = place?.photo_url ?? null;
  const rating = typeof place?.google_rating === 'number' ? place.google_rating : null;
  const hours = todaysHoursLine(place ?? null, dateISO);
  const timeRange = minToHHMM(s.arriveMin[i]) + ' - ' + minToHHMM(s.departMin[i]);
  const overrun = s.overrunMin[i];
  // 이미 다녀왔거나 건너뛴 곳은 살짝 가라앉혀서, 눈이 자연히 "아직 안 간 곳"으로 가게 한다
  const done = prog?.status === 'departed' || prog?.status === 'skipped';

  // "숙소 들르기"처럼 목적만 있는 스탑은 사진·평점이 없으므로 얇은 줄 카드로 따로 그린다
  if (stop.purpose) {
    return [
      '<div class="mb-stop">',
      '<article class="mb-card mb-card-slim">',
      '  <span class="mb-card-num">' + (i + 1) + '</span>',
      '  <div class="mb-slim-body">',
      '    <div class="mb-slim-name">' + escapeHtml(stop.name) + '</div>',
      '    <div class="mb-slim-meta">' + escapeHtml(stop.purpose) + ' · ' + timeRange + '</div>',
      '  </div>',
      '</article>',
      '</div>',
    ].join('');
  }

  // 카드는 사진을 위해 overflow:hidden이라 NOW 배지·시간축 마디가 잘린다 —
  // 그래서 잘리면 안 되는 것들은 카드 바깥의 래퍼(.mb-stop)에 얹는다.
  return [
    '<div class="mb-stop' + (isNow ? ' is-now' : '') + '">',
    isNow ? '  <span class="mb-now-flag">NOW</span>' : '',
    '<article class="mb-card' + (isNow ? ' is-now' : '') + (photo ? '' : ' no-photo') + (done ? ' is-done' : '') + '"',
    '  data-stop="' + escapeHtml(stop.key) + '" role="button" tabindex="0">',
    photo ? '  <div class="mb-card-photo" data-photo="' + escapeHtml(photo) + '"></div>' : '',
    '  <div class="mb-card-scrim"></div>',
    '  <span class="mb-card-num">' + (i + 1) + '</span>',
    '  <div class="mb-card-actions">',
    // 상세로 안 들어가고 바로 이동할 수 있는 원터치 길찾기 — 여행 중 가장 자주 쓰는 동작
    '    <a class="mb-card-nav" href="' + directionsHref(stop) + '" target="_blank" rel="noopener" aria-label="길찾기" data-nav="' + escapeHtml(stop.key) + '">' + IC.navigate + '</a>',
    '    <button class="mb-card-bm" data-bm="' + escapeHtml(stop.key) + '" aria-label="저장">' + IC.bookmark + '</button>',
    '  </div>',
    '  <div class="mb-card-body">',
    '    <h3 class="mb-card-name">' + escapeHtml(stop.name) + '</h3>',
    // 실제 저장된 카테고리가 있을 때만 (원칙 3-1)
    place?.category ? '    <p class="mb-card-cat">' + escapeHtml(place.category) + '</p>' : '',
    '    <div class="mb-card-meta">',
    '      <span class="mb-meta-item">' + IC.clock + timeRange + '</span>',
    rating != null ? '      <span class="mb-meta-item rating">' + IC.star + rating.toFixed(1) + '</span>' : '',
    '    </div>',
    // 저장된 실제 값만 배지로 — 없으면 아예 안 보여준다
    hours ? '    <div class="mb-card-note">' + IC.clock + '<span>' + escapeHtml(hours) + '</span></div>' : '',
    stop.memo ? '    <div class="mb-card-note">' + IC.pencil + '<span>' + escapeHtml(stop.memo) + '</span></div>' : '',
    overrun > 0
      ? '    <div class="mb-card-warn">앞 일정을 다 하면 ' + fmtMin(overrun) + ' 늦어요</div>'
      : '',
    showTrack ? trackHtml(stop, prog) : '',
    '  </div>',
    '</article>',
    '</div>',
  ].join('');
}

/** ISO 타임스탬프를 "HH:MM"으로 — 여행자의 폰이 현지 시간대를 따라간다고 가정한다 */
function fmtClock(iso: string): string {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/**
 * 카드 하단의 도착/출발/건너뛰기 버튼 줄. 네 가지 상태를 오간다 —
 *   pending(기본) → [도착] → arrived → [출발] → departed
 *                 → [건너뛰기] → skipped
 * 어느 상태에서든 "되돌리기"로 pending으로 되돌릴 수 있다(잘못 눌렀을 때).
 */
function trackHtml(stop: TlStop, prog: StopProgress | undefined): string {
  const key = escapeHtml(stop.key);
  const status = prog?.status ?? 'pending';

  if (status === 'arrived') {
    const t = prog?.actualArriveAt ? fmtClock(prog.actualArriveAt) : '';
    return [
      '<div class="mb-track">',
      '  <span class="mb-track-status">' + t + ' 도착</span>',
      '  <button class="mb-track-btn primary" data-depart="' + key + '">' + IC.check + '출발</button>',
      '  <button class="mb-track-undo" data-reset="' + key + '">되돌리기</button>',
      '</div>',
    ].join('');
  }
  if (status === 'departed') {
    const a = prog?.actualArriveAt ? fmtClock(prog.actualArriveAt) : '';
    const d = prog?.actualDepartAt ? fmtClock(prog.actualDepartAt) : '';
    return [
      '<div class="mb-track">',
      '  <span class="mb-track-status done">' + IC.check + a + ' – ' + d + ' 다녀옴</span>',
      '  <button class="mb-track-undo" data-reset="' + key + '">되돌리기</button>',
      '</div>',
    ].join('');
  }
  if (status === 'skipped') {
    return [
      '<div class="mb-track">',
      '  <span class="mb-track-status muted">건너뜀</span>',
      '  <button class="mb-track-undo" data-reset="' + key + '">되돌리기</button>',
      '</div>',
    ].join('');
  }
  return [
    '<div class="mb-track">',
    '  <button class="mb-track-btn primary" data-arrive="' + key + '">' + IC.check + '도착</button>',
    '  <button class="mb-track-btn ghost" data-skip="' + key + '">건너뛰기</button>',
    '</div>',
  ].join('');
}

/**
 * 카드와 카드 사이 — 중앙선 위에 얹히는 이동 구간 노드.
 * 선이 카드를 관통하는 것처럼 보이게 하는 핵심 요소라, 칩 자체가 선 위 한가운데에 앉는다.
 */
function legNodeHtml(leg: ReturnType<typeof scheduleFor>['legs'][number], i: number): string {
  if (!leg) {
    return '<div class="mb-leg"><span class="mb-leg-dot" aria-hidden="true"></span></div>';
  }
  const cls = leg.mode === 'WALK' ? 'walk' : leg.mode === 'TRANSIT' ? 'transit' : 'taxi';
  return [
    '<div class="mb-leg" data-leg="' + i + '">',
    '  <span class="mb-leg-chip ' + cls + '">',
    '    <span class="mb-leg-ic">' + MODE_ICON[leg.mode] + '</span>',
    '    <span class="mb-leg-text">' + escapeHtml(modeLabel(leg.mode)) + ' ' + fmtMin(leg.min) + '</span>',
    '    <span class="mb-leg-km">' + fmtKm(leg.km) + '</span>',
    leg.real ? '' : '    <span class="mb-leg-est">추정</span>',
    '  </span>',
    '</div>',
  ].join('');
}

/* ══════════════ TIMELINE 탭 — 전체 DAY 한눈에 ══════════════ */

function allDaysTabHtml(): string {
  if (!days.some((d) => d.stops.length)) {
    return emptyHtml('일정이 아직 없어요', 'PC에서 ROUTE로 동선을 먼저 만들어 주세요.');
  }
  const t = todayISO();
  const rows = days.map((d, idx) => {
    // progress는 활성 DAY만 불러와 있다(원칙 3-2) — 다른 DAY의 키와는 안 겹치므로 그냥 넘겨도
    // 안전하고, 활성 DAY 행에서는 실제 기록이 반영된 시각을 보여주는 보너스가 된다.
    const s = scheduleFor(d, realLegs, progress);
    const filled = d.stops.length > 0;
    const names = d.stops.slice(0, 3).map((x) => x.name).join(' · ');
    const more = d.stops.length > 3 ? ' 외 ' + (d.stops.length - 3) + '곳' : '';
    return [
      '<button class="mb-dayrow' + (idx === activeDayIndex ? ' active' : '') + '" data-goday="' + idx + '">',
      '  <div class="mb-dayrow-left">',
      '    <span class="mb-dayrow-label">' + escapeHtml(d.label) + '</span>',
      '    <span class="mb-dayrow-date">' + escapeHtml(dateLabel(d.date)) + (d.date === t ? ' · TODAY' : '') + '</span>',
      '  </div>',
      '  <div class="mb-dayrow-mid">',
      filled
        ? '    <span class="mb-dayrow-names">' + escapeHtml(names) + escapeHtml(more) + '</span>' +
          '    <span class="mb-dayrow-sub">' + minToHHMM(s.spanStartMin) + '–' + minToHHMM(s.spanEndMin) +
          (s.legCount ? ' · 이동 ' + fmtMin(s.totalMoveMin) : '') + '</span>'
        : '    <span class="mb-dayrow-empty">비어 있어요</span>',
      '  </div>',
      '  <span class="mb-dayrow-chev">' + IC.chevRight + '</span>',
      '</button>',
    ].join('');
  });
  return '<div class="mb-daylist">' + rows.join('') + '</div>';
}

/* ══════════════════════ WALLET 탭 ══════════════════════ */

/** 지출 데이터를 아직 안 불렀으면 불러온다 — WALLET을 처음 열 때만(원칙 3-2) */
async function ensureExpenseCtx(): Promise<void> {
  if (expenseCtx || expenseLoading || !currentTripId) return;
  expenseLoading = true;
  render();
  try {
    expenseCtx = await loadExpenseCtx(currentTripId);
    // 마지막으로 쓴 통화를 기본값으로 — 방콕 여행이면 두 번째 지출부터 THB가 미리 잡힌다
    const last = [...expenseCtx.expenses].reverse().find((e) => e.currency);
    if (last?.currency) padCurrency = last.currency;
    subscribeExpenses();
  } catch (e) {
    console.error('[Mobile] 지출 로드 실패:', e);
  } finally {
    expenseLoading = false;
    render();
  }
}

/** 다른 멤버가 지출을 넣으면 지갑도 즉시 따라간다 (links·expenses와 같은 패턴) */
function subscribeExpenses(): void {
  if (expenseChannel || !currentTripId) return;
  expenseChannel = supabase
    .channel('mb-expenses:' + currentTripId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trip_expenses', filter: 'trip_id=eq.' + currentTripId },
      () => { void reloadExpenses(); }
    )
    .subscribe();
}

async function reloadExpenses(): Promise<void> {
  if (!currentTripId) return;
  try {
    expenseCtx = await loadExpenseCtx(currentTripId);
    if (activeTab === 'wallet') render();
  } catch (e) {
    console.error('[Mobile] 지출 새로고침 실패:', e);
  }
}

function walletTabHtml(): string {
  if (expenseLoading && !expenseCtx) {
    return '<div class="mb-wallet-loading"><span class="mb-spinner"></span>지출 불러오는 중…</div>';
  }
  if (!expenseCtx) {
    return [
      '<div class="mb-empty">',
      '  <div class="mb-empty-title">지갑을 불러오지 못했어요</div>',
      '  <p class="mb-empty-sub">잠시 후 다시 시도해 주세요.</p>',
      '</div>',
    ].join('');
  }

  const ctx = expenseCtx;
  const today = sumPaidOn(ctx, todayISO());
  const total = sumPaid(ctx);
  const budget = getTotalBudget(ctx);
  const pct = budget && budget > 0 ? Math.min(100, Math.round((total / budget) * 100)) : null;
  const over = budget != null && total > budget;
  const unconverted = unconvertedCount(ctx);

  return [
    // ── 히어로: 오늘 쓴 돈 하나만 크게 ──
    '<section class="mb-wal-hero">',
    '  <div class="mb-wal-hero-label">오늘 쓴 돈</div>',
    '  <div class="mb-wal-hero-value">' + fmtKRW(today) + '</div>',
    budget != null
      ? [
          '  <div class="mb-wal-gauge"><span class="mb-wal-gauge-fill' + (over ? ' is-over' : '') + '" style="width:' + (pct ?? 0) + '%"></span></div>',
          '  <div class="mb-wal-hero-sub">',
          '    <span>전체 ' + fmtKRW(total) + '</span>',
          '    <span>' + (over ? '예산 ' + fmtKRW(total - budget) + ' 초과' : '예산 ' + fmtKRW(budget) + '의 ' + pct + '%') + '</span>',
          '  </div>',
        ].join('')
      : '  <div class="mb-wal-hero-sub"><span>전체 ' + fmtKRW(total) + '</span><span>예산 미설정</span></div>',
    // 원칙 3-1 — 환산 못 한 항목이 있으면 합계가 그만큼 빠졌다고 밝힌다
    unconverted > 0
      ? '  <p class="mb-wal-note">환율을 못 받은 ' + unconverted + '건은 합계에서 빠졌어요.</p>'
      : '',
    '</section>',
    settleLineHtml(ctx),
    recentExpensesHtml(ctx),
    '<button class="mb-wal-add" id="mb-wal-add">' + IC.plus + ' 지출 추가</button>',
  ].join('');
}

/** 정산은 한 줄 요약만 — 자세한 건 PC에서 (모바일에서 필요한 건 "얼마 주고받나" 하나) */
function settleLineHtml(ctx: ExpenseCtx): string {
  const me = store.get('user')?.id ?? null;
  const { transfers } = computeSettlement(ctx);
  if (!transfers.length) return '';

  const mine = me ? transfers.filter((t) => t.from === me || t.to === me) : [];
  const shown = mine.length ? mine : transfers;
  const t = shown[0];
  const text =
    me && t.from === me ? memberName(ctx, t.to) + '에게 ' + fmtKRW(t.amount) + ' 보내야 해요'
    : me && t.to === me ? memberName(ctx, t.from) + '에게 ' + fmtKRW(t.amount) + ' 받을 게 있어요'
    : memberName(ctx, t.from) + ' → ' + memberName(ctx, t.to) + ' ' + fmtKRW(t.amount);
  const more = shown.length > 1 ? ' 외 ' + (shown.length - 1) + '건' : '';

  return [
    '<button class="mb-wal-settle" id="mb-wal-settle">',
    '  <span class="mb-wal-settle-ic">' + IC.wallet + '</span>',
    '  <span class="mb-wal-settle-text">' + escapeHtml(text + more) + '</span>',
    '  <span class="mb-wal-settle-chev">' + IC.chevRight + '</span>',
    '</button>',
  ].join('');
}

/** 최근 지출 몇 개만 — 전체 목록·필터·차트는 PC의 몫이다 */
function recentExpensesHtml(ctx: ExpenseCtx): string {
  const items = [...ctx.expenses]
    .filter((e) => e.is_paid)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, 6);

  if (!items.length) {
    return [
      '<section class="mb-wal-sec">',
      '  <h4 class="mb-wal-sec-title">최근 지출</h4>',
      '  <p class="mb-wal-empty">아직 기록한 지출이 없어요. 아래 버튼으로 첫 지출을 남겨보세요.</p>',
      '</section>',
    ].join('');
  }

  const rows = items.map((e) => {
    const cat = categoryOf(e);
    const meta = CATEGORY_META[cat];
    const krw = krwOf(e);
    const isForeign = e.currency !== 'KRW';
    return [
      '<div class="mb-wal-row">',
      '  <span class="mb-wal-row-ic" style="color:' + meta.color + ';background:' + meta.color + '1f">' + meta.icon + '</span>',
      '  <div class="mb-wal-row-main">',
      '    <div class="mb-wal-row-title">' + escapeHtml(e.title) + '</div>',
      '    <div class="mb-wal-row-sub">' + escapeHtml(meta.label) + (e.paid_by_name ? ' · ' + escapeHtml(e.paid_by_name) : '') + '</div>',
      '  </div>',
      '  <div class="mb-wal-row-amt">',
      '    <div class="mb-wal-row-primary">' + escapeHtml(fmtAmount(e.amount, e.currency)) + '</div>',
      // 외화면 환산값을 아래에 — 환산 실패면 지어내지 않고 물음표로 남긴다(원칙 3-1)
      isForeign
        ? '    <div class="mb-wal-row-krw">' + (krw != null ? escapeHtml(fmtKRW(krw)) : '환산 불가') + '</div>'
        : '',
      '  </div>',
      '</div>',
    ].join('');
  });

  return [
    '<section class="mb-wal-sec">',
    '  <h4 class="mb-wal-sec-title">최근 지출</h4>',
    '  <div class="mb-wal-list">' + rows.join('') + '</div>',
    '  <button class="mb-wal-more" id="mb-wal-pc">전체 내역·예산 설정은 PC에서 ' + IC.chevRight + '</button>',
    '</section>',
  ].join('');
}

/* ── 숫자패드 시트 ── */

/**
 * 지금 있는 정류지로 카테고리·제목을 미리 채운다. 값을 "지어내는" 게 아니라 입력 폼의
 * 기본값일 뿐이고 사용자가 바로 바꿀 수 있다 — 여행 중엔 이 한 번의 절약이 크다.
 */
function guessFromCurrentStop(): { category: ExpenseCategory; title: string } | null {
  const day = activeDay();
  if (!day || day.date !== todayISO()) return null;
  const stop = day.stops.find((st) => progress.get(st.key)?.status === 'arrived');
  if (!stop) return null;

  const hay = ((stop.place?.category ?? '') + ' ' + stop.name).toLowerCase();
  const cat: ExpenseCategory =
    /식당|음식|카페|레스토랑|푸드|맛집|바|주점|베이커리|restaurant|cafe|food|bar/.test(hay) ? 'FOOD'
    : /호텔|숙소|게스트|리조트|hotel|hostel|resort/.test(hay) ? 'STAY'
    : /공항|역|터미널|정류장|airport|station|terminal/.test(hay) ? 'TRANSPORT'
    : /쇼핑|몰|시장|백화점|면세|market|mall|shopping/.test(hay) ? 'SHOPPING'
    : 'ACTIVITY';
  return { category: cat, title: stop.name };
}

function openPad(): void {
  const guess = guessFromCurrentStop();
  padAmount = '';
  padCategory = guess?.category ?? 'ETC';
  padSaving = false;
  padOpen = true;
  padRate = null;
  render();
  void refreshPadRate();
}

/** 외화면 ≈₩ 미리보기를 채운다. 통화당 1회만 조회되고 캐시된다(원칙 3-2) */
async function refreshPadRate(): Promise<void> {
  if (padCurrency === 'KRW') { padRate = { rate: 1, source: 'live' }; render(); return; }
  padRate = null;
  render();
  padRate = await fetchRate(padCurrency);
  if (padOpen) render();
}

function padSheetHtml(): string {
  const amount = padAmount ? Number(padAmount) : 0;
  const guess = guessFromCurrentStop();
  const krw = padRate?.rate != null ? Math.round(amount * padRate.rate) : null;

  const currencyChips = CURRENCIES.slice(0, 6)
    .map((c) => '<button class="mb-pad-chip' + (c.code === padCurrency ? ' active' : '') + '" data-cur="' + c.code + '">' + c.code + '</button>')
    .join('');

  const catChips = EXPENSE_CATEGORIES.map((cat) => {
    const meta = CATEGORY_META[cat];
    const on = cat === padCategory;
    return (
      '<button class="mb-pad-cat' + (on ? ' active' : '') + '" data-cat="' + cat + '"' +
      (on ? ' style="border-color:' + meta.color + ';background:' + meta.color + '22;color:' + meta.color + '"' : '') +
      '><span class="mb-pad-cat-ic">' + meta.icon + '</span>' + escapeHtml(meta.label) + '</button>'
    );
  }).join('');

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];
  const pad = keys
    .map((k) =>
      k === 'del'
        ? '<button class="mb-pad-key" data-key="del" aria-label="지우기">' + IC.padDel + '</button>'
        : '<button class="mb-pad-key" data-key="' + k + '">' + k + '</button>'
    )
    .join('');

  return [
    '<div class="mb-sheet-back" id="mb-pad-back"></div>',
    '<div class="mb-pad" role="dialog" aria-label="지출 추가">',
    '  <div class="mb-pad-head">',
    '    <button class="mb-pad-close" id="mb-pad-close" aria-label="닫기">' + IC.close + '</button>',
    '    <span class="mb-pad-title">지출 추가</span>',
    '  </div>',
    '  <div class="mb-pad-amount">',
    '    <span class="mb-pad-sym">' + escapeHtml(symbolOf(padCurrency)) + '</span>',
    '    <span class="mb-pad-num' + (padAmount ? '' : ' is-empty') + '">' + escapeHtml(padAmount || '0') + '</span>',
    '  </div>',
    padCurrency !== 'KRW'
      ? '  <div class="mb-pad-krw">' +
        (krw != null
          ? '≈ ' + escapeHtml(fmtKRW(krw)) + (padRate?.source === 'fallback' ? ' <span class="mb-tag-est">참고용 환율</span>' : '')
          : padRate === null ? '환율 확인 중…' : '<span class="mb-pad-warn">환율을 못 받았어요 · 원화 환산 없이 저장돼요</span>') +
        '</div>'
      : '',
    '  <div class="mb-pad-currencies">' + currencyChips + '</div>',
    '  <div class="mb-pad-cats">' + catChips + '</div>',
    guess
      ? '  <p class="mb-pad-hint">' + escapeHtml(guess.title) + '에서 쓴 걸로 저장돼요</p>'
      : '',
    '  <div class="mb-pad-keys">' + pad + '</div>',
    '  <button class="mb-pad-save" id="mb-pad-save"' + (amount > 0 && !padSaving ? '' : ' disabled') + '>' +
      (padSaving ? '<span class="mb-spinner"></span>저장 중…' : '저장') + '</button>',
    '</div>',
  ].join('');
}

function padPress(key: string): void {
  if (key === 'del') {
    padAmount = padAmount.slice(0, -1);
  } else if (key === '.') {
    if (!padAmount.includes('.')) padAmount = (padAmount || '0') + '.';
  } else {
    // 소수점 둘째 자리까지만, 그리고 앞자리 0이 쌓이지 않게
    if (padAmount.includes('.') && padAmount.split('.')[1].length >= 2) return;
    if (padAmount === '0') padAmount = key;
    else padAmount = padAmount + key;
  }
  render();
}

/** 저장 — 여행 중 기록이므로 "결제 완료 + 공동 지출 + 오늘 날짜"가 기본이다 */
async function savePadExpense(): Promise<void> {
  const amount = Number(padAmount);
  if (!expenseCtx || !Number.isFinite(amount) || amount <= 0 || padSaving) return;

  padSaving = true;
  render();

  const guess = guessFromCurrentStop();
  const me = store.get('user')?.id ?? null;
  const allIds = new Set(expenseCtx.members.map((m) => m.user_id));

  try {
    const payload = await buildExpensePayload(expenseCtx, {
      category: padCategory,
      title: guess?.title || CATEGORY_META[padCategory].label,
      amount,
      currency: padCurrency,
      expenseDate: todayISO(),
      isPaid: true,
      splitMode: 'SHARED',
      payer: me,
      split: allIds,
      memo: null,
    });
    const { error } = await supabase.from('trip_expenses').insert(payload);
    if (error) {
      console.error('[Mobile] 지출 저장 실패:', error.message);
      padSaving = false;
      render();
      return;
    }
    padOpen = false;
    padSaving = false;
    padAmount = '';
    await reloadExpenses();
    render();
  } catch (e) {
    console.error('[Mobile] 지출 저장 실패:', e);
    padSaving = false;
    render();
  }
}

function comingSoonHtml(): string {
  return [
    '<div class="mb-empty">',
    '  <div class="mb-empty-title">MORE</div>',
    '  <p class="mb-empty-sub">체크리스트·티켓 지갑·채팅이 이 탭에 들어올 예정이에요.<br />지금은 PC 화면에서 이용할 수 있어요.</p>',
    '  <button class="mb-ghost-btn" id="mb-goto-desktop">PC 화면으로 열기</button>',
    '</div>',
  ].join('');
}

function emptyHtml(title: string, sub: string): string {
  return [
    '<div class="mb-empty">',
    '  <div class="mb-empty-title">' + escapeHtml(title) + '</div>',
    '  <p class="mb-empty-sub">' + sub + '</p>',
    '  <button class="mb-ghost-btn" id="mb-goto-route">ROUTE로 이동</button>',
    '</div>',
  ].join('');
}

/* ── DAY 선택 시트 ── */

function daySheetHtml(): string {
  const t = todayISO();
  return [
    '<div class="mb-sheet-back" id="mb-sheet-back"></div>',
    '<div class="mb-sheet" role="dialog" aria-label="DAY 선택">',
    '  <div class="mb-sheet-grip"></div>',
    '  <div class="mb-sheet-title">DAY 선택</div>',
    '  <div class="mb-sheet-list">',
    days
      .map((d, i) =>
        '<button class="mb-sheet-item' + (i === activeDayIndex ? ' active' : '') + '" data-day="' + i + '">' +
        '<span class="mb-sheet-day">' + escapeHtml(d.label) + '</span>' +
        '<span class="mb-sheet-date">' + escapeHtml(dateLabel(d.date)) + (d.date === t ? ' · TODAY' : '') + '</span>' +
        '<span class="mb-sheet-count">' + (d.stops.length ? d.stops.length + '곳' : '—') + '</span>' +
        '</button>'
      )
      .join(''),
    '  </div>',
    '</div>',
  ].join('');
}

/* ══════════════ 장소 상세 ══════════════ */

function findStop(key: string): { stop: TlStop; index: number; day: TlDay } | null {
  for (const d of days) {
    const idx = d.stops.findIndex((s) => s.key === key);
    if (idx >= 0) return { stop: d.stops[idx], index: idx, day: d };
  }
  return null;
}

function briefRequestFor(stop: TlStop): PlaceBriefRequest {
  const p = stop.place;
  return {
    name: stop.name,
    googlePlaceId: p?.google_place_id ?? null,
    category: p?.category ?? null,
    address: p?.address ?? null,
    destination: destName(),
    rating: typeof p?.google_rating === 'number' ? p.google_rating : null,
    hours: Array.isArray(p?.opening_hours) ? (p!.opening_hours as string[]) : null,
  };
}

function detailHtml(): string {
  const found = detailKey ? findStop(detailKey) : null;
  if (!found) return '<div class="mb-loading">장소를 찾을 수 없어요.</div>';
  const { stop, index, day } = found;
  const place = stop.place;
  const s = scheduleFor(day, realLegs, progress);
  const rating = typeof place?.google_rating === 'number' ? place.google_rating : null;
  const photo = place?.photo_url ?? null;
  const dwell = s.dwellMin[index] ?? dwellMinutes(stop.cat);

  return [
    '<div class="mb-detail">',
    '  <div class="mb-hero' + (photo ? '' : ' no-photo') + '"' + (photo ? ' data-photo="' + escapeHtml(photo) + '"' : '') + '>',
    '    <div class="mb-hero-scrim"></div>',
    '    <button class="mb-hero-btn" id="mb-pd-close" aria-label="닫기">' + IC.chevDown + '</button>',
    '    <div class="mb-hero-right">',
    '      <button class="mb-hero-btn" id="mb-pd-share" aria-label="공유">' + IC.share + '</button>',
    '      <button class="mb-hero-btn" id="mb-pd-more" aria-label="더보기">' + IC.more + '</button>',
    '    </div>',
    '  </div>',
    '  <div class="mb-pd">',
    '    <div class="mb-pd-head">',
    '      <span class="mb-pd-num">' + (index + 1) + '</span>',
    '      <h2 class="mb-pd-name">' + escapeHtml(stop.name) + '</h2>',
    rating != null
      ? '      <span class="mb-pd-rating">' + IC.star + rating.toFixed(1) + '</span>'
      : '',
    '    </div>',
    '    <div class="mb-pd-sub">',
    '      <span>' + escapeHtml(place?.category ?? CAT_LABEL[stop.cat]) + '</span>',
    '      <span class="mb-pd-sub-right">' + minToHHMM(s.arriveMin[index]) + ' – ' + minToHHMM(s.departMin[index]) + '</span>',
    '    </div>',
    '    <div class="mb-pd-chip">' + IC.clock + '예상 체류 ' + fmtMin(dwell) + ' <span class="mb-tag-est">추정</span></div>',
    '    <div class="mb-pd-tabs">',
    ['overview', 'guide', 'reviews']
      .map(
        (t) =>
          '<button class="mb-pd-tab' + (detailTab === t ? ' active' : '') + '" data-pdtab="' + t + '">' +
          t.toUpperCase() +
          '</button>'
      )
      .join(''),
    '    </div>',
    '    <div class="mb-pd-body">' + pdBodyHtml(stop, index, s, day) + '</div>',
    '  </div>',
    '</div>',
  ].join('');
}

function pdBodyHtml(stop: TlStop, index: number, s: DaySchedule, day: TlDay): string {
  if (detailTab === 'guide') return pdGuideHtml(stop, day);
  if (detailTab === 'reviews') return pdReviewsHtml(stop);
  return pdOverviewHtml(stop, index, s, day);
}

/* ── Overview ── */

function pdOverviewHtml(stop: TlStop, index: number, s: DaySchedule, day: TlDay): string {
  const key = placeBriefKey(briefRequestFor(stop));
  const brief = placeBriefs.get(key) ?? null;
  const loading = placeBriefLoading.has(key);
  const err = placeBriefErrors.get(key) ?? null;

  return [
    pdSectionHtml(IC.bulb, '한눈에 보기', aboutHtml(brief, loading, err, key)),
    pdSectionHtml(IC.starLine, 'Don\'t Miss', dontMissHtml(stop, brief, loading, key)),
    pdCardSectionHtml(IC.bag, 'Before You Go', beforeYouGoHtml(stop, index, s, day, brief)),
    pdCardSectionHtml(IC.pencil, '메모', memoHtml(stop)),
  ].join('');
}

/** 위계는 카드 개수가 아니라 배경 차이로 만든다 — 상위 섹션은 배경 위에 그대로 */
function pdSectionHtml(icon: string, title: string, body: string): string {
  return [
    '<section class="mb-pd-sec">',
    '  <h4 class="mb-pd-sec-title">' + icon + escapeHtml(title) + '</h4>',
    body,
    '</section>',
  ].join('');
}

/** 보조 정보는 한 단계 내려서 카드로 감싼다 */
function pdCardSectionHtml(icon: string, title: string, body: string): string {
  return [
    '<section class="mb-pd-sec">',
    '  <h4 class="mb-pd-sec-title">' + icon + escapeHtml(title) + '</h4>',
    '  <div class="mb-pd-card">' + body + '</div>',
    '</section>',
  ].join('');
}

function aboutHtml(brief: PlaceBrief | null, loading: boolean, err: string | null, key: string): string {
  if (loading) {
    return '<div class="mb-ai-loading"><span class="mb-spinner"></span>AI가 이 장소를 정리하고 있어요</div>';
  }
  if (brief?.summary) {
    return [
      '<p class="mb-pd-text">' + escapeHtml(brief.summary) + '</p>',
      brief.keywords.length
        ? '<div class="mb-kw">' + brief.keywords.map((k) => '<span class="mb-kw-item">' + escapeHtml(k) + '</span>').join('') + '</div>'
        : '',
      '<p class="mb-caveat">요금·운영 정책은 현장에서 확인해 주세요. <span class="mb-tag-ai">' + IC.spark + 'AI</span></p>',
    ].join('');
  }
  return [
    err ? '<p class="mb-ai-err">' + escapeHtml(err) + '</p>' : '',
    '<button class="mb-ai-btn" data-brief="' + escapeHtml(key) + '">' + IC.spark + 'AI로 이 장소 정리하기</button>',
  ].join('');
}

function dontMissHtml(stop: TlStop, brief: PlaceBrief | null, loading: boolean, key: string): string {
  const links = searchLinksHtml(stop);
  if (loading) return links;
  if (brief && brief.dontMiss.length) {
    return [
      '<ul class="mb-miss">',
      brief.dontMiss
        .map(
          (d) =>
            '<li class="mb-miss-item"><span class="mb-miss-ic">' + IC.check + '</span>' +
            '<div><span class="mb-miss-title">' + escapeHtml(d.title) + '</span>' +
            (d.detail ? '<span class="mb-miss-detail">' + escapeHtml(d.detail) + '</span>' : '') +
            '</div></li>'
        )
        .join(''),
      '</ul>',
      brief.bestTime
        ? '<div class="mb-best"><span class="mb-best-label">BEST TIME</span>' + escapeHtml(brief.bestTime) +
          ' <span class="mb-tag-ai">' + IC.spark + 'AI</span></div>'
        : '',
      links,
    ].join('');
  }
  // 브리핑은 있는데 이 섹션만 비어 있으면 "다시 생성" — 반쪽 캐시를 건너뛰는 경로(5-3의 실제 버그)
  if (brief) {
    return [
      '<button class="mb-ai-btn ghost" data-brief="' + escapeHtml(key) + '" data-force="1">' + IC.refresh + '다시 생성</button>',
      links,
    ].join('');
  }
  return links;
}

/** URL 조합뿐이라 API 비용이 0 (원칙 3-2) */
function searchLinksHtml(stop: TlStop): string {
  const q = encodeURIComponent(stop.name);
  return [
    '<div class="mb-links">',
    '  <a class="mb-link" target="_blank" rel="noopener" href="' + directionsHref(stop) + '">' + IC.navigate + '길찾기</a>',
    '  <a class="mb-link" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=' + q + '">' + IC.ext + '영상</a>',
    '  <a class="mb-link" target="_blank" rel="noopener" href="https://search.naver.com/search.naver?query=' + q + '+후기">' + IC.ext + '후기</a>',
    '</div>',
  ].join('');
}

/**
 * 값의 출처를 세 가지로 구분한다(원칙 3-1) —
 *   실제 저장값 → 파란 체크 / AI가 채운 값 → 스파클 + AI 태그 / 근거 없음 → 옅은 ? + "확인 필요"
 * 빈칸을 감추지 않고 빈칸인 채로 보여주는 게 이 앱의 방식이다.
 */
function beforeYouGoHtml(stop: TlStop, index: number, s: DaySchedule, day: TlDay, brief: PlaceBrief | null): string {
  const place = stop.place;
  const hours = todaysHoursLine(place ?? null, day.date);
  const rows: string[] = [];

  rows.push(bygRow('운영시간', hours, hours ? 'real' : 'unknown'));
  rows.push(bygRow('위치', place?.address ?? null, place?.address ? 'real' : 'unknown'));
  rows.push(bygRow('예상 체류', fmtMin(s.dwellMin[index] ?? dwellMinutes(stop.cat)), 'est'));
  rows.push(bygRow('예약·입장', brief?.beforeYouGo.booking || null, brief?.beforeYouGo.booking ? 'ai' : 'unknown'));
  rows.push(bygRow('복장 규정', brief?.beforeYouGo.dress || null, brief?.beforeYouGo.dress ? 'ai' : 'unknown'));
  rows.push(bygRow('현금 준비', brief?.beforeYouGo.cash || null, brief?.beforeYouGo.cash ? 'ai' : 'unknown'));

  return rows.join('');
}

function bygRow(label: string, value: string | null, kind: 'real' | 'ai' | 'est' | 'unknown'): string {
  const mark =
    kind === 'real' ? '<span class="mb-byg-ic real">' + IC.check + '</span>'
    : kind === 'ai' ? '<span class="mb-byg-ic ai">' + IC.spark + '</span>'
    : kind === 'est' ? '<span class="mb-byg-ic est">' + IC.clock + '</span>'
    : '<span class="mb-byg-ic unknown">?</span>';
  const text =
    value != null
      ? escapeHtml(value) + (kind === 'ai' ? ' <span class="mb-tag-ai">AI</span>' : kind === 'est' ? ' <span class="mb-tag-est">추정</span>' : '')
      : '<span class="mb-byg-unknown">확인 필요</span>';
  return [
    '<div class="mb-byg-row">',
    '  ' + mark,
    '  <span class="mb-byg-label">' + escapeHtml(label) + '</span>',
    '  <span class="mb-byg-value">' + text + '</span>',
    '</div>',
  ].join('');
}

function memoHtml(stop: TlStop): string {
  const memo = stop.memo ?? '';
  return [
    '<textarea class="mb-memo" id="mb-memo" maxlength="200" rows="3" placeholder="이 장소에 대한 메모를 남겨보세요">' + escapeHtml(memo) + '</textarea>',
    '<div class="mb-memo-foot"><span id="mb-memo-count">' + memo.length + '/200</span></div>',
  ].join('');
}

/* ── Guide ── */

function pdGuideHtml(stop: TlStop, day: TlDay): string {
  const place = stop.place;
  const lines = Array.isArray(place?.opening_hours) ? (place!.opening_hours as unknown[]) : null;
  const todayIdx = day.date ? (new Date(day.date + 'T00:00:00').getDay() + 6) % 7 : -1;

  const hoursBlock =
    lines && lines.length === 7 && lines.every((l) => typeof l === 'string')
      ? '<div class="mb-hours">' +
        (lines as string[])
          .map((l, i) => '<div class="mb-hours-row' + (i === todayIdx ? ' today' : '') + '">' + escapeHtml(l) + '</div>')
          .join('') +
        '</div>'
      : '<p class="mb-pd-muted">저장된 영업시간이 없어요.</p>';

  return [
    pdCardSectionHtml(IC.clock, '영업시간', hoursBlock),
    pdCardSectionHtml(
      IC.pin,
      '위치',
      (place?.address ? '<p class="mb-pd-text">' + escapeHtml(place.address) + '</p>' : '<p class="mb-pd-muted">저장된 주소가 없어요.</p>') +
        '<div class="mb-links">' +
        '<a class="mb-link" target="_blank" rel="noopener" href="' + directionsHref(stop) + '">' + IC.navigate + '길찾기</a>' +
        '</div>'
    ),
  ].join('');
}

/* ── Reviews ── */

function pdReviewsHtml(stop: TlStop): string {
  const rating = typeof stop.place?.google_rating === 'number' ? stop.place.google_rating : null;
  const q = encodeURIComponent(stop.name);
  return pdCardSectionHtml(
    IC.starLine,
    '평점 · 후기',
    (rating != null
      ? '<div class="mb-rating-big">' + IC.star + '<strong>' + rating.toFixed(1) + '</strong><span>Google 평점</span></div>'
      : '<p class="mb-pd-muted">저장된 평점이 없어요.</p>') +
      '<div class="mb-links">' +
      '<a class="mb-link" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + q + '">' + IC.ext + 'Google 지도 리뷰</a>' +
      '<a class="mb-link" target="_blank" rel="noopener" href="https://search.naver.com/search.naver?query=' + q + '+후기">' + IC.ext + '블로그 후기</a>' +
      '</div>'
  );
}

/* ══════════════ 사진 주입 ══════════════ */

/** 사진 주소를 style 속성에 직접 끼워 넣지 않는다 — 따옴표·괄호가 섞이면 CSS가 깨진다(5-3) */
function applyPhotos(): void {
  container?.querySelectorAll('[data-photo]').forEach((el) => {
    const url = (el as HTMLElement).dataset.photo;
    if (url) (el as HTMLElement).style.backgroundImage = 'url("' + url + '")';
  });
}

/* ══════════════ 이벤트 ══════════════ */

function bind(): void {
  if (!container) return;
  const root = container;

  // ── 탭 이동 ──
  root.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = (btn as HTMLElement).dataset.tab as MbTab;
      activeTab = tab;
      render();
      if (tab === 'wallet') void ensureExpenseCtx();
    });
  });

  // ── DAY 선택 ──
  root.querySelector('#mb-daypick')?.addEventListener('click', () => {
    daySheetOpen = true;
    render();
  });
  root.querySelector('#mb-sheet-back')?.addEventListener('click', () => {
    daySheetOpen = false;
    render();
  });
  root.querySelectorAll('[data-day]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeDayIndex = Number((btn as HTMLElement).dataset.day);
      daySheetOpen = false;
      render();
      void loadRealLegsForActiveDay();
      void loadProgressForActiveDay();
    });
  });
  root.querySelectorAll('[data-goday]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeDayIndex = Number((btn as HTMLElement).dataset.goday);
      activeTab = 'today';
      render();
      void loadRealLegsForActiveDay();
      void loadProgressForActiveDay();
    });
  });

  // ── 카드 → 상세 ──
  root.querySelectorAll('[data-stop]').forEach((card) => {
    const open = (e: Event) => {
      // 북마크·길찾기·도착 기록 버튼을 눌렀을 땐 상세를 열지 않는다
      const t = e.target as HTMLElement;
      if (t.closest('[data-bm]') || t.closest('[data-nav]') || t.closest('.mb-track')) return;
      detailKey = (card as HTMLElement).dataset.stop ?? null;
      detailTab = 'overview';
      render();
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        ke.preventDefault();
        open(e);
      }
    });
  });

  // ── 실제 도착/출발 기록 ──
  root.querySelectorAll('[data-arrive]').forEach((btn) => {
    btn.addEventListener('click', () => { void recordAction('arrive', (btn as HTMLElement).dataset.arrive!); });
  });
  root.querySelectorAll('[data-depart]').forEach((btn) => {
    btn.addEventListener('click', () => { void recordAction('depart', (btn as HTMLElement).dataset.depart!); });
  });
  root.querySelectorAll('[data-skip]').forEach((btn) => {
    btn.addEventListener('click', () => { void recordAction('skip', (btn as HTMLElement).dataset.skip!); });
  });
  root.querySelectorAll('[data-reset]').forEach((btn) => {
    btn.addEventListener('click', () => { void recordAction('reset', (btn as HTMLElement).dataset.reset!); });
  });

  // ── 상세 닫기 · 탭 ──
  root.querySelector('#mb-pd-close')?.addEventListener('click', () => {
    detailKey = null;
    render();
  });
  root.querySelectorAll('[data-pdtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      detailTab = (btn as HTMLElement).dataset.pdtab as PdTab;
      render();
    });
  });
  root.querySelector('#mb-pd-share')?.addEventListener('click', () => { void sharePlace(); });

  // ── AI 브리핑 ──
  root.querySelectorAll('[data-brief]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const force = (btn as HTMLElement).dataset.force === '1';
      void loadBrief(force);
    });
  });

  // ── 메모 ──
  const memo = root.querySelector('#mb-memo') as HTMLTextAreaElement | null;
  if (memo) {
    memo.addEventListener('input', () => {
      const c = root.querySelector('#mb-memo-count');
      if (c) c.textContent = memo.value.length + '/200';
    });
  }

  // ── 그 외 ──
  root.querySelector('#mb-goto-route')?.addEventListener('click', () => gotoGate('route'));
  root.querySelector('#mb-goto-desktop')?.addEventListener('click', () => gotoGate('timeline'));
  root.querySelector('#mb-links')?.addEventListener('click', () => gotoGate('links'));
  root.querySelector('#mb-menu')?.addEventListener('click', () => gotoGate('timeline'));
  root.querySelector('#mb-add')?.addEventListener('click', () => gotoGate('route'));

  // ── WALLET ──
  root.querySelector('#mb-wal-add')?.addEventListener('click', () => openPad());
  root.querySelector('#mb-wal-pc')?.addEventListener('click', () => gotoGate('expense'));
  root.querySelector('#mb-wal-settle')?.addEventListener('click', () => gotoGate('expense'));

  // ── 숫자패드 ──
  root.querySelector('#mb-pad-back')?.addEventListener('click', () => { padOpen = false; render(); });
  root.querySelector('#mb-pad-close')?.addEventListener('click', () => { padOpen = false; render(); });
  root.querySelectorAll('[data-key]').forEach((btn) => {
    btn.addEventListener('click', () => padPress((btn as HTMLElement).dataset.key!));
  });
  root.querySelectorAll('[data-cur]').forEach((btn) => {
    btn.addEventListener('click', () => {
      padCurrency = (btn as HTMLElement).dataset.cur!;
      void refreshPadRate();
    });
  });
  root.querySelectorAll('[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      padCategory = (btn as HTMLElement).dataset.cat as ExpenseCategory;
      render();
    });
  });
  root.querySelector('#mb-pad-save')?.addEventListener('click', () => { void savePadExpense(); });
}

/**
 * 도착/출발/건너뛰기/되돌리기를 기록한다. **낙관적으로 먼저 화면에 반영하고 그다음 저장한다**
 * — 해외에서는 연결이 느리거나 끊길 수 있어서, 버튼을 눌렀는데 반응이 늦으면 "눌렸는지 안
 * 눌렸는지" 몰라 다시 누르게 된다. 저장이 실패해도 되돌리지 않는다: 다음 realtime 이벤트나
 * 재조회가 오면 서버 상태로 자연히 맞춰진다(route_stops 저장의 self-write echo 억제와
 * 같은 전제 — 쓰기는 기본적으로 성공한다고 보고, 실패는 로그만 남긴다).
 */
async function recordAction(kind: 'arrive' | 'depart' | 'skip' | 'reset', stopKey: string): Promise<void> {
  if (!activeDestId || !currentTripId) return;

  const nowIso = new Date().toISOString();
  const prev = progress.get(stopKey);
  const optimistic: StopProgress =
    kind === 'arrive' ? { status: 'arrived', actualArriveAt: nowIso, actualDepartAt: null }
    : kind === 'depart' ? { status: 'departed', actualArriveAt: prev?.actualArriveAt ?? nowIso, actualDepartAt: nowIso }
    : kind === 'skip' ? { status: 'skipped', actualArriveAt: null, actualDepartAt: null }
    : { status: 'pending', actualArriveAt: null, actualDepartAt: null };
  progress.set(stopKey, optimistic);
  render();

  const save = kind === 'arrive' ? markArrived : kind === 'depart' ? markDeparted : kind === 'skip' ? markSkipped : resetProgress;
  const ok = await save(currentTripId, activeDestId, activeDayIndex, stopKey);
  if (!ok) console.error('[Mobile] 진행 기록 저장 실패:', kind, stopKey);
}

async function sharePlace(): Promise<void> {
  const found = detailKey ? findStop(detailKey) : null;
  if (!found) return;
  const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(found.stop.name);
  if (navigator.share) {
    try {
      await navigator.share({ title: found.stop.name, url });
      return;
    } catch {
      /* 사용자가 취소한 경우 — 아래 클립보드 복사로 떨어지지 않고 그냥 종료 */
      return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    /* 클립보드도 막혀 있으면 조용히 넘어간다 */
  }
}

/**
 * 요약·Don't Miss·가기 전 확인사항을 **한 번의 호출로 같이** 받는다(원칙 3-2).
 * `force`면 로컬 가드와 서버 캐시를 둘 다 건너뛴다 — 안 그러면 반쪽 결과를 그대로 다시 받는다.
 */
async function loadBrief(force = false): Promise<void> {
  const found = detailKey ? findStop(detailKey) : null;
  if (!found) return;
  const req = briefRequestFor(found.stop);
  const key = placeBriefKey(req);
  if (placeBriefLoading.has(key)) return;
  if (!force && placeBriefs.has(key)) return;

  placeBriefLoading.add(key);
  placeBriefErrors.delete(key);
  render();

  try {
    const brief = await requestPlaceBrief(req, force);
    placeBriefs.set(key, brief);
  } catch (e) {
    placeBriefErrors.set(key, e instanceof Error ? e.message : 'AI 요청에 실패했어요.');
  } finally {
    placeBriefLoading.delete(key);
    render();
  }
}
