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
  placeBelongsToDestination,
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
import { requestRoutePlan, requestDayDetail } from './aiPlan';
import type { AiPlanPlace, AiRoutePlanResult, AiDayDetailResult } from './aiPlan';
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
const IC_CHEVRON_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>';
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
/** 좌측 패널 카테고리 필터 칩 — 후보 목록에 실제로 나타나는 4개 게이트만(숙소 제외) */
const CAT_FILTERS: Array<{ key: CatKey; label: string }> = [
  { key: 'VISIT', label: '관광' },
  { key: 'FOOD', label: '맛집' },
  { key: 'ACTIVITY', label: '액티비티' },
  { key: 'SHOPPING', label: '쇼핑' },
];
const SHOPPING_KEYWORDS = ['쇼핑', '마켓', '시장', '백화점', 'mall', 'market', 'shopping'];

/**
 * DAY마다 다른 블루 계열 색조를 줘서(전부 같은 파랑이 아니라) 우측 패널·DAY 탭에서 "지금 몇
 * 째 날을 보고 있나"가 색으로도 구분되게 한다. 카테고리 색(CAT_COLOR)과 달리 채도를 낮춘
 * 남색~하늘~청보라 사이에서만 오가 alarm 전체 톤(Airport Lounge Premium Light)을 벗어나지 않는다.
 * DAY 수가 배열보다 많아지면(최대 10개라 실제로는 안 모자람) 순환한다.
 */
const DAY_COLOR_PALETTE = [
  '#0B2A5C', // DAY1 — 남색(navy, 여행의 시작)
  '#0B7CC4', // DAY2 — 파랑
  '#1FA6C9', // DAY3 — 하늘
  '#6366C9', // DAY4 — 파랑보라
  '#3D4F91', // DAY5 — 인디고
  '#2E8FB0', // DAY6 — 청록빛 파랑
  '#7C6FDE', // DAY7 — 보라빛 파랑
  '#274472', // DAY8 — 짙은 슬레이트 남색
  '#4A90D9', // DAY9 — 파랑
  '#5A7FE0', // DAY10 — 페리윙클 블루
];
function dayColorFor(dayIndex: number): string {
  return DAY_COLOR_PALETTE[((dayIndex % DAY_COLOR_PALETTE.length) + DAY_COLOR_PALETTE.length) % DAY_COLOR_PALETTE.length];
}

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
  /** 실제 도로를 따라가는 좌표(있을 때만) — 없으면 지도에 두 지점을 잇는 직선으로 대체 */
  path?: Array<{ lat: number; lng: number }>;
}

/** /api/route-matrix(구간 비교 모드) 응답의 모드별 실측값 */
interface RealLeg {
  meters: number;
  seconds: number;
  fare?: { units: number; currency: string };
  polyline?: string;
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
let leftPanelCollapsed = false;
let members: MemberLite[] = [];

let activeTool: ToolKind = 'select';
let connectFromId: string | null = null;
let highlightedPlaceId: string | null = null;
/** 우측 타임라인에 마우스를 올렸을 때만 잠깐 강조되는 장소 (클릭 선택과 별개인 일시적 미리보기) */
let hoveredPlaceId: string | null = null;
let selectedLegKey: string | null = null;
let adhocMode = false;
let adhocSeq = 0;
let placeSearchQuery = '';
/** 좌측 패널 카테고리 필터 — 비어있으면 전체 표시 */
let activeCatFilters = new Set<CatKey>();
let historyByDay = new Map<string, HistoryState>();
const memoStore = new Map<string, string>();
const timeOverride = new Map<string, string>();
const legModeOverride = new Map<string, Leg['mode']>();

let activeDestId: string | null = null;
let activeDestName = '';

/* ── AI 일정 추천 상태 ── */
let aiPlanBusy = false;
/** 방금 만든 추천의 설명 — 적용 직후 우측 패널 위에 한 번 보여주고 닫을 수 있게 */
let aiPlanNotice: { notes: string; usedCount: number; skippedCount: number; cached: boolean } | null = null;
let dayDetailBusy = false;
/**
 * AI 적용 직전 상태의 전체 스냅샷.
 * 기본 실행취소(Ctrl+Z)는 **활성 DAY의 stopIds만** 되돌리므로, 모든 DAY와 도착시각·이동수단까지
 * 한 번에 바꾸는 AI 적용은 그걸로 원상복구가 안 된다. 그래서 별도 스냅샷을 잡아
 * 안내 배너의 "되돌리기" 버튼 하나로 완전히 되돌릴 수 있게 한다.
 */
let aiPlanUndo: {
  stopIdsByDay: Array<[string, string[]]>;
  times: Array<[string, string]>;
  modes: Array<[string, Leg['mode']]>;
} | null = null;
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
let zoomRedrawHandle: number | null = null;

export function teardownRoute(): void {
  if (resizeHandler) { window.removeEventListener('resize', resizeHandler); resizeHandler = null; }
  if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
  if (zoomRedrawHandle != null) { window.cancelAnimationFrame(zoomRedrawHandle); zoomRedrawHandle = null; }
  // 화면을 떠날 때 대기 중인 저장은 버리지 않고 커밋한다 (Claude.md 알려진 버그 패턴:
  // 대기 타이머를 그냥 취소하면 "화면엔 반영됐는데 DB엔 없는" 상태가 됨).
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    void persistActiveDay();
  }
  unsubscribeRoutePlan();
  resetRouteStorageProbe();
  document.querySelector('.rt-ai-modal-backdrop')?.remove();
  activeDestId = null;
  activeDestName = '';
  aiPlanBusy = false;
  aiPlanNotice = null;
  aiPlanUndo = null;
  dayDetailBusy = false;
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
  leftPanelCollapsed = false;
  members = [];
  activeTool = 'select';
  connectFromId = null;
  highlightedPlaceId = null;
  hoveredPlaceId = null;
  selectedLegKey = null;
  adhocMode = false;
  placeSearchQuery = '';
  activeCatFilters = new Set();
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
/**
 * Google 인코딩 폴리라인(base64 유사 가변길이 인코딩) 디코딩 — 표준 알고리즘.
 * google.maps의 geometry 라이브러리를 추가로 로드하지 않기 위해 직접 구현.
 */
function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

function realToLeg(mode: Leg['mode'], r: RealLeg): Leg {
  const km = r.meters / 1000;
  const min = Math.max(1, Math.round(r.seconds / 60));
  const path = r.polyline ? decodePolyline(r.polyline) : undefined;
  if (mode === 'TRANSIT') {
    // 실측 요금이 있으면 그 값을, 없으면 거리 기반 추정치를 쓴다(추정 여부는 fare 유무로 구분).
    const costTHB = r.fare ? Math.round(r.fare.units) : Math.min(62, 20 + Math.round(km) * 6);
    return { mode, km, min, costTHB, real: true, fare: r.fare, path };
  }
  if (mode === 'WALK') return { mode, km, min, costTHB: 0, real: true, path };
  return { mode, km, min, costTHB: 35 + Math.round(km * 6.5), real: true, path };
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

/**
 * 모든 DAY를 저장한다. 평소엔 활성 DAY만 저장하면 충분하지만(사용자는 한 번에 한 DAY만
 * 편집하므로), AI 일정 추천처럼 여러 DAY를 한 번에 바꾸는 경우엔 전부 저장해야 한다.
 */
async function persistAllDays(): Promise<void> {
  if (!isRouteStorageReady() || !activeDestId || !currentTripId) return;
  const keepActive = activeDayId;
  try {
    for (const d of days) {
      // persistActiveDay는 activeDay()를 기준으로 동작하므로 잠깐 활성 DAY를 옮겨가며 저장한다.
      // (화면은 이 사이에 다시 그리지 않으므로 사용자에게는 보이지 않음)
      activeDayId = d.id;
      await persistActiveDay();
    }
  } finally {
    activeDayId = keepActive;
    lastSavedSig = daySignature(activeDay());
  }
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
  activeDestName = activeDest?.name ?? '';
  const segments = activeDest ? await loadStaySegments(trip, activeDest) : [];
  const seg = activeDest ? resolveActiveSegment(activeDest.id, segments) : null;

  const basecampId = seg?.basecamp_place_id ?? trip.shortlist_basecamp_place_id ?? null;
  basecamp = basecampId ? placeById.get(basecampId) ?? null : null;

  // SHORTLIST Step3의 "확정" 목록(숙소 4km 이내로 자동 필터링됨)이 아니라, 이 여행지에서
  // Brainstorm으로 분류한 장소 전체를 후보로 쓴다 — 숙소 근처만 보이던 문제 수정.
  // (loadPlaces가 이미 mood(VISIT/FOOD/ACTIVITY로 분류됨)가 있는 것만 불러온 상태)
  candidatePlaces = [...placeById.values()].filter(
    (p) =>
      p.id !== basecampId &&
      p.lat != null &&
      p.lng != null &&
      (!activeDest || placeBelongsToDestination(p, activeDest))
  );

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

  days = Array.from({ length: dayCount }, (_, i) => ({
    id: 'day-' + (i + 1),
    label: 'DAY ' + (i + 1),
    stopIds: [],
  }));
  activeDayId = days[0].id;

  // 저장된 동선이 있으면 그걸 복원(협업/새로고침). 없으면 전부 빈 DAY로 시작 —
  // 후보가 이제 Brainstorm 전체(숙소 근처만이 아님)라 자동으로 채우면 오히려 어수선해짐.
  // 사용자가 왼쪽 검색 패널·지도 클릭으로 직접 골라 담는다.
  let restored = false;
  if (activeDestId) {
    const stored = await loadRoutePlan(activeDestId);
    restored = applyStoredPlan(stored);
  }
  lastSavedSig = restored ? daySignature(activeDay()) : '';
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
    // route-legs.ts는 Vercel Hobby 플랜의 서버리스 함수 12개 한도를 넘겨 route-matrix.ts에
    // 합쳐졌다(body에 legs가 있으면 이 경로로 분기됨) — api/route-matrix.ts 상단 설명 참고.
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
    // 모든 DAY를 한 번에 바꾸는 동작이라 DAY 탭과 같은 줄(여행지 전체 맥락)에 둔다
    '      <button type="button" class="rt-ai-plan-btn" id="rt-ai-plan" title="Brainstorm에 담은 장소들을 영업시간·인기 동선·이동 효율 순으로 DAY별 일정으로 배분해요">' + IC_SPARK + '<span>AI 일정 짜기</span></button>',
    '      <div class="rt-searchbox">' + IC_SEARCH + '<input type="text" id="rt-search-top" placeholder="여행지 검색" /></div>',
    '      <button type="button" class="rt-optionsbtn" id="rt-options-btn">' + IC_DOTS + '<span>옵션</span>' + IC_CHEVRON + '</button>',
    '    </div>',
    '  </div>',

    '  <div class="rt-main" id="rt-main">',
    '    <div class="rt-map-col">',
    '      <div class="rt-map-wrap">',
    '        <div id="rt-map" class="rt-map"></div>',

    '        <div class="rt-float-search" id="rt-float-search">',
    '          <div class="rt-float-search-input">',
    '            <button type="button" class="rt-float-search-icon" id="rt-float-search-icon" title="장소 검색 패널 펼치기" aria-label="장소 검색 패널 펼치기">' + IC_SEARCH + '</button>',
    '            <input type="text" id="rt-float-search-input" placeholder="장소 검색" />',
    '            <button type="button" class="rt-float-search-toggle" id="rt-float-toggle" title="패널 접기/펼치기" aria-label="장소 검색 패널 접기/펼치기">' + IC_CHEVRON_UP + '</button>',
    '          </div>',
    '          <div class="rt-float-filters" id="rt-float-filters"></div>',
    '          <div class="rt-float-list" id="rt-float-list"></div>',
    '          <button type="button" class="rt-float-adhoc" id="rt-float-adhoc" title="지도를 클릭한 위치에 Brainstorm에 없는 장소(예: 특정 출입구, 뷰포인트)를 새로 추가해요">' + IC_PIN_PLUS + ' 지도에 직접 추가</button>',
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
  renderCatFilters(container);
  renderLeftPanel(container);
  renderRightPanel(container);
  renderMemberLegend(container);
  bindSearchInputs(container);
  bindToolbar(container);
  bindOptionsMenu(container);
  bindAdhocButton(container);
  container.querySelector('#rt-ai-plan')?.addEventListener('click', () => void runAiRoutePlan(container));

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

  // 좌측 패널 접기/펼치기 토글은 bindSearchInputs가 함께 바인딩한다(검색창 옆에 붙어 있어서).

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
        const color = dayColorFor(i);
        return [
          i > 0 ? '<span class="rt-daytab-line" aria-hidden="true"></span>' : '',
          '<button type="button" class="rt-daytab' + (active ? ' active' : '') + '" data-day="' + d.id + '"' +
            ' aria-current="' + (active ? 'true' : 'false') + '"' +
            (active ? ' style="border-color:' + color + '"' : '') +
            ' title="' + escapeHtml(d.label) + (filled ? ' · 장소 ' + d.stopIds.length + '곳' : ' · 비어 있음') + '">',
          filled ? '  <span class="rt-daytab-filled" style="background:' + color + '" aria-hidden="true"></span>' : '',
          '  <span class="rt-daytab-label">' + escapeHtml(d.label) + '</span>',
          '  <span class="rt-daytab-date"' + (active ? ' style="color:' + color + '"' : '') + '>' + dayDateLabel(i) + '</span>',
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

  const toggle = container.querySelector('#rt-float-toggle') as HTMLElement;
  const panel = container.querySelector('#rt-float-search') as HTMLElement;
  const setCollapsed = (collapsed: boolean) => {
    leftPanelCollapsed = collapsed;
    panel.classList.toggle('collapsed', collapsed);
    toggle.classList.toggle('is-collapsed', collapsed);
  };
  toggle?.addEventListener('click', () => setCollapsed(!leftPanelCollapsed));

  // 접힌 상태에선 돋보기 아이콘만 남기고(펼치기 버튼은 숨김) — 그 아이콘을 눌러서 펼침
  const searchIcon = container.querySelector('#rt-float-search-icon') as HTMLElement | null;
  searchIcon?.addEventListener('click', () => {
    if (!leftPanelCollapsed) return; // 펼쳐진 상태에서는 장식용 아이콘일 뿐
    setCollapsed(false);
    requestAnimationFrame(() => floatInput?.focus());
  });
}

function filteredCandidates(): Place[] {
  const q = placeSearchQuery.trim().toLowerCase();
  return candidatePlaces.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (activeCatFilters.size > 0 && !activeCatFilters.has(categoryMeta(p, false).key)) return false;
    return true;
  });
}

function renderCatFilters(container: HTMLElement): void {
  const el = container.querySelector('#rt-float-filters') as HTMLElement;
  if (!el) return;
  el.innerHTML = CAT_FILTERS.map((f) => {
    const on = activeCatFilters.has(f.key);
    const color = CAT_COLOR[f.key];
    return (
      '<button type="button" class="rt-float-filter-chip' + (on ? ' active' : '') + '" data-cat="' + f.key + '"' +
      (on ? ' style="--chip-color:' + color + '"' : '') + '>' +
      '<span class="rt-float-filter-dot" style="background:' + color + '"></span>' + f.label +
      '</button>'
    );
  }).join('');

  el.querySelectorAll('.rt-float-filter-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = (btn as HTMLElement).dataset.cat as CatKey;
      if (activeCatFilters.has(cat)) activeCatFilters.delete(cat);
      else activeCatFilters.add(cat);
      renderCatFilters(container);
      renderLeftPanel(container);
    });
  });
}

function renderLeftPanel(container: HTMLElement): void {
  const listEl = container.querySelector('#rt-float-list') as HTMLElement;
  if (!listEl) return;
  const day = activeDay();
  const items = filteredCandidates();

  if (!items.length) {
    // 검색/필터 결과 없음 vs 애초에 분류된 장소가 없음을 구분해서 안내
    const filtering = !!placeSearchQuery.trim() || activeCatFilters.size > 0;
    listEl.innerHTML = filtering
      ? '<div class="rt-float-empty">' + IC_SEARCH + '<div>조건에 맞는 장소가 없어요<br>검색어나 필터를 확인해보세요</div></div>'
      : '<div class="rt-float-empty">' + IC_PIN_PLUS + '<div>Brainstorm에 분류된 장소가 없어요<br>아래에서 직접 추가해보세요</div></div>';
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

  // 기본(선택) 툴: 아직 담지 않은 후보는 정보 카드(사진/평점/담기 버튼)를 보여줘 담을지 결정하게 하고,
  // 이미 오늘 동선에 들어간 정류지는 같은 정보가 우측 타임라인에 이미 떠 있으므로 카드 없이
  // 강조 + 타임라인 스크롤만 한다(안 그러면 클릭할 때마다 지도 위에 카드가 겹쳐 어수선해짐).
  const alreadyIncluded = isBasecamp || activeDay().stopIds.includes(p.id);
  highlightedPlaceId = p.id;
  hoveredPlaceId = null;
  if (g?.maps) {
    showRipple(g, p, ROUTE_NAVY);
    if (!alreadyIncluded) openPlaceCard(g, p);
  }
  drawRouteOnMap(false);
  renderRightPanel(rtContainer!);
  scrollTimelineTo(p.id);
}

/** 지도에서 핀을 클릭하면 우측 타임라인도 그 장소가 보이도록 스크롤 */
function scrollTimelineTo(placeId: string): void {
  const row = rtContainer?.querySelector('.rt-panel-stop[data-place-id="' + placeId + '"]') as HTMLElement | null;
  if (!row) return;
  row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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

/* ══════════════ AI 일정 추천 (Gemini) ══════════════ */

/**
 * DAY 세부 계획은 나중에 유료로 돌릴 기능. 지금은 전원 사용 가능하되 UI에 예정임을 표시해 둔다.
 * 결제 게이트를 붙일 땐 이 함수 하나만 바꾸면 되도록 판정을 한 곳에 모아둔다.
 */
function canUseDayDetail(): boolean {
  return true;
}

/** places 행에서 AI에 보낼 "우리가 이미 아는 사실"만 뽑는다 (추측값은 보내지 않음) */
function toAiPlace(p: Place, arriveTime?: string | null): AiPlanPlace {
  const hours = Array.isArray(p.opening_hours)
    ? (p.opening_hours as unknown[]).map((h) => String(h)).filter(Boolean)
    : null;
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    mood: p.mood,
    rating: p.google_rating,
    lat: p.lat,
    lng: p.lng,
    hours: hours && hours.length ? hours : null,
    ...(arriveTime ? { arriveTime } : {}),
  };
}

/** AI 적용 직전 상태를 통째로 기억해 둔다(되돌리기용) */
function snapshotBeforeAiPlan(): void {
  aiPlanUndo = {
    stopIdsByDay: days.map((d) => [d.id, [...d.stopIds]] as [string, string[]]),
    times: [...timeOverride.entries()],
    modes: [...legModeOverride.entries()],
  };
}

/** 안내 배너의 "되돌리기" — AI 적용 전 상태로 완전히 복원하고 저장까지 되돌린다 */
async function undoAiRoutePlan(container: HTMLElement): Promise<void> {
  if (!aiPlanUndo) return;
  const snap = aiPlanUndo;
  const byId = new Map(snap.stopIdsByDay);
  days.forEach((d) => { d.stopIds = [...(byId.get(d.id) ?? [])]; });
  timeOverride.clear();
  snap.times.forEach(([k, v]) => timeOverride.set(k, v));
  legModeOverride.clear();
  snap.modes.forEach(([k, v]) => legModeOverride.set(k, v));

  aiPlanUndo = null;
  aiPlanNotice = null;
  lastSavedSig = '';
  await persistAllDays();
  refreshAll(container, { refit: true });
}

/** AI가 짠 일정을 모듈 상태에 반영. 반환값은 실제로 배치된 장소 수 */
function applyAiRoutePlan(result: AiRoutePlanResult): number {
  const basecampId = basecamp?.id ?? null;
  const seen = new Set<string>();

  // 전체 DAY를 새로 짜는 것이므로 기존 배치·도착시각·수동 이동수단은 비운다.
  // (장소별 메모는 장소에 딸린 사용자 기록이라 그대로 둔다 — 그 장소가 새 일정에도 남으면 계속 보인다)
  days.forEach((d) => { d.stopIds = []; });
  timeOverride.clear();
  legModeOverride.clear();

  result.days.forEach((rd) => {
    const day = days[rd.dayIndex];
    if (!day) return;
    rd.stops.forEach((s) => {
      // 서버가 이미 걸렀지만, 그 사이 장소가 지워졌을 수도 있으니 화면 기준으로 한 번 더 확인
      if (!placeById.has(s.placeId) || s.placeId === basecampId || seen.has(s.placeId)) return;
      seen.add(s.placeId);
      day.stopIds.push(s.placeId);
      if (s.arriveTime) timeOverride.set(timeKey(day.id, s.placeId), s.arriveTime);
    });
  });

  return seen.size;
}

async function runAiRoutePlan(container: HTMLElement): Promise<void> {
  if (aiPlanBusy) return;
  if (!activeDestId) {
    window.alert('여행지를 먼저 선택해 주세요.');
    return;
  }
  if (candidatePlaces.length < 2) {
    window.alert('AI가 일정을 짜려면 Brainstorm에서 분류한 장소가 2곳 이상 필요해요.');
    return;
  }
  // 이미 짜둔 동선이 있으면 덮어쓰기 전에 확인 (실행 취소로 되돌릴 수 있음을 함께 안내)
  const hasExisting = days.some((d) => d.stopIds.length > 0);
  if (hasExisting && !window.confirm('지금까지 담은 모든 DAY의 동선을 AI 추천으로 바꿀까요?\n도착 시각과 직접 지정한 이동수단도 함께 초기화돼요. (적용 후 "되돌리기"로 지금 상태로 복구할 수 있어요)')) {
    return;
  }

  aiPlanBusy = true;
  aiPlanNotice = null;
  aiPlanUndo = null;
  renderRightPanel(container);
  updateAiPlanButton(container);

  try {
    const result = await requestRoutePlan({
      destinationId: activeDestId,
      destinationName: activeDestName || currentTrip?.name || '',
      dayCount: days.length,
      startDate: dayRangeStartDate,
      basecamp: basecamp ? toAiPlace(basecamp) : null,
      places: candidatePlaces.filter((p) => p.lat != null && p.lng != null).map((p) => toAiPlace(p)),
    });

    // 반영하기 **전에** 쓸 만한 결과인지 먼저 확인한다 — 먼저 지우고 나서 판단하면
    // 결과가 비었을 때 기존 동선만 날아간다.
    const basecampId = basecamp?.id ?? null;
    const planned = result.days.reduce(
      (n, d) => n + d.stops.filter((s) => placeById.has(s.placeId) && s.placeId !== basecampId).length,
      0
    );
    if (planned === 0) {
      window.alert('AI가 배치할 장소를 찾지 못했어요. 잠시 후 다시 시도해 주세요.');
      return;
    }

    snapshotBeforeAiPlan();
    days.forEach((d) => pushHistory(d.id));
    const usedCount = applyAiRoutePlan(result);

    aiPlanNotice = {
      notes: result.notes,
      usedCount,
      skippedCount: Math.max(0, candidatePlaces.length - usedCount),
      cached: result.cached,
    };
    lastSavedSig = '';
    await persistAllDays();
  } catch (e) {
    window.alert((e as Error).message);
  } finally {
    aiPlanBusy = false;
    refreshAll(container, { refit: true });
    updateAiPlanButton(container);
  }
}

/** 상단 툴바 버튼은 패널 재렌더 대상이 아니라 따로 상태를 갱신해준다 */
function updateAiPlanButton(container: HTMLElement): void {
  const btn = container.querySelector('#rt-ai-plan') as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = aiPlanBusy;
  btn.classList.toggle('is-busy', aiPlanBusy);
  btn.innerHTML = aiPlanBusy
    ? '<span class="rt-ai-spinner"></span><span>일정 짜는 중…</span>'
    : IC_SPARK + '<span>AI 일정 짜기</span>';
}

async function runDayDetail(container: HTMLElement): Promise<void> {
  if (dayDetailBusy) return;
  if (!canUseDayDetail()) return;
  if (!activeDestId) {
    window.alert('여행지를 먼저 선택해 주세요.');
    return;
  }
  const day = activeDay();
  const dayIndex = days.findIndex((d) => d.id === day.id);
  // 숙소는 매일 자동으로 붙는 출발지라 "이 DAY에 담은 장소"에서는 제외하고 판단한다
  const stops = day.stopIds.map((id) => placeById.get(id)).filter((p): p is Place => !!p);
  if (stops.length === 0) {
    window.alert('이 DAY에 담은 장소가 없어요. 장소를 먼저 담아주세요.');
    return;
  }

  dayDetailBusy = true;
  renderRightPanel(container);

  try {
    const times = computeStopTimes(day, orderedStops(day).filter((p) => p.lat != null && p.lng != null), dayLegs(day));
    const timeByPlace = new Map<string, string>();
    orderedStops(day)
      .filter((p) => p.lat != null && p.lng != null)
      .forEach((p, i) => timeByPlace.set(p.id, times[i]));

    const result = await requestDayDetail({
      destinationId: activeDestId,
      destinationName: activeDestName || currentTrip?.name || '',
      dayIndex,
      dayLabel: day.label,
      date: dayDateLabel(dayIndex),
      currency: currencyOf(dayLegs(day)),
      headcount: currentTrip?.headcount ?? null,
      stops: stops.map((p) => toAiPlace(p, timeByPlace.get(p.id) ?? null)),
    });
    openDayDetailModal(day.label, result);
  } catch (e) {
    window.alert((e as Error).message);
  } finally {
    dayDetailBusy = false;
    renderRightPanel(container);
  }
}

/** DAY 세부 계획 결과 — 읽기 전용 참고 자료라 모달로 띄운다(동선 상태는 건드리지 않음) */
function openDayDetailModal(dayLabel: string, r: AiDayDetailResult): void {
  document.querySelector('.rt-ai-modal-backdrop')?.remove();

  const stopHtml = r.stops
    .map((s) => {
      const p = placeById.get(s.placeId);
      if (!p) return '';
      const meta = [
        s.stayMinutes ? '<span class="rt-ai-chip">체류 ' + fmtMin(s.stayMinutes) + '</span>' : '',
        s.costText ? '<span class="rt-ai-chip">' + escapeHtml(s.costText) + '</span>' : '',
      ].join('');
      const highlights = s.highlights.length
        ? '<ul class="rt-ai-list">' + s.highlights.map((h) => '<li>' + escapeHtml(h) + '</li>').join('') + '</ul>'
        : '';
      const tip = s.tip ? '<div class="rt-ai-tip">' + IC_SPARK + '<span>' + escapeHtml(s.tip) + '</span></div>' : '';
      return [
        '<div class="rt-ai-stop">',
        '  <div class="rt-ai-stop-head"><span class="rt-ai-stop-name">' + escapeHtml(p.name) + '</span>' + meta + '</div>',
        highlights,
        tip,
        '</div>',
      ].join('');
    })
    .join('');

  const extrasHtml = r.extras.length
    ? [
        '<div class="rt-ai-section-title">사이사이 추천</div>',
        '<div class="rt-ai-extras">',
        r.extras
          .map(
            (e) =>
              '<div class="rt-ai-extra">' +
              (e.time ? '<span class="rt-ai-extra-time">' + escapeHtml(e.time) + '</span>' : '') +
              '<div><div class="rt-ai-extra-title">' + escapeHtml(e.title) + '</div>' +
              (e.detail ? '<div class="rt-ai-extra-detail">' + escapeHtml(e.detail) + '</div>' : '') +
              '</div></div>'
          )
          .join(''),
        '</div>',
      ].join('')
    : '';

  const budgetHtml = r.budget.lines.length
    ? [
        '<div class="rt-ai-section-title">예상 예산 <span class="rt-ai-badge-est">추정</span></div>',
        '<div class="rt-ai-budget">',
        r.budget.lines
          .map(
            (l) =>
              '<div class="rt-ai-budget-row"><span>' + escapeHtml(l.label) + '</span><b>' + escapeHtml(l.amountText) + '</b></div>'
          )
          .join(''),
        r.budget.totalText
          ? '<div class="rt-ai-budget-row total"><span>합계</span><b>' + escapeHtml(r.budget.totalText) + '</b></div>'
          : '',
        '</div>',
      ].join('')
    : '';

  const cautionsHtml = r.cautions.length
    ? [
        '<div class="rt-ai-section-title">알아두면 좋은 점</div>',
        '<ul class="rt-ai-list">' + r.cautions.map((c) => '<li>' + escapeHtml(c) + '</li>').join('') + '</ul>',
      ].join('')
    : '';

  const backdrop = document.createElement('div');
  backdrop.className = 'rt-ai-modal-backdrop';
  backdrop.innerHTML = [
    '<div class="rt-ai-modal" role="dialog" aria-modal="true" aria-label="' + escapeHtml(dayLabel) + ' 세부 계획">',
    '  <div class="rt-ai-modal-head">',
    '    <div><div class="rt-ai-modal-eyebrow">AI 세부 계획 · 참고용</div>',
    '    <div class="rt-ai-modal-title">' + escapeHtml(dayLabel) + '</div></div>',
    '    <button type="button" class="rt-ai-modal-close" id="rt-ai-close" aria-label="닫기">✕</button>',
    '  </div>',
    '  <div class="rt-ai-modal-body">',
    r.overview ? '    <div class="rt-ai-overview">' + escapeHtml(r.overview) + '</div>' : '',
    stopHtml,
    extrasHtml,
    budgetHtml,
    cautionsHtml,
    // 원칙 3-1 — 체류시간·비용은 AI 추정치라는 걸 결과 안에서 분명히 밝힌다
    '    <div class="rt-ai-disclaimer">체류시간과 비용은 AI가 일반적인 수준으로 추정한 값이에요. 실제 요금·영업시간은 방문 전에 다시 확인해 주세요.</div>',
    '  </div>',
    '</div>',
  ].join('\n');

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };

  backdrop.querySelector('#rt-ai-close')?.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
}

/**
 * AI가 방금 일정을 짠 직후 한 번 보여주는 안내. 무엇을 근거로 짰는지와 몇 곳이 빠졌는지를
 * 알려줘야 사용자가 결과를 그대로 믿지 않고 검토하게 된다(원칙 3-1).
 */
function aiPlanNoticeHtml(): string {
  if (!aiPlanNotice) return '';
  const n = aiPlanNotice;
  const skipped = n.skippedCount > 0 ? ' · 남은 장소 ' + n.skippedCount + '곳은 넣지 않았어요' : '';
  return [
    '<div class="rt-ai-notice">',
    '  <div class="rt-ai-notice-head">',
    '    <span class="rt-ai-notice-title">' + IC_SPARK + 'AI 추천 일정을 적용했어요</span>',
    '    <button type="button" class="rt-ai-notice-close" id="rt-ai-notice-close" aria-label="안내 닫기">✕</button>',
    '  </div>',
    '  <div class="rt-ai-notice-meta">' + n.usedCount + '곳 배치' + skipped + (n.cached ? ' · 저장된 추천' : '') + '</div>',
    n.notes ? '  <div class="rt-ai-notice-body">' + escapeHtml(n.notes) + '</div>' : '',
    '  <div class="rt-ai-notice-foot">영업시간·인기 동선·이동 효율 순으로 배치한 <b>추천안</b>이에요. 직접 옮겨서 다듬어도 좋아요.</div>',
    // 기본 Ctrl+Z는 활성 DAY만 되돌리므로, 전체를 한 번에 되돌리는 수단을 따로 준다
    aiPlanUndo
      ? '  <button type="button" class="rt-ai-notice-undo" id="rt-ai-notice-undo">' + IC_UNDO + ' 적용 전으로 되돌리기</button>'
      : '',
    '</div>',
  ].join('');
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
  const dColor = dayColorFor(Math.max(0, dayIndex));

  const rows: string[] = [];
  stops.forEach((p, i) => {
    const isBasecamp = !!basecamp && i === 0 && p.id === basecamp.id;
    const memo = memoStore.get(p.id) ?? '';
    const highlighted = p.id === highlightedPlaceId;

    const manualTime = timeOverride.has(timeKey(day.id, p.id));
    rows.push(
      [
        '<div class="rt-panel-stop' + (highlighted ? ' rt-highlighted' : '') + '" draggable="' + (isBasecamp ? 'false' : 'true') + '" data-place-id="' + p.id + '">',
        isBasecamp
          ? '  <span class="rt-drag-handle locked" aria-hidden="true"></span>'
          : '  <span class="rt-drag-handle" title="드래그해서 순서 바꾸기" aria-hidden="true">' + IC_GRIP + '</span>',
        '  <span class="rt-panel-badge' + (isBasecamp ? ' rt-panel-badge-stay' : '') + '"' +
          (isBasecamp ? '' : ' style="background:' + dColor + '"') + '>' + (i + 1) + '</span>',
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
    '  <span class="rt-panel-dot" style="background:' + dColor + '"></span>',
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
    aiPlanNoticeHtml(),
    '<div class="rt-panel-list" id="rt-panel-list">',
    stops.length
      ? rows.join('')
      : [
          '<div class="rt-panel-empty">',
          '  <span class="rt-panel-empty-icon">' + IC_ROUTEPATH + '</span>',
          '  <div class="rt-panel-empty-title">아직 담은 장소가 없어요</div>',
          '  <div class="rt-panel-empty-hint">지도의 핀을 누르거나<br>왼쪽 목록에서 담아보세요.</div>',
          // 빈 화면이야말로 "AI가 대신 짜줄까요?"가 가장 자연스러운 자리 — 첫 사용자가
          // 기능을 발견하는 경로를 여기 두고, 이후 재생성은 상단 툴바 버튼으로 한다.
          candidatePlaces.length >= 2
            ? '  <button type="button" class="rt-panel-empty-cta" id="rt-panel-empty-ai"' + (aiPlanBusy ? ' disabled' : '') + '>' +
              (aiPlanBusy ? '<span class="rt-ai-spinner"></span> 일정 짜는 중…' : IC_SPARK + ' AI에게 일정 맡기기') +
              '</button>'
            : '',
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
    // 이 DAY 하나에 대한 심화 기능이라 DAY 단위 액션(장소 추가/순서 정리) 바로 아래에 둔다.
    '<button type="button" class="rt-panel-detail" id="rt-panel-daydetail"' +
      (s.visitCount === 0 || dayDetailBusy ? ' disabled' : '') +
      ' title="이 DAY의 동선을 보고 장소별 추천 체류시간·팁·예상 예산을 정리해요">' +
      (dayDetailBusy
        ? '<span class="rt-ai-spinner"></span><span>세부 계획 만드는 중…</span>'
        : IC_NOTE + '<span>이 DAY 세부 계획</span><span class="rt-panel-detail-badge">PRO 예정</span>') +
      '</button>',
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
    // 타임라인 ↔ 지도 연결감: 카드에 올리면 지도의 해당 핀·구간만 살짝 밝아진다.
    // 선택(클릭) 상태는 건드리지 않는 "일시적 미리보기"라, 마우스를 떼면 원래대로 돌아온다.
    card.addEventListener('mouseenter', () => {
      const id = (card as HTMLElement).dataset.placeId!;
      if (highlightedPlaceId || hoveredPlaceId === id) return; // 클릭 선택이 있으면 그게 우선
      hoveredPlaceId = id;
      drawRouteOnMap(false);
    });
    card.addEventListener('mouseleave', () => {
      if (!hoveredPlaceId) return;
      hoveredPlaceId = null;
      drawRouteOnMap(false);
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
  el.querySelector('#rt-panel-empty-ai')?.addEventListener('click', () => void runAiRoutePlan(container));
  el.querySelector('#rt-panel-daydetail')?.addEventListener('click', () => void runDayDetail(container));
  el.querySelector('#rt-ai-notice-close')?.addEventListener('click', () => {
    aiPlanNotice = null;
    aiPlanUndo = null; // 배너를 닫으면 되돌리기 기회도 끝난다(상태를 오래 붙들고 있지 않도록)
    renderRightPanel(container);
  });
  el.querySelector('#rt-ai-notice-undo')?.addEventListener('click', () => void undoAiRoutePlan(container));
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

/**
 * 동선 선 스타일. 이전엔 이동수단마다 다른 색(초록/파랑/회색)을 썼지만, 지도에서 Route가
 * 확실한 주인공이 되도록 **진한 네이비 단일 색**으로 통일했다. 이동수단 구분은 색이 아니라
 * 캡슐 배지의 아이콘/라벨과 모드 전환 노드가 담당한다.
 * 도보만 점선을 유지 — 실제 보행로가 도로와 다를 수 있다는 신호로 유용해서.
 */
const ROUTE_NAVY = '#243B78';
const ROUTE_ORANGE = '#E8833A';
const ROUTE_GRAY = '#9AA7B8';
const MODE_STYLE: Record<Leg['mode'], { weight: number; dashed: boolean }> = {
  WALK: { weight: 5, dashed: true },
  TRANSIT: { weight: 6, dashed: false },
  TAXI: { weight: 6, dashed: false },
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
    // 확대/축소는 마우스 휠·드래그(gestureHandling:'greedy')로 충분해 버튼은 아예 뺀다.
    zoomControl: false,
    // 구글 기본 지도/위성 버튼은 이 디자인 톤과 안 어울려서 끄고, 같은 자리에 커스텀 버튼을 넣는다.
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    rotateControl: false,
  });

  addMapTypeToggle(g, mapInstance);

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

  // 축소할수록 번호 핀이 상대적으로 너무 커 보이는 문제 — 줌 레벨에 따라 핀 크기를 다시 계산.
  // 스크롤 줌 중엔 zoom_changed가 매우 자주 발생하므로 프레임당 한 번만 다시 그린다.
  mapInstance.addListener('zoom_changed', () => {
    if (zoomRedrawHandle != null) return;
    zoomRedrawHandle = window.requestAnimationFrame(() => {
      zoomRedrawHandle = null;
      drawRouteOnMap(false);
    });
  });

  drawRouteOnMap(true);

  resizeHandler = () => resizeMap();
  window.addEventListener('resize', resizeHandler);
}

/**
 * 구글 기본 "지도/위성" 버튼(딱딱한 회색 UI)을 끄고, 하단 툴바(.rt-tool)와 같은
 * 언어(글래스 배경 + 네이비 active 필)로 만든 커스텀 세그먼트 버튼을 그 자리에 넣는다.
 */
function addMapTypeToggle(g: any, map: any): void {
  const wrap = document.createElement('div');
  wrap.className = 'rt-maptype-control';
  wrap.innerHTML =
    '<button type="button" class="rt-maptype-btn active" data-type="roadmap">지도</button>' +
    '<button type="button" class="rt-maptype-btn" data-type="hybrid">위성</button>';
  wrap.querySelectorAll('.rt-maptype-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = (btn as HTMLElement).dataset.type!;
      map.setMapTypeId(type);
      wrap.querySelectorAll('.rt-maptype-btn').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });
  map.controls[g.maps.ControlPosition.RIGHT_TOP].push(wrap);
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

  // 강조 기준점: 클릭 선택이 우선, 없으면 타임라인 호버(일시적 미리보기)
  const focusId = highlightedPlaceId ?? hoveredPlaceId;
  const focusIdx = focusId ? stops.findIndex((s) => s.id === focusId) : -1;

  // 아직 오늘 동선에 없는 후보 — 회색으로 물러나게 (Route가 주인공)
  candidatePlaces.forEach((p) => {
    if (p.lat == null || p.lng == null) return;
    if (day.stopIds.includes(p.id)) return;
    const marker = buildMarkerV2(g, p, { isBasecamp: false, included: false, highlighted: p.id === focusId });
    marker.addListener('click', () => handlePinClick(g, p));
    mapMarkers.push(marker);
  });

  // 오늘 동선의 정류지 — 순서 번호 + 진행 상태 색
  stops.forEach((p, i) => {
    const isBasecamp = !!basecamp && i === 0 && p.id === basecamp.id;
    // 여행은 아직 미래라 실제 "완료"는 없다. 선택한 지점을 현재로 보고 앞/뒤를 나눠
    // 진행 방향이 읽히게 한다. 아무것도 선택하지 않았으면 전부 기본 네이비.
    let phase: StopPhase = 'plain';
    if (focusIdx >= 0) {
      if (i < focusIdx) phase = 'done';
      else if (i === focusIdx) phase = 'current';
      else if (i === focusIdx + 1) phase = 'next';
      else phase = 'plain';
    }
    const marker = buildMarkerV2(g, p, {
      isBasecamp,
      included: true,
      num: i + 1,
      highlighted: p.id === focusId,
      phase,
    });
    marker.addListener('click', () => handlePinClick(g, p));
    mapMarkers.push(marker);
  });

  // 같은 구간이 여러 번 등장하면(같은 길 왕복 등) 겹쳐 보이지 않게 회차를 센다
  const seenLegs = new Map<string, number>();

  for (let i = 0; i < stops.length - 1; i++) {
    const leg = legs[i];
    const key = legKey(stops[i].id, stops[i + 1].id);
    // 방향이 반대여도 같은 선분이므로 정렬한 키로 겹침을 판단
    const geomKey = [stops[i].id, stops[i + 1].id].sort().join('~');
    const overlapIndex = seenLegs.get(geomKey) ?? 0;
    seenLegs.set(geomKey, overlapIndex + 1);

    // 캡슐(시간/비용) 표시는 이 구간(화살표)을 **클릭**했을 때만 반응한다. 호버로도 띄워봤지만
    // 호버가 지도 전체를 다시 그리다 보니(drawRouteOnMap) 마우스가 올라간 폴리라인 자체가
    // 매번 새로 생성돼 mouseover/mouseout이 짧은 간격으로 서로를 취소시키며 깜빡이는
    // 문제가 있었음 — 클릭 한 번으로 고정/해제하는 편이 안정적이고 예측 가능해서 되돌림.
    const capsuleActive = selectedLegKey === key;
    // "선의 강조 표시(진하기)"는 장소 핀 포커스와 연동한다 — 어떤 장소를 클릭하면 그 장소로
    // 들어오고 나가는 두 구간만 선명하게, 나머지는 옅게 흐려서 "여기서 어디로 가는지"가
    // 한눈에 읽히게 한다. 캡슐 표시 여부와는 별개의 신호라 따로 둔다.
    const legAdjacentToFocus = focusIdx >= 0 && (i === focusIdx || i === focusIdx - 1);
    // selected와 dimmed가 동시에 참이 되지 않도록 반드시 selected의 여집합으로 정의한다.
    const selected = capsuleActive || legAdjacentToFocus;
    const dimmed = !selected && (!!selectedLegKey || focusIdx >= 0);

    const line = buildLegPolyline(g, stops[i], stops[i + 1], leg, {
      selected,
      dimmed,
      passed: focusIdx < 0 ? true : i < focusIdx,
      overlapIndex,
    });
    line.addListener('click', () => handleLegClick(stops[i].id, stops[i + 1].id));
    routePolylines.push(line);

    // 이동수단이 바뀌는 지점에 작은 노드 (첫 구간이거나 앞 구간과 모드가 다를 때)
    if (i > 0 && legs[i - 1] && legs[i - 1].mode !== leg.mode) {
      mapMarkers.push(buildModeChangeNode(g, { lat: stops[i].lat!, lng: stops[i].lng! }));
    }

    // 이동시간·비용 캡슐은 항상 떠 있으면 지도가 어수선해지므로 이 구간을 직접 호버/클릭했을 때만 표시.
    if (capsuleActive) {
      const mid =
        leg.path && leg.path.length >= 2
          ? leg.path[Math.floor(leg.path.length / 2)]
          : { lat: (stops[i].lat! + stops[i + 1].lat!) / 2, lng: (stops[i].lng! + stops[i + 1].lng!) / 2 };
      // 구간이 화면상 너무 짧으면 캡슐이 정중앙에 있을 때 양 끝 핀과 겹쳐 버리므로,
      // 그럴 때만 예전처럼 선 위로 살짝 띄운다(그 외엔 화살표 정중앙에 그대로 얹는다).
      const midLat = (stops[i].lat! + stops[i + 1].lat!) / 2;
      const zoom = typeof mapInstance.getZoom === 'function' ? mapInstance.getZoom() : 13;
      const short = legPixelLength(leg.km, midLat, zoom) < CAPSULE_SHORT_PX;
      const Ctor = getOverlayCtor(g);
      const cls = 'rt-map-capsule ' + modeColorClass(leg.mode) + ' rt-leg-selected' +
        (short ? ' rt-cap-above' : '') +
        (legModeOverride.has(key) ? ' rt-leg-manual' : '');
      const capsule = new Ctor(new g.maps.LatLng(mid.lat, mid.lng), legCapsuleHtml(leg, mapCur), cls, () =>
        handleLegClick(stops[i].id, stops[i + 1].id, capsule.div ?? undefined)
      );
      capsule.setMap(mapInstance);
      mapOverlays.push(capsule);
    }
  }

  if (refit) fitRouteBounds();
}

// 캡슐 정중앙 배치가 양 끝 핀과 겹칠 만큼 짧은 구간인지 판단하는 기준(px). 캡슐 실제 폭(약
// 100~130px)보다 살짝 좁게 잡아, 그보다 짧을 때만 "위로 띄우기"로 되돌아간다.
const CAPSULE_SHORT_PX = 90;

/** 구간의 실제 거리(km)가 현재 지도 확대 수준에서 화면상 몇 px로 보이는지 추정(Web Mercator 근사식) */
function legPixelLength(km: number, lat: number, zoom: number): number {
  if (!Number.isFinite(zoom)) zoom = 13;
  const metersPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return Infinity;
  return (km * 1000) / metersPerPixel;
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

/** 동선 안에서의 위치에 따른 핀 상태 — 색은 이것만으로 결정한다(카테고리 색 아님) */
type StopPhase = 'current' | 'next' | 'done' | 'plain';

function phaseColor(phase: StopPhase): string {
  if (phase === 'next') return ROUTE_ORANGE;
  if (phase === 'done') return ROUTE_GRAY;
  return ROUTE_NAVY; // current / plain
}

interface MarkerOpts {
  isBasecamp: boolean;
  included: boolean;
  num?: number;
  highlighted?: boolean;
  phase?: StopPhase;
}

// 확대했을 때(REFERENCE_ZOOM 이상)의 핀 크기가 "적절한" 기준 — 그보다 축소하면 화면 픽셀
// 상 크기가 고정된 채로 남아 핀이 점점 더 존재감이 커 보이므로, 축소한 만큼 배지를 함께 줄인다.
const PIN_REFERENCE_ZOOM = 14;
const PIN_MIN_ZOOM_SCALE = 0.55;
function pinZoomScale(): number {
  if (!mapInstance || typeof mapInstance.getZoom !== 'function') return 1;
  const zoom = mapInstance.getZoom();
  if (typeof zoom !== 'number' || !Number.isFinite(zoom)) return 1;
  const diff = PIN_REFERENCE_ZOOM - zoom;
  if (diff <= 0) return 1; // 확대 상태는 기존 크기 그대로(사용자가 "적절하다"고 확인한 크기)
  return Math.max(PIN_MIN_ZOOM_SCALE, 1 - diff * 0.09);
}

/**
 * 커스텀 원형 배지 마커.
 *  - 동선에 포함된 정류지: 순서 번호 + 진행 상태 색(네이비/오렌지/그레이)
 *  - 아직 담지 않은 후보: 작고 흐린 회색 배지 + 카테고리 아이콘(배경으로 물러나게)
 * 카테고리별 알록달록한 색을 쓰지 않는 이유 — 지도에서 Route가 가장 먼저 눈에 들어와야 해서.
 */
function buildMarkerV2(g: any, p: Place, opts: MarkerOpts): any {
  const meta = categoryMeta(p, opts.isBasecamp);
  const phase: StopPhase = opts.phase ?? 'plain';
  const scale = (opts.highlighted ? 1.18 : 1) * pinZoomScale();
  const r = (opts.included ? 15 : 9) * scale;
  // halo/glow까지 담을 여유를 둔 캔버스
  const pad = opts.highlighted ? 26 : 12;
  const size = Math.ceil(r * 2 + pad);
  const c = size / 2;
  const fill = opts.included ? phaseColor(phase) : '#FFFFFF';

  // 선택된 지점만 아주 옅은 네이비 halo로 강조 (지도 전체를 건드리지 않음)
  const halo = opts.highlighted
    ? '<circle cx="' + c + '" cy="' + c + '" r="' + (r + 9) + '" fill="' + ROUTE_NAVY + '" fill-opacity="0.09"/>' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + (r + 4.5) + '" fill="' + ROUTE_NAVY + '" fill-opacity="0.07"/>'
    : '';
  const shadow =
    '<ellipse cx="' + c + '" cy="' + (c + r * 0.62) + '" rx="' + r * 0.78 + '" ry="' + r * 0.26 + '" fill="rgba(11,42,92,0.16)"/>';

  const inner = opts.included
    ? '<text x="' + c + '" y="' + (c + 4.2) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' +
      Math.round(12 * scale) + '" font-weight="800" fill="#fff">' + (opts.num ?? '') + '</text>'
    : '<g transform="translate(' + (c - 5.5) + ',' + (c - 5.5) + ') scale(0.46)" color="' + ROUTE_GRAY +
      '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      iconInner(meta.icon) + '</g>';

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    halo + shadow +
    '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="' + fill + '" stroke="' +
      (opts.included ? '#FFFFFF' : 'rgba(154,167,184,0.9)') + '" stroke-width="' + (opts.included ? 2.6 : 1.8) + '"/>' +
    inner +
    '</svg>';

  return new g.maps.Marker({
    position: { lat: p.lat!, lng: p.lng! },
    map: mapInstance,
    title: p.name,
    zIndex: opts.highlighted ? 400 : opts.included ? 100 + (opts.num ?? 0) : 10,
    icon: {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new g.maps.Size(size, size),
      anchor: new g.maps.Point(c, c),
    },
  });
}

/** 이동수단이 바뀌는 지점에 찍는 작은 원형 노드 */
function buildModeChangeNode(g: any, at: LatLngLit): any {
  const size = 14;
  const c = size / 2;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<circle cx="' + c + '" cy="' + c + '" r="4.5" fill="#FFFFFF" stroke="' + ROUTE_NAVY + '" stroke-width="2.4"/></svg>';
  return new g.maps.Marker({
    position: at,
    map: mapInstance,
    clickable: false,
    zIndex: 90,
    icon: {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new g.maps.Size(size, size),
      anchor: new g.maps.Point(c, c),
    },
  });
}

/** 구간 폴리라인 — 이동수단별 스타일(도보 점선/대중교통·자동차 실선) + 끝 화살표 */
type LatLngLit = { lat: number; lng: number };

/**
 * 추정 구간(실제 도로 경로가 없는 직선)을 부드러운 호로 바꾼다.
 * ⚠️ 실측 경로(leg.path)에는 절대 적용하지 않는다 — 실제 도로 좌표를 곡선으로 다듬으면
 * 존재하지 않는 길을 지나가는 것처럼 보여 데이터를 왜곡한다(원칙 3-1).
 * 실측 구간은 도로를 따라가느라 이미 자연스러운 곡선이라 다듬을 필요도 없다.
 *
 * @param bend 곡률(구간 길이 대비 최대 부풀림 비율). 0이면 직선.
 */
function arcBetween(a: LatLngLit, b: LatLngLit, bend: number): LatLngLit[] {
  const SEGMENTS = 24;
  // 위경도 평면에서의 수직 방향(경도는 위도에 따라 좁아지므로 보정)
  const latScale = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180) || 1;
  const dx = (b.lng - a.lng) * latScale;
  const dy = b.lat - a.lat;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [a, b];

  // 제어점 = 중점에서 수직으로 살짝 밀어낸 지점 (2차 베지어)
  const mx = (a.lng + b.lng) / 2;
  const my = (a.lat + b.lat) / 2;
  const nx = -dy / len;
  const ny = dx / len;
  const off = len * bend;
  const cx = mx + (nx * off) / latScale;
  const cy = my + ny * off;

  const pts: LatLngLit[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const u = 1 - t;
    pts.push({
      lng: u * u * a.lng + 2 * u * t * cx + t * t * b.lng,
      lat: u * u * a.lat + 2 * u * t * cy + t * t * b.lat,
    });
  }
  return pts;
}

/** 경로 전체를 수직 방향으로 살짝 밀어낸다 — 같은 구간이 겹쳐 그려질 때 구분용 */
function offsetPath(path: LatLngLit[], meters: number): LatLngLit[] {
  if (path.length < 2 || meters === 0) return path;
  const a = path[0];
  const b = path[path.length - 1];
  const latScale = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180) || 1;
  const dx = (b.lng - a.lng) * latScale;
  const dy = b.lat - a.lat;
  const len = Math.hypot(dx, dy);
  if (len === 0) return path;
  const degPerMeter = 1 / 111320;
  const nx = (-dy / len) * meters * degPerMeter;
  const ny = (dx / len) * meters * degPerMeter;
  return path.map((p) => ({ lat: p.lat + ny, lng: p.lng + nx / latScale }));
}

interface LegDrawOpts {
  selected: boolean;
  dimmed: boolean;
  /** 선택 지점 기준 "지나온" 구간이면 true → 완전 불투명, 이후 예정 구간은 살짝 투명 */
  passed: boolean;
  /** 같은 구간이 여러 번 그려질 때의 회차 (0이면 오프셋 없음) */
  overlapIndex: number;
}

function buildLegPolyline(g: any, from: Place, to: Place, leg: Leg, opts: LegDrawOpts): any {
  const style = MODE_STYLE[leg.mode];

  let path: LatLngLit[];
  if (leg.path && leg.path.length >= 2) {
    path = leg.path; // 실측 도로 경로 — 그대로(왜곡 금지)
  } else {
    // 추정 구간만 부드러운 호로. 선택된 구간은 조금 더 완만하게 펴서 강조.
    path = arcBetween(
      { lat: from.lat!, lng: from.lng! },
      { lat: to.lat!, lng: to.lng! },
      opts.selected ? 0.08 : 0.12
    );
  }
  if (opts.overlapIndex > 0) path = offsetPath(path, opts.overlapIndex * 28);

  // 진행 방향 읽기: 지나온 구간 100%, 예정 구간 80%. 다른 구간이 선택되면 흐리게.
  const baseOpacity = opts.passed ? 1 : 0.8;
  const lineOpacity = opts.dimmed ? 0.28 : opts.selected ? 1 : baseOpacity;
  const weight = opts.selected ? style.weight + 2 : style.weight;

  const icons: any[] = [];
  if (style.dashed) {
    icons.push({
      icon: { path: 'M 0,-1 0,1', strokeOpacity: lineOpacity, strokeColor: ROUTE_NAVY, strokeWeight: weight, scale: 3 },
      offset: '0',
      repeat: '15px',
    });
  }
  icons.push({
    icon: {
      path: g.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: 3.4,
      strokeColor: ROUTE_NAVY,
      strokeOpacity: lineOpacity,
      fillColor: ROUTE_NAVY,
      fillOpacity: lineOpacity,
    },
    offset: '96%',
  });

  // 선택/호버된 구간은 아주 옅은 네이비 halo를 아래에 깔아 배경에서 확실히 떠오르게
  if (opts.selected) {
    routePolylines.push(
      new g.maps.Polyline({
        map: mapInstance,
        path,
        strokeColor: ROUTE_NAVY,
        strokeOpacity: 0.14,
        strokeWeight: weight + 10,
        zIndex: 9,
      })
    );
  }

  // 흰 테두리를 깔아 지도 배경과 대비를 만든다(도로 위에서도 선이 또렷하게 보임)
  if (!style.dashed) {
    routePolylines.push(
      new g.maps.Polyline({
        map: mapInstance,
        path,
        strokeColor: '#FFFFFF',
        strokeOpacity: opts.dimmed ? 0.3 : 0.9,
        strokeWeight: weight + 3,
        zIndex: opts.selected ? 18 : 8,
      })
    );
  }

  return new g.maps.Polyline({
    map: mapInstance,
    path,
    strokeColor: ROUTE_NAVY,
    strokeOpacity: style.dashed ? 0 : lineOpacity,
    strokeWeight: weight,
    icons,
    zIndex: opts.selected ? 20 : 10,
  });
}

/**
 * 지도는 "배경", Route가 "주인공"이 되도록 채도를 낮춘 스타일.
 * 길 찾을 때 필요한 도로망과 지명은 남기되(위치 감각에 꼭 필요), 색은 거의 무채색에 가깝게
 * 눌러서 네이비 동선이 확실히 위로 떠오르게 한다. 업체 POI 아이콘/라벨은 전부 끈다.
 */
const MAP_STYLE_LIGHT = [
  { elementType: 'geometry', stylers: [{ color: '#F7F9FC' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#A9B4C2' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#FFFFFF' }, { weight: 2 }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  // POI는 전부 숨기고 공원 지형만 아주 옅게 남겨 위치 감각을 돕는다
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#EFF4EF' }, { visibility: 'on' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  // 동네/지역 이름은 지도를 채우는 가장 큰 글자 소음이라 완전히 끈다(위치 감각은 도로망으로 충분)
  { featureType: 'administrative.locality', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  // 도로는 유지하되 흰색~아주 연한 회색으로 (동선 네이비와 최대 대비)
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#EDF1F6' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#FAFBFD' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#E6EBF2' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#B7C1CD' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  // 잔도로 이름까지는 필요 없음 — 주요 도로(고속도로)만 이름을 남긴다
  { featureType: 'road.arterial', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#DEEAF4' }] },
  { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#F4F7FA' }] },
];
