/**
 * TIMELINE 게이트 (04) — 날짜별 일정표.
 *
 * ROUTE(03)에서 지도 위로 만든 동선을 이어받아, **시간축 위에 올려놓고 다듬는** 화면이다.
 * 같은 route_days/route_stops를 읽고 쓰므로 두 화면은 항상 같은 일정을 본다.
 *
 *   ROUTE     = "어디를 어떤 순서로" (지도가 주인공, 동선을 만드는 곳)
 *   TIMELINE  = "몇 시에 얼마나"     (일정 카드가 주인공, 하루를 완성하는 곳)
 *
 * 화면 구성 — 데스크톱은 크게, 모바일은 촘촘하게
 *   상단  DAY 스트립  — 날짜별 채움 정도를 막대로 나란히 비교
 *   좌측  일정 카드    — 사진·메모·평점까지 한 카드에서 다 보이는 "여행 계획서" 형태
 *   우측  지도        — 그날의 경로와 핀. 카드를 누르면 그 핀으로 이동하고, 핀을 누르면 카드로 간다
 *   모바일에선 지도를 접고 카드도 한 줄에 가깝게 줄여, 여행 중 빠르게 확인하는 데 집중한다
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
  dayNumberOffsetFor,
  setActiveDestinationId,
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
import { loadGoogleMapsScript } from '../utils/googleMaps';
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
const IC_ARROW_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>';
const IC_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const IC_ALERT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';
const IC_ROUTEPATH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H14a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h5.5"/></svg>';
const IC_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13"/></svg>';
const IC_GRIP = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';
const IC_EXTLINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>';
const IC_PIN_SMALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21Z"/></svg>';
// "숙소 들르기"(재방문 스탑) 전용 — ROUTE의 IC_LODGING(=Expense 화면 숙소 아이콘)과 동일
const IC_LODGING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15"/><path d="M15 21v-8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v8"/><path d="M7.5 7.5h1M7.5 11h1M7.5 14.5h1M11.5 7.5h1M11.5 11h1M11.5 14.5h1M17.5 14.5h1M17.5 17.5h1"/><path d="M2 21h20"/></svg>';
const IC_STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.8 5.9 20.4 7.2 13.7 2.2 9l6.8-.8z"/></svg>';
const IC_CHEVRON_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
// "여행지 변경" 전용 — Board/Shortlist의 같은 아이콘과 통일
const IC_SWAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3L3 7l4 4M3 7h13a4 4 0 0 1 4 4v1M17 21l4-4-4-4M21 17H8a4 4 0 0 1-4-4v-1"/></svg>';
const IC_PLANE_SM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12L22 5L15 22L11 14L2 12Z"/></svg>';
const IC_CHECK_SM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
// 장소 상세 패널 전용 아이콘
const IC_PD_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
const IC_PD_MAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2Z"/><path d="M9 3v16M15 5v16"/></svg>';
const IC_PD_WEB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"/></svg>';
const IC_PD_BOOK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0 0 4h13"/></svg>';
const IC_PD_SPARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></svg>';

const MODE_ICON: Record<TravelMode, string> = { WALK: IC_WALK, TRANSIT: IC_TRANSIT, TAXI: IC_TAXI };
const MODES: TravelMode[] = ['WALK', 'TRANSIT', 'TAXI'];

/** 일정 핀·시간축 점 색 — 전부 같은 Primary Navy 하나로 통일(레퍼런스 기준) */
const PIN_NAVY = '#193A73';

/**
 * 이 정류지가 속한 캘린더 날짜(dateISO)의 요일에 맞는 영업시간 한 줄을 고른다.
 * Google Places의 opening_hours(weekdayDescriptions)는 월요일부터 7줄이 오므로,
 * JS의 getDay()(일=0)를 월요일 기준 인덱스로 바꿔서 정확히 그날의 줄만 골라 쓴다.
 * 데이터가 없거나 형식이 다르면 null — 근거 없는 영업시간을 지어내지 않는다(원칙 3-1).
 */
function todaysHoursLine(place: Place | null, dateISO: string | null): string | null {
  const lines = place?.opening_hours;
  if (!dateISO || !Array.isArray(lines) || lines.length !== 7) return null;
  if (!lines.every((l) => typeof l === 'string')) return null;
  const d = new Date(dateISO + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const mondayFirstIdx = (d.getDay() + 6) % 7;
  const line = String(lines[mondayFirstIdx]).trim();
  if (!line) return null;
  // "월요일: 09:00~18:00" 형식이면 요일 접두어는 떼고 시간만 배지에 보여준다
  const colonIdx = line.indexOf(':');
  return colonIdx >= 0 && colonIdx < 6 ? line.slice(colonIdx + 1).trim() : line;
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

/** 하루의 기본 시작 시각(분) — ROUTE의 computeStopTimes와 같은 09:00 기준 */
const DAY_START_MIN = 9 * 60;

/**
 * 여행 중에도 쓰는 화면이라 도로·지형은 살리고, 업체 POI 라벨만 옅게 눌러
 * 우리 핀이 묻히지 않게 한다 (shortlist Step2와 같은 접근).
 */
const MAP_STYLE = [
  { featureType: 'poi.business', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ saturation: -45 }, { lightness: 30 }] },
  { featureType: 'poi', elementType: 'labels.text', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];

/* ══════════════ 타입 ══════════════ */

/** 일정 카드 한 장 — route_stops 한 행에 대응 */
interface TlStop {
  /** 이 DAY 안에서만 유일하면 되는 행 키 (같은 장소를 하루에 두 번 담을 수 있으므로 순번 포함) */
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
  /** 비어있으면 일반 정류지, 있으면 "숙소 들르기"처럼 목적만 있는 특수 스탑(예: 짐 두기) —
   *  이럴 땐 일반 장소 카드가 아니라 구간(leg) 카드에 가까운 전용 스타일로 그린다. */
  purpose: string | null;
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
  arriveMin: number[];
  departMin: number[];
  dwellMin: number[];
  /** 고정 시각 때문에 생긴 여유(분). 0보다 크면 그 앞에 빈 시간이 있다는 뜻 */
  slackMin: number[];
  /** 고정 시각이 앞 일정보다 빠를 때 모자란 시간(분). 0보다 크면 일정이 겹친다 */
  overrunMin: number[];
  /** stops[i] → stops[i+1] 구간 (좌표가 없는 정류지는 null) */
  legs: Array<Leg | null>;
  totalMoveMin: number;
  totalDwellMin: number;
  totalCost: number;
  currency: string;
  spanStartMin: number;
  spanEndMin: number;
  realLegCount: number;
  legCount: number;
}

type ViewMode = 'day' | 'all';

/* ══════════════ 모듈 상태 ══════════════ */

let container: HTMLElement | null = null;
let currentTripId = '';
let currentTrip: Trip | null = null;
let activeDestId: string | null = null;
/** 이 트립의 전체 여행지 목록 — 상단 "여행지 변경" 드롭다운에서 고를 목록으로 쓴다 */
let allDestinations: TripDestination[] = [];
let staySegments: StaySegment[] = [];
let placeById = new Map<string, Place>();
let basecampIds = new Set<string>();
/** 공항 이름 -> 합성 Place(사진/평점 포함). ROUTE의 makeAnchorPlace와 같은 목적 —
 * 자동완성에서 실제로 고른 공항의 사진/평점은 trip_destinations에 이미 캐싱되어 있으므로
 * 여기서 다시 구글 API를 부르지 않고 그대로 읽어 쓴다(원칙 3-2). */
let airportPlaceByName = new Map<string, Place>();

let days: TlDay[] = [];
let activeDayIndex = 0;
let viewMode: ViewMode = 'day';
/** 클릭으로 고른 일정 — 카드 강조 + 지도 핀 확대가 함께 따라간다 (마우스를 떼도 유지) */
let selectedKey: string | null = null;
/** 이동수단을 바꾸려고 펼쳐 놓은 구간 번호 (한 번에 하나) */
let openLegIndex: number | null = null;
/** 지도 자리에 장소 상세 패널을 띄워 놓은 정류지 — null이면 그 자리는 원래 지도.
 *  실제 장소 데이터(place)가 없는 정류지(숙소 들르기 등)는 보여줄 게 없어 대상이 될 수 없다. */
let detailKey: string | null = null;
/** 상세 패널의 "리뷰" 탭 선택 상태 — "지도" 탭은 탭이 아니라 실제 지도로 돌아가는 동작이라 상태가 없다 */
let detailTab: 'overview' | 'review' = 'overview';

/** legKey → 모드별 실측. 없으면 직선거리 추정치 (ROUTE와 같은 캐시 전략) */
let realLegs = new Map<string, Record<string, RealLeg>>();
let realLegPending = false;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSaveDays = new Set<number>();
let nowTimer: ReturnType<typeof setInterval> | null = null;
let storageReady = false;

/* 지도 */
let mapInstance: any = null;
let mapMarkers: any[] = [];
let mapLines: any[] = [];
let mapReady = false;
let mapFitKey = '';
/** 지도 열림/닫힘 — 화면 폭과 무관하게 사용자가 언제든 토글할 수 있다 */
let mapOpen = true;

/* ══════════════ 정리 ══════════════ */

export function teardownTimeline(): void {
  // 화면을 떠날 때 대기 중인 저장은 버리지 않고 커밋한다 (Claude.md 알려진 버그 패턴)
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    void flushSave();
  }
  if (nowTimer) { clearInterval(nowTimer); nowTimer = null; }
  closeDestSwitcher();
  unsubscribeRoutePlan();
  resetRouteStorageProbe();
  clearMapOverlays();
  mapInstance = null;
  mapReady = false;
  mapFitKey = '';
  mapOpen = true;
  container = null;
  currentTrip = null;
  activeDestId = null;
  allDestinations = [];
  staySegments = [];
  placeById = new Map();
  basecampIds = new Set();
  airportPlaceByName = new Map();
  days = [];
  activeDayIndex = 0;
  viewMode = 'day';
  selectedKey = null;
  openLegIndex = null;
  detailKey = null;
  detailTab = 'overview';
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

/** 공항 이름/좌표로 실제 Place 객체를 만든다 — ROUTE의 makeAnchorPlace와 동일한 목적.
 * 사진/평점은 트립 설정에서 자동완성으로 공항을 고를 때 이미 trip_destinations에
 * 캐싱되어 있으므로 그대로 넘겨받는다(원칙 3-1 — 없으면 null로 둔다). */
function makeAnchorPlace(
  tripId: string,
  name: string,
  lat: number,
  lng: number,
  photoUrl: string | null,
  rating: number | null
): Place {
  return {
    id: 'airport:' + name,
    trip_id: tripId,
    name,
    lat,
    lng,
    address: null,
    photo_url: photoUrl,
    category: '공항',
    notes: null,
    added_by: null,
    created_at: new Date().toISOString(),
    likes_count: 0,
    google_place_id: null,
    google_rating: rating,
    photo_ref: null,
    opening_hours: null,
    mood: null,
    status: 'idea',
    is_idea: false,
    sort_order: 0,
    destination_id: null,
    group_id: null,
    group_name: null,
    group_order: null,
  } as Place;
}

function buildAirportPlaceMap(trip: Trip, dest: TripDestination | null): Map<string, Place> {
  const map = new Map<string, Place>();
  if (dest?.arrival_airport && dest.arrival_lat != null && dest.arrival_lng != null) {
    map.set(
      dest.arrival_airport,
      makeAnchorPlace(trip.id, dest.arrival_airport, dest.arrival_lat, dest.arrival_lng, dest.arrival_photo_url ?? null, dest.arrival_rating ?? null)
    );
  }
  if (dest?.departure_airport && dest.departure_lat != null && dest.departure_lng != null) {
    map.set(
      dest.departure_airport,
      makeAnchorPlace(trip.id, dest.departure_airport, dest.departure_lat, dest.departure_lng, dest.departure_photo_url ?? null, dest.departure_rating ?? null)
    );
  }
  return map;
}

/**
 * 저장된 동선(route_days/route_stops)을 일정 모델로 변환한다.
 * ROUTE가 숙소·공항 앵커까지 전부 순서대로 저장해 두므로, 여기서 앵커를 다시 계산하지 않고
 * 저장된 순서를 그대로 신뢰한다 — 그래야 두 화면의 일정이 어긋날 여지가 없다.
 */
async function buildDays(trip: Trip): Promise<void> {
  const places = await loadPlaces(trip.id);
  placeById = new Map(places.map((p) => [p.id, p]));

  const dests = await loadDestinations(trip);
  allDestinations = dests;
  const dest: TripDestination | null = resolveActiveDestination(trip.id, dests) ?? null;
  activeDestId = dest && !isSyntheticDestination(dest.id) ? dest.id : null;

  const segments = dest ? await loadStaySegments(trip, dest) : [];
  staySegments = [...segments].sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''));

  basecampIds = new Set(
    [...staySegments.map((s) => s.basecamp_place_id), trip.shortlist_basecamp_place_id].filter(
      (id): id is string => !!id
    )
  );
  airportPlaceByName = buildAirportPlaceMap(trip, dest);

  // DAY 개수 = 숙박 일수 + 1 (ROUTE와 같은 계산 — 마지막 출국일도 하나의 DAY다)
  const start = dest?.start_date ?? trip.start_date;
  const end = dest?.end_date ?? trip.end_date;
  let nights = 1;
  if (start && end) {
    const diff = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000);
    nights = Math.max(1, diff);
  }
  const dayCount = Math.max(2, Math.min(nights, 10) + 1);

  // ROUTE와 같은 계산 — 이 여행지 앞에 다른 여행지가 있으면 그만큼 DAY 번호를 밀어서
  // 여행 전체 기준으로 이어지는 번호를 보여준다(예: 방콕 DAY1~3 다음 푸켓은 DAY4부터).
  const dayOffset = activeDestId ? dayNumberOffsetFor(dests, activeDestId, trip) : 0;

  days = Array.from({ length: dayCount }, (_, i) => ({
    dayIndex: i,
    label: 'DAY ' + (dayOffset + i + 1),
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
  const airportPlace = !s.placeId && s.customName ? airportPlaceByName.get(s.customName) ?? null : null;
  const place = s.placeId ? placeById.get(s.placeId) ?? null : airportPlace;
  const name = place?.name ?? s.customName ?? '이름 없는 지점';
  const isBasecamp = !!s.placeId && basecampIds.has(s.placeId);
  const isAirport = !!airportPlace;
  const mode = s.travelMode && (MODES as string[]).includes(s.travelMode) ? (s.travelMode as TravelMode) : null;
  return {
    key: 'd' + dayIndex + '-' + order + '-' + (s.placeId ?? s.customName ?? 'x'),
    placeId: s.placeId,
    customName: s.customName,
    purpose: s.purpose,
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

  return {
    arriveMin, departMin, dwellMin, slackMin, overrunMin, legs,
    totalMoveMin: totalMove,
    totalDwellMin: dwellMin.reduce((a, b) => a + b, 0),
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
    purpose: s.purpose,
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
    host.innerHTML = '<div class="tl-dest-bar-wrap" id="tl-dest-bar-wrap"></div>' + emptyStateHtml();
    renderDestBar(host, tripId);
    host.querySelector('#tl-go-route')?.addEventListener('click', () => gotoGate('route'));
    return;
  }

  // 여행 중이면 오늘 날짜의 DAY로 바로 연다 — 여행지에서 앱을 켰을 때 탭을 찾아
  // 누르지 않아도 "지금 봐야 할 하루"가 먼저 보이게.
  const today = todayDayIndex();
  activeDayIndex = today >= 0 ? today : firstFilledDay();

  host.innerHTML = '<div class="tl-dest-bar-wrap" id="tl-dest-bar-wrap"></div>' + shellHtml();
  renderDestBar(host, tripId);
  render();
  bindShell();

  subscribeRoutePlan(tripId, () => { void reloadFromRemote(); });
  void loadRealLegsForActiveDay();
  void initMap();

  // "지금" 표시는 분 단위로만 움직이면 충분하다
  nowTimer = setInterval(() => { if (todayDayIndex() >= 0) renderNowMarker(); }, 60_000);
}

/** "N박 · 10.26–11.01" — Board/Shortlist의 여행지 변경 목록과 같은 형식 */
function destMetaLabel(d: TripDestination): string {
  if (!d.start_date || !d.end_date) return '';
  const s = new Date(d.start_date);
  const e = new Date(d.end_date);
  const nights = Math.max(0, Math.round((e.getTime() - s.getTime()) / 86400000));
  const fmt = (dt: Date) => dt.getMonth() + 1 + '.' + dt.getDate();
  return (nights > 0 ? nights + '박 · ' : '') + fmt(s) + '–' + fmt(e);
}

/**
 * 상단 "여행지 변경" 바 — Board/Shortlist와 같은 위치(우측 상단)·같은 역할(전환만).
 * 마이그레이션 전(합성 단일 여행지)이면 렌더하지 않아 기존 화면과 동일.
 */
function renderDestBar(host: HTMLElement, tripId: string): void {
  const wrap = host.querySelector('#tl-dest-bar-wrap') as HTMLElement | null;
  if (!wrap) return;

  if (!activeDestId) {
    wrap.innerHTML = '';
    return;
  }

  wrap.innerHTML = [
    '<div class="tl-dest-bar">',
    '  <button type="button" class="tl-dest-switch" id="tl-dest-switch">' + IC_SWAP + ' 여행지 변경</button>',
    '</div>',
  ].join('');

  wrap.querySelector('#tl-dest-switch')?.addEventListener('click', (e) => {
    openDestSwitcher(host, tripId, e.currentTarget as HTMLElement);
  });
}

let destSwitcherEl: HTMLElement | null = null;
let destSwitcherDismiss: ((e: MouseEvent) => void) | null = null;

function closeDestSwitcher(): void {
  if (destSwitcherEl) { destSwitcherEl.remove(); destSwitcherEl = null; }
  if (destSwitcherDismiss) { document.removeEventListener('mousedown', destSwitcherDismiss); destSwitcherDismiss = null; }
}

/** "여행지 변경" 드롭다운 — 이미 정해진 여행지 중에서 고르기만 함(추가/편집/삭제 없음).
 *  고르면 이 여행지의 DAY·정류지가 전부 새로 바뀌므로, renderTimelineContent를 처음부터
 *  다시 돌려 안전하게 새로 그린다(ROUTE의 openRouteDestSwitcher와 같은 방식). */
function openDestSwitcher(host: HTMLElement, tripId: string, anchor: HTMLElement): void {
  closeDestSwitcher();

  const items = allDestinations
    .filter((d) => !isSyntheticDestination(d.id))
    .map((d) => {
      const active = d.id === activeDestId;
      const meta = destMetaLabel(d);
      return [
        '<button type="button" class="tl-dest-switch-item' + (active ? ' active' : '') + '" data-dest-id="' + d.id + '">',
        '  <span class="tl-dest-switch-plane">' + IC_PLANE_SM + '</span>',
        '  <span class="tl-dest-switch-text">',
        '    <span class="tl-dest-switch-name">' + escapeHtml(d.name) + '</span>',
        meta ? '    <span class="tl-dest-switch-meta">' + escapeHtml(meta) + '</span>' : '',
        '  </span>',
        active ? '  <span class="tl-dest-switch-check">' + IC_CHECK_SM + '</span>' : '',
        '</button>',
      ].join('');
    })
    .join('');

  const pop = document.createElement('div');
  pop.className = 'tl-dest-switcher';
  pop.innerHTML = '<div class="tl-dest-switch-title">여행지 변경</div><div class="tl-dest-switch-list">' + items + '</div>';
  document.body.appendChild(pop);
  destSwitcherEl = pop;

  const r = anchor.getBoundingClientRect();
  const popW = 220;
  let left = r.right - popW;
  if (left < 12) left = 12;
  pop.style.top = r.bottom + 8 + 'px';
  pop.style.left = left + 'px';

  pop.querySelectorAll('.tl-dest-switch-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.destId;
      closeDestSwitcher();
      if (!id || id === activeDestId) return;
      setActiveDestinationId(tripId, id);
      void renderTimelineContent(host, tripId);
    });
  });

  destSwitcherDismiss = (e: MouseEvent) => {
    if (destSwitcherEl && !destSwitcherEl.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
      closeDestSwitcher();
    }
  };
  setTimeout(() => document.addEventListener('mousedown', destSwitcherDismiss!), 0);
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
    '    <div class="tl-empty-title">아직 일정에 올릴 동선이 없어요</div>',
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
    '    <div class="tl-map-handle-col">',
    '      <button type="button" class="tl-map-handle" id="tl-map-toggle" aria-pressed="true" title="지도 열기/닫기">' + IC_CHEVRON_DOWN + '</button>',
    '    </div>',
    '    <div class="tl-mapcol" id="tl-mapcol">',
    '      <div class="tl-map" id="tl-map"></div>',
    '      <div class="tl-map-legend" id="tl-map-legend"></div>',
    '      <div class="tl-pd" id="tl-pd" hidden></div>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

function render(): void {
  if (!container) return;
  renderDayStrip();
  renderViewMode();
  const main = container.querySelector('#tl-main') as HTMLElement | null;
  if (!main) return;

  if (viewMode === 'all') {
    main.innerHTML = allDaysHtml();
    bindAllDays(main);
  } else {
    main.innerHTML = dayScheduleHtml();
    bindDaySchedule(main);
  }
  renderNowMarker();
  drawMap();
  renderPlaceDetailPanel();
}

function renderViewMode(): void {
  container?.querySelectorAll('#tl-viewmode .tl-segment').forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.view === viewMode);
  });
  const nowBtn = container?.querySelector('#tl-now-btn') as HTMLElement | null;
  if (nowBtn) nowBtn.hidden = todayDayIndex() < 0;
  container?.querySelector('#tl-body')?.classList.toggle('tl-view-all', viewMode === 'all');

  // 지도 토글은 전체 보기에선 의미가 없다(그 뷰는 항상 지도를 접음) — 버튼은 남기고 막기만 한다
  const mapBtn = container?.querySelector('#tl-map-toggle') as HTMLButtonElement | null;
  if (mapBtn) {
    mapBtn.disabled = viewMode === 'all';
    mapBtn.classList.toggle('active', mapOpen && viewMode === 'day');
    mapBtn.setAttribute('aria-pressed', String(mapOpen));
  }
  container?.querySelector('#tl-body')?.classList.toggle('tl-map-open', mapOpen && viewMode === 'day');
}

/* ══════════════ DAY 스트립 ══════════════ */

/**
 * 날짜를 나란히 놓고 **막대 하나로 하루의 밀도를 비교**하게 한다.
 * 하루씩 넘겨보지 않아도 어느 날이 비었고 어느 날이 빡빡한지 한 줄에서 알 수 있다.
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
      selectedKey = null;
      openLegIndex = null;
      detailKey = null; // 다른 DAY의 정류지를 보여주던 상세 패널은 의미가 없어 닫는다
      mapFitKey = ''; // DAY가 바뀌면 지도를 그 하루에 맞춰 다시 잡는다
      viewMode = 'day';
      render();
      void loadRealLegsForActiveDay();
    });
  });
}

/* ══════════════ 하루 일정 (카드) ══════════════ */

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
    rows.push(stopCardHtml(stop, i, s, day.date));
    if (i < day.stops.length - 1) rows.push(legRowHtml(s.legs[i], day.stops[i + 1], i, s.arriveMin[i + 1]));
  });

  return ['<div class="tl-day">', dayHeadHtml(day, s), '  <ol class="tl-list" id="tl-list">' + rows.join('') + '</ol>', '</div>'].join('');
}

/** 하루의 요약은 별도 패널이 아니라 제목 옆 한 줄로 — 화면을 나눠 쓰지 않고도 다 읽힌다 */
function dayHeadHtml(day: TlDay, s: DaySchedule): string {
  const estNote =
    s.legCount === 0
      ? ''
      : s.realLegCount === 0
      ? '<span id="tl-legs-loading" class="tl-est-loading" style="display:none">실제 경로 확인 중… </span>이동 정보는 직선거리 기반 추정치'
      : s.realLegCount === s.legCount
      ? '이동시간·거리는 실제 경로 기준 · 택시 요금은 추정치'
      : s.legCount + '개 구간 중 ' + s.realLegCount + '개만 실제 경로 기준';

  const stats = [
    ['일정', day.stops.length + '곳'],
    ['이동', fmtMin(s.totalMoveMin)],
    ['예상 교통비', s.totalCost.toLocaleString() + ' ' + s.currency],
  ];

  return [
    '  <div class="tl-dayhead">',
    '    <div class="tl-dayhead-title">',
    '      <span class="tl-dayhead-label">' + escapeHtml(day.label) + '</span>',
    '      <span class="tl-dayhead-date">' + escapeHtml(dateLabel(day.date)) + '</span>',
    '      <span class="tl-dayhead-span">' + minToHHMM(s.spanStartMin) + ' – ' + minToHHMM(s.spanEndMin) + '</span>',
    '    </div>',
    '    <div class="tl-dayhead-stats">',
    stats.map(([k, v]) =>
      '<span class="tl-hstat"><span class="tl-hstat-k">' + k + '</span><span class="tl-hstat-v">' + escapeHtml(v) + '</span></span>'
    ).join(''),
    '    </div>',
    // 원칙 3-1 — 실측/추정을 섞어 쓰므로 어느 쪽인지 반드시 밝힌다
    estNote ? '    <div class="tl-dayhead-note">* ' + estNote + '예요</div>' : '',
    '  </div>',
  ].join('');
}

/**
 * 일정 카드 — 사진(좌) · 이름/평점/카테고리/영업시간 · 메모, 오른쪽엔 체류 요약 박스.
 * 구글 평점·카테고리·영업시간은 실제로 저장된 데이터가 있을 때만 보여준다 — 입장료·체크인
 * 시각·WiFi처럼 우리 DB에 없는 값은 지어내지 않는다(원칙 3-1).
 */
function stopCardHtml(stop: TlStop, i: number, s: DaySchedule, dateISO: string | null): string {
  const selected = selectedKey === stop.key;
  const fixed = !!stop.arriveTime;
  const dwell = s.dwellMin[i];
  // "숙소 들르기" — 실제 장소가 아니라 목적만 있는 재방문 스탑이라, 사진·평점·영업시간 같은
  // 장소 카드 요소를 다 빼고 구간(leg) 카드에 가까운 전용 스타일로 압축해서 보여준다.
  if (stop.purpose) return revisitStopCardHtml(stop, i, s, selected, fixed, dwell);
  const place = stop.place;

  const warn =
    s.overrunMin[i] > 0
      ? '<span class="tl-flag tl-flag-over" title="앞 일정을 다 소화하면 이 시각에 도착할 수 없어요">' +
        IC_ALERT + fmtMin(s.overrunMin[i]) + ' 모자람</span>'
      : s.slackMin[i] > 30
      ? '<span class="tl-flag tl-flag-slack" title="고정한 시각까지 비는 시간이에요">여유 ' + fmtMin(s.slackMin[i]) + '</span>'
      : '';

  const rating = typeof place?.google_rating === 'number'
    ? '<span class="tl-rating">' + IC_STAR + '<b>' + place.google_rating.toFixed(1) + '</b></span>'
    : '';

  const catParts = [CAT_LABEL[stop.cat], place?.category ?? ''].filter(Boolean);
  const catLine = catParts.length ? '<span class="tl-cat">' + escapeHtml(catParts.join(' · ')) + '</span>' : '';

  const hoursLine = todaysHoursLine(place, dateISO);
  const badges = hoursLine ? '<span class="tl-badge">' + escapeHtml(hoursLine) + '</span>' : '';

  // 사진 주소는 style 속성에 직접 끼워 넣지 않는다 — 따옴표·괄호가 섞이면 CSS가 깨지고,
  // 이미 인코딩된 주소를 다시 인코딩하면(encodeURI) %23 → %2523이 되어 이미지가 안 뜬다.
  // 값은 data-* 로만 넘기고 렌더 후 JS가 style에 넣는다.
  const photo = place?.photo_url
    ? '<div class="tl-photo" data-photo="' + escapeHtml(place.photo_url) + '"></div>'
    : '<div class="tl-photo tl-photo-empty"></div>';

  const mapsUrl = place?.google_place_id
    ? 'https://www.google.com/maps/place/?q=place_id:' + place.google_place_id
    : stop.lat != null && stop.lng != null
    ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(stop.lat + ',' + stop.lng)
    : null;

  // 우측 체류 요약 박스 — 도착/출발은 항상, "예상 체류"는 실제로 머무는 시간이 있을 때만
  // (앵커 정류지처럼 체류시간이 0인 곳에 없는 값을 지어내 보여주지 않기 위해)
  const stayBox = [
    '<div class="tl-staybox">',
    dwell > 0
      ? '  <span class="tl-staybox-label">예상 체류</span><span class="tl-staybox-value">' + fmtMin(dwell) + '</span>'
      : '',
    '  <div class="tl-staybox-times">',
    '    <span class="tl-staybox-time"><b>도착</b>' + minToHHMM(s.arriveMin[i]) + '</span>',
    '    <span class="tl-staybox-time"><b>출발</b>' + minToHHMM(s.departMin[i]) + '</span>',
    '  </div>',
    '</div>',
  ].join('');

  return [
    '<li class="tl-row tl-stop' + (selected ? ' is-selected' : '') + '" data-key="' + stop.key + '" data-idx="' + i + '" draggable="true">',

    '  <div class="tl-col-time">',
    '    <input type="text" class="tl-time' + (fixed ? ' is-fixed' : '') + '" value="' + minToHHMM(s.arriveMin[i]) + '"' +
      ' data-key="' + stop.key + '" inputmode="numeric" maxlength="5" spellcheck="false"' +
      ' title="' + (fixed ? '직접 고정한 시각 · 비우면 자동 계산으로 돌아가요' : '앞 일정에서 자동 계산된 시각 · 입력하면 고정돼요') + '"' +
      ' aria-label="' + escapeHtml(stop.name) + ' 도착 시각" />',
    dwell > 0 ? '    <span class="tl-dwell">' + fmtMin(dwell) + '</span>' : '',
    dwell > 0 ? '    <span class="tl-out">' + minToHHMM(s.departMin[i]) + ' 출발</span>' : '',
    fixed ? '    <button type="button" class="tl-unfix" data-key="' + stop.key + '" title="고정 해제 — 앞 일정에 맞춰 자동으로 계산해요">고정 해제</button>' : '',
    '  </div>',

    '  <div class="tl-col-spine"><span class="tl-spine-line"></span><span class="tl-dot"><i></i></span></div>',

    '  <div class="tl-col-card">',
    '    <div class="tl-card">',
    // 사진은 카드 맨 왼쪽에서 위아래로 꽉 차게 — 카드가 overflow:hidden이라 왼쪽 모서리만
    // 카드 radius를 따라 둥글게 깎인다.
    photo,
    '      <div class="tl-card-body">',
    // 번호는 제목 앞에 붙는다(사진 왼쪽이 아니라) — 레퍼런스의 "① 장소명" 한 줄 구조
    '        <div class="tl-card-titlerow">',
    '          <span class="tl-pin">' + (i + 1) + '</span>',
    '          <h3 class="tl-name">' + escapeHtml(stop.name) + '</h3>',
    warn,
    '        </div>',
    catLine ? '        <div class="tl-catrow">' + catLine + '</div>' : '',
    (rating || badges) ? '        <div class="tl-metarow">' + rating + badges + '</div>' : '',
    '        <div class="tl-memo-row">',
    '          <span class="tl-memo-label">메모</span>',
    '          <input type="text" class="tl-memo" placeholder="메모 추가" value="' + escapeHtml(stop.memo ?? '') + '"' +
      ' data-key="' + stop.key + '" aria-label="' + escapeHtml(stop.name) + ' 메모" />',
    '        </div>',
    '      </div>',
    stayBox,
    '      <div class="tl-card-tools">',
    '        <span class="tl-tool tl-grip" title="드래그해서 순서 바꾸기">' + IC_GRIP + '</span>',
    '        <button type="button" class="tl-tool tl-tool-map" data-key="' + stop.key + '" title="지도에서 이 일정 보기" aria-label="지도에서 보기">' + IC_PIN_SMALL + '</button>',
    mapsUrl ? '        <a class="tl-tool" href="' + mapsUrl + '" target="_blank" rel="noopener noreferrer" title="Google 지도에서 열기" aria-label="Google 지도에서 열기">' + IC_EXTLINK + '</a>' : '',
    '        <button type="button" class="tl-tool tl-tool-remove" data-key="' + stop.key + '" title="이 일정 빼기" aria-label="' + escapeHtml(stop.name) + ' 일정에서 빼기">' + IC_TRASH + '</button>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</li>',
  ].join('');
}

/**
 * "숙소 들르기"(예: 짐 두기) 전용 카드 — 일반 장소 카드(사진/평점/카테고리)가 아니라
 * legRowHtml의 구간 카드에 가까운 압축된 스타일. 전용 색(바이올렛) + 아이콘 + 목적 텍스트만
 * 보여주고, 그래도 실제 정류지라 시각 편집/드래그 순서 변경/삭제는 그대로 된다.
 */
function revisitStopCardHtml(
  stop: TlStop,
  i: number,
  s: DaySchedule,
  selected: boolean,
  fixed: boolean,
  dwell: number
): string {
  return [
    '<li class="tl-row tl-stop tl-stop-revisit' + (selected ? ' is-selected' : '') + '" data-key="' + stop.key + '" data-idx="' + i + '" draggable="true">',
    '  <div class="tl-col-time">',
    '    <input type="text" class="tl-time' + (fixed ? ' is-fixed' : '') + '" value="' + minToHHMM(s.arriveMin[i]) + '"' +
      ' data-key="' + stop.key + '" inputmode="numeric" maxlength="5" spellcheck="false"' +
      ' title="' + (fixed ? '직접 고정한 시각 · 비우면 자동 계산으로 돌아가요' : '앞 일정에서 자동 계산된 시각 · 입력하면 고정돼요') + '"' +
      ' aria-label="' + escapeHtml(stop.purpose ?? '') + ' 도착 시각" />',
    dwell > 0 ? '    <span class="tl-dwell">' + fmtMin(dwell) + '</span>' : '',
    fixed ? '    <button type="button" class="tl-unfix" data-key="' + stop.key + '" title="고정 해제 — 앞 일정에 맞춰 자동으로 계산해요">고정 해제</button>' : '',
    '  </div>',
    '  <div class="tl-col-spine"><span class="tl-spine-line"></span><span class="tl-dot tl-dot-revisit"><i></i></span></div>',
    '  <div class="tl-col-card">',
    '    <div class="tl-legcard tl-revisitcard">',
    '      <span class="tl-legcard-icon tl-revisit-icon">' + IC_LODGING + '</span>',
    '      <span class="tl-legcard-mode">숙소 들르기</span>',
    '      <div class="tl-legcard-info"><span class="tl-legcard-stats"><b>' + escapeHtml(stop.purpose ?? '') + '</b></span></div>',
    '      <button type="button" class="tl-tool tl-tool-remove" data-key="' + stop.key + '" title="일정에서 빼기" aria-label="' + escapeHtml(stop.purpose ?? '') + ' 빼기">' + IC_TRASH + '</button>',
    '    </div>',
    '  </div>',
    '</li>',
  ].join('');
}

/**
 * 이동 구간 — 아이콘 원 + 소요시간/거리/요금 + "N시 도착 예정"을 한 장의 카드로 묶는다.
 * 화살표(▼)를 누르면 그 자리에서 이동수단을 바꾼다. 이동수단은 "두 일정 사이"의 속성이라
 * 카드 안이 아니라 여기에 두는 게 맞다.
 */
function legRowHtml(leg: Leg | null, to: TlStop, i: number, nextArriveMin: number): string {
  if (!leg) {
    return [
      '<li class="tl-row tl-leg tl-leg-unknown">',
      '  <div class="tl-col-time"></div>',
      '  <div class="tl-col-spine"><span class="tl-spine-line"></span></div>',
      '  <div class="tl-col-card"><div class="tl-legcard"><span class="tl-legcard-empty">좌표가 없어 이동시간을 계산할 수 없어요</span></div></div>',
      '</li>',
    ].join('');
  }

  const open = openLegIndex === i;
  const manual = !!to.travelMode;
  // 걸어서 가는 구간엔 요금이 없으므로 거리만 한 번 보여준다
  const costText = leg.costTHB > 0 ? '예상 요금 ' + leg.costTHB.toLocaleString() + ' ' + (leg.fare?.currency ?? 'THB') : '';

  const modeBtns = MODES.map((m) =>
    '<button type="button" class="tl-modebtn' + (to.travelMode === m ? ' active' : '') + '"' +
    ' data-mode="' + m + '" data-key="' + to.key + '">' + MODE_ICON[m] + '<span>' + modeLabel(m) + '</span></button>'
  ).join('') +
  (manual ? '<button type="button" class="tl-modebtn tl-modeauto" data-key="' + to.key + '">자동으로</button>' : '');

  return [
    '<li class="tl-row tl-leg ' + modeColorClass(leg.mode) + (open ? ' is-open' : '') + '" data-leg-idx="' + i + '">',
    '  <div class="tl-col-time"><span class="tl-leg-dur">' + fmtMin(leg.min) + '</span></div>',
    '  <div class="tl-col-spine"><span class="tl-spine-line"></span></div>',
    '  <div class="tl-col-card">',
    '    <div class="tl-legcard">',
    // 직접 지정한 이동수단은 아이콘 원에 얇은 링으로 표시한다 — 이름 옆에 점을 붙이면
    // "도보 •"처럼 오타로 읽힌다.
    '      <span class="tl-legcard-icon' + (manual ? ' is-manual" title="직접 지정한 이동수단' : '') + '">' +
      MODE_ICON[leg.mode] + '</span>',
    '      <span class="tl-legcard-mode">' + modeLabel(leg.mode) + '</span>',
    // 소요시간·거리·요금은 왼쪽 라벨과 붙지 않고 오른쪽(도착 예정 앞)으로 몰아 정렬한다
    '      <div class="tl-legcard-info">',
    '        <span class="tl-legcard-stats"><b>' + fmtMin(leg.min) + '</b><b>' + fmtKm(leg.km) + '</b>' +
      (!leg.real ? '<span class="tl-est" title="실제 경로를 못 받아 직선거리로 추정한 값이에요">추정</span>' : '') + '</span>',
    costText ? '        <span class="tl-legcard-cost">' + escapeHtml(costText) + '</span>' : '',
    '      </div>',
    // 시각과 "도착 예정"을 따로 감싼다 — 좁은 화면에선 말(label)만 접고 시각은 남기려고
    '      <button type="button" class="tl-legcard-eta" data-leg-idx="' + i + '" aria-expanded="' + open + '" title="눌러서 이동수단 바꾸기">',
    '        <span class="tl-eta-time">' + minToHHMM(nextArriveMin) + '</span>' +
      '<span class="tl-eta-label">도착 예정</span>' + IC_CHEVRON_DOWN,
    '      </button>',
    '    </div>',
    open ? '    <div class="tl-modes">' + modeBtns + '</div>' : '',
    '  </div>',
    '</li>',
  ].join('');
}

/* ══════════════ 전체 보기 ══════════════ */

/**
 * 모든 DAY를 컬럼으로 나란히 — 하루씩 넘겨보지 않고 여행 전체의 리듬을 한 화면에서 본다.
 * 컬럼마다 같은 24시간 축의 띠를 붙여, 어느 날이 이르게 시작하고 어느 날이 늦게까지
 * 이어지는지 위치만으로 비교된다. 편집은 막고 읽기에만 집중한다(수정은 하루 보기에서).
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
              '<div class="tl-allrow">',
              '  <span class="tl-alltime">' + minToHHMM(s.arriveMin[j]) + '</span>',
              '  <span class="tl-alldot" style="background:' + PIN_NAVY + '"></span>',
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
      '    ' + dayBandHtml(s),
      '    <span class="tl-allhead-meta">' + (d.stops.length ? d.stops.length + '곳 · 이동 ' + fmtMin(s.totalMoveMin) : '—') + '</span>',
      '  </button>',
      '  <div class="tl-allbody">' + rows + '</div>',
      '</section>',
    ].join('');
  });

  return '<div class="tl-all">' + cols.join('') + '</div>';
}

/** 24시간 축 위에 그 하루가 실제로 차지하는 구간을 그린 띠 */
function dayBandHtml(s: DaySchedule): string {
  const segs: string[] = [];
  s.arriveMin.forEach((a, i) => {
    const d = s.departMin[i];
    if (d > a) segs.push('<i class="tl-band-stay" style="left:' + (a / 1440) * 100 + '%;width:' + ((d - a) / 1440) * 100 + '%"></i>');
    const leg = s.legs[i];
    if (leg) segs.push('<i class="tl-band-move" style="left:' + (d / 1440) * 100 + '%;width:' + (leg.min / 1440) * 100 + '%"></i>');
  });
  return '<span class="tl-band">' + segs.join('') + '</span>';
}

/* ══════════════ "지금" 표시 (여행 중) ══════════════ */

/**
 * 오늘이 이 DAY면 현재 시각선을 일정 사이에 끼워 넣는다.
 * 기기 시계라는 실제 근거가 있는 정보만 쓰고, "예상 도착까지 N분" 같은 추측은 하지 않는다.
 */
function renderNowMarker(): void {
  if (!container) return;
  container.querySelector('.tl-nowline')?.remove();

  const day = activeDay();
  if (!day || day.date !== todayISO() || viewMode !== 'day' || !day.stops.length) return;

  const s = scheduleFor(day);
  const now = nowMinutes();
  const list = container.querySelector('#tl-list') as HTMLElement | null;
  if (!list) return;

  // 현재 시각 바로 다음에 오는 일정 앞에 선을 넣는다. 하루가 이미 끝났으면 표시하지 않는다.
  const nextIdx = s.arriveMin.findIndex((m) => m > now);
  if (nextIdx < 0) return;

  const marker = document.createElement('li');
  marker.className = 'tl-row tl-nowline';
  marker.innerHTML =
    '<div class="tl-col-time"><span class="tl-nowline-time">' + minToHHMM(now) + '</span></div>' +
    '<div class="tl-col-spine"><span class="tl-spine-line"></span><span class="tl-nowline-dot"></span></div>' +
    '<div class="tl-col-card"><span class="tl-nowline-label">지금</span><span class="tl-nowline-bar"></span></div>';

  const target = list.querySelector('.tl-stop[data-idx="' + nextIdx + '"]');
  if (target) list.insertBefore(marker, target.previousElementSibling ?? target);
}

/* ══════════════ 지도 ══════════════ */

async function initMap(): Promise<void> {
  const mapEl = container?.querySelector('#tl-map') as HTMLElement | null;
  if (!mapEl) return;
  try {
    await loadGoogleMapsScript();
  } catch {
    mapEl.innerHTML = '<div class="tl-map-error">' + IC_ALERT + '<span>지도를 불러오지 못했어요</span></div>';
    return;
  }
  const g = (window as any).google;
  if (!g?.maps || !container) return;

  mapInstance = new g.maps.Map(mapEl, {
    center: { lat: 13.74, lng: 100.53 },
    zoom: 12,
    gestureHandling: 'greedy',
    styles: MAP_STYLE,
    clickableIcons: false,
    zoomControl: false,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    rotateControl: false,
  });
  // 지도 빈 곳 클릭 = 선택 해제 (원칙 3-3 — 명시적 해제 수단)
  mapInstance.addListener('click', () => {
    if (!selectedKey) return;
    selectedKey = null;
    render();
  });
  mapReady = true;
  drawMap();
}

function clearMapOverlays(): void {
  mapMarkers.forEach((m) => m.setMap(null));
  mapLines.forEach((l) => l.setMap(null));
  mapMarkers = [];
  mapLines = [];
}

const PIN_TAIL_RATIO = 1.5;

/** 반지름 r인 원(중심 cx,cy)에 외부 접선 두 개를 그어 tip에서 만나는 "물방울(핀)" 윤곽 경로.
 *  ROUTE의 지도 핀(buildMarkerV2)과 같은 모양 — 두 화면의 핀이 한 눈에 같은 것으로 읽히도록. */
function pinTearPath(cx: number, cy: number, r: number, tipY: number): string {
  const d = tipY - cy;
  const phi = Math.acos(r / d);
  const a1 = Math.PI / 2 - phi;
  const a2 = Math.PI / 2 + phi;
  const t1x = cx + r * Math.cos(a1);
  const t1y = cy + r * Math.sin(a1);
  const t2x = cx + r * Math.cos(a2);
  const t2y = cy + r * Math.sin(a2);
  return 'M' + t1x + ' ' + t1y + ' A' + r + ' ' + r + ' 0 1 0 ' + t2x + ' ' + t2y + ' L' + cx + ' ' + tipY + ' Z';
}

/** 번호가 박힌 물방울 핀 — ROUTE 지도 핀과 같은 모양: 색 채운 물방울 위에 살짝 작은 흰 원을 얹어
 *  위쪽만 링처럼 보이고, 그 흰 원 안에 순번을 핀 색으로 적는다. 카드의 순번 배지와 같은 숫자라
 *  둘이 바로 이어진다. */
function pinIcon(g: any, n: number, color: string, active: boolean): any {
  const r = active ? 15 : 12;
  const pad = 10;
  const tail = r * PIN_TAIL_RATIO;
  const w = Math.ceil(r * 2 + pad);
  const h = Math.ceil(r + tail + pad);
  const cx = w / 2;
  const tipY = h - pad / 2;
  const headCy = tipY - tail;
  const ringWidth = r * 0.24;
  const whiteR = r - ringWidth;
  const shadow =
    '<ellipse cx="' + cx + '" cy="' + (tipY + r * 0.1) + '" rx="' + r * 0.42 + '" ry="' + r * 0.15 + '" fill="rgba(11,42,92,0.18)"/>';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
    shadow +
    '<path d="' + pinTearPath(cx, headCy, r, tipY) + '" fill="' + color + '"/>' +
    '<circle cx="' + cx + '" cy="' + headCy + '" r="' + whiteR + '" fill="#FFFFFF"/>' +
    '<text x="' + cx + '" y="' + (headCy + 4.2) + '" text-anchor="middle" font-family="system-ui,sans-serif" font-size="' +
    Math.round(active ? 13 : 11) + '" font-weight="800" fill="' + color + '">' + n + '</text>' +
    '</svg>';
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new g.maps.Size(w, h),
    anchor: new g.maps.Point(cx, tipY),
  };
}

function drawMap(): void {
  if (!mapReady || !mapInstance) return;
  const g = (window as any).google;
  clearMapOverlays();

  const legendEl = container?.querySelector('#tl-map-legend') as HTMLElement | null;
  const day = activeDay();
  // 전체 보기이거나 사용자가 지도를 닫아 놓았으면 그릴 것도 없다(닫힌 지도는 폭이 0이라
  // 마커를 만들어도 의미가 없고, 다시 열릴 때 resizeMapSoon이 새로 그린다)
  if (viewMode === 'all' || !mapOpen || !day || !day.stops.length) {
    if (legendEl) legendEl.innerHTML = '';
    return;
  }

  const s = scheduleFor(day);
  const pts = day.stops
    .map((stop, i) => ({ stop, i }))
    .filter(({ stop }) => stop.lat != null && stop.lng != null);

  // 구간 선 — 실제 도로 좌표가 있으면 그걸, 없으면 두 점을 잇는 점선(추정)
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const leg = s.legs[a.i];
    if (!leg) continue;
    const path = leg.path?.length
      ? leg.path
      : [{ lat: a.stop.lat!, lng: a.stop.lng! }, { lat: b.stop.lat!, lng: b.stop.lng! }];
    mapLines.push(
      new g.maps.Polyline({
        path,
        map: mapInstance,
        strokeColor: leg.mode === 'WALK' ? '#1D9E75' : leg.mode === 'TRANSIT' ? '#0B7CC4' : '#E08A1E',
        strokeOpacity: leg.path?.length ? 0.85 : 0,
        strokeWeight: 3.5,
        // 실측 경로가 아니면 점선으로 그려서 "추정"임을 지도 위에서도 구분되게 (원칙 3-1)
        icons: leg.path?.length
          ? undefined
          : [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.7, strokeWeight: 3, scale: 3 }, offset: '0', repeat: '12px' }],
        zIndex: 1,
      })
    );
  }

  const bounds = new g.maps.LatLngBounds();
  pts.forEach(({ stop, i }) => {
    const pos = { lat: stop.lat!, lng: stop.lng! };
    bounds.extend(pos);
    const active = selectedKey === stop.key;
    const marker = new g.maps.Marker({
      position: pos,
      map: mapInstance,
      icon: pinIcon(g, i + 1, PIN_NAVY, active),
      title: stop.name,
      zIndex: active ? 999 : 10 + i,
    });
    // 지도 → 목록. 핀을 누르면 그 카드가 선택되고 화면에 보이도록 스크롤한다
    marker.addListener('click', () => {
      selectedKey = selectedKey === stop.key ? null : stop.key;
      render();
      if (selectedKey) {
        container?.querySelector('.tl-stop[data-key="' + CSS.escape(stop.key) + '"]')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    mapMarkers.push(marker);
  });

  if (legendEl) {
    legendEl.innerHTML =
      '<span class="tl-map-legend-day">' + escapeHtml(activeDay()?.label ?? '') + '</span>' +
      '<span class="tl-map-legend-sep">·</span>' +
      '<span>' + pts.length + '곳</span>' +
      (pts.length < day.stops.length
        ? '<span class="tl-map-legend-warn">좌표 없는 일정 ' + (day.stops.length - pts.length) + '개는 표시 못 해요</span>'
        : '');
  }

  // 같은 DAY를 보는 동안엔 사용자가 움직여 놓은 지도를 건드리지 않는다
  const fitKey = day.dayIndex + ':' + pts.map((p) => p.stop.key).join(',');
  if (pts.length && fitKey !== mapFitKey) {
    mapFitKey = fitKey;
    if (pts.length === 1) {
      mapInstance.setCenter(bounds.getCenter());
      mapInstance.setZoom(15);
    } else {
      mapInstance.fitBounds(bounds, { top: 56, right: 40, bottom: 40, left: 40 });
    }
  }
}

/** 카드 → 지도. 선택한 일정의 핀으로 부드럽게 이동 */
function panToStop(stop: TlStop): void {
  if (!mapReady || !mapInstance || stop.lat == null || stop.lng == null) return;
  mapInstance.panTo({ lat: stop.lat, lng: stop.lng });
  if (mapInstance.getZoom() < 14) mapInstance.setZoom(15);
}

/**
 * 지도 칸이 닫혀 있다가 열리면(또는 뷰 전환으로 다시 나타나면) Google Maps가 크기 변경을
 * 스스로 감지하지 못해 타일이 잘려 보인다 — resize 이벤트를 직접 쏴 주고, 패널 크기가
 * 달라졌으니 맞춰뒀던 bounds도 다시 계산하게 mapFitKey를 비운다.
 */
function resizeMapSoon(after?: () => void): void {
  if (!mapInstance) return;
  const g = (window as any).google;
  mapFitKey = '';
  setTimeout(() => {
    g?.maps?.event?.trigger(mapInstance, 'resize');
    drawMap();
    after?.();
  }, 60);
}

/* ══════════════ 장소 상세 패널 (지도 자리에 뜬다) ══════════════ */

/**
 * place_id가 있으면 정확히 그 장소로, 없으면 좌표(그마저 없으면 이름)로 검색 링크를 조합한다.
 * API를 새로 부르지 않고 URL만 만드는 거라 원칙 3-2와 무관하다(워크스페이스 상세 Drawer와 같은 방식).
 */
function pdMapsUrl(place: Place, stop: TlStop): string {
  if (place.google_place_id) return 'https://www.google.com/maps/place/?q=place_id:' + place.google_place_id;
  if (stop.lat != null && stop.lng != null) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(stop.lat + ',' + stop.lng);
  }
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place.name);
}

/**
 * "Place Brief" — AI 요약은 다음 단계에서 연결한다(원칙 3-1, 근거 없는 설명을 지어내지 않음).
 * 지금 당장 정직하게 보여줄 수 있는 건 실제 링크(Google 지도·Wikipedia 검색)와
 * 이미 앱 전체가 쓰는 체류시간 추정치·카테고리뿐이라 그것만 칩으로 놓는다.
 */
function pdBriefSectionHtml(stop: TlStop): string {
  const place = stop.place!;
  const name = stop.name || place.name;
  const mapsUrl = pdMapsUrl(place, stop);
  const wikiUrl = 'https://ko.wikipedia.org/w/index.php?search=' + encodeURIComponent(name);
  const catParts = [CAT_LABEL[stop.cat], place.category ?? ''].filter(Boolean);
  const dwell = dwellMinutes(stop.cat);
  return [
    '<div class="tl-pd-card tl-pd-brief">',
    '  <div class="tl-pd-brief-top">',
    '    <div class="tl-pd-brief-main">',
    '      <div class="tl-pd-card-title">' + IC_PD_SPARK + '<span>Place Brief</span></div>',
    '      <p class="tl-pd-brief-stub">AI 요약은 다음 단계에서 연결돼요.</p>',
    '    </div>',
    '    <div class="tl-pd-linkrow">',
    '      <a class="tl-pd-link" href="' + mapsUrl + '" target="_blank" rel="noopener noreferrer">' + IC_PD_MAP + '<span>Google Maps</span></a>',
    '      <a class="tl-pd-link" href="' + wikiUrl + '" target="_blank" rel="noopener noreferrer">' + IC_PD_WEB + '<span>Wikipedia</span></a>',
    '    </div>',
    '  </div>',
    '  <div class="tl-pd-chips">',
    '    <span class="tl-pd-chip">' + IC_CLOCK + '<span>예상 체류 ' + fmtMin(dwell) + '</span></span>',
    catParts.length ? '    <span class="tl-pd-chip">' + escapeHtml(catParts.join(' · ')) + '</span>' : '',
    '  </div>',
    '</div>',
  ].join('\n');
}

/** 실제 opening_hours가 있을 때만 요일별 7줄을 그대로 보여준다(지어낸 "입장 마감" 같은 값 없음) */
function pdHoursTileHtml(place: Place, dateISO: string | null): string {
  const lines = place.opening_hours;
  if (!Array.isArray(lines) || lines.length !== 7 || !lines.every((l) => typeof l === 'string')) {
    return [
      '<div class="tl-pd-bygo-tile tl-pd-stub">',
      '  <div class="tl-pd-bygo-tile-title">' + IC_CLOCK + '<span>운영시간</span></div>',
      '  <div class="tl-pd-bygo-tile-desc">아직 확인된 영업시간 정보가 없어요.</div>',
      '</div>',
    ].join('');
  }
  const todayIdx = dateISO ? (new Date(dateISO + 'T00:00:00').getDay() + 6) % 7 : -1;
  const rows = lines
    .map((l, i) => '<div class="tl-pd-hours-line' + (i === todayIdx ? ' is-today' : '') + '">' + escapeHtml(String(l)) + '</div>')
    .join('');
  return [
    '<div class="tl-pd-bygo-tile tl-pd-hours-tile">',
    '  <div class="tl-pd-bygo-tile-title">' + IC_CLOCK + '<span>운영시간</span></div>',
    '  <div class="tl-pd-hours-list">' + rows + '</div>',
    '</div>',
  ].join('');
}

/** 복장 규정·준비물 등 나머지 "Before You Go" 항목은 전부 AI 추천이라 지금은 정직한 스텁 하나로 묶는다 */
function pdBeforeGoSectionHtml(stop: TlStop, dateISO: string | null): string {
  const place = stop.place!;
  return [
    '<div class="tl-pd-row2">',
    '  <div class="tl-pd-card tl-pd-bygo">',
    '    <div class="tl-pd-card-title"><span>Before You Go</span></div>',
    '    <div class="tl-pd-bygo-grid">',
    pdHoursTileHtml(place, dateISO),
    '      <div class="tl-pd-bygo-tile tl-pd-stub">',
    '        <div class="tl-pd-bygo-tile-title">' + IC_PD_SPARK + '<span>방문 팁</span></div>',
    '        <div class="tl-pd-bygo-tile-desc">복장 규정·준비물·이동 팁은 AI 단계에서 채워질 예정이에요.</div>',
    '      </div>',
    '    </div>',
    '  </div>',
    '  <div class="tl-pd-note">',
    '    <div class="tl-pd-note-title">' + IC_PD_BOOK + '<span>개인 메모</span></div>',
    '    <textarea class="tl-pd-note-input" id="tl-pd-memo" placeholder="이 장소에 대해 기억할 걸 적어두세요">' + escapeHtml(stop.memo ?? '') + '</textarea>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/** "이 장소에서 놓치지 말 것" — 지금은 추천 데이터가 없어 자리만 잡아 둔 정직한 스텁 카드 하나뿐이다 */
function pdDontMissSectionHtml(): string {
  return [
    '<div class="tl-pd-card tl-pd-dontmiss">',
    '  <div class="tl-pd-card-title"><span>Don’t Miss</span></div>',
    '  <div class="tl-pd-dontmiss-track">',
    '    <div class="tl-pd-dontmiss-stub">',
    '      <div class="tl-pd-dontmiss-stub-title">포토스팟 · 맛집 · 야경 포인트</div>',
    '      <div class="tl-pd-dontmiss-stub-desc">AI 추천은 다음 단계에서 연결돼요.</div>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/** "리뷰" 탭 — 실제 리뷰 텍스트를 모아오는 기능이 아직 없어(원칙 3-1), 있는 평점만 보여주고
 *  나머지는 Google로 보낸다. 링크만 조합하는 거라 API 비용은 들지 않는다. */
function pdReviewTabHtml(stop: TlStop): string {
  const place = stop.place!;
  const name = stop.name || place.name;
  const mapsUrl = pdMapsUrl(place, stop);
  const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(name + ' 리뷰');
  const rating = typeof place.google_rating === 'number'
    ? '<span class="tl-pd-rating tl-pd-rating-lg">' + IC_STAR + '<b>' + place.google_rating.toFixed(1) + '</b></span>'
    : '';
  return [
    '<div class="tl-pd-card tl-pd-review-empty">',
    rating,
    '  <p class="tl-pd-review-msg">아직 리뷰 데이터를 모아오지 않았어요. Google에서 실제 리뷰를 확인해 보세요.</p>',
    '  <div class="tl-pd-linkrow">',
    '    <a class="tl-pd-link" href="' + mapsUrl + '" target="_blank" rel="noopener noreferrer">' + IC_PD_MAP + '<span>Google 지도에서 보기</span></a>',
    '    <a class="tl-pd-link" href="' + searchUrl + '" target="_blank" rel="noopener noreferrer">' + IC_PD_WEB + '<span>Google에서 검색</span></a>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/**
 * 지도 자리에 뜨는 장소 상세 패널 본문. 사진은 지금 장소당 1장만 캐싱돼 있어(원칙 3-1) 여러 장
 * 캐러셀 대신 큰 사진 1장만 보여준다 — 나중에 사진을 여러 장 받아오게 되면 이 자리에 그대로
 * 캐러셀 인디케이터를 얹으면 된다.
 */
function placeDetailHtml(stop: TlStop, dateISO: string | null): string {
  const place = stop.place!;
  const name = stop.name || place.name;
  const catParts = [CAT_LABEL[stop.cat], place.category ?? ''].filter(Boolean);
  const rating = typeof place.google_rating === 'number'
    ? '<span class="tl-pd-rating">' + IC_STAR + '<b>' + place.google_rating.toFixed(1) + '</b></span>'
    : '';
  const photo = place.photo_url
    ? '<div class="tl-pd-photo" data-photo="' + escapeHtml(place.photo_url) + '"></div>'
    : '<div class="tl-pd-photo tl-pd-photo-empty">' + IC_PD_MAP + '</div>';

  const body =
    detailTab === 'review'
      ? pdReviewTabHtml(stop)
      : pdBriefSectionHtml(stop) + pdBeforeGoSectionHtml(stop, dateISO) + pdDontMissSectionHtml();

  return [
    '<div class="tl-pd-head">',
    '  <div class="tl-pd-head-text">',
    '    <h2 class="tl-pd-name">' + escapeHtml(name) + '</h2>',
    '    <div class="tl-pd-headmeta">',
    catParts.length ? '<span class="tl-pd-cat">' + escapeHtml(catParts.join(' · ')) + '</span>' : '',
    rating,
    '    </div>',
    '  </div>',
    photo,
    '  <button type="button" class="tl-pd-close" id="tl-pd-close" title="상세 패널 닫기" aria-label="닫기">' + IC_PD_CLOSE + '</button>',
    '</div>',
    '<div class="tl-pd-tabs">',
    '  <button type="button" class="tl-pd-tab' + (detailTab === 'overview' ? ' active' : '') + '" data-tab="overview">개요</button>',
    '  <button type="button" class="tl-pd-tab" data-tab="map" title="실제 지도로 전환">지도</button>',
    '  <button type="button" class="tl-pd-tab' + (detailTab === 'review' ? ' active' : '') + '" data-tab="review">리뷰</button>',
    '</div>',
    '<div class="tl-pd-body">' + body + '</div>',
  ].join('\n');
}

function renderPlaceDetailPanel(): void {
  const el = container?.querySelector('#tl-pd') as HTMLElement | null;
  if (!el) return;
  const found = detailKey ? findStop(detailKey) : null;
  if (!found || !found.stop.place) {
    detailKey = null;
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = placeDetailHtml(found.stop, found.day.date);
  bindPlaceDetail(el, found.stop, found.day);
}

function bindPlaceDetail(el: HTMLElement, stop: TlStop, day: TlDay): void {
  el.querySelectorAll('.tl-pd-photo').forEach((photoEl) => {
    const url = (photoEl as HTMLElement).dataset.photo;
    if (url) (photoEl as HTMLElement).style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
  });

  el.querySelector('#tl-pd-close')?.addEventListener('click', () => {
    detailKey = null;
    render();
  });

  el.querySelectorAll('.tl-pd-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = (btn as HTMLElement).dataset.tab;
      // "지도" 탭은 상태가 아니라 동작 — 패널을 닫고 실제 지도에서 이 정류지로 이동한다
      if (tab === 'map') {
        selectedKey = stop.key;
        detailKey = null;
        const wasClosed = !mapOpen;
        mapOpen = true;
        render();
        if (wasClosed) resizeMapSoon(() => panToStop(stop));
        else panToStop(stop);
        return;
      }
      if (tab === 'overview' || tab === 'review') {
        detailTab = tab;
        render();
      }
    });
  });

  // 메모는 카드 목록의 한 줄 입력과 같은 값을 공유한다 — 입력 중 전체를 다시 그리면 포커스가
  // 날아가므로 값만 갱신하고, 카드 쪽 입력창도 DOM에서 직접 맞춰준다(scheduleSave 패턴과 동일)
  const memo = el.querySelector('#tl-pd-memo') as HTMLTextAreaElement | null;
  if (memo) {
    memo.addEventListener('input', () => {
      stop.memo = memo.value;
      scheduleSave(day.dayIndex);
      const cardInput = container?.querySelector('.tl-memo[data-key="' + stop.key + '"]') as HTMLInputElement | null;
      if (cardInput && cardInput.value !== memo.value) cardInput.value = memo.value;
    });
  }
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
      // 지도가 숨었다 다시 나타나면 크기를 다시 잡아줘야 회색 여백이 남지 않는다
      if (v === 'day' && mapOpen) resizeMapSoon();
    });
  });

  // 지도 열기/닫기 — 화면 폭과 무관하게 언제든 토글할 수 있다(요청: "항상 열고닫기가 되어야 함")
  container.querySelector('#tl-map-toggle')?.addEventListener('click', () => {
    mapOpen = !mapOpen;
    render();
    if (mapOpen) resizeMapSoon();
  });

  container.querySelector('#tl-now-btn')?.addEventListener('click', () => {
    const idx = todayDayIndex();
    if (idx < 0) return;
    activeDayIndex = idx;
    viewMode = 'day';
    selectedKey = null;
    detailKey = null;
    mapFitKey = '';
    render();
    void loadRealLegsForActiveDay();
    container?.querySelector('.tl-nowline')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function bindAllDays(main: HTMLElement): void {
  main.querySelectorAll('.tl-allhead').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number((btn as HTMLElement).dataset.day);
      if (!Number.isFinite(idx)) return;
      activeDayIndex = idx;
      viewMode = 'day';
      selectedKey = null;
      detailKey = null;
      mapFitKey = '';
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

  main.querySelectorAll('.tl-photo').forEach((el) => {
    const url = (el as HTMLElement).dataset.photo;
    if (url) (el as HTMLElement).style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
  });

  /* 카드 클릭 — 실제 장소 데이터가 있으면 지도 자리를 "이 장소 상세 패널"로 바꾼다.
   * 같은 카드를 다시 누르면 해제(원칙 3-3). 보여줄 장소 데이터가 없는 정류지(숙소 들르기 등)는
   * 예전처럼 선택 표시 + 지도 이동만 한다. */
  main.querySelectorAll('.tl-stop').forEach((row) => {
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('input, button, a')) return;
      const key = (row as HTMLElement).dataset.key!;
      const found = findStop(key);
      if (!found) return;
      if (!found.stop.place) {
        selectedKey = selectedKey === key ? null : key;
        render();
        if (selectedKey) panToStop(found.stop);
        return;
      }
      if (detailKey === key) {
        detailKey = null;
        render();
        return;
      }
      selectedKey = key;
      detailKey = key;
      detailTab = 'overview';
      const wasClosed = !mapOpen;
      mapOpen = true; // 상세 패널도 지도 칸에 뜨는 거라, 접혀 있었다면 열어준다
      render();
      if (wasClosed) resizeMapSoon();
    });
  });

  main.querySelectorAll('.tl-tool-map').forEach((btn) => {
    btn.addEventListener('click', () => {
      const found = findStop((btn as HTMLElement).dataset.key!);
      if (!found) return;
      selectedKey = found.stop.key;
      detailKey = null; // "지도에서 보기"는 상세 패널이 아니라 실제 지도를 보러 온 것
      const wasClosed = !mapOpen;
      mapOpen = true; // "지도에서 보기"는 지도를 보러 온 거니 닫혀 있었다면 열어준다
      render();
      if (wasClosed) resizeMapSoon(() => panToStop(found.stop));
      else panToStop(found.stop);
    });
  });

  /* 도착 시각 고정 — 비우면 다시 자동 계산으로 돌아간다 */
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

  main.querySelectorAll('.tl-unfix').forEach((btn) => {
    btn.addEventListener('click', () => {
      const found = findStop((btn as HTMLElement).dataset.key!);
      if (!found) return;
      found.stop.arriveTime = null;
      scheduleSave(found.day.dayIndex);
      render();
    });
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

  /* 이동수단 — "N시 도착 예정" 칩을 눌러 펼치고, 켜진 걸 다시 누르면 자동 선택으로 되돌린다 */
  main.querySelectorAll('.tl-legcard-eta').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number((btn as HTMLElement).dataset.legIdx);
      if (!Number.isFinite(idx)) return;
      openLegIndex = openLegIndex === idx ? null : idx;
      render();
    });
  });
  main.querySelectorAll('.tl-modebtn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const el = btn as HTMLElement;
      const found = findStop(el.dataset.key!);
      if (!found) return;
      const mode = el.dataset.mode as TravelMode | undefined;
      found.stop.travelMode = !mode ? null : found.stop.travelMode === mode ? null : mode;
      scheduleSave(found.day.dayIndex);
      render();
    });
  });

  main.querySelectorAll('.tl-tool-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const found = findStop((btn as HTMLElement).dataset.key!);
      if (!found) return;
      found.day.stops.splice(found.index, 1);
      if (selectedKey === found.stop.key) selectedKey = null;
      if (detailKey === found.stop.key) detailKey = null;
      openLegIndex = null;
      mapFitKey = '';
      scheduleSave(found.day.dayIndex);
      render();
      void loadRealLegsForActiveDay();
    });
  });

  bindDragReorder(main);
}

/** 카드를 끌어 순서 바꾸기 */
function bindDragReorder(main: HTMLElement): void {
  let dragKey: string | null = null;

  main.querySelectorAll('.tl-stop').forEach((row) => {
    const el = row as HTMLElement;

    el.addEventListener('dragstart', (e) => {
      dragKey = el.dataset.key ?? null;
      el.classList.add('dragging');
      const dt = (e as DragEvent).dataTransfer;
      if (dt) { dt.setData('text/plain', dragKey ?? ''); dt.effectAllowed = 'move'; }
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
      openLegIndex = null;
      scheduleSave(day.dayIndex);
      render();
      void loadRealLegsForActiveDay();
    });
  });
}
