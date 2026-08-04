/**
 * TIMELINE 게이트 (04) — 날짜별 일정표.
 *
 * ROUTE(03)에서 지도 위로 만든 동선을 이어받아, **시간축 위에 올려놓고 다듬는** 화면이다.
 * 같은 route_days/route_stops를 읽고 쓰므로 두 화면은 항상 같은 일정을 본다.
 *
 *   ROUTE     = "어디를 어떤 순서로" (공간)
 *   TIMELINE  = "몇 시에 얼마나"     (시간)
 *
 * 공항 메타포에서 이 화면은 **운항 시각표(FLIGHT SCHEDULE)** 다 — 시각·편명·게이트가
 * 한 줄에 정렬된 전광판처럼, 한 정류지가 한 줄에 다 들어오도록 밀도를 최우선으로 설계했다.
 *
 * 화면 구성
 *   상단  DAY 스트립  — 날짜별 채움 정도를 막대로 나란히 비교 (트리플엔 없는 "날짜 간 비교")
 *   좌측  시각표       — 시각 / 스파인 / 정류지 한 줄. 펼치면 그 자리에서 편집
 *   우측  요약 레일     — 하루 리듬(이동·머무름·여유 비율), 24시간 분포, 주의 신호, 예상 교통비
 *
 * 원칙 3-1 — 여기 뜨는 시각·체류시간·교통비는 대부분 추정치다.
 *   · 이동시간/거리 : Routes API 실측이 오면 실측, 못 받으면 직선거리 추정(구간마다 "추정" 표기)
 *   · 체류시간      : 방문 유형별 기본값(추정) — 사용자가 도착 시각을 직접 입력하면 그게 우선
 *   · 교통비        : 대중교통은 실측 요금이 있을 때만 실측, 택시는 항상 추정
 *   날씨·혼잡도·예약 상태처럼 근거 데이터가 없는 정보는 아예 만들지 않는다.
 */

import { supabase } from '../supabase';
import { store } from '../store';
import {
  loadDestinations,
  resolveActiveDestination,
  loadStaySegments,
  isSyntheticDestination,
} from '../trips/destinations';
import {
  loadRoutePlan,
  saveRouteDay,
  subscribeRoutePlan,
  unsubscribeRoutePlan,
  isRouteStorageReady,
  resetRouteStorageProbe,
} from '../route/routeStore';
import type { StoredStop } from '../route/routeStore';
import {
  estimateLegBetween,
  legKey,
  catKeyFor,
  dwellMinutes,
  modeLabel,
  modeColorClass,
  fmtMin,
  fmtKm,
  minToHHMM,
  hhmmToMin,
  parseTimeInput,
  CAT_COLOR,
  CAT_LABEL,
} from '../utils/travelEstimate';
import type { Leg, RealLeg, TravelMode, CatKey } from '../utils/travelEstimate';
import type { Database, StaySegment, TripDestination } from '../types/database';
import './timeline.css';

type Place = Database['public']['Tables']['places']['Row'];
type Trip = Database['public']['Tables']['trips']['Row'];

/* ══════════════ 아이콘 ══════════════ */

const IC_WALK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="M11 8l-3 3 2 7M11 8l3 2 3-1M8 11l-3 2v6M13 10l2 4-2 6"/></svg>';
const IC_TRANSIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="14" rx="2"/><path d="M4 11h16M8 21l2-4h4l2 4M8 7h.01M16 7h.01"/></svg>';
const IC_TAXI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M5 17l1.5-5h11L19 17M8 12V8h8v4"/></svg>';
const IC_BED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20v-9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9"/><path d="M4 15h16M8 9V6h8v3"/><path d="M4 20v1M20 20v1"/></svg>';
const IC_PLANE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
const IC_LANDMARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M4 21V10M20 21V10M2 10l10-6 10 6M6 10v7M10 10v7M14 10v7M18 10v7"/></svg>';
const IC_FORK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2v7a2 2 0 0 0 2 2v11M7 2v7M9 2v7M11 2v7M16 2c-1.5 0-3 1.5-3 4s1.5 4 3 4v10"/></svg>';
const IC_FERRIS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3 6.3 17.7"/></svg>';
const IC_BAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l1 12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>';
const IC_CHEVRON_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
const IC_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const IC_ARROW_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>';
const IC_MAPPIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21C12 21 19 14.5 19 9.5C19 5.9 15.9 3 12 3C8.1 3 5 5.9 5 9.5C5 14.5 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.2"/></svg>';
const IC_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const IC_ALERT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';
const IC_ROUTEPATH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H14a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h5.5"/></svg>';
const IC_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13"/></svg>';
const IC_GRIP = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';
const IC_STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.8 5.9 20.4 7.2 13.7 2.2 9l6.8-.8z"/></svg>';
const IC_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const IC_EXTLINK ='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>';

const CAT_ICON: Record<CatKey, string> = {
  VISIT: IC_LANDMARK, FOOD: IC_FORK, ACTIVITY: IC_FERRIS, SHOPPING: IC_BAG, STAY: IC_BED, AIRPORT: IC_PLANE,
};

const MODE_ICON: Record<TravelMode, string> = { WALK: IC_WALK, TRANSIT: IC_TRANSIT, TAXI: IC_TAXI };
const MODES: TravelMode[] = ['WALK', 'TRANSIT', 'TAXI'];

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

/** 하루의 기본 시작 시각(분) — ROUTE의 computeStopTimes와 같은 09:00 기준 */
const DAY_START_MIN = 9 * 60;

/* ══════════════ 타입 ══════════════ */

/** 시각표 한 줄 — route_stops 한 행에 대응 */
interface TlStop {
  /** 이 DAY 안에서만 유일하면 되는 행 키 (같은 장소를 하루에 두 번 담을 수 있으므로 인덱스 포함) */
  key: string;
  placeId: string | null;
  /** 지도에 직접 찍은 지점·공항처럼 places 행이 없는 정류지의 이름 */
  customName: string | null;
  lat: number | null;
  lng: number | null;
  /** 사용자가 직접 고정한 도착 시각 (HH:MM). 없으면 앞 일정에서 계산 */
  arriveTime: string | null;
  memo: string | null;
  /** 이 정류지로 **들어오는** 구간의 수동 이동수단 (저장 스키마가 도착지 기준) */
  travelMode: TravelMode | null;
  /* 표시용 파생값 */
  name: string;
  cat: CatKey;
  place: Place | null;
}

interface TlDay {
  dayIndex: number;
  label: string;
  /** 이 DAY의 실제 캘린더 날짜 (YYYY-MM-DD). 시작일을 모르면 null */
  date: string | null;
  stops: TlStop[];
}

/** 한 DAY를 시간축에 올린 결과 */
interface DaySchedule {
  /** stops[i]의 도착 시각(분) — 화면에 보여주는 값 */
  arriveMin: number[];
  /** stops[i]에서 떠나는 시각(분) = 도착 + 체류 */
  departMin: number[];
  /** stops[i]의 체류시간(분) */
  dwellMin: number[];
  /** 고정 시각 때문에 생긴 여유(분). 0보다 크면 그 앞에 빈 시간이 있다는 뜻 */
  slackMin: number[];
  /** 고정 시각이 앞 일정보다 빠를 때 모자란 시간(분). 0보다 크면 일정이 겹친다 */
  overrunMin: number[];
  /** stops[i] → stops[i+1] 구간 (좌표가 없는 정류지는 null) */
  legs: Array<Leg | null>;
  totalMoveMin: number;
  totalDwellMin: number;
  totalSlackMin: number;
  totalCost: number;
  currency: string;
  /** 하루의 첫 도착 ~ 마지막 출발 */
  spanStartMin: number;
  spanEndMin: number;
  /** 실측으로 채워진 구간 수 / 전체 구간 수 (원칙 3-1 표기용) */
  realLegCount: number;
  legCount: number;
}

type ViewMode = 'day' | 'all';

/* ══════════════ 모듈 상태 ══════════════ */

let container: HTMLElement | null = null;
let currentTripId = '';
let currentTrip: Trip | null = null;
let activeDestId: string | null = null;
let activeDest: TripDestination | null = null;
let staySegments: StaySegment[] = [];
let placeById = new Map<string, Place>();
let basecampIds = new Set<string>();
let airportNames = new Set<string>();

let days: TlDay[] = [];
let activeDayIndex = 0;
let viewMode: ViewMode = 'day';
/** 펼쳐 놓은 정류지의 행 키 — 한 번에 하나만 (열려 있는 걸 다시 누르면 접힘) */
let expandedKey: string | null = null;

/** legKey → 모드별 실측. 없으면 직선거리 추정치 (ROUTE와 같은 캐시 전략) */
let realLegs = new Map<string, Record<string, RealLeg>>();
let realLegPending = false;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSaveDays = new Set<number>();
let nowTimer: ReturnType<typeof setInterval> | null = null;
let storageReady = false;

/* ══════════════ 정리 ══════════════ */

export function teardownTimeline(): void {
  // 화면을 떠날 때 대기 중인 저장은 버리지 않고 커밋한다 (Claude.md 알려진 버그 패턴)
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    void flushSave();
  }
  if (nowTimer) { clearInterval(nowTimer); nowTimer = null; }
  unsubscribeRoutePlan();
  resetRouteStorageProbe();
  container = null;
  currentTrip = null;
  activeDestId = null;
  activeDest = null;
  staySegments = [];
  placeById = new Map();
  basecampIds = new Set();
  airportNames = new Set();
  days = [];
  activeDayIndex = 0;
  viewMode = 'day';
  expandedKey = null;
  realLegs = new Map();
  realLegPending = false;
  storageReady = false;
}

/* ══════════════ 유틸 ══════════════ */

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function gotoGate(gate: string): void {
  window.dispatchEvent(new CustomEvent('mongsil:navigateGate', { detail: { tripId: currentTripId, gate } }));
}

/** YYYY-MM-DD → "10.27 (화)" */
function dateLabel(iso: string | null, withWeekday = true): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  const base = d.getMonth() + 1 + '.' + String(d.getDate()).padStart(2, '0');
  return withWeekday ? base + ' (' + WEEKDAY[d.getDay()] + ')' : base;
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

/* ══════════════ 데이터 로드 ══════════════ */

async function loadTrip(tripId: string): Promise<Trip | null> {
  const cached = store.get('currentTrip');
  if (cached && cached.id === tripId) return cached;
  const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).single();
  if (error) {
    console.error('[Timeline] Trip load error:', error.message);
    return null;
  }
  return data;
}

async function loadPlaces(tripId: string): Promise<Place[]> {
  const { data, error } = await supabase.from('places').select('*').eq('trip_id', tripId).not('mood', 'is', null);
  if (error) {
    console.error('[Timeline] places load error:', error.message);
    return [];
  }
  return data ?? [];
}

/**
 * 저장된 동선(route_days/route_stops)을 시각표 모델로 변환한다.
 * ROUTE가 숙소·공항 앵커까지 전부 순서대로 저장해 두므로, 여기서 앵커를 다시 계산하지 않고
 * 저장된 순서를 그대로 신뢰한다 — 그래야 두 화면의 일정이 어긋날 여지가 없다.
 */
async function buildDays(trip: Trip): Promise<void> {
  const places = await loadPlaces(trip.id);
  placeById = new Map(places.map((p) => [p.id, p]));

  const dests = await loadDestinations(trip);
  const dest = resolveActiveDestination(trip.id, dests);
  activeDest = dest ?? null;
  activeDestId = dest && !isSyntheticDestination(dest.id) ? dest.id : null;

  const segments = dest ? await loadStaySegments(trip, dest) : [];
  staySegments = [...segments].sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''));

  basecampIds = new Set(
    [...staySegments.map((s) => s.basecamp_place_id), trip.shortlist_basecamp_place_id].filter(
      (id): id is string => !!id
    )
  );
  airportNames = new Set(
    [dest?.arrival_airport, dest?.departure_airport].filter((n): n is string => !!n)
  );

  // DAY 개수 = 숙박 일수 + 1 (ROUTE와 같은 계산 — 마지막 출국일도 하나의 DAY다)
  const start = dest?.start_date ?? trip.start_date;
  const end = dest?.end_date ?? trip.end_date;
  let nights = 1;
  if (start && end) {
    const diff = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000);
    nights = Math.max(1, diff);
  }
  const dayCount = Math.max(2, Math.min(nights, 10) + 1);

  days = Array.from({ length: dayCount }, (_, i) => ({
    dayIndex: i,
    label: 'DAY ' + (i + 1),
    date: start ? shiftDate(start, i) : null,
    stops: [] as TlStop[],
  }));

  if (!activeDestId) {
    storageReady = false;
    return;
  }
  const stored = await loadRoutePlan(activeDestId);
  storageReady = isRouteStorageReady();
  if (!stored) return;

  stored.forEach((sd) => {
    const day = days[sd.dayIndex];
    if (!day) return; // 기간이 줄어들어 남은 DAY는 조용히 무시 (ROUTE와 같은 처리)
    day.stops = sd.stops.map((s, i) => toStop(s, sd.dayIndex, i));
  });
}

function shiftDate(iso: string, plusDays: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + plusDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function toStop(s: StoredStop, dayIndex: number, order: number): TlStop {
  const place = s.placeId ? placeById.get(s.placeId) ?? null : null;
  const name = place?.name ?? s.customName ?? '이름 없는 지점';
  const isBasecamp = !!s.placeId && basecampIds.has(s.placeId);
  const isAirport = !s.placeId && airportNames.has(s.customName ?? '');
  const mode = s.travelMode && (MODES as string[]).includes(s.travelMode) ? (s.travelMode as TravelMode) : null;
  return {
    key: 'd' + dayIndex + '-' + order + '-' + (s.placeId ?? s.customName ?? 'x'),
    placeId: s.placeId,
    customName: s.customName,
    lat: place?.lat ?? s.customLat,
    lng: place?.lng ?? s.customLng,
    arriveTime: s.arriveTime,
    memo: s.memo,
    travelMode: mode,
    name,
    cat: catKeyFor(place?.mood ?? null, place?.category ?? null, { isBasecamp, isAirport }),
    place,
  };
}

/* ══════════════ 시각 계산 ══════════════ */

/**
 * 하루를 시간축에 올린다. 09:00에서 출발해 "체류 + 이동"을 누적하고, 사용자가 고정한
 * 도착 시각을 만나면 그 시각으로 시계를 맞춘다(ROUTE의 computeStopTimes와 같은 규칙).
 *
 * 여기에 더해 고정 시각과 자연스러운 도착 시각의 차이를 따로 남긴다 —
 *   앞당겨 고정  → overrun(일정이 겹침, 앞 일정을 줄여야 함)
 *   늦춰서 고정  → slack(그 앞에 비는 시간이 생김)
 * 단순 나열이 아니라 "이 일정이 실제로 가능한가"를 보여주기 위한 값이다.
 */
function scheduleFor(day: TlDay): DaySchedule {
  const stops = day.stops;
  const legs: Array<Leg | null> = [];
  for (let i = 0; i < stops.length - 1; i++) {
    legs.push(legBetween(stops[i], stops[i + 1]));
  }

  const arriveMin: number[] = [];
  const departMin: number[] = [];
  const dwellMin: number[] = [];
  const slackMin: number[] = [];
  const overrunMin: number[] = [];

  let clock = DAY_START_MIN;
  stops.forEach((s, i) => {
    const natural = clock;
    const fixed = s.arriveTime ? hhmmToMin(s.arriveTime) : null;
    const arrive = fixed ?? natural;
    // 첫 정류지는 비교 대상이 없으므로 여유/겹침을 따지지 않는다
    slackMin.push(i > 0 && fixed != null && fixed > natural ? fixed - natural : 0);
    overrunMin.push(i > 0 && fixed != null && fixed < natural ? natural - fixed : 0);

    const dwell = dwellMinutes(s.cat);
    arriveMin.push(arrive);
    dwellMin.push(dwell);
    departMin.push(arrive + dwell);

    clock = arrive + dwell + (legs[i]?.min ?? 0);
  });

  let totalMove = 0;
  let totalCost = 0;
  let realLegCount = 0;
  let legCount = 0;
  let currency = 'THB';
  legs.forEach((l) => {
    if (!l) return;
    legCount += 1;
    totalMove += l.min;
    totalCost += l.costTHB;
    if (l.real) realLegCount += 1;
    if (l.fare?.currency) currency = l.fare.currency;
  });

  const totalDwell = dwellMin.reduce((a, b) => a + b, 0);
  const totalSlack = slackMin.reduce((a, b) => a + b, 0);

  return {
    arriveMin, departMin, dwellMin, slackMin, overrunMin, legs,
    totalMoveMin: totalMove,
    totalDwellMin: totalDwell,
    totalSlackMin: totalSlack,
    totalCost,
    currency,
    spanStartMin: arriveMin.length ? arriveMin[0] : DAY_START_MIN,
    spanEndMin: departMin.length ? departMin[departMin.length - 1] : DAY_START_MIN,
    realLegCount,
    legCount,
  };
}

/** 좌표가 둘 다 있어야 구간을 계산할 수 있다 (원칙 3-1 — 좌표를 지어내지 않음) */
function legBetween(a: TlStop, b: TlStop): Leg | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  return estimateLegBetween(
    { lat: a.lat, lng: a.lng },
    { lat: b.lat, lng: b.lng },
    b.travelMode ?? undefined,
    realLegs.get(stopLegKey(a, b))
  );
}

/** 실측 캐시 키 — 좌표 기반이라 같은 장소를 여러 DAY에 담아도 캐시가 공유된다 */
function stopLegKey(a: TlStop, b: TlStop): string {
  return legKey(a.placeId ?? coordId(a), b.placeId ?? coordId(b));
}
function coordId(s: TlStop): string {
  return (s.lat ?? 0).toFixed(5) + ',' + (s.lng ?? 0).toFixed(5);
}

/* ══════════════ 실측 경로 (활성 DAY만) ══════════════ */

/**
 * 지금 보고 있는 DAY의 구간만 실제 경로로 채운다.
 * 원칙 3-2 — 모든 DAY를 한 번에 조회하면 호출량이 배로 늘어나므로 ROUTE와 같은
 * "활성 DAY만, 이미 받은 구간은 다시 묻지 않음" 전략을 그대로 쓴다.
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
  setLegLoading(true);
  try {
    const res = await fetch('/api/route-matrix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs: pending, modes: ['WALK', 'TRANSIT', 'DRIVE'] }),
    });
    if (!res.ok) {
      console.error('[Timeline] /api/route-matrix 실패:', res.status, await res.text().catch(() => ''));
      return;
    }
    const json = await res.json();
    const results: Array<{ id: string; modes: Record<string, RealLeg> }> = json?.results ?? [];
    let got = false;
    results.forEach((r) => {
      if (r.modes && Object.keys(r.modes).length) {
        realLegs.set(r.id, r.modes);
        got = true;
      }
    });
    // 실패해도 화면은 조용히 추정치를 유지한다 (구간마다 "추정"으로 이미 표기됨)
    if (got) render();
  } catch (e) {
    console.error('[Timeline] /api/route-matrix 요청 실패:', e);
  } finally {
    realLegPending = false;
    setLegLoading(false);
  }
}

function setLegLoading(on: boolean): void {
  const el = container?.querySelector('#tl-legs-loading') as HTMLElement | null;
  if (el) el.style.display = on ? '' : 'none';
}

/* ══════════════ 저장 ══════════════ */

function toStoredStops(day: TlDay): StoredStop[] {
  return day.stops.map((s) => ({
    placeId: s.placeId,
    customName: s.placeId ? null : s.customName ?? s.name,
    customLat: s.placeId ? null : s.lat,
    customLng: s.placeId ? null : s.lng,
    arriveTime: s.arriveTime,
    memo: s.memo || null,
    travelMode: s.travelMode,
  }));
}

/** 바뀐 DAY를 잠시 뒤 한 번에 저장 (연속 조작을 묶음) */
function scheduleSave(dayIndex: number): void {
  if (!storageReady || !activeDestId || !currentTripId) return;
  pendingSaveDays.add(dayIndex);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushSave();
  }, 600);
}

/**
 * 저장할 내용을 **await 전에 전부 스냅샷으로 떠 놓는다.**
 * teardownTimeline()이 화면을 떠나며 이 함수를 호출한 직후 모듈 상태를 초기화하기 때문에,
 * 루프 안에서 days/currentTripId를 그때그때 읽으면 두 번째 DAY부터는 이미 비워진 상태를 읽어
 * 조용히 저장이 누락된다(화면엔 반영됐는데 DB엔 없는 상태 — Claude.md의 알려진 버그 패턴).
 */
async function flushSave(): Promise<void> {
  if (!storageReady || !activeDestId || !currentTripId) return;
  const tripId = currentTripId;
  const destId = activeDestId;
  const jobs = [...pendingSaveDays]
    .map((idx) => ({ idx, stops: days[idx] ? toStoredStops(days[idx]) : null }))
    .filter((j): j is { idx: number; stops: StoredStop[] } => j.stops !== null);
  pendingSaveDays = new Set();
  for (const job of jobs) {
    await saveRouteDay(tripId, destId, job.idx, job.stops);
  }
}

/* ══════════════ 진입점 ══════════════ */

export async function renderTimelineContent(host: HTMLElement, tripId: string): Promise<void> {
  teardownTimeline();
  container = host;
  currentTripId = tripId;

  host.innerHTML = '<div class="tl-loading"><span class="tl-loading-spinner"></span>일정 불러오는 중…</div>';

  const trip = await loadTrip(tripId);
  currentTrip = trip;
  if (!trip) {
    host.innerHTML = '<div class="tl-loading">여행 정보를 찾을 수 없어요.</div>';
    return;
  }

  await buildDays(trip);

  if (!days.some((d) => d.stops.length > 0)) {
    host.innerHTML = emptyStateHtml();
    host.querySelector('#tl-go-route')?.addEventListener('click', () => gotoGate('route'));
    return;
  }

  // 여행 중이면 오늘 날짜의 DAY로 바로 연다 — 여행지에서 앱을 켰을 때 탭을 찾아
  // 누르지 않아도 "지금 봐야 할 하루"가 먼저 보이게.
  const today = todayDayIndex();
  activeDayIndex = today >= 0 ? today : firstFilledDay();

  host.innerHTML = shellHtml();
  render();
  bindShell();

  subscribeRoutePlan(tripId, () => { void reloadFromRemote(); });
  void loadRealLegsForActiveDay();

  // "지금" 표시는 분 단위로만 움직이면 충분하다
  nowTimer = setInterval(() => { if (todayDayIndex() >= 0) renderNowMarker(); }, 60_000);
}

function firstFilledDay(): number {
  const i = days.findIndex((d) => d.stops.length > 0);
  return i >= 0 ? i : 0;
}

async function reloadFromRemote(): Promise<void> {
  if (!currentTrip || !container) return;
  // 내가 편집 중이던 값을 남의 변경으로 덮어쓰기 전에, 대기 중인 저장을 먼저 커밋한다
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await flushSave(); }
  await buildDays(currentTrip);
  if (activeDayIndex >= days.length) activeDayIndex = Math.max(0, days.length - 1);
  render();
}

/* ══════════════ 셸 ══════════════ */

function emptyStateHtml(): string {
  return [
    '<div class="tl-shell">',
    '  <div class="tl-empty">',
    '    <span class="tl-empty-icon">' + IC_ROUTEPATH + '</span>',
    '    <div class="tl-empty-title">아직 시각표에 올릴 동선이 없어요</div>',
    '    <div class="tl-empty-hint">ROUTE에서 하루 동선을 만들면,<br>여기서 시간 단위로 다듬을 수 있어요.</div>',
    '    <button type="button" class="tl-empty-btn" id="tl-go-route">' + IC_ARROW_BACK + ' ROUTE로 이동</button>',
    '  </div>',
    '</div>',
  ].join('\n');
}

function shellHtml(): string {
  return [
    '<div class="tl-shell">',
    '  <div class="tl-topbar">',
    '    <div class="tl-daystrip" id="tl-daystrip"></div>',
    '    <div class="tl-topbar-actions">',
    '      <div class="tl-segmented" id="tl-viewmode">',
    '        <button type="button" class="tl-segment" data-view="day">하루</button>',
    '        <button type="button" class="tl-segment" data-view="all">전체</button>',
    '      </div>',
    '      <button type="button" class="tl-nowbtn" id="tl-now-btn" hidden>' + IC_CLOCK + '<span>지금</span></button>',
    '      <button type="button" class="tl-routebtn" id="tl-to-route">' + IC_ARROW_BACK + ' 동선 수정</button>',
    '    </div>',
    '  </div>',
    '  <div class="tl-body" id="tl-body">',
    '    <div class="tl-main" id="tl-main"></div>',
    '    <aside class="tl-rail" id="tl-rail"></aside>',
    '  </div>',
    '</div>',
  ].join('\n');
}

function render(): void {
  if (!container) return;
  renderDayStrip();
  renderViewMode();
  const main = container.querySelector('#tl-main') as HTMLElement | null;
  const rail = container.querySelector('#tl-rail') as HTMLElement | null;
  if (!main || !rail) return;

  if (viewMode === 'all') {
    main.innerHTML = allDaysHtml();
    bindAllDays(main);
  } else {
    main.innerHTML = dayScheduleHtml();
    bindDaySchedule(main);
  }
  rail.innerHTML = railHtml();
  bindRail(rail);
  renderNowMarker();
}

function renderViewMode(): void {
  container?.querySelectorAll('#tl-viewmode .tl-segment').forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.view === viewMode);
  });
  const nowBtn = container?.querySelector('#tl-now-btn') as HTMLElement | null;
  if (nowBtn) nowBtn.hidden = todayDayIndex() < 0;
  container?.querySelector('#tl-body')?.classList.toggle('tl-view-all', viewMode === 'all');
}

/* ══════════════ DAY 스트립 ══════════════ */

/**
 * 날짜를 나란히 놓고 **막대 하나로 하루의 밀도를 비교**하게 한다.
 * 트리플식 일정표가 "그날 안에서만" 보이는 것과 달리, 어느 날이 비었고 어느 날이 빡빡한지를
 * 탭을 옮겨 다니지 않고도 한 줄에서 알 수 있게 하려는 것.
 */
function renderDayStrip(): void {
  const el = container?.querySelector('#tl-daystrip') as HTMLElement | null;
  if (!el) return;

  // 막대 길이의 기준 = 가장 긴 하루 (절대 시간이 아니라 "이 여행 안에서의 상대 밀도")
  const spans = days.map((d) => {
    const s = scheduleFor(d);
    return d.stops.length ? Math.max(0, s.spanEndMin - s.spanStartMin) : 0;
  });
  const maxSpan = Math.max(60, ...spans);
  const today = todayDayIndex();

  el.innerHTML = days
    .map((d, i) => {
      const visits = d.stops.length;
      const pct = Math.round((spans[i] / maxSpan) * 100);
      const cls = [
        'tl-daychip',
        i === activeDayIndex ? 'active' : '',
        visits === 0 ? 'is-empty' : '',
        i === today ? 'is-today' : '',
      ].filter(Boolean).join(' ');
      return [
        '<button type="button" class="' + cls + '" data-day="' + i + '">',
        '  <span class="tl-daychip-row">',
        '    <span class="tl-daychip-label">' + escapeHtml(d.label) + '</span>',
        '    <span class="tl-daychip-date">' + escapeHtml(dateLabel(d.date)) + '</span>',
        '  </span>',
        '  <span class="tl-daychip-bar"><i style="width:' + pct + '%"></i></span>',
        '  <span class="tl-daychip-meta">' + (visits ? visits + '곳 · ' + fmtMin(spans[i]) : '비어 있음') + '</span>',
        i === today ? '  <span class="tl-daychip-today">오늘</span>' : '',
        '</button>',
      ].join('');
    })
    .join('');

  el.querySelectorAll('.tl-daychip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number((btn as HTMLElement).dataset.day);
      if (!Number.isFinite(idx) || idx === activeDayIndex) return;
      activeDayIndex = idx;
      expandedKey = null;
      viewMode = 'day';
      render();
      void loadRealLegsForActiveDay();
    });
  });
}

/* ══════════════ 하루 시각표 ══════════════ */

function dayScheduleHtml(): string {
  const day = activeDay();
  if (!day) return '';
  if (!day.stops.length) {
    return [
      '<div class="tl-dayempty">',
      '  <span class="tl-dayempty-icon">' + IC_ROUTEPATH + '</span>',
      '  <div class="tl-dayempty-title">' + escapeHtml(day.label) + '은(는) 아직 비어 있어요</div>',
      '  <div class="tl-dayempty-hint">일부러 비워둔 날일 수도 있어요. 일정을 넣으려면 ROUTE에서 이 DAY에 장소를 담아주세요.</div>',
      '  <button type="button" class="tl-empty-btn" id="tl-day-go-route">' + IC_ARROW_BACK + ' ROUTE에서 채우기</button>',
      '</div>',
    ].join('');
  }

  const s = scheduleFor(day);
  const rows: string[] = [];

  day.stops.forEach((stop, i) => {
    rows.push(stopRowHtml(day, stop, i, s));
    const leg = s.legs[i];
    if (i < day.stops.length - 1) rows.push(legRowHtml(leg, day.stops[i + 1], i));
  });

  return [
    '<div class="tl-day">',
    '  <div class="tl-dayhead">',
    '    <div class="tl-dayhead-left">',
    '      <span class="tl-dayhead-label">' + escapeHtml(day.label) + '</span>',
    '      <span class="tl-dayhead-date">' + escapeHtml(dateLabel(day.date)) + '</span>',
    '    </div>',
    '    <div class="tl-dayhead-right">',
    '      <span class="tl-dayhead-span">' + minToHHMM(s.spanStartMin) + ' – ' + minToHHMM(s.spanEndMin) + '</span>',
    '      <span class="tl-dayhead-dot">·</span>',
    '      <span class="tl-dayhead-count">' + day.stops.length + '곳</span>',
    '    </div>',
    '  </div>',
    // 열 이름 — 아래 모든 줄이 같은 격자를 쓰므로, 숫자들이 무엇인지 한 번만 알려주면 된다
    '  <div class="tl-row tl-colhead">',
    '    <div class="tl-col-time">도착</div>',
    '    <div class="tl-col-spine"></div>',
    '    <div class="tl-col-card">',
    '      <span class="tl-ch-name">일정</span>',
    '      <span class="tl-ch-track">' + minToHHMM(s.spanStartMin) + '<i></i>' + minToHHMM(s.spanEndMin) + '</span>',
    '      <span class="tl-ch-num">체류</span>',
    '      <span class="tl-ch-num tl-ch-depart">출발</span>',
    '      <span></span>',
    '    </div>',
    '  </div>',
    '  <ol class="tl-list" id="tl-list">' + rows.join('') + '</ol>',
    '</div>',
  ].join('');
}

function stopRowHtml(day: TlDay, stop: TlStop, i: number, s: DaySchedule): string {
  const color = CAT_COLOR[stop.cat];
  const expanded = expandedKey === stop.key;
  const fixed = !!stop.arriveTime;
  const dwell = s.dwellMin[i];
  const rating = typeof stop.place?.google_rating === 'number' ? stop.place.google_rating : null;

  // 부제 — 유형 + 구글 카테고리 + 평점을 한 줄에 합친다. 열을 늘리지 않고 정보를 넣기 위해서고,
  // 없는 값(평점 미수집 등)은 그냥 빠진다(원칙 3-1 — 자리를 채우려 만들지 않음).
  const subParts = [CAT_LABEL[stop.cat], stop.place?.category ?? ''].filter(Boolean);
  const sub =
    (subParts.length ? '<span>' + escapeHtml(subParts.join(' · ')) + '</span>' : '') +
    (rating != null ? '<span class="tl-rating">' + IC_STAR + rating.toFixed(1) + '</span>' : '');

  const warn =
    s.overrunMin[i] > 0
      ? '<span class="tl-flag tl-flag-over" title="앞 일정을 다 소화하면 이 시각에 도착할 수 없어요">' +
        IC_ALERT + fmtMin(s.overrunMin[i]) + ' 모자람</span>'
      : s.slackMin[i] > 30
      ? '<span class="tl-flag tl-flag-slack" title="고정한 시각까지 비는 시간이에요">여유 ' + fmtMin(s.slackMin[i]) + '</span>'
      : '';

  return [
    '<li class="tl-row tl-stop' + (expanded ? ' is-open' : '') + '" data-key="' + stop.key + '" data-idx="' + i + '" draggable="true">',
    '  <div class="tl-col-time">',
    '    <input type="text" class="tl-time' + (fixed ? ' is-fixed' : '') + '" value="' + minToHHMM(s.arriveMin[i]) + '"' +
      ' data-key="' + stop.key + '" inputmode="numeric" maxlength="5" spellcheck="false"' +
      ' title="' + (fixed ? '직접 고정한 시각 · 비우면 자동 계산으로 돌아가요' : '앞 일정에서 자동 계산된 시각 · 입력하면 고정돼요') + '"' +
      ' aria-label="' + escapeHtml(stop.name) + ' 도착 시각" />',
    '  </div>',
    '  <div class="tl-col-spine"><span class="tl-dot" style="background:' + color + '"></span></div>',
    '  <div class="tl-col-card">',
    '    <span class="tl-lead">',
    '      <span class="tl-grip" title="드래그해서 순서 바꾸기">' + IC_GRIP + '</span>',
    '      <span class="tl-idx">' + (i + 1) + '</span>',
    '    </span>',
    '    <span class="tl-cat" style="color:' + color + ';background:' + color + '14">' + CAT_ICON[stop.cat] + '</span>',
    '    <span class="tl-name-col">',
    '      <span class="tl-name-row">',
    '        <span class="tl-name">' + escapeHtml(stop.name) + '</span>',
    warn,
    '      </span>',
    sub ? '      <span class="tl-sub">' + sub + '</span>' : '',
    '    </span>',
    // 메모는 이름과 숫자 열 사이의 빈 공간을 채운다 — 새 열을 만들지 않고 한 줄 안에서 소화
    // 메모가 없어도 같은 클래스의 빈 칸을 둔다 — 좁은 화면에서 이 열을 통째로 숨길 때
    // 열 개수가 줄마다 달라지지 않도록(격자가 어긋나지 않도록) 하기 위해서.
    '    <span class="tl-memo-inline"' + (stop.memo ? ' title="' + escapeHtml(stop.memo) + '">' + IC_NOTE + escapeHtml(stop.memo) : '>') + '</span>',
    trackHtml(s, i),
    '    <span class="tl-num">' + (dwell > 0 ? fmtMin(dwell) : '<i class="tl-dash-mark">—</i>') + '</span>',
    '    <span class="tl-num tl-num-depart">' + (dwell > 0 ? minToHHMM(s.departMin[i]) : '<i class="tl-dash-mark">—</i>') + '</span>',
    '    <button type="button" class="tl-expand" data-key="' + stop.key + '" aria-expanded="' + expanded + '"' +
      ' aria-label="' + escapeHtml(stop.name) + ' 상세 ' + (expanded ? '접기' : '펼치기') + '">' + IC_CHEVRON_DOWN + '</button>',
    '  </div>',
    expanded ? detailHtml(day, stop, i, s) : '',
    '</li>',
  ].join('');
}

/**
 * 줄마다 붙는 작은 시간 막대 — 이 정류지가 **하루 전체 중 어느 구간**을 차지하는지 보여준다.
 * 줄들이 쌓이면 그 자체로 하루의 모양(오전이 비었는지, 저녁까지 이어지는지)이 그려져서,
 * 진짜 시간 비례 캘린더처럼 세로 공간을 낭비하지 않고도 "시간 블록"을 읽을 수 있다.
 */
function trackHtml(s: DaySchedule, i: number): string {
  const span = Math.max(1, s.spanEndMin - s.spanStartMin);
  const pos = (min: number) => ((min - s.spanStartMin) / span) * 100;
  // 하루의 끝에 걸친 막대가 overflow에 잘려 아예 안 보이는 일이 없도록 오른쪽 끝에 붙인다
  const clamp = (left: number, width: number) => Math.max(0, Math.min(left, 100 - width));
  const stayWidth = Math.max(1.5, (s.dwellMin[i] / span) * 100);
  const stayLeft = clamp(pos(s.arriveMin[i]), stayWidth);
  const leg = s.legs[i];
  const moveWidth = leg ? Math.max(0.8, (leg.min / span) * 100) : 0;
  const moveHtml = leg
    ? '<i class="tl-track-move" style="left:' + clamp(pos(s.departMin[i]), moveWidth) + '%;width:' + moveWidth + '%"></i>'
    : '';
  return (
    '    <span class="tl-track" aria-hidden="true">' +
    '<i class="tl-track-stay" style="left:' + stayLeft + '%;width:' + stayWidth + '%"></i>' +
    moveHtml +
    '</span>'
  );
}

function legRowHtml(leg: Leg | null, to: TlStop, i: number): string {
  if (!leg) {
    return [
      '<li class="tl-row tl-leg tl-leg-unknown">',
      '  <div class="tl-col-time"></div>',
      '  <div class="tl-col-spine"><span class="tl-spine-line"></span></div>',
      '  <div class="tl-col-card"><span class="tl-leg-body">좌표가 없어 이동시간을 계산할 수 없어요</span></div>',
      '</li>',
    ].join('');
  }
  const manual = !!to.travelMode;
  // 걸어서 가는 구간엔 요금이 없으므로 거리만 한 번 보여준다(거리를 두 번 적지 않기 위해)
  const cost = leg.costTHB > 0 ? leg.costTHB.toLocaleString() + ' ' + (leg.fare?.currency ?? 'THB') : '';
  return [
    '<li class="tl-row tl-leg ' + modeColorClass(leg.mode) + '" data-leg-idx="' + i + '">',
    '  <div class="tl-col-time"><span class="tl-leg-dur">' + fmtMin(leg.min) + '</span></div>',
    '  <div class="tl-col-spine"><span class="tl-spine-line"></span></div>',
    '  <div class="tl-col-card">',
    '    <span class="tl-leg-body">',
    '      <span class="tl-leg-ico">' + MODE_ICON[leg.mode] + '</span>',
    '      <span class="tl-leg-mode">' + modeLabel(leg.mode) + '</span>',
    '      <span class="tl-leg-sep">·</span><span class="tl-leg-dim">' + fmtKm(leg.km) + '</span>',
    cost ? '      <span class="tl-leg-sep">·</span><span class="tl-leg-dim">' + escapeHtml(cost) + '</span>' : '',
    !leg.real ? '      <span class="tl-est" title="실제 경로를 못 받아 직선거리로 추정한 값이에요">추정</span>' : '',
    manual ? '      <span class="tl-manual" title="직접 지정한 이동수단"></span>' : '',
    '    </span>',
    '  </div>',
    '</li>',
  ].join('');
}

/**
 * 펼침 패널 — 한 줄에 넣기엔 긴 정보(메모·주소·이동수단 선택·바깥 링크)를 그 자리에서 처리한다.
 * 접힌 줄을 최대한 얇게 유지하기 위한 장치라, 여기에도 근거 없는 항목은 넣지 않는다.
 */
function detailHtml(day: TlDay, stop: TlStop, i: number, s: DaySchedule): string {
  const p = stop.place;
  const modeBtns = MODES.map((m) => {
    const active = stop.travelMode === m;
    return '<button type="button" class="tl-modebtn' + (active ? ' active' : '') + '" data-mode="' + m + '" data-key="' + stop.key + '">' +
      MODE_ICON[m] + '<span>' + modeLabel(m) + '</span></button>';
  }).join('');

  const mapsUrl = p?.google_place_id
    ? 'https://www.google.com/maps/place/?q=place_id:' + p.google_place_id
    : stop.lat != null && stop.lng != null
    ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(stop.lat + ',' + stop.lng)
    : null;

  return [
    '<div class="tl-detail">',
    '  <div class="tl-detail-grid">',
    '    <label class="tl-field tl-field-wide">',
    '      <span class="tl-field-label">메모</span>',
    '      <input type="text" class="tl-memo" placeholder="이 일정에 대한 메모" value="' + escapeHtml(stop.memo ?? '') + '"' +
      ' data-key="' + stop.key + '" />',
    '    </label>',
    i > 0
      ? '    <div class="tl-field"><span class="tl-field-label">여기까지 이동수단</span><div class="tl-modes">' + modeBtns +
        (stop.travelMode ? '<button type="button" class="tl-modeauto" data-key="' + stop.key + '">자동</button>' : '') +
        '</div></div>'
      : '',
    '  </div>',
    p?.address ? '  <div class="tl-detail-line">' + IC_MAPPIN + '<span>' + escapeHtml(p.address) + '</span></div>' : '',
    stop.arriveTime
      ? '  <div class="tl-detail-line tl-detail-fixed">' + IC_CLOCK +
        '<span>' + escapeHtml(stop.arriveTime) + ' 로 고정됨 — 앞 일정이 밀려도 이 시각은 유지돼요</span>' +
        '<button type="button" class="tl-unfix" data-key="' + stop.key + '">고정 해제</button></div>'
      : '',
    s.slackMin[i] > 30 && !s.overrunMin[i]
      ? '  <div class="tl-detail-line tl-detail-note">앞 일정이 끝나고 ' + fmtMin(s.slackMin[i]) + ' 정도 비어요</div>'
      : '',
    '  <div class="tl-detail-actions">',
    mapsUrl ? '    <a class="tl-detail-link" href="' + mapsUrl + '" target="_blank" rel="noopener noreferrer">' + IC_EXTLINK + ' Google 지도</a>' : '',
    '    <button type="button" class="tl-detail-remove" data-key="' + stop.key + '">' + IC_TRASH + ' 이 일정 빼기</button>',
    '  </div>',
    '</div>',
  ].join('');
}

/* ══════════════ 전체 보기 ══════════════ */

/**
 * 모든 DAY를 컬럼으로 나란히 — 하루씩 넘겨보지 않고 여행 전체의 리듬을 한 화면에서 본다.
 * "장소 간·날짜 간 비교가 어렵다"는 기존 일정표의 약점을 메우는 뷰라, 여기선 편집을 막고
 * 읽기에만 집중한다(수정은 하루 뷰에서).
 */
function allDaysHtml(): string {
  const today = todayDayIndex();
  const cols = days.map((d, i) => {
    const s = scheduleFor(d);
    const rows = d.stops.length
      ? d.stops
          .map((stop, j) => {
            const leg = s.legs[j];
            return [
              '<div class="tl-allrow" data-day="' + i + '">',
              '  <span class="tl-alltime">' + minToHHMM(s.arriveMin[j]) + '</span>',
              '  <span class="tl-alldot" style="background:' + CAT_COLOR[stop.cat] + '"></span>',
              '  <span class="tl-allname">' + escapeHtml(stop.name) + '</span>',
              '</div>',
              leg && j < d.stops.length - 1
                ? '<div class="tl-allleg ' + modeColorClass(leg.mode) + '"><span class="tl-allleg-ico">' + MODE_ICON[leg.mode] +
                  '</span>' + fmtMin(leg.min) + '</div>'
                : '',
            ].join('');
          })
          .join('')
      : '<div class="tl-allempty">비어 있음</div>';

    return [
      '<section class="tl-allcol' + (i === activeDayIndex ? ' active' : '') + (i === today ? ' is-today' : '') + '">',
      '  <button type="button" class="tl-allhead" data-day="' + i + '" title="이 DAY를 하루 보기로 열기">',
      '    <span class="tl-allhead-label">' + escapeHtml(d.label) + '</span>',
      '    <span class="tl-allhead-date">' + escapeHtml(dateLabel(d.date)) + '</span>',
      // 같은 24시간 축을 모든 컬럼이 공유하므로, 띠의 위치만 봐도 어느 날이 이르고
      // 어느 날이 늦게까지 이어지는지 바로 비교된다 (이 뷰의 존재 이유)
      '    ' + dayBandHtml(s, { compact: true }),
      '    <span class="tl-allhead-meta">' + (d.stops.length ? d.stops.length + '곳 · 이동 ' + fmtMin(s.totalMoveMin) : '—') + '</span>',
      '  </button>',
      '  <div class="tl-allbody">' + rows + '</div>',
      '</section>',
    ].join('');
  });

  return '<div class="tl-all">' + cols.join('') + '</div>';
}

/* ══════════════ 우측 요약 레일 ══════════════ */

function railHtml(): string {
  const day = activeDay();
  if (!day) return '';
  const s = scheduleFor(day);
  const span = Math.max(1, s.spanEndMin - s.spanStartMin);
  // 하루를 채운 시간 = 이동 + 머무름 + (고정 시각 때문에 생긴) 여유
  const move = s.totalMoveMin;
  const stay = s.totalDwellMin;
  const idle = Math.max(0, span - move - stay);
  const pct = (v: number) => Math.round((v / span) * 100);

  const overruns = s.overrunMin.filter((m) => m > 0).length;
  const bigSlacks = s.slackMin.filter((m) => m > 90).length;

  const alerts: string[] = [];
  if (overruns > 0) {
    alerts.push(
      '<div class="tl-alert tl-alert-warn">' + IC_ALERT +
        '<span><b>' + overruns + '곳</b>이 고정 시각에 못 맞춰요. 앞 일정을 줄이거나 시각을 늦춰보세요.</span></div>'
    );
  }
  if (bigSlacks > 0) {
    alerts.push(
      '<div class="tl-alert">' + IC_CLOCK +
        '<span><b>' + bigSlacks + '군데</b>에 1시간 30분 넘는 여유가 있어요.</span></div>'
    );
  }
  if (move > stay && stay > 0) {
    alerts.push(
      '<div class="tl-alert">' + IC_ROUTEPATH +
        '<span>머무는 시간보다 <b>이동이 더 길어요</b>. ROUTE에서 순서를 정리하면 줄일 수 있어요.</span></div>'
    );
  }

  const estNote =
    s.legCount === 0
      ? ''
      : s.realLegCount === 0
      ? '<span id="tl-legs-loading" class="tl-loading-inline" style="display:none">실제 경로 확인 중… </span>* 이동 정보는 직선거리 기반 추정치예요'
      : s.realLegCount === s.legCount
      ? '* 이동시간·거리는 실제 경로 기준 · 택시 요금은 추정치예요'
      : '* ' + s.legCount + '개 구간 중 ' + s.realLegCount + '개만 실제 경로 기준이에요';

  return [
    '<div class="tl-rail-inner">',

    '  <section class="tl-card">',
    '    <div class="tl-card-head">',
    '      <span class="tl-card-title">' + escapeHtml(day.label) + ' 리듬</span>',
    '      <span class="tl-card-sub">' + minToHHMM(s.spanStartMin) + '–' + minToHHMM(s.spanEndMin) + ' · ' + fmtMin(span) + '</span>',
    '    </div>',
    '    <div class="tl-mix" role="img" aria-label="이동 ' + pct(move) + '퍼센트, 머무름 ' + pct(stay) + '퍼센트, 여유 ' + pct(idle) + '퍼센트">',
    '      <i class="tl-mix-move" style="width:' + pct(move) + '%"></i>',
    '      <i class="tl-mix-stay" style="width:' + pct(stay) + '%"></i>',
    '      <i class="tl-mix-idle" style="width:' + pct(idle) + '%"></i>',
    '    </div>',
    '    <div class="tl-legend">',
    '      <div class="tl-legend-item"><span class="tl-legend-dot move"></span><span class="tl-legend-label">이동</span><span class="tl-legend-value">' + fmtMin(move) + '</span></div>',
    '      <div class="tl-legend-item"><span class="tl-legend-dot stay"></span><span class="tl-legend-label">머무름</span><span class="tl-legend-value">' + fmtMin(stay) + '</span></div>',
    '      <div class="tl-legend-item"><span class="tl-legend-dot idle"></span><span class="tl-legend-label">여유</span><span class="tl-legend-value">' + fmtMin(idle) + '</span></div>',
    '    </div>',
    '  </section>',

    '  <section class="tl-card">',
    '    <div class="tl-card-head"><span class="tl-card-title">하루 분포</span></div>',
    dayBandHtml(s),
    '    <div class="tl-band-axis"><span>06</span><span>12</span><span>18</span><span>24</span></div>',
    '  </section>',

    alerts.length ? '  <section class="tl-card tl-card-alerts">' + alerts.join('') + '</section>' : '',

    '  <section class="tl-card">',
    '    <div class="tl-stats">',
    '      <div class="tl-stat"><span class="tl-stat-label">일정</span><span class="tl-stat-value">' + day.stops.length + '곳</span></div>',
    '      <div class="tl-stat"><span class="tl-stat-label">이동 거리</span><span class="tl-stat-value">' + totalKmOf(s).toFixed(1) + 'km</span></div>',
    '      <div class="tl-stat"><span class="tl-stat-label">예상 교통비</span><span class="tl-stat-value">' + s.totalCost.toLocaleString() + ' ' + escapeHtml(s.currency) + '</span></div>',
    '    </div>',
    estNote ? '    <div class="tl-estnote">' + estNote + '</div>' : '',
    '  </section>',

    '</div>',
  ].join('');
}

function totalKmOf(s: DaySchedule): number {
  return s.legs.reduce((sum, l) => sum + (l?.km ?? 0), 0);
}

/**
 * 24시간 띠 위에 일정이 실제로 차지하는 구간을 그린다 — 숫자 대신 모양으로
 * "아침이 비었는지, 밤까지 이어지는지"를 즉시 읽게 하는 장치.
 */
function dayBandHtml(s: DaySchedule, opts: { compact?: boolean } = {}): string {
  const segs: string[] = [];
  s.arriveMin.forEach((a, i) => {
    const d = s.departMin[i];
    if (d <= a) return;
    segs.push(
      '<i class="tl-band-stay" style="left:' + (a / 1440) * 100 + '%;width:' + ((d - a) / 1440) * 100 + '%"></i>'
    );
    const leg = s.legs[i];
    if (leg) {
      segs.push(
        '<i class="tl-band-move" style="left:' + (d / 1440) * 100 + '%;width:' + (leg.min / 1440) * 100 + '%"></i>'
      );
    }
  });
  // 레일의 띠만 "지금" 표시를 갱신받으므로 id는 그쪽에만 붙인다
  if (opts.compact) return '<span class="tl-band tl-band-compact">' + segs.join('') + '</span>';
  return '<div class="tl-band" id="tl-band">' + segs.join('') + '<span class="tl-band-now" id="tl-band-now" hidden></span></div>';
}

/* ══════════════ "지금" 표시 (여행 중) ══════════════ */

/**
 * 오늘이 이 DAY면 현재 시각선을 시각표에 끼워 넣고, 24시간 띠에도 같은 위치를 찍는다.
 * 기기 시계라는 실제 근거가 있는 정보만 쓰고, "예상 도착까지 N분" 같은 추측은 하지 않는다.
 */
function renderNowMarker(): void {
  if (!container) return;
  container.querySelector('.tl-nowline')?.remove();
  const bandNow = container.querySelector('#tl-band-now') as HTMLElement | null;

  const day = activeDay();
  const isToday = !!day && day.date === todayISO();
  if (bandNow) {
    bandNow.hidden = !isToday;
    if (isToday) bandNow.style.left = (nowMinutes() / 1440) * 100 + '%';
  }
  if (!isToday || viewMode !== 'day' || !day || !day.stops.length) return;

  const s = scheduleFor(day);
  const now = nowMinutes();
  const list = container.querySelector('#tl-list') as HTMLElement | null;
  if (!list) return;

  // 현재 시각 바로 다음에 오는 정류지 앞에 선을 넣는다. 하루가 이미 끝났으면 표시하지 않는다.
  const nextIdx = s.arriveMin.findIndex((m) => m > now);
  if (nextIdx < 0) return;

  const marker = document.createElement('li');
  marker.className = 'tl-row tl-nowline';
  marker.innerHTML =
    '<div class="tl-col-time"><span class="tl-nowline-time">' + minToHHMM(now) + '</span></div>' +
    '<div class="tl-col-spine"><span class="tl-nowline-dot"></span></div>' +
    '<div class="tl-col-card"><span class="tl-nowline-bar"></span><span class="tl-nowline-label">지금</span></div>';

  const target = list.querySelector('.tl-stop[data-idx="' + nextIdx + '"]');
  if (target) list.insertBefore(marker, target.previousElementSibling ?? target);
}

/* ══════════════ 이벤트 ══════════════ */

function bindShell(): void {
  if (!container) return;
  container.querySelector('#tl-to-route')?.addEventListener('click', () => gotoGate('route'));

  container.querySelectorAll('#tl-viewmode .tl-segment').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = (btn as HTMLElement).dataset.view as ViewMode;
      if (!v || v === viewMode) return;
      viewMode = v;
      render();
    });
  });

  container.querySelector('#tl-now-btn')?.addEventListener('click', () => {
    const idx = todayDayIndex();
    if (idx < 0) return;
    activeDayIndex = idx;
    viewMode = 'day';
    expandedKey = null;
    render();
    void loadRealLegsForActiveDay();
    container?.querySelector('.tl-nowline')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function bindRail(rail: HTMLElement): void {
  // 레일은 지금은 읽기 전용 — 자리표시자 없이 비워둔다(불필요한 훅을 만들지 않음)
  void rail;
}

function bindAllDays(main: HTMLElement): void {
  main.querySelectorAll('.tl-allhead').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number((btn as HTMLElement).dataset.day);
      if (!Number.isFinite(idx)) return;
      activeDayIndex = idx;
      viewMode = 'day';
      expandedKey = null;
      render();
      void loadRealLegsForActiveDay();
    });
  });
}

function findStop(key: string): { day: TlDay; stop: TlStop; index: number } | null {
  for (const day of days) {
    const index = day.stops.findIndex((s) => s.key === key);
    if (index >= 0) return { day, stop: day.stops[index], index };
  }
  return null;
}

function bindDaySchedule(main: HTMLElement): void {
  main.querySelector('#tl-day-go-route')?.addEventListener('click', () => gotoGate('route'));

  /* 펼치기 — 접힌 줄을 얇게 유지하기 위해 상세 편집은 전부 여기 안으로 */
  main.querySelectorAll('.tl-expand').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = (btn as HTMLElement).dataset.key!;
      expandedKey = expandedKey === key ? null : key;
      render();
    });
  });

  /* 도착 시각 고정 — 비우면 다시 자동 계산으로 돌아간다(명시적 해제 수단, 원칙 3-3) */
  main.querySelectorAll('.tl-time').forEach((input) => {
    const el = input as HTMLInputElement;
    const commit = () => {
      const found = findStop(el.dataset.key!);
      if (!found) return;
      const raw = el.value.trim();
      const next = raw ? parseTimeInput(raw) : null;
      // 형식이 잘못됐으면 조용히 되돌린다 (재렌더가 계산값으로 복구)
      if (raw && !next) { render(); return; }
      found.stop.arriveTime = next;
      scheduleSave(found.day.dayIndex);
      render();
    };
    el.addEventListener('change', commit);
    el.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter') { ke.preventDefault(); el.blur(); }
      if (ke.key === 'Escape') { ke.preventDefault(); render(); }
    });
    el.addEventListener('click', (e) => e.stopPropagation());
  });

  /* 메모 — 입력 중 재렌더하면 포커스가 날아가므로 값만 갱신하고 저장만 예약한다 */
  main.querySelectorAll('.tl-memo').forEach((input) => {
    const el = input as HTMLInputElement;
    el.addEventListener('input', () => {
      const found = findStop(el.dataset.key!);
      if (!found) return;
      found.stop.memo = el.value;
      scheduleSave(found.day.dayIndex);
    });
  });

  /* 이동수단 수동 지정 / 자동으로 되돌리기 */
  main.querySelectorAll('.tl-modebtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const el = btn as HTMLElement;
      const found = findStop(el.dataset.key!);
      if (!found) return;
      const mode = el.dataset.mode as TravelMode;
      // 이미 켜진 걸 다시 누르면 자동 선택으로 되돌린다 (해제 수단을 항상 같은 자리에)
      found.stop.travelMode = found.stop.travelMode === mode ? null : mode;
      scheduleSave(found.day.dayIndex);
      render();
    });
  });
  main.querySelectorAll('.tl-modeauto').forEach((btn) => {
    btn.addEventListener('click', () => {
      const found = findStop((btn as HTMLElement).dataset.key!);
      if (!found) return;
      found.stop.travelMode = null;
      scheduleSave(found.day.dayIndex);
      render();
    });
  });

  main.querySelectorAll('.tl-unfix').forEach((btn) => {
    btn.addEventListener('click', () => {
      const found = findStop((btn as HTMLElement).dataset.key!);
      if (!found) return;
      found.stop.arriveTime = null;
      scheduleSave(found.day.dayIndex);
      render();
    });
  });

  main.querySelectorAll('.tl-detail-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const found = findStop((btn as HTMLElement).dataset.key!);
      if (!found) return;
      found.day.stops.splice(found.index, 1);
      expandedKey = null;
      scheduleSave(found.day.dayIndex);
      render();
      void loadRealLegsForActiveDay();
    });
  });

  bindDragReorder(main);
}

/** 줄을 끌어 순서 바꾸기 — ROUTE 우측 패널과 같은 조작감 */
function bindDragReorder(main: HTMLElement): void {
  let dragKey: string | null = null;

  main.querySelectorAll('.tl-stop').forEach((row) => {
    const el = row as HTMLElement;

    el.addEventListener('dragstart', (e) => {
      dragKey = el.dataset.key ?? null;
      el.classList.add('dragging');
      (e as DragEvent).dataTransfer?.setData('text/plain', dragKey ?? '');
      if ((e as DragEvent).dataTransfer) (e as DragEvent).dataTransfer!.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      dragKey = null;
      el.classList.remove('dragging');
      main.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
    });
    el.addEventListener('dragover', (e) => {
      if (!dragKey || dragKey === el.dataset.key) return;
      e.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const from = dragKey;
      const to = el.dataset.key;
      if (!from || !to || from === to) return;

      const day = activeDay();
      if (!day) return;
      const fromIdx = day.stops.findIndex((s) => s.key === from);
      const toIdx = day.stops.findIndex((s) => s.key === to);
      if (fromIdx < 0 || toIdx < 0) return;

      const [moved] = day.stops.splice(fromIdx, 1);
      day.stops.splice(toIdx, 0, moved);
      scheduleSave(day.dayIndex);
      render();
      void loadRealLegsForActiveDay();
    });
  });
}
