/**
 * ROUTE 게이트 — 여러 명이 지도 위에서 함께 하루 동선을 직접 만드는 협업 워크스페이스.
 *
 * shortlist(SHORTLIST)에서 확정한 결과를 이어받아:
 *   - 숙소(basecamp) = 하루의 출발점(항상 순번 1)
 *   - 확정 장소들      = 지도에 카테고리색 배지 마커로 표시, 클릭하면 그날 동선에 순서대로 추가
 *   - 체류 일수         = DAY 탭 개수 (기본값, "DAY 추가"로 더 늘릴 수 있음)
 *
 * 이 화면은 텍스트 설명 대신 지도·핀·선·색·아이콘으로 정보를 전달하는 것을 원칙으로 한다.
 * 이동시간/교통비는 직선거리(Haversine) 기반 추정치예요(실제 Directions API 호출 없음).
 *
 * 동선 상태는 세션 메모리에만 유지(스키마 변경 없음). 새로고침하면 초기화돼요.
 */

import { supabase } from '../supabase';
import { store } from '../store';
import {
  loadDestinations,
  resolveActiveDestination,
  loadStaySegments,
  resolveActiveSegment,
  isSyntheticDestination,
} from '../trips/destinations';
import { loadGoogleMapsScript } from '../utils/googleMaps';
import {
  loadRoutePlan,
  saveRouteDay,
  clearRoutePlan,
  subscribeRoutePlan,
  unsubscribeRoutePlan,
  isRouteStorageReady,
  resetRouteStorageProbe,
} from './routeStore';
import type { StoredStop } from './routeStore';
import type { Database } from '../types/database';
import './route.css';

type Place = Database['public']['Tables']['places']['Row'];
type Trip = Database['public']['Tables']['trips']['Row'];

/* ── 아이콘 ── */
const IC_WALK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="M11 8l-3 3 2 7M11 8l3 2 3-1M8 11l-3 2v6M13 10l2 4-2 6"/></svg>';
const IC_TRANSIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="14" rx="2"/><path d="M4 11h16M8 21l2-4h4l2 4M8 7h.01M16 7h.01"/></svg>';
const IC_TAXI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M5 17l1.5-5h11L19 17M8 12V8h8v4"/></svg>';
const IC_CAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l1.5-5h11L19 13M5 17h14M5 13h14v4H5zM7 17v2M17 17v2"/><circle cx="7.5" cy="15" r="0.6"/><circle cx="16.5" cy="15" r="0.6"/></svg>';
const IC_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
const IC_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const IC_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
const IC_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const IC_SPARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>';
const IC_STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.8 5.9 20.4 7.2 13.7 2.2 9l6.8-.8z"/></svg>';
const IC_BED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 18v2M21 18v2M3 12V8a2 2 0 0 1 2-2h4v6"/></svg>';
const IC_LANDMARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M4 21V10M20 21V10M2 10l10-6 10 6M6 10v7M10 10v7M14 10v7M18 10v7"/></svg>';
const IC_FORK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2v7a2 2 0 0 0 2 2v11M7 2v7M9 2v7M11 2v7M16 2c-1.5 0-3 1.5-3 4s1.5 4 3 4v10"/></svg>';
const IC_TARGET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>';
const IC_BAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l1 12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>';
const IC_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
const IC_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
const IC_CURSOR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l6.5 17 2-7 7-2L5 3Z"/></svg>';
const IC_PIN_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21C12 21 19 14.5 19 9.5C19 5.9 15.9 3 12 3C8.1 3 5 5.9 5 9.5C5 14.5 12 21 12 21Z"/><path d="M12 6.5v6M9 9.5h6"/></svg>';
const IC_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15l6-6"/><path d="M8 13l-2 2a4 4 0 0 0 6 6l2-2M16 11l2-2a4 4 0 0 0-6-6l-2 2"/></svg>';
const IC_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const IC_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13"/></svg>';
const IC_UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/></svg>';
const IC_REDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h2"/></svg>';
const IC_GRIP = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
const IC_ALERT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';
const IC_ROUTEPATH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H14a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h5.5"/></svg>';

type CatKey = 'VISIT' | 'FOOD' | 'ACTIVITY' | 'SHOPPING' | 'STAY';
const CAT_COLOR: Record<CatKey, string> = {
  VISIT: '#E24B4A', FOOD: '#1D9E75', ACTIVITY: '#7F77DD', SHOPPING: '#F5A623', STAY: '#0B2A5C',
};
const CAT_ICON: Record<CatKey, string> = { VISIT: IC_LANDMARK, FOOD: IC_FORK, ACTIVITY: IC_TARGET, SHOPPING: IC_BAG, STAY: IC_BED };
const SHOPPING_KEYWORDS = ['쇼핑', '마켓', '시장', '백화점', 'mall', 'market', 'shopping'];

interface RouteDay {
  id: string;
  label: string;
  stopIds: string[]; // basecamp 다음의 방문 순서(장소 id들)
}

interface Leg {
  mode: 'WALK' | 'TRANSIT' | 'TAXI';
  km: number;
  min: number;
  costTHB: number;
  /** true면 Routes API 실측, false면 직선거리 기반 추정치 (원칙 3-1 — 화면에 구분 표기) */
  real: boolean;
  /** 실측 대중교통 요금이 있을 때만 (통화 포함) */
  fare?: { units: number; currency: string };
}

/** /api/route-legs 응답의 모드별 실측값 */
interface RealLeg {
  meters: number;
  seconds: number;
  fare?: { units: number; currency: string };
}

interface Pt { lat: number; lng: number }

interface MemberLite {
  id: string;
  display_name: string | null;
}

interface HistoryState {
  past: string[][];
  future: string[][];
}

type ToolKind = 'select' | 'add' | 'connect' | 'transport' | 'memo' | 'delete';

const MEMBER_PALETTE = ['#2E6BE6', '#F59E0B', '#16A34A', '#9333EA', '#DB2777', '#0891B2'];

/** 하단 플로팅 툴바 정의 — 라벨/툴팁/단축키를 한 곳에서 관리 */
const TOOLS: Array<{ key: ToolKind; label: string; icon: string; tip: string; shortcut: string; danger?: boolean }> = [
  { key: 'select', label: '선택', icon: IC_CURSOR, tip: '선택 · 핀을 눌러 정보 보기 (V)', shortcut: 'v' },
  { key: 'add', label: '장소 추가', icon: IC_PIN_PLUS, tip: '장소 추가 · 핀을 눌러 담기 (A)', shortcut: 'a' },
  { key: 'connect', label: '연결', icon: IC_LINK, tip: '연결 · 두 핀을 순서대로 잇기 (C)', shortcut: 'c' },
  { key: 'transport', label: '교통수단', icon: IC_CAR, tip: '교통수단 · 구간을 눌러 변경 (T)', shortcut: 't' },
  { key: 'memo', label: '메모', icon: IC_NOTE, tip: '메모 · 핀을 눌러 메모 입력 (M)', shortcut: 'm' },
  { key: 'delete', label: '삭제', icon: IC_TRASH, tip: '삭제 · 핀을 눌러 동선에서 빼기 (D)', shortcut: 'd', danger: true },
];

/* ── 모듈 상태 ── */
let currentTripId = '';
let currentTrip: Trip | null = null;
let rtContainer: HTMLElement | null = null;
let basecamp: Place | null = null;
let candidatePlaces: Place[] = []; // 확정 장소들(숙소 제외)
let placeById = new Map<string, Place>();
let days: RouteDay[] = [];
let activeDayId = '';
let dayRangeStartDate: string | null = null;
let panelCollapsed = false;
let members: MemberLite[] = [];

let activeTool: ToolKind = 'select';
let connectFromId: string | null = null;
let highlightedPlaceId: string | null = null;
let selectedLegKey: string | null = null;
let adhocMode = false;
let adhocSeq = 0;
let placeSearchQuery = '';
let historyByDay = new Map<string, HistoryState>();
const memoStore = new Map<string, string>();
const timeOverride = new Map<string, string>();
const legModeOverride = new Map<string, Leg['mode']>();

let activeDestId: string | null = null;
/** 실제 길찾기 결과 — legKey → 모드별 {meters,seconds,fare}. 없으면 직선거리 추정치 사용 */
let realLegs = new Map<string, Record<string, RealLeg>>();
let realLegPending = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedSig = '';

let mapInstance: any = null;
let mapMarkers: any[] = [];
let routePolylines: any[] = [];
let mapOverlays: any[] = [];
let placeCardOverlay: any = null;
let placeCardPlaceId: string | null = null;
let resizeHandler: (() => void) | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;

export function teardownRoute(): void {
  if (resizeHandler) { window.removeEventListener('resize', resizeHandler); resizeHandler = null; }
  if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
  // 화면을 떠날 때 대기 중인 저장은 버리지 않고 커밋한다 (Claude.md 알려진 버그 패턴:
  // 대기 타이머를 그냥 취소하면 "화면엔 반영됐는데 DB엔 없는" 상태가 됨).
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    void persistActiveDay();
  }
  unsubscribeRoutePlan();
  resetRouteStorageProbe();
  activeDestId = null;
  realLegs = new Map();
  realLegPending = false;
  lastSavedSig = '';
  currentTrip = null;
  basecamp = null;
  candidatePlaces = [];
  placeById = new Map();
  days = [];
  activeDayId = '';
  dayRangeStartDate = null;
  panelCollapsed = false;
  members = [];
  activeTool = 'select';
  connectFromId = null;
  highlightedPlaceId = null;
  selectedLegKey = null;
  adhocMode = false;
  placeSearchQuery = '';
  historyByDay = new Map();
  memoStore.clear();
  timeOverride.clear();
  legModeOverride.clear();
  mapInstance = null;
  mapMarkers = [];
  routePolylines = [];
  mapOverlays = [];
  placeCardOverlay = null;
  placeCardPlaceId = null;
  rtContainer = null;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ── 거리·이동수단 추정 (직선거리 기반, API 호출 없음) ── */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function legForMode(km: number, mode: Leg['mode']): Leg {
  if (mode === 'WALK') return { mode, km, min: Math.max(2, Math.round(km * 13)), costTHB: 0, real: false };
  if (mode === 'TRANSIT') return { mode, km, min: Math.max(6, Math.round((km / 18) * 60) + 6), costTHB: Math.min(62, 20 + Math.round(km) * 6), real: false };
  return { mode, km, min: Math.max(8, Math.round((km / 24) * 60)), costTHB: 35 + Math.round(km * 6.5), real: false };
}

/** 앱 내부 모드 ↔ Routes API travelMode */
function toApiMode(mode: Leg['mode']): string {
  return mode === 'TAXI' ? 'DRIVE' : mode;
}

/** 실측 데이터를 Leg로 변환. 택시 요금은 Routes API가 주지 않으므로 거리 기반 추정 유지 */
function realToLeg(mode: Leg['mode'], r: RealLeg): Leg {
  const km = r.meters / 1000;
  const min = Math.max(1, Math.round(r.seconds / 60));
  if (mode === 'TRANSIT') {
    // 실측 요금이 있으면 그 값을, 없으면 거리 기반 추정치를 쓴다(추정 여부는 fare 유무로 구분).
    const costTHB = r.fare ? Math.round(r.fare.units) : Math.min(62, 20 + Math.round(km) * 6);
    return { mode, km, min, costTHB, real: true, fare: r.fare };
  }
  if (mode === 'WALK') return { mode, km, min, costTHB: 0, real: true };
  return { mode, km, min, costTHB: 35 + Math.round(km * 6.5), real: true };
}

/**
 * 두 지점 사이의 이동 leg.
 * 실측 데이터(Routes API)가 도착해 있으면 그걸 쓰고, 없으면 직선거리 기반 추정치로 폴백한다.
 * 모드는 수동 지정이 있으면 그것을, 없으면 실측 소요시간(없으면 거리)으로 자동 판단한다.
 */
function estimateLegWithOverride(a: Place, b: Place, override?: Leg['mode']): Leg {
  const straightKm = haversineKm(a.lat!, a.lng!, b.lat!, b.lng!) * 1.25; // 직선→실주행 보정
  const measured = realLegs.get(legKey(a.id, b.id));

  const mode: Leg['mode'] = override ?? pickAutoMode(straightKm, measured);
  const r = measured?.[toApiMode(mode)];
  if (r) return realToLeg(mode, r);
  return legForMode(straightKm, mode);
}

/**
 * 이동수단 자동 선택. 실측이 있으면 "도보 15분 이내면 걷고, 아니면 대중교통이 택시보다
 * 심하게 느리지 않은 한 대중교통"이라는 실제 여행자 기준으로 고른다.
 */
function pickAutoMode(straightKm: number, measured?: Record<string, RealLeg>): Leg['mode'] {
  if (!measured) return straightKm <= 1.0 ? 'WALK' : straightKm <= 6 ? 'TRANSIT' : 'TAXI';
  const walk = measured.WALK;
  const transit = measured.TRANSIT;
  const drive = measured.DRIVE;
  if (walk && walk.seconds <= 15 * 60) return 'WALK';
  if (transit && (!drive || transit.seconds <= drive.seconds * 1.6)) return 'TRANSIT';
  if (drive) return 'TAXI';
  if (transit) return 'TRANSIT';
  if (walk) return 'WALK';
  return straightKm <= 1.0 ? 'WALK' : straightKm <= 6 ? 'TRANSIT' : 'TAXI';
}

function modeIcon(mode: Leg['mode']): string {
  return mode === 'WALK' ? IC_WALK : mode === 'TRANSIT' ? IC_TRANSIT : IC_TAXI;
}
function modeLabel(mode: Leg['mode']): string {
  return mode === 'WALK' ? '도보' : mode === 'TRANSIT' ? 'BTS·지하철' : '택시';
}
function modeColorClass(mode: Leg['mode']): string {
  return mode === 'WALK' ? 'walk' : mode === 'TRANSIT' ? 'transit' : 'taxi';
}

function fmtMin(min: number): string {
  if (min < 60) return min + '분';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? h + '시간' : h + '시간 ' + m + '분';
}
function fmtKm(km: number): string {
  return km >= 1 ? km.toFixed(1) + 'km' : Math.round(km * 1000) + 'm';
}

function legKey(fromId: string, toId: string): string {
  return fromId + '>' + toId;
}

/* ── 카테고리(방문 유형) → 색상·아이콘 ── */
function categoryMeta(p: Place, isBasecamp: boolean): { key: CatKey; color: string; icon: string } {
  if (isBasecamp) return { key: 'STAY', color: CAT_COLOR.STAY, icon: CAT_ICON.STAY };
  const cat = (p.category || '').toLowerCase();
  if (SHOPPING_KEYWORDS.some((k) => cat.includes(k))) return { key: 'SHOPPING', color: CAT_COLOR.SHOPPING, icon: CAT_ICON.SHOPPING };
  if (p.mood === '먹고싶어') return { key: 'FOOD', color: CAT_COLOR.FOOD, icon: CAT_ICON.FOOD };
  if (p.mood === '하고싶어') return { key: 'ACTIVITY', color: CAT_COLOR.ACTIVITY, icon: CAT_ICON.ACTIVITY };
  return { key: 'VISIT', color: CAT_COLOR.VISIT, icon: CAT_ICON.VISIT };
}

function dwellMinutes(key: CatKey): number {
  switch (key) {
    case 'FOOD': return 75;
    case 'ACTIVITY': return 120;
    case 'SHOPPING': return 60;
    case 'STAY': return 0;
    default: return 60;
  }
}

/* ── 현재 활성 DAY / 순서대로 이어진 정류지(출발 숙소 포함) ── */
function activeDay(): RouteDay {
  return days.find((d) => d.id === activeDayId) ?? days[0];
}

/** 출발 숙소 + 그날 방문 장소들을 순서대로 (지도 마커/leg 계산의 기준) */
function orderedStops(day: RouteDay): Place[] {
  const stops: Place[] = [];
  if (basecamp) stops.push(basecamp);
  day.stopIds.forEach((id) => {
    const p = placeById.get(id);
    if (p) stops.push(p);
  });
  return stops;
}

/** 순서대로의 leg들 (stops.length - 1개), 수동 이동수단 오버라이드 반영 */
function dayLegs(day: RouteDay): Leg[] {
  const stops = orderedStops(day).filter((p) => p.lat != null && p.lng != null);
  const legs: Leg[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const override = legModeOverride.get(legKey(stops[i].id, stops[i + 1].id));
    legs.push(estimateLegWithOverride(stops[i], stops[i + 1], override));
  }
  return legs;
}

/* ══════════════ 영속화 (supabase/route_plan.sql) ══════════════ */

/** 현재 DAY 상태의 지문 — 실제로 바뀌었을 때만 저장하려고 비교용으로 쓴다 */
function daySignature(day: RouteDay): string {
  const stops = day.stopIds.map((id) => {
    const p = placeById.get(id);
    return [
      id,
      timeOverride.get(timeKey(day.id, id)) ?? '',
      memoStore.get(id) ?? '',
      p ? legModeOverrideForArrival(day, id) : '',
    ].join('~');
  });
  return day.id + '|' + stops.join('|');
}

/** 이 정류지로 **오는** 구간의 수동 이동수단 (저장 스키마가 도착지 기준이라 맞춰줌) */
function legModeOverrideForArrival(day: RouteDay, placeId: string): string {
  const seq = orderedStops(day);
  const idx = seq.findIndex((p) => p.id === placeId);
  if (idx <= 0) return '';
  return legModeOverride.get(legKey(seq[idx - 1].id, placeId)) ?? '';
}

/** 변경이 있으면 잠시 뒤 저장 (연속 조작을 한 번으로 묶음) */
function scheduleSave(): void {
  if (!isRouteStorageReady() || !activeDestId || !currentTripId) return;
  const day = activeDay();
  if (!day) return;
  const sig = daySignature(day);
  if (sig === lastSavedSig) return;

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistActiveDay();
  }, 600);
}

async function persistActiveDay(): Promise<void> {
  if (!isRouteStorageReady() || !activeDestId || !currentTripId) return;
  const day = activeDay();
  if (!day) return;
  const dayIndex = days.findIndex((d) => d.id === day.id);
  if (dayIndex < 0) return;

  const seq = orderedStops(day);
  const stops: StoredStop[] = day.stopIds.map((id) => {
    const p = placeById.get(id);
    const idx = seq.findIndex((s) => s.id === id);
    const prev = idx > 0 ? seq[idx - 1] : null;
    const isAdhoc = id.startsWith('adhoc-');
    return {
      placeId: isAdhoc ? null : id,
      customName: isAdhoc ? p?.name ?? '직접 추가한 장소' : null,
      customLat: isAdhoc ? p?.lat ?? null : null,
      customLng: isAdhoc ? p?.lng ?? null : null,
      arriveTime: timeOverride.get(timeKey(day.id, id)) ?? null,
      memo: memoStore.get(id) || null,
      travelMode: prev ? legModeOverride.get(legKey(prev.id, id)) ?? null : null,
    };
  });

  const sig = daySignature(day);
  const ok = await saveRouteDay(currentTripId, activeDestId, dayIndex, stops);
  if (ok) lastSavedSig = sig;
}

/** 저장된 동선을 모듈 상태로 복원. 저장된 DAY가 하나도 없으면 false */
function applyStoredPlan(stored: Awaited<ReturnType<typeof loadRoutePlan>>): boolean {
  if (!stored || stored.length === 0) return false;

  let applied = false;
  stored.forEach((sd) => {
    const day = days[sd.dayIndex];
    if (!day) return; // 저장된 DAY 수가 더 많으면(기간이 줄어든 경우) 남는 건 무시
    const ids: string[] = [];
    let prevId: string | null = basecamp?.id ?? null;

    sd.stops.forEach((s) => {
      let id: string | null = null;
      if (s.placeId) {
        if (placeById.has(s.placeId)) id = s.placeId;
      } else if (s.customLat != null && s.customLng != null) {
        // 지도에 직접 찍었던 지점 복원
        const p = makeAdhocPlace(s.customName || '직접 추가한 장소', s.customLat, s.customLng);
        placeById.set(p.id, p);
        candidatePlaces.push(p);
        id = p.id;
      }
      if (!id) return; // 원본 장소가 지워졌으면 조용히 건너뜀

      ids.push(id);
      if (s.arriveTime) timeOverride.set(timeKey(day.id, id), s.arriveTime);
      if (s.memo) memoStore.set(id, s.memo);
      if (s.travelMode && prevId) legModeOverride.set(legKey(prevId, id), s.travelMode as Leg['mode']);
      prevId = id;
    });

    day.stopIds = ids;
    applied = true;
  });

  return applied;
}

function removeStop(placeId: string): void {
  const day = activeDay();
  day.stopIds = day.stopIds.filter((id) => id !== placeId);
}

function toggleStop(placeId: string): void {
  const day = activeDay();
  if (day.stopIds.includes(placeId)) {
    day.stopIds = day.stopIds.filter((id) => id !== placeId);
  } else {
    day.stopIds.push(placeId);
  }
}

/** placeId를 afterId 바로 뒤로 옮긴다(연결 툴). afterId가 숙소면 맨 앞으로. */
function moveStopAfter(placeId: string, afterId: string): void {
  const day = activeDay();
  day.stopIds = day.stopIds.filter((id) => id !== placeId);
  if (basecamp && afterId === basecamp.id) {
    day.stopIds.unshift(placeId);
    return;
  }
  const idx = day.stopIds.indexOf(afterId);
  if (idx === -1) { day.stopIds.push(placeId); return; }
  day.stopIds.splice(idx + 1, 0, placeId);
}

/* ── 실행 취소 / 다시 실행 (DAY별 stopIds 스냅샷) ── */
function pushHistory(dayId: string = activeDayId): void {
  const day = days.find((d) => d.id === dayId);
  if (!day) return;
  const h = historyByDay.get(dayId) ?? { past: [], future: [] };
  h.past.push([...day.stopIds]);
  if (h.past.length > 30) h.past.shift();
  h.future = [];
  historyByDay.set(dayId, h);
}

function doUndo(container: HTMLElement): void {
  const day = activeDay();
  const h = historyByDay.get(day.id);
  if (!h || h.past.length === 0) return;
  h.future.push([...day.stopIds]);
  day.stopIds = h.past.pop()!;
  refreshAll(container, { refit: false });
}

function doRedo(container: HTMLElement): void {
  const day = activeDay();
  const h = historyByDay.get(day.id);
  if (!h || h.future.length === 0) return;
  h.past.push([...day.stopIds]);
  day.stopIds = h.future.pop()!;
  refreshAll(container, { refit: false });
}

function updateUndoRedoState(container: HTMLElement): void {
  const h = historyByDay.get(activeDay().id);
  const undoBtn = container.querySelector('#rt-undo') as HTMLButtonElement | null;
  const redoBtn = container.querySelector('#rt-redo') as HTMLButtonElement | null;
  if (undoBtn) undoBtn.disabled = !h || h.past.length === 0;
  if (redoBtn) redoBtn.disabled = !h || h.future.length === 0;
}

/* ── 즉석 추가(지도에 직접 추가) — 세션 메모리에만 유지되는 가상 장소 ── */
function makeAdhocPlace(name: string, lat: number, lng: number): Place {
  adhocSeq += 1;
  return {
    id: 'adhoc-' + Date.now() + '-' + adhocSeq,
    trip_id: currentTripId,
    name,
    lat,
    lng,
    address: null,
    photo_url: null,
    category: '직접 추가',
    notes: null,
    added_by: null,
    created_at: new Date().toISOString(),
    likes_count: 0,
    google_place_id: null,
    google_rating: null,
    photo_ref: null,
    opening_hours: null,
    mood: '가고싶어',
    status: 'idea',
    is_idea: false,
    sort_order: 0,
    destination_id: null,
  };
}

/* ══════════════════ 데이터 로딩 ══════════════════ */

async function loadTrip(tripId: string): Promise<Trip | null> {
  const cached = store.get('currentTrip');
  if (cached && cached.id === tripId) return cached;
  const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).single();
  if (error) {
    console.error('[Route] Trip load error:', error.message);
    return null;
  }
  return data;
}

async function loadPlaces(tripId: string): Promise<Place[]> {
  const { data, error } = await supabase.from('places').select('*').eq('trip_id', tripId).not('mood', 'is', null);
  if (error) {
    console.error('[Route] places load error:', error.message);
    return [];
  }
  return data ?? [];
}

async function loadMembers(tripId: string): Promise<MemberLite[]> {
  const { data, error } = await supabase
    .from('trip_members')
    .select('id, display_name')
    .eq('trip_id', tripId)
    .order('joined_at', { ascending: true });
  if (error) {
    console.error('[Route] members load error:', error.message);
    return [];
  }
  return data ?? [];
}

function memberColor(i: number): string {
  return MEMBER_PALETTE[i % MEMBER_PALETTE.length];
}

/** shortlist 확정 결과(숙소 + 확정 장소들)를 이어받아 초기 상태 구성 */
async function buildFromShortlist(trip: Trip, places: Place[]): Promise<void> {
  placeById = new Map(places.map((p) => [p.id, p]));

  const dests = await loadDestinations(trip);
  const activeDest = resolveActiveDestination(trip.id, dests);
  activeDestId = activeDest && !isSyntheticDestination(activeDest.id) ? activeDest.id : null;
  const segments = activeDest ? await loadStaySegments(trip, activeDest) : [];
  const seg = activeDest ? resolveActiveSegment(activeDest.id, segments) : null;

  const basecampId = seg?.basecamp_place_id ?? trip.shortlist_basecamp_place_id ?? null;
  basecamp = basecampId ? placeById.get(basecampId) ?? null : null;

  const confirmedIds = seg?.confirmed_place_ids ?? trip.shortlist_confirmed_place_ids ?? [];
  candidatePlaces = confirmedIds
    .map((id) => placeById.get(id))
    .filter((p): p is Place => !!p && p.id !== basecampId && p.lat != null && p.lng != null);

  // 체류 일수 = 여행지 전체 기간 기준(숙소 나누기로 구간이 쪼개져 있어도 DAY는 전체 기간을
  // 다 채워야 함 — 활성 구간의 날짜만 쓰면 그 구간의 좁혀진 기간만큼만 DAY가 생기는 버그가 있었음)
  const start = activeDest?.start_date ?? seg?.start_date ?? trip.start_date;
  const end = activeDest?.end_date ?? seg?.end_date ?? trip.end_date;
  dayRangeStartDate = start ?? null;
  let nights = 1;
  if (start && end) {
    const d = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000);
    nights = Math.max(1, d);
  }
  const dayCount = Math.max(1, Math.min(nights, 10));

  // 첫 진입: 확정 장소를 가까운 순으로 정렬해 1일차에 미리 채워둠(사용자가 조정 가능)
  const sorted = basecamp
    ? [...candidatePlaces].sort(
        (a, b) =>
          haversineKm(basecamp!.lat!, basecamp!.lng!, a.lat!, a.lng!) -
          haversineKm(basecamp!.lat!, basecamp!.lng!, b.lat!, b.lng!)
      )
    : [...candidatePlaces];

  days = Array.from({ length: dayCount }, (_, i) => ({
    id: 'day-' + (i + 1),
    label: 'DAY ' + (i + 1),
    stopIds: [],
  }));
  activeDayId = days[0].id;

  // 저장된 동선이 있으면 그걸 복원(협업/새로고침), 없으면 1일차에 가까운 순으로 미리 채워둔다.
  let restored = false;
  if (activeDestId) {
    const stored = await loadRoutePlan(activeDestId);
    restored = applyStoredPlan(stored);
  }
  if (!restored) {
    days[0].stopIds = sorted.map((p) => p.id);
    // 첫 진입에 자동으로 채운 것도 저장해 두어야 다른 멤버에게 같은 화면이 보인다.
    lastSavedSig = '';
    scheduleSave();
  } else {
    lastSavedSig = daySignature(activeDay());
  }
}

/* ══════════════ 실제 길찾기 (Routes API + DB 캐시) ══════════════ */

/**
 * 현재 DAY의 구간들을 실제 경로 데이터로 채운다(모드 3종 동시 조회 — 교통편 비교에도 그대로 사용).
 * 실패하거나 키가 없으면 조용히 추정치를 유지한다(원칙 3-1대로 화면에 "추정"으로 표기됨).
 */
async function loadRealLegsForActiveDay(container: HTMLElement): Promise<void> {
  const day = activeDay();
  if (!day) return;
  const stops = orderedStops(day).filter((p) => p.lat != null && p.lng != null);
  if (stops.length < 2) return;

  const pending: Array<{ id: string; from: Pt; to: Pt }> = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const key = legKey(stops[i].id, stops[i + 1].id);
    if (realLegs.has(key)) continue; // 이미 받아온 구간은 다시 묻지 않음
    pending.push({
      id: key,
      from: { lat: stops[i].lat!, lng: stops[i].lng! },
      to: { lat: stops[i + 1].lat!, lng: stops[i + 1].lng! },
    });
  }
  if (!pending.length || realLegPending) return;

  realLegPending = true;
  setLegLoading(container, true);
  try {
    const res = await fetch('/api/route-legs', {
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
    if (got && rtContainer) {
      renderRightPanel(rtContainer);
      drawRouteOnMap(false);
    }
  } catch {
    /* 네트워크 실패 → 추정치 유지 */
  } finally {
    realLegPending = false;
    setLegLoading(container, false);
  }
}

function setLegLoading(container: HTMLElement, on: boolean): void {
  const el = container.querySelector('#rt-legs-loading') as HTMLElement | null;
  if (el) el.style.display = on ? '' : 'none';
}

function dayDateLabel(dayIndex: number): string {
  if (!dayRangeStartDate) return '';
  const d = new Date(dayRangeStartDate);
  d.setDate(d.getDate() + dayIndex);
  const week = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return (d.getMonth() + 1) + '.' + String(d.getDate()).padStart(2, '0') + ' (' + week + ')';
}

/* ══════════════════ 메인 렌더 ══════════════════ */

export async function renderRouteContent(container: HTMLElement, tripId: string): Promise<void> {
  teardownRoute();
  currentTripId = tripId;
  rtContainer = container;

  container.innerHTML = '<div class="rt-loading"><span class="rt-loading-spinner"></span>동선 준비 중...</div>';

  const [trip, places, mem] = await Promise.all([loadTrip(tripId), loadPlaces(tripId), loadMembers(tripId)]);
  currentTrip = trip;
  members = mem;
  if (!trip) {
    container.innerHTML = '<div class="rt-loading">여행 정보를 찾을 수 없어요.</div>';
    return;
  }

  await buildFromShortlist(trip, places);

  if (!basecamp) {
    container.innerHTML = [
      '<div class="rt-shell">',
      '  <div class="rt-empty">',
      '    <span class="rt-empty-icon">' + IC_BED + '</span>',
      '    <div class="rt-empty-title">아직 숙소를 확정하지 않았어요</div>',
      '    <div class="rt-empty-hint">SHORTLIST에서 숙소를 여행의 중심으로 확정하면, 그 숙소를 출발점으로 하루 동선을 만들 수 있어요.</div>',
      '    <button type="button" class="rt-empty-btn" id="rt-go-shortlist">' + IC_ARROW + ' SHORTLIST로 이동</button>',
      '  </div>',
      '</div>',
    ].join('\n');
    container.querySelector('#rt-go-shortlist')?.addEventListener('click', () => gotoGate('shortlist'));
    return;
  }

  container.innerHTML = buildPageHtml();
  bindHeaderNav(container);
  bindPage(container);
  await initMap(container);

  // 같은 트립을 보고 있는 다른 멤버의 변경을 실시간으로 반영
  subscribeRoutePlan(tripId, () => { void reloadFromRemote(); });
  void loadRealLegsForActiveDay(container);
}

/** 다른 멤버가 동선을 바꿨을 때 — 내 편집 중인 상태를 버리지 않도록 저장 예약을 먼저 비운다 */
async function reloadFromRemote(): Promise<void> {
  if (!activeDestId || !rtContainer) return;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }

  const stored = await loadRoutePlan(activeDestId);
  if (!stored) return;
  days.forEach((d) => { d.stopIds = []; });
  applyStoredPlan(stored);
  lastSavedSig = daySignature(activeDay());
  refreshAll(rtContainer, { refit: false });
}

function bindHeaderNav(container: HTMLElement): void {
  container.querySelector('#rt-to-timeline-top')?.addEventListener('click', () => gotoGate('timeline'));
}

function gotoGate(gate: string): void {
  window.dispatchEvent(new CustomEvent('mongsil:navigateGate', { detail: { tripId: currentTripId, gate } }));
}

/* ── 페이지 전체 HTML ── */
function buildPageHtml(): string {
  return [
    '<div class="rt-shell">',

    '  <div class="rt-toolbar">',
    '    <div class="rt-daytabs" id="rt-daytabs"></div>',
    '    <div class="rt-toolbar-right">',
    '      <button type="button" class="rt-to-timeline-top" id="rt-to-timeline-top">' + IC_ARROW + ' 타임라인으로</button>',
    '      <div class="rt-searchbox">' + IC_SEARCH + '<input type="text" id="rt-search-top" placeholder="여행지 검색" /></div>',
    '      <button type="button" class="rt-optionsbtn" id="rt-options-btn">' + IC_DOTS + '<span>옵션</span>' + IC_CHEVRON + '</button>',
    '    </div>',
    '  </div>',

    '  <div class="rt-main" id="rt-main">',
    '    <div class="rt-map-col">',
    '      <div class="rt-map-wrap">',
    '        <div id="rt-map" class="rt-map"></div>',

    '        <div class="rt-float-search" id="rt-float-search">',
    '          <div class="rt-float-search-input">' + IC_SEARCH + '<input type="text" id="rt-float-search-input" placeholder="장소 검색" /></div>',
    '          <div class="rt-float-list" id="rt-float-list"></div>',
    '          <button type="button" class="rt-float-adhoc" id="rt-float-adhoc">' + IC_PIN_PLUS + ' 지도에 직접 추가</button>',
    '        </div>',

    '        <div class="rt-memberlegend" id="rt-memberlegend"></div>',

    '        <div class="rt-toolfloat" id="rt-toolfloat" role="toolbar" aria-label="동선 편집 도구">',
    TOOLS.map((t) =>
      '          <button type="button" class="rt-tool' + (t.key === 'select' ? ' active' : '') + (t.danger ? ' danger' : '') +
      '" data-tool="' + t.key + '" data-tip="' + t.tip + '" aria-label="' + t.label + '" aria-pressed="' + (t.key === 'select') + '">' +
      t.icon + '<span class="rt-tool-label">' + t.label + '</span></button>'
    ).join('\n'),
    '          <div class="rt-tool-sep"></div>',
    '          <button type="button" class="rt-tool" id="rt-undo" data-tip="실행 취소 · Ctrl+Z" aria-label="실행 취소" disabled>' + IC_UNDO + '<span class="rt-tool-label">실행 취소</span></button>',
    '          <button type="button" class="rt-tool" id="rt-redo" data-tip="다시 실행 · Ctrl+Shift+Z" aria-label="다시 실행" disabled>' + IC_REDO + '<span class="rt-tool-label">다시 실행</span></button>',
    '        </div>',
    '      </div>',
    '    </div>',

    '    <button type="button" class="rt-collapse-toggle" id="rt-collapse-toggle" title="정보 패널 접기/펼치기" aria-label="정보 패널 접기/펼치기">' + IC_CHEVRON + '</button>',
    '    <div class="rt-panel-col" id="rt-panel-col">',
    '      <div class="rt-panel-inner" id="rt-panel-inner"></div>',
    '    </div>',
    '  </div>',

    '</div>',
  ].join('\n');
}

function bindPage(container: HTMLElement): void {
  renderDayTabs(container);
  renderLeftPanel(container);
  renderRightPanel(container);
  renderMemberLegend(container);
  bindSearchInputs(container);
  bindToolbar(container);
  bindOptionsMenu(container);
  bindAdhocButton(container);

  const toggle = container.querySelector('#rt-collapse-toggle') as HTMLElement;
  const mainEl = container.querySelector('#rt-main') as HTMLElement;
  const panelCol = container.querySelector('#rt-panel-col') as HTMLElement;
  toggle?.addEventListener('click', () => {
    panelCollapsed = !panelCollapsed;
    mainEl.classList.toggle('rt-panel-collapsed', panelCollapsed);
    toggle.classList.toggle('is-collapsed', panelCollapsed);
  });
  panelCol?.addEventListener('transitionend', (e) => {
    if ((e as TransitionEvent).propertyName !== 'width' && (e as TransitionEvent).propertyName !== 'transform') return;
    resizeMap();
  });

  if (escHandler) document.removeEventListener('keydown', escHandler);
  escHandler = (e: KeyboardEvent) => {
    // 입력 중일 땐 단축키를 가로채지 않음 (메모/시간/검색 입력을 방해하지 않도록)
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

    if (e.key === 'Escape') {
      // 명시적 해제 수단 — 열린 카드 → 즉석추가 모드 → 툴 순으로 하나씩 되돌린다
      if (placeCardOverlay) { closePlaceCard(); return; }
      if (adhocMode) { setAdhocMode(container, false); return; }
      if (activeTool !== 'select') { setActiveTool(container, 'select'); return; }
      if (highlightedPlaceId || selectedLegKey) {
        highlightedPlaceId = null;
        selectedLegKey = null;
        drawRouteOnMap(false);
        renderRightPanel(container);
      }
      if (typing) (t as HTMLInputElement).blur();
      return;
    }

    if (typing) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) doRedo(container);
      else doUndo(container);
      return;
    }

    const tool = TOOLS.find((x) => x.shortcut === e.key.toLowerCase());
    if (tool && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setActiveTool(container, tool.key);
    }
  };
  document.addEventListener('keydown', escHandler);
}

/* ── DAY 탭 ── */
function renderDayTabs(container: HTMLElement): void {
  const el = container.querySelector('#rt-daytabs') as HTMLElement;
  if (!el) return;
  el.innerHTML =
    days
      .map((d, i) => {
        const active = d.id === activeDayId;
        const filled = d.stopIds.length > 0;
        return [
          i > 0 ? '<span class="rt-daytab-line" aria-hidden="true"></span>' : '',
          '<button type="button" class="rt-daytab' + (active ? ' active' : '') + '" data-day="' + d.id + '"' +
            ' aria-current="' + (active ? 'true' : 'false') + '"' +
            ' title="' + escapeHtml(d.label) + (filled ? ' · 장소 ' + d.stopIds.length + '곳' : ' · 비어 있음') + '">',
          filled ? '  <span class="rt-daytab-filled" aria-hidden="true"></span>' : '',
          '  <span class="rt-daytab-label">' + escapeHtml(d.label) + '</span>',
          '  <span class="rt-daytab-date">' + dayDateLabel(i) + '</span>',
          '</button>',
        ].join('');
      })
      .join('') +
    '<button type="button" class="rt-daytab-add" id="rt-day-add">' + IC_PLUS + ' DAY 추가</button>';

  el.querySelectorAll('.rt-daytab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeDayId = (btn as HTMLElement).dataset.day!;
      highlightedPlaceId = null;
      selectedLegKey = null;
      refreshAll(container, { refit: true });
    });
  });
  el.querySelector('#rt-day-add')?.addEventListener('click', () => {
    const n = days.length + 1;
    days.push({ id: 'day-' + n, label: 'DAY ' + n, stopIds: [] });
    activeDayId = 'day-' + n;
    refreshAll(container, { refit: true });
  });
}

/* ── 좌측 플로팅 검색 패널 ── */
function bindSearchInputs(container: HTMLElement): void {
  const floatInput = container.querySelector('#rt-float-search-input') as HTMLInputElement | null;
  const topInput = container.querySelector('#rt-search-top') as HTMLInputElement | null;
  floatInput?.addEventListener('input', () => {
    placeSearchQuery = floatInput.value;
    if (topInput && topInput.value !== placeSearchQuery) topInput.value = placeSearchQuery;
    renderLeftPanel(container);
  });
  topInput?.addEventListener('input', () => {
    placeSearchQuery = topInput.value;
    if (floatInput && floatInput.value !== placeSearchQuery) floatInput.value = placeSearchQuery;
    renderLeftPanel(container);
  });
}

function filteredCandidates(): Place[] {
  const q = placeSearchQuery.trim().toLowerCase();
  return q ? candidatePlaces.filter((p) => p.name.toLowerCase().includes(q)) : candidatePlaces;
}

function renderLeftPanel(container: HTMLElement): void {
  const listEl = container.querySelector('#rt-float-list') as HTMLElement;
  if (!listEl) return;
  const day = activeDay();
  const items = filteredCandidates();

  if (!items.length) {
    // 검색 결과 없음 / 애초에 확정 장소 없음을 구분해서 안내
    listEl.innerHTML = placeSearchQuery.trim()
      ? '<div class="rt-float-empty">' + IC_SEARCH + '<div>\'' + escapeHtml(placeSearchQuery.trim()) + '\'와<br>일치하는 장소가 없어요</div></div>'
      : '<div class="rt-float-empty">' + IC_PIN_PLUS + '<div>확정된 장소가 없어요<br>아래에서 직접 추가해보세요</div></div>';
    return;
  }

  listEl.innerHTML = items
    .map((p) => {
      const meta = categoryMeta(p, false);
      const added = day.stopIds.includes(p.id);
      return [
        '<div class="rt-float-item">',
        '  <div class="rt-float-thumb"' + (p.photo_url ? ' style="background-image:url(\'' + p.photo_url + '\')"' : '') + '>' +
          (p.photo_url ? '' : '<span style="color:' + meta.color + '">' + meta.icon + '</span>') + '</div>',
        '  <div class="rt-float-text"><div class="rt-float-name">' + escapeHtml(p.name) + '</div><div class="rt-float-cat">' + escapeHtml(p.category || '') + '</div></div>',
        '  <button type="button" class="rt-float-add' + (added ? ' added' : '') + '" data-place-id="' + p.id + '">' + (added ? IC_CHECK : IC_PLUS) + '</button>',
        '</div>',
      ].join('');
    })
    .join('');

  listEl.querySelectorAll('.rt-float-add').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.placeId!;
      const d = activeDay();
      if (d.stopIds.includes(id)) return;
      pushHistory();
      d.stopIds.push(id);
      refreshAll(container, { refit: true });
    });
  });
}

function setAdhocMode(container: HTMLElement, on: boolean): void {
  adhocMode = on;
  container.querySelector('#rt-float-adhoc')?.classList.toggle('active', on);
}

function bindAdhocButton(container: HTMLElement): void {
  container.querySelector('#rt-float-adhoc')?.addEventListener('click', () => setAdhocMode(container, !adhocMode));
}

/* ── 협업 멤버 색상 범례 ── */
function renderMemberLegend(container: HTMLElement): void {
  const el = container.querySelector('#rt-memberlegend') as HTMLElement;
  if (!el) return;
  if (!members.length) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  const MAX = 4;
  el.innerHTML =
    members
      .slice(0, MAX)
      .map(
        (m, i) =>
          '<div class="rt-memberlegend-item"><span class="rt-memberlegend-dot" style="background:' + memberColor(i) + '"></span>' +
          escapeHtml(m.display_name || '멤버') + '</div>'
      )
      .join('') +
    (members.length > MAX ? '<span class="rt-memberlegend-more">+' + (members.length - MAX) + '</span>' : '');
}

/* ── 하단 플로팅 툴바 ── */
function bindToolbar(container: HTMLElement): void {
  container.querySelectorAll('.rt-tool[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = (btn as HTMLElement).dataset.tool as ToolKind;
      setActiveTool(container, activeTool === tool ? 'select' : tool);
    });
  });
  container.querySelector('#rt-undo')?.addEventListener('click', () => doUndo(container));
  container.querySelector('#rt-redo')?.addEventListener('click', () => doRedo(container));
}

function setActiveTool(container: HTMLElement, tool: ToolKind): void {
  activeTool = tool;
  connectFromId = null;
  closePlaceCard();
  container.querySelectorAll('.rt-tool[data-tool]').forEach((btn) => {
    const on = (btn as HTMLElement).dataset.tool === tool;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  // 툴을 바꾸면 즉석추가 모드는 항상 해제 (모드가 겹쳐 헷갈리지 않도록)
  if (adhocMode) setAdhocMode(container, false);
}

/* ── 옵션 드롭다운 ── */
function bindOptionsMenu(container: HTMLElement): void {
  const btn = container.querySelector('#rt-options-btn') as HTMLElement | null;
  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const existing = document.querySelector('.rt-options-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.className = 'rt-options-menu';
    menu.innerHTML = [
      '<button type="button" id="rt-opt-fit">' + IC_TARGET + ' 전체 동선 화면에 맞추기</button>',
      '<button type="button" id="rt-opt-satellite">' + IC_SPARK + ' 위성 지도 전환</button>',
      '<div class="rt-options-divider"></div>',
      '<button type="button" class="danger" id="rt-opt-reset">' + IC_TRASH + ' 모든 DAY 동선 초기화</button>',
    ].join('');
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = r.bottom + 8 + 'px';
    menu.style.left = Math.max(12, r.right - 210) + 'px';

    menu.querySelector('#rt-opt-fit')?.addEventListener('click', () => {
      fitRouteBounds();
      menu.remove();
    });
    menu.querySelector('#rt-opt-satellite')?.addEventListener('click', () => {
      toggleSatellite();
      menu.remove();
    });
    menu.querySelector('#rt-opt-reset')?.addEventListener('click', () => {
      if (!confirm('이 여행지의 모든 DAY 동선을 초기화할까요?')) { menu.remove(); return; }
      days.forEach((d) => pushHistory(d.id));
      days.forEach((d) => { d.stopIds = []; });
      memoStore.clear();
      timeOverride.clear();
      legModeOverride.clear();
      menu.remove();
      if (activeDestId) void clearRoutePlan(activeDestId);
      lastSavedSig = '';
      refreshAll(container, { refit: true });
    });
    const dismiss = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node) && ev.target !== btn) {
        menu.remove();
        document.removeEventListener('mousedown', dismiss);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  });
}

function toggleSatellite(): void {
  if (!mapInstance) return;
  const g = (window as any).google;
  const current = mapInstance.getMapTypeId();
  mapInstance.setMapTypeId(current === g.maps.MapTypeId.HYBRID ? g.maps.MapTypeId.ROADMAP : g.maps.MapTypeId.HYBRID);
}

/* ── 지도 위 핀 클릭 — 활성 툴에 따라 다르게 동작 ── */
function handlePinClick(g: any, p: Place): void {
  const isBasecamp = !!basecamp && p.id === basecamp.id;
  closePlaceCard();

  if (activeTool === 'delete') {
    if (isBasecamp) return;
    pushHistory();
    removeStop(p.id);
    if (highlightedPlaceId === p.id) highlightedPlaceId = null;
    refreshAll(rtContainer!, { refit: false });
    return;
  }

  if (activeTool === 'connect') {
    const day = activeDay();
    const needsAdd = !isBasecamp && !day.stopIds.includes(p.id);
    const needsMove = !!connectFromId && connectFromId !== p.id;
    if (needsAdd || needsMove) pushHistory();
    if (needsAdd) day.stopIds.push(p.id);
    if (needsMove) moveStopAfter(p.id, connectFromId!);
    connectFromId = p.id;
    highlightedPlaceId = p.id;
    if (g?.maps) showRipple(g, p, categoryMeta(p, isBasecamp).color);
    refreshAll(rtContainer!, { refit: false });
    return;
  }

  if (activeTool === 'memo') {
    const wasIncluded = isBasecamp || activeDay().stopIds.includes(p.id);
    if (!wasIncluded) { pushHistory(); activeDay().stopIds.push(p.id); }
    highlightedPlaceId = p.id;
    refreshAll(rtContainer!, { refit: false });
    requestAnimationFrame(() => focusMemoInput(p.id));
    return;
  }

  if (activeTool === 'transport') return; // 이동수단 변경은 캡슐/커넥터 클릭으로 동작

  if (activeTool === 'add') {
    // "장소 추가" 툴: 클릭 한 번으로 바로 담기/빼기
    if (isBasecamp) return;
    pushHistory();
    toggleStop(p.id);
    highlightedPlaceId = p.id;
    if (g?.maps) showRipple(g, p, categoryMeta(p, false).color);
    refreshAll(rtContainer!, { refit: false });
    return;
  }

  // 기본(선택) 툴: 장소 카드를 열어 정보를 보고 담을지 결정 — hover가 아니라 클릭으로만 반응
  highlightedPlaceId = p.id;
  if (g?.maps) {
    showRipple(g, p, categoryMeta(p, isBasecamp).color);
    openPlaceCard(g, p);
  }
  drawRouteOnMap(false);
  renderRightPanel(rtContainer!);
}

function focusMemoInput(placeId: string): void {
  const input = rtContainer?.querySelector('.rt-panel-memo[data-place-id="' + placeId + '"]') as HTMLInputElement | null;
  input?.focus();
}

function handleLegClick(fromId: string, toId: string, anchor?: HTMLElement): void {
  const key = legKey(fromId, toId);
  if (activeTool === 'transport') {
    openModeOverridePopover(key, anchor);
    return;
  }
  selectedLegKey = selectedLegKey === key ? null : key;
  drawRouteOnMap(false);
  renderRightPanel(rtContainer!);
}

function openModeOverridePopover(key: string, anchor?: HTMLElement): void {
  document.querySelectorAll('.rt-mode-popover').forEach((el) => el.remove());
  const cur = legModeOverride.get(key);
  const measured = realLegs.get(key);

  /** 모드별 실제 소요시간·요금을 나란히 보여줘 사용자가 직접 비교해 고르게 한다 */
  const row = (mode: string, icon: string, label: string) => {
    const on = mode === 'AUTO' ? !cur : cur === mode;
    let meta = '';
    if (mode !== 'AUTO') {
      const r = measured?.[toApiMode(mode as Leg['mode'])];
      if (r) {
        const min = Math.max(1, Math.round(r.seconds / 60));
        const fare = r.fare ? ' · ' + Math.round(r.fare.units) + ' ' + r.fare.currency : '';
        meta = '<span class="rt-mode-meta">' + fmtMin(min) + fare + '</span>';
      } else if (measured) {
        meta = '<span class="rt-mode-meta rt-mode-na">경로 없음</span>';
      }
    }
    return '<button type="button" data-mode="' + mode + '" class="' + (on ? 'selected' : '') + '">' +
      icon + '<span class="rt-mode-name">' + label + '</span>' + meta +
      (on ? '<span class="rt-mode-check">' + IC_CHECK + '</span>' : '') + '</button>';
  };

  const pop = document.createElement('div');
  pop.className = 'rt-mode-popover';
  pop.innerHTML = [
    '<div class="rt-mode-popover-title">이동수단' + (measured ? ' · 실제 경로 기준' : '') + '</div>',
    row('WALK', IC_WALK, '도보'),
    row('TRANSIT', IC_TRANSIT, '대중교통'),
    row('TAXI', IC_TAXI, '자동차'),
    row('AUTO', IC_SPARK, '자동 선택'),
    measured ? '' : '<div class="rt-mode-popover-note">실제 경로를 불러오는 중이거나<br>불러오지 못해 추정치를 쓰고 있어요</div>',
  ].join('');
  document.body.appendChild(pop);
  const r = anchor?.getBoundingClientRect();
  if (r) {
    pop.style.top = Math.max(8, r.top - 8) + 'px';
    pop.style.left = Math.max(8, r.left) + 'px';
  } else {
    pop.style.top = '50%';
    pop.style.left = '50%';
  }
  pop.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode!;
      if (mode === 'AUTO') legModeOverride.delete(key);
      else legModeOverride.set(key, mode as Leg['mode']);
      pop.remove();
      refreshAll(rtContainer!, { refit: false });
    });
  });
  const dismiss = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) {
      pop.remove();
      document.removeEventListener('mousedown', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

/**
 * 화면에 쓸 통화 코드. 실측 대중교통 요금이 오면 그 통화를 그대로 쓰고(여행지가 어디든 정확),
 * 없으면 추정 로직이 방콕 기준이라 THB로 폴백한다.
 */
function currencyOf(legs: Leg[]): string {
  const withFare = legs.find((l) => l.fare?.currency);
  return withFare?.fare?.currency ?? 'THB';
}

function fmtCost(amount: number, currency: string): string {
  return amount.toLocaleString() + ' ' + currency;
}

/**
 * 요약 아래 안내문 — 원칙 3-1(데이터 진위)에 따라 실측/추정을 섞어 쓰는 현 상태를 정확히 알린다.
 * 택시 요금은 Routes API가 주지 않으므로 항상 추정치임을 별도로 밝힌다.
 */
function estimateNoteHtml(legs: Leg[]): string {
  if (!legs.length) return '';
  const realCount = legs.filter((l) => l.real).length;
  const hasTaxi = legs.some((l) => l.mode === 'TAXI');
  const fareEstimated = legs.some((l) => l.mode === 'TRANSIT' && l.real && !l.fare);

  if (realCount === 0) {
    return '<span id="rt-legs-loading" style="display:none">실제 경로 확인 중… </span>* 직선거리 기반 추정치예요';
  }
  const base =
    realCount === legs.length
      ? '* 이동시간·거리는 실제 경로 기준'
      : '* 이동시간·거리는 일부만 실제 경로 기준 (' + realCount + '/' + legs.length + '), 나머지는 추정치';
  const costNote = hasTaxi || fareEstimated ? ', 요금은 추정치' : '';
  return '<span id="rt-legs-loading" style="display:none">실제 경로 확인 중… </span>' + base + costNote + '예요';
}

/* ── 시간 계산 (수동 오버라이드가 있으면 그 시각을 기준으로 이어서 계산) ── */
function timeKey(dayId: string, placeId: string): string {
  return dayId + '|' + placeId;
}

/**
 * 사용자가 친 시각 문자열을 24시간 "HH:MM"으로 정규화. "930"·"9:30"·"09:30" 모두 허용하고,
 * 범위를 벗어나거나 해석할 수 없으면 null(→ 호출부가 계산값으로 되돌림).
 */
function parseTimeInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const digits = s.replace(/[^0-9]/g, '');
  if (!digits) return null; // "abc"처럼 숫자가 하나도 없으면 Number('')===0에 걸리지 않도록 먼저 차단
  let h: number;
  let m: number;
  if (s.includes(':')) {
    const [hs, ms] = s.split(':');
    h = Number(hs);
    m = Number(ms);
  } else if (digits.length === 3) {
    h = Number(digits.slice(0, 1));
    m = Number(digits.slice(1));
  } else if (digits.length === 4) {
    h = Number(digits.slice(0, 2));
    m = Number(digits.slice(2));
  } else if (digits.length <= 2) {
    h = Number(digits);
    m = 0;
  } else {
    return null;
  }
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function minToHHMM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

function computeStopTimes(day: RouteDay, stops: Place[], legs: Leg[]): string[] {
  const times: string[] = [];
  let clockMin = 9 * 60; // 09:00 시작
  stops.forEach((p, i) => {
    const isBasecamp = !!basecamp && i === 0 && p.id === basecamp.id;
    const override = timeOverride.get(timeKey(day.id, p.id));
    if (override) {
      const [h, m] = override.split(':').map(Number);
      clockMin = h * 60 + m;
    }
    times.push(minToHHMM(clockMin));
    const meta = categoryMeta(p, isBasecamp);
    clockMin += dwellMinutes(meta.key);
    if (i < legs.length) clockMin += legs[i].min;
  });
  return times;
}

/* ── DAY 요약 통계 ── */
function computeDaySummary(day: RouteDay): { totalMin: number; totalCost: number; legCount: number; visitCount: number } {
  const legs = dayLegs(day);
  let totalMin = 0;
  let totalCost = 0;
  legs.forEach((l) => {
    totalMin += l.min;
    totalCost += l.costTHB;
  });
  return { totalMin, totalCost, legCount: legs.length, visitCount: day.stopIds.length };
}

/** 최근접 이웃 재정렬로 총 이동시간을 얼마나 줄일 수 있는지 계산 */
function optimizedOrder(day: RouteDay): { order: string[]; totalMin: number } {
  const pts = orderedStops(day).filter((p) => p.lat != null && p.lng != null);
  if (pts.length <= 2) {
    return { order: [...day.stopIds], totalMin: computeDaySummary(day).totalMin };
  }
  const start = pts[0];
  const rest = pts.slice(1);
  const used = new Set<number>();
  const orderedIds: string[] = [];
  let cur = start;
  let totalMin = 0;
  for (let k = 0; k < rest.length; k++) {
    let best = -1;
    let bestKm = Infinity;
    for (let i = 0; i < rest.length; i++) {
      if (used.has(i)) continue;
      const km = haversineKm(cur.lat!, cur.lng!, rest[i].lat!, rest[i].lng!);
      if (km < bestKm) {
        bestKm = km;
        best = i;
      }
    }
    used.add(best);
    const leg = estimateLegWithOverride(cur, rest[best]);
    totalMin += leg.min;
    orderedIds.push(rest[best].id);
    cur = rest[best];
  }
  return { order: orderedIds, totalMin };
}

/* ── 우측 정보 패널 ── */
function renderRightPanel(container: HTMLElement): void {
  const el = container.querySelector('#rt-panel-inner') as HTMLElement;
  if (!el) return;
  const day = activeDay();
  const stops = orderedStops(day).filter((p) => p.lat != null && p.lng != null);
  const legs = dayLegs(day);
  const times = computeStopTimes(day, stops, legs);
  const s = computeDaySummary(day);
  const totalKm = legs.reduce((sum, l) => sum + l.km, 0);
  const dayIndex = days.findIndex((d) => d.id === day.id);
  const cur = currencyOf(legs);

  const rows: string[] = [];
  stops.forEach((p, i) => {
    const isBasecamp = !!basecamp && i === 0 && p.id === basecamp.id;
    const meta = categoryMeta(p, isBasecamp);
    const memo = memoStore.get(p.id) ?? '';
    const highlighted = p.id === highlightedPlaceId;

    const manualTime = timeOverride.has(timeKey(day.id, p.id));
    rows.push(
      [
        '<div class="rt-panel-stop' + (highlighted ? ' rt-highlighted' : '') + '" draggable="' + (isBasecamp ? 'false' : 'true') + '" data-place-id="' + p.id + '">',
        isBasecamp
          ? '  <span class="rt-drag-handle locked" aria-hidden="true"></span>'
          : '  <span class="rt-drag-handle" title="드래그해서 순서 바꾸기" aria-hidden="true">' + IC_GRIP + '</span>',
        '  <span class="rt-panel-badge" style="background:' + meta.color + '">' + (i + 1) + '</span>',
        '  <div class="rt-panel-name-col"><div class="rt-panel-name">' + escapeHtml(p.name) + '</div><div class="rt-panel-sub">' + escapeHtml(p.category || (isBasecamp ? '숙소' : '')) + '</div></div>',
        // native <input type="time">은 로케일에 따라 "오후 01:00"처럼 12시간제로 그려져
        // 좁은 패널에서 접두사가 잘리면 13:00이 01:00으로 보이는 오표시가 발생한다.
        // → 로케일과 무관하게 24시간 HH:MM으로 고정되는 텍스트 입력을 쓴다.
        '  <input type="text" class="rt-panel-time' + (manualTime ? ' is-manual' : '') + '" value="' + times[i] + '"' +
          ' data-place-id="' + p.id + '" inputmode="numeric" maxlength="5" spellcheck="false"' +
          ' aria-label="' + escapeHtml(p.name) + ' 도착 시각 (24시간 HH:MM)" />',
        !isBasecamp
          ? '  <button type="button" class="rt-panel-remove" data-place-id="' + p.id + '" title="동선에서 빼기" aria-label="' + escapeHtml(p.name) + ' 동선에서 빼기">✕</button>'
          : '  <span class="rt-panel-remove-spacer"></span>',
        '  <div class="rt-panel-memo-row">',
        '    <input type="text" class="rt-panel-memo" placeholder="메모 추가" value="' + escapeHtml(memo) + '" data-place-id="' + p.id + '" aria-label="' + escapeHtml(p.name) + ' 메모" />',
        '    <span class="rt-panel-memo-icon">' + IC_NOTE + '</span>',
        '  </div>',
        '</div>',
      ].join('')
    );

    if (i < legs.length) {
      const leg = legs[i];
      const key = legKey(p.id, stops[i + 1].id);
      const selected = selectedLegKey === key;
      const manual = legModeOverride.has(key);
      const extra = leg.costTHB > 0 ? fmtCost(leg.costTHB, cur) : (leg.mode === 'WALK' ? fmtKm(leg.km) : '무료');
      rows.push(
        [
          '<div class="rt-panel-connector ' + modeColorClass(leg.mode) + (selected ? ' rt-highlighted' : '') + '" data-leg-key="' + key + '"' +
            ' role="button" tabindex="0" title="눌러서 이 구간 강조 · 교통수단 툴에서는 이동수단 변경">',
          '  <span class="rt-panel-connector-icon">' + modeIcon(leg.mode) + '</span>',
          '  <span class="rt-panel-connector-label">' + modeLabel(leg.mode) + ' ' + fmtMin(leg.min) + ' <b>·</b> ' + extra + '</span>',
          !leg.real ? '  <span class="rt-panel-connector-est" title="실제 경로를 못 받아 직선거리로 추정한 값이에요">추정</span>' : '',
          manual ? '  <span class="rt-panel-connector-manual" title="직접 지정한 이동수단"></span>' : '',
          '</div>',
        ].join('')
      );
    }
  });

  el.innerHTML = [
    '<div class="rt-panel-header">',
    '  <span class="rt-panel-dot"></span>',
    '  <span class="rt-panel-daylabel">' + escapeHtml(day.label) + '</span>',
    '  <span class="rt-panel-daydate">' + dayDateLabel(dayIndex) + '</span>',
    '  <div class="rt-panel-header-avatars">' +
      members
        .slice(0, 3)
        .map((m, i) => '<div class="rt-panel-avatar" style="background:' + memberColor(i) + '">' + escapeHtml((m.display_name || '?').charAt(0)) + '</div>')
        .join('') +
      '</div>',
    '  <button type="button" class="rt-panel-more" id="rt-panel-more" aria-label="이 DAY 메뉴">' + IC_DOTS + '</button>',
    '</div>',
    '<div class="rt-panel-list" id="rt-panel-list">',
    stops.length
      ? rows.join('')
      : [
          '<div class="rt-panel-empty">',
          '  <span class="rt-panel-empty-icon">' + IC_ROUTEPATH + '</span>',
          '  <div class="rt-panel-empty-title">아직 담은 장소가 없어요</div>',
          '  <div class="rt-panel-empty-hint">지도의 핀을 누르거나<br>왼쪽 목록에서 담아보세요.</div>',
          '</div>',
        ].join(''),
    '</div>',
    '<div class="rt-panel-summary">',
    '  <div class="rt-panel-summary-item"><div class="rt-panel-summary-label">총 이동시간</div><div class="rt-panel-summary-value">' + fmtMin(s.totalMin) + '</div></div>',
    '  <div class="rt-panel-summary-item"><div class="rt-panel-summary-label">총 이동거리</div><div class="rt-panel-summary-value">' + totalKm.toFixed(1) + 'km</div></div>',
    '  <div class="rt-panel-summary-item"><div class="rt-panel-summary-label">예상 교통비</div><div class="rt-panel-summary-value">' + fmtCost(s.totalCost, cur) + '</div></div>',
    '</div>',
    // 원칙 3-1 — 실측/추정을 섞어 쓰므로 어느 쪽인지 반드시 구분해 표기
    '<div class="rt-panel-estimate-note">' + estimateNoteHtml(legs) + '</div>',
    '<div class="rt-panel-actions">',
    '  <button type="button" class="rt-panel-action" id="rt-panel-add">' + IC_PLUS + ' 장소 추가</button>',
    '  <button type="button" class="rt-panel-action primary" id="rt-panel-optimize"' + (s.visitCount < 2 ? ' disabled' : '') +
      ' title="' + (s.visitCount < 2 ? '장소가 2곳 이상일 때 정렬할 수 있어요' : '가까운 순서로 다시 정렬해요') + '">' + IC_SPARK + ' 순서 정리</button>',
    '</div>',
  ].join('\n');

  bindRightPanelEvents(container, el);
  updateUndoRedoState(container);
}

function bindRightPanelEvents(container: HTMLElement, el: HTMLElement): void {
  el.querySelectorAll('.rt-panel-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.placeId!;
      pushHistory();
      removeStop(id);
      if (highlightedPlaceId === id) highlightedPlaceId = null;
      refreshAll(container, { refit: false });
    });
  });

  el.querySelectorAll('.rt-panel-time').forEach((input) => {
    const commit = () => {
      const id = (input as HTMLElement).dataset.placeId!;
      const parsed = parseTimeInput((input as HTMLInputElement).value);
      if (parsed) timeOverride.set(timeKey(activeDay().id, id), parsed);
      // 형식이 잘못됐으면 조용히 되돌림(재렌더가 계산값으로 복구)
      renderRightPanel(container);
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter') { ke.preventDefault(); (input as HTMLInputElement).blur(); }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
  });

  el.querySelectorAll('.rt-panel-memo').forEach((input) => {
    input.addEventListener('input', (e) => {
      const id = (input as HTMLElement).dataset.placeId!;
      memoStore.set(id, (e.target as HTMLInputElement).value);
      scheduleSave(); // 재렌더 없이 값만 바뀌므로 여기서 직접 저장 예약
    });
    input.addEventListener('click', (e) => e.stopPropagation());
  });

  el.querySelectorAll('.rt-panel-connector').forEach((row) => {
    const fire = () => {
      const key = (row as HTMLElement).dataset.legKey!;
      const [fromId, toId] = key.split('>');
      handleLegClick(fromId, toId, row as HTMLElement);
    };
    row.addEventListener('click', fire);
    row.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') { ke.preventDefault(); fire(); }
    });
  });

  el.querySelectorAll('.rt-panel-stop').forEach((card) => {
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('input, button')) return;
      const id = (card as HTMLElement).dataset.placeId!;
      highlightedPlaceId = highlightedPlaceId === id ? null : id;
      drawRouteOnMap(false);
      renderRightPanel(container);
    });
  });

  bindDragReorder(container, el);

  el.querySelector('#rt-panel-more')?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanelMenu(container, el.querySelector('.rt-panel-header') as HTMLElement);
  });
  el.querySelector('#rt-panel-add')?.addEventListener('click', () => {
    (container.querySelector('#rt-float-search-input') as HTMLElement | null)?.focus();
  });
  el.querySelector('#rt-panel-optimize')?.addEventListener('click', () => {
    const day = activeDay();
    const opt = optimizedOrder(day);
    pushHistory();
    day.stopIds = opt.order;
    refreshAll(container, { refit: true });
  });
}

function bindDragReorder(container: HTMLElement, el: HTMLElement): void {
  let dragStopId: string | null = null;

  el.querySelectorAll('.rt-panel-stop[draggable="true"]').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      dragStopId = (card as HTMLElement).dataset.placeId!;
      (card as HTMLElement).classList.add('dragging');
      (e as DragEvent).dataTransfer?.setData('text/plain', dragStopId);
    });
    card.addEventListener('dragend', () => {
      (card as HTMLElement).classList.remove('dragging');
      el.querySelectorAll('.drag-over').forEach((c) => c.classList.remove('drag-over'));
    });
  });

  el.querySelectorAll('.rt-panel-stop').forEach((card) => {
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const targetId = (card as HTMLElement).dataset.placeId!;
      if (!dragStopId || dragStopId === targetId) { dragStopId = null; return; }
      pushHistory();
      const day = activeDay();
      const dragged = dragStopId;
      day.stopIds = day.stopIds.filter((id) => id !== dragged);
      if (basecamp && targetId === basecamp.id) {
        day.stopIds.unshift(dragged);
      } else {
        const idx = day.stopIds.indexOf(targetId);
        day.stopIds.splice(idx === -1 ? day.stopIds.length : idx, 0, dragged);
      }
      dragStopId = null;
      refreshAll(container, { refit: false });
    });
  });
}

function togglePanelMenu(container: HTMLElement, headerEl: HTMLElement): void {
  const existing = headerEl.querySelector('.rt-panel-menu');
  if (existing) { existing.remove(); return; }
  const menu = document.createElement('div');
  menu.className = 'rt-panel-menu';
  menu.innerHTML = '<button type="button" id="rt-panel-clear">이 DAY 초기화</button>';
  headerEl.appendChild(menu);
  menu.querySelector('#rt-panel-clear')?.addEventListener('click', () => {
    pushHistory();
    activeDay().stopIds = [];
    menu.remove();
    refreshAll(container, { refit: true });
  });
  const dismiss = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node) && !(e.target as HTMLElement).closest('#rt-panel-more')) {
      menu.remove();
      document.removeEventListener('mousedown', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

/* ── 전체 갱신 (지도 제외 UI + 지도 오버레이 재드로우) ── */
function refreshAll(container: HTMLElement, opts: { refit: boolean } = { refit: true }): void {
  renderDayTabs(container);
  renderLeftPanel(container);
  renderRightPanel(container);
  renderMemberLegend(container);
  drawRouteOnMap(opts.refit);
  // 변경이 실제로 있을 때만 저장되고(지문 비교), 새로 생긴 구간은 실측 데이터를 채운다.
  scheduleSave();
  void loadRealLegsForActiveDay(container);
}

/* ══════════════════ 지도 ══════════════════ */

const MODE_STYLE: Record<Leg['mode'], { color: string; weight: number; dashed: boolean }> = {
  WALK: { color: '#1D9E75', weight: 2, dashed: true },
  TRANSIT: { color: '#0B7CC4', weight: 3, dashed: false },
  TAXI: { color: '#475569', weight: 3, dashed: false },
};

async function initMap(container: HTMLElement): Promise<void> {
  const mapEl = container.querySelector('#rt-map') as HTMLElement;
  if (!mapEl) return;
  try {
    await loadGoogleMapsScript();
  } catch {
    mapEl.innerHTML = '<div class="rt-map-error">' + IC_ALERT + '<div>지도를 불러오지 못했어요.<br>네트워크 상태를 확인한 뒤 새로고침해 주세요.</div></div>';
    return;
  }
  const g = (window as any).google;
  if (!g?.maps) return;

  const center = basecamp && basecamp.lat != null ? { lat: basecamp.lat, lng: basecamp.lng! } : { lat: 13.74, lng: 100.53 };
  mapInstance = new g.maps.Map(mapEl, {
    center,
    zoom: 13,
    gestureHandling: 'greedy',
    isFractionalZoomEnabled: true,
    styles: MAP_STYLE_LIGHT,
    clickableIcons: false,
    // Google 기본 컨트롤 사용(커스텀 금지). 좌하단은 멤버 범례가 쓰므로 전부 우측으로 모아
    // 겹침을 방지한다 — 좌상단은 장소 검색 패널, 하단 중앙은 편집 툴바가 차지.
    zoomControl: true,
    zoomControlOptions: { position: g.maps.ControlPosition.RIGHT_BOTTOM },
    mapTypeControl: true,
    mapTypeControlOptions: { style: g.maps.MapTypeControlStyle.DEFAULT, position: g.maps.ControlPosition.RIGHT_TOP },
    streetViewControl: false,
    fullscreenControl: false,
    rotateControl: false,
  });

  // 지도 빈 곳 클릭 = 장소 카드/강조 해제 (원칙 3-3 명시적 해제 수단)
  mapInstance.addListener('click', () => {
    if (placeCardOverlay) { closePlaceCard(); return; }
    if (highlightedPlaceId || selectedLegKey) {
      highlightedPlaceId = null;
      selectedLegKey = null;
      connectFromId = null;
      drawRouteOnMap(false);
      renderRightPanel(container);
    }
  });

  mapInstance.addListener('click', (e: any) => {
    if (!adhocMode || !e.latLng || !rtContainer) return;
    const name = window.prompt('이 위치에 추가할 장소 이름을 입력하세요');
    setAdhocMode(rtContainer, false);
    if (!name || !name.trim()) return;
    const p = makeAdhocPlace(name.trim(), e.latLng.lat(), e.latLng.lng());
    placeById.set(p.id, p);
    candidatePlaces.push(p);
    pushHistory();
    activeDay().stopIds.push(p.id);
    refreshAll(rtContainer, { refit: true });
  });

  drawRouteOnMap(true);

  resizeHandler = () => resizeMap();
  window.addEventListener('resize', resizeHandler);
}

function resizeMap(): void {
  const g = (window as any).google;
  if (!g?.maps || !mapInstance) return;
  g.maps.event.trigger(mapInstance, 'resize');
  fitRouteBounds();
}

function clearMapOverlays(): void {
  mapMarkers.forEach((m) => m.setMap(null));
  mapMarkers = [];
  routePolylines.forEach((l) => l.setMap(null));
  routePolylines = [];
  mapOverlays.forEach((o) => o.setMap(null));
  mapOverlays = [];
}

/** 마커(숙소+후보) + 순서 폴리라인(모드별 스타일) + 이동 캡슐을 다시 그림 */
function drawRouteOnMap(refit: boolean): void {
  const g = (window as any).google;
  if (!g?.maps || !mapInstance) return;
  clearMapOverlays();

  const day = activeDay();
  const stops = orderedStops(day).filter((p) => p.lat != null && p.lng != null);
  const legs = dayLegs(day);
  const mapCur = currencyOf(legs);

  // 아직 오늘 동선에 없는 확정 장소 — 카테고리 아이콘 배지(작게)
  candidatePlaces.forEach((p) => {
    if (p.lat == null || p.lng == null) return;
    if (day.stopIds.includes(p.id)) return;
    const marker = buildMarkerV2(g, p, { isBasecamp: false, included: false, highlighted: p.id === highlightedPlaceId });
    marker.addListener("click", () => handlePinClick(g, p));
    mapMarkers.push(marker);
  });

  // 오늘 동선의 정류지(숙소 포함) — 순서 번호 배지(크게)
  stops.forEach((p, i) => {
    const isBasecamp = !!basecamp && i === 0 && p.id === basecamp.id;
    const marker = buildMarkerV2(g, p, { isBasecamp, included: true, num: i + 1, highlighted: p.id === highlightedPlaceId });
    marker.addListener("click", () => handlePinClick(g, p));
    mapMarkers.push(marker);
  });

  // 구간 폴리라인(모드별 스타일 + 화살표) + 이동 캡슐
  for (let i = 0; i < stops.length - 1; i++) {
    const leg = legs[i];
    const key = legKey(stops[i].id, stops[i + 1].id);
    const selected = selectedLegKey === key;
    const dimmed = !!selectedLegKey && selectedLegKey !== key;

    const line = buildLegPolyline(g, stops[i], stops[i + 1], leg, { selected, dimmed });
    line.addListener('click', () => handleLegClick(stops[i].id, stops[i + 1].id));
    routePolylines.push(line);

    const midLat = (stops[i].lat! + stops[i + 1].lat!) / 2;
    const midLng = (stops[i].lng! + stops[i + 1].lng!) / 2;
    const Ctor = getOverlayCtor(g);
    const cls = 'rt-map-capsule ' + modeColorClass(leg.mode) +
      (selected ? ' rt-leg-selected' : dimmed ? ' rt-leg-dimmed' : '') +
      (legModeOverride.has(key) ? ' rt-leg-manual' : '');
    const capsule = new Ctor(new g.maps.LatLng(midLat, midLng), legCapsuleHtml(leg, mapCur), cls, () =>
      handleLegClick(stops[i].id, stops[i + 1].id, capsule.div ?? undefined)
    );
    capsule.setMap(mapInstance);
    mapOverlays.push(capsule);
  }

  if (refit) fitRouteBounds();
}

function legCapsuleHtml(leg: Leg, currency: string): string {
  const extra = leg.mode === 'WALK' ? fmtKm(leg.km) : (leg.costTHB > 0 ? fmtCost(leg.costTHB, currency) : '무료');
  return modeIcon(leg.mode) + '<span>' + fmtMin(leg.min) + '</span><span class="rt-cap-dist">' + extra + '</span>';
}

function fitRouteBounds(): void {
  const g = (window as any).google;
  if (!g?.maps || !mapInstance) return;
  const day = activeDay();
  const pts: Place[] = [];
  if (basecamp) pts.push(basecamp);
  candidatePlaces.forEach((p) => pts.push(p));
  const withCoords = pts.filter((p) => p.lat != null && p.lng != null);
  if (withCoords.length === 0) return;
  if (withCoords.length === 1) {
    mapInstance.setCenter({ lat: withCoords[0].lat!, lng: withCoords[0].lng! });
    mapInstance.setZoom(15);
    return;
  }
  const bounds = new g.maps.LatLngBounds();
  const focus = orderedStops(day).filter((p) => p.lat != null && p.lng != null);
  const target = focus.length >= 2 ? focus : withCoords;
  target.forEach((p) => bounds.extend({ lat: p.lat!, lng: p.lng! }));
  mapInstance.fitBounds(bounds, 64);
}

/**
 * 핀을 **클릭**하면 뜨는 장소 카드(사진·이름·평점 + 담기/빼기).
 * Claude.md 3-3 원칙 — hover로 강조/확대하지 않고 반드시 클릭으로만 반응하며,
 * 닫기(✕)·지도 빈 곳 클릭·ESC 세 가지 명시적 해제 수단을 항상 제공한다.
 */
function closePlaceCard(): void {
  if (placeCardOverlay) { placeCardOverlay.setMap(null); placeCardOverlay = null; }
  placeCardPlaceId = null;
}

function openPlaceCard(g: any, p: Place): void {
  closePlaceCard();
  const isBasecamp = !!basecamp && p.id === basecamp.id;
  const included = isBasecamp || activeDay().stopIds.includes(p.id);
  const meta = categoryMeta(p, isBasecamp);

  const html = [
    p.photo_url
      ? '<div class="rt-clickcard-photo" style="background-image:url(\'' + p.photo_url + '\')"></div>'
      : '<div class="rt-clickcard-photo">' + meta.icon + '</div>',
    '<button type="button" class="rt-clickcard-close" aria-label="닫기">✕</button>',
    '<div class="rt-clickcard-body">',
    '  <div class="rt-clickcard-name">' + escapeHtml(p.name) + '</div>',
    '  <div class="rt-clickcard-meta">',
    p.google_rating ? '    <span class="rt-clickcard-rate">' + IC_STAR + ' ' + p.google_rating.toFixed(1) + '</span>' : '',
    p.category ? '    <span class="rt-clickcard-cat">' + escapeHtml(p.category) + '</span>' : '',
    '  </div>',
    isBasecamp
      ? ''
      : included
        ? '  <button type="button" class="rt-clickcard-action remove" data-card-act="remove">' + IC_TRASH + ' 동선에서 빼기</button>'
        : '  <button type="button" class="rt-clickcard-action" data-card-act="add">' + IC_PLUS + ' 이 동선에 담기</button>',
    '</div>',
  ].join('');

  const Ctor = getOverlayCtor(g);
  placeCardOverlay = new Ctor(new g.maps.LatLng(p.lat!, p.lng!), html, 'rt-clickcard');
  placeCardOverlay.setMap(mapInstance);
  placeCardPlaceId = p.id;

  // OverlayView가 DOM에 붙은 뒤에 핸들러 연결
  requestAnimationFrame(() => {
    const div: HTMLElement | null = placeCardOverlay?.div ?? null;
    if (!div) return;
    div.querySelector('.rt-clickcard-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closePlaceCard();
    });
    div.querySelector('[data-card-act]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = (e.currentTarget as HTMLElement).dataset.cardAct;
      pushHistory();
      if (act === 'add') activeDay().stopIds.push(p.id);
      else removeStop(p.id);
      closePlaceCard();
      refreshAll(rtContainer!, { refit: false });
    });
  });
}

function showRipple(g: any, p: Place, color: string): void {
  const Ctor = getOverlayCtor(g);
  const ripple = new Ctor(new g.maps.LatLng(p.lat!, p.lng!), '', 'rt-ripple', undefined, { '--ripple-color': color });
  ripple.setMap(mapInstance);
  setTimeout(() => ripple.setMap(null), 700);
}

/** 지도 위에 임의의 HTML을 올리는 범용 OverlayView (이동 캡슐 / 호버카드 / 리플에서 공용) */
let MapHtmlOverlayCtor: any = null;
function getOverlayCtor(g: any): any {
  if (MapHtmlOverlayCtor) return MapHtmlOverlayCtor;
  class MapHtmlOverlay extends g.maps.OverlayView {
    div: HTMLDivElement | null = null;
    position: any;
    html: string;
    cls: string;
    onClick?: () => void;
    styleVars?: Record<string, string>;
    constructor(position: any, html: string, cls: string, onClick?: () => void, styleVars?: Record<string, string>) {
      super();
      this.position = position;
      this.html = html;
      this.cls = cls;
      this.onClick = onClick;
      this.styleVars = styleVars;
    }
    onAdd() {
      const div = document.createElement('div');
      div.className = this.cls;
      div.innerHTML = this.html;
      if (this.styleVars) {
        Object.entries(this.styleVars).forEach(([k, v]) => div.style.setProperty(k, v));
      }
      if (this.onClick) {
        div.addEventListener('click', (e: MouseEvent) => {
          e.stopPropagation();
          this.onClick!();
        });
      }
      this.div = div;
      this.getPanes().floatPane.appendChild(div);
    }
    draw() {
      if (!this.div) return;
      const proj = this.getProjection();
      if (!proj) return;
      const pt = proj.fromLatLngToDivPixel(this.position);
      if (!pt) return;
      this.div.style.left = pt.x + 'px';
      this.div.style.top = pt.y + 'px';
    }
    onRemove() {
      if (this.div) { this.div.remove(); this.div = null; }
    }
  }
  MapHtmlOverlayCtor = MapHtmlOverlay;
  return MapHtmlOverlayCtor;
}

function iconInner(svg: string): string {
  return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
}

/** 커스텀 원형 배지 마커 — 후보(카테고리 아이콘) / 동선 포함(순서 번호) */
function buildMarkerV2(g: any, p: Place, opts: { isBasecamp: boolean; included: boolean; num?: number; highlighted?: boolean }): any {
  const meta = categoryMeta(p, opts.isBasecamp);
  const scale = opts.highlighted ? 1.15 : 1;
  const r = (opts.included ? 15 : 10) * scale;
  const size = Math.ceil(r * 2 + 10);
  const c = size / 2;

  const shadow = '<ellipse cx="' + c + '" cy="' + (c + r * 0.55) + '" rx="' + (r * 0.8) + '" ry="' + (r * 0.3) + '" fill="rgba(11,42,92,0.18)"/>';
  const ring = opts.highlighted
    ? '<circle cx="' + c + '" cy="' + c + '" r="' + (r + 4) + '" fill="none" stroke="#fff" stroke-width="3"/>'
    : '';
  const inner = opts.included
    ? '<text x="' + c + '" y="' + (c + 4) + '" text-anchor="middle" font-family="Arial" font-size="' + Math.round(11 * scale) + '" font-weight="800" fill="#fff">' + (opts.num ?? '') + '</text>'
    : '<g transform="translate(' + (c - 6) + ',' + (c - 6) + ') scale(0.5)" color="#fff" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + iconInner(meta.icon) + '</g>';

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    shadow + ring +
    '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="' + meta.color + '" stroke="#fff" stroke-width="2.5"/>' +
    inner +
    '</svg>';

  return new g.maps.Marker({
    position: { lat: p.lat!, lng: p.lng! },
    map: mapInstance,
    title: p.name,
    zIndex: opts.included ? 100 + (opts.num ?? 0) : 10,
    icon: {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new g.maps.Size(size, size),
      anchor: new g.maps.Point(c, c),
    },
  });
}

/** 구간 폴리라인 — 이동수단별 스타일(도보 점선/대중교통·자동차 실선) + 끝 화살표 */
function buildLegPolyline(g: any, from: Place, to: Place, leg: Leg, opts: { selected: boolean; dimmed: boolean }): any {
  const style = MODE_STYLE[leg.mode];
  const path = [
    { lat: from.lat!, lng: from.lng! },
    { lat: to.lat!, lng: to.lng! },
  ];
  const lineOpacity = opts.dimmed ? 0.35 : opts.selected ? 1 : 0.85;
  const weight = opts.selected ? style.weight + 2 : style.weight;

  const icons: any[] = [];
  if (style.dashed) {
    icons.push({ icon: { path: 'M 0,-1 0,1', strokeOpacity: lineOpacity, strokeColor: style.color, strokeWeight: weight, scale: 3 }, offset: '0', repeat: '13px' });
  }
  icons.push({
    icon: { path: g.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3.2, strokeColor: style.color, strokeOpacity: lineOpacity, fillColor: style.color, fillOpacity: lineOpacity },
    offset: '97%',
  });

  if (opts.selected) {
    const glow = new g.maps.Polyline({
      map: mapInstance,
      path,
      strokeColor: style.color,
      strokeOpacity: style.dashed ? 0 : 0.22,
      strokeWeight: weight + 8,
      zIndex: 9,
      icons: style.dashed
        ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.22, strokeColor: style.color, strokeWeight: weight + 8, scale: 5 }, offset: '0', repeat: '18px' }]
        : [],
    });
    routePolylines.push(glow);
  }

  return new g.maps.Polyline({
    map: mapInstance,
    path,
    strokeColor: style.color,
    strokeOpacity: style.dashed ? 0 : lineOpacity,
    strokeWeight: weight,
    icons,
    zIndex: opts.selected ? 20 : 10,
  });
}

const MAP_STYLE_LIGHT = [
  { elementType: 'geometry', stylers: [{ color: '#F8FBFE' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#94A3B8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#F8FBFE' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.attraction', elementType: 'labels', stylers: [{ visibility: 'on' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#E7EEF5' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D5EEFB' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#F1F6FB' }] },
];
