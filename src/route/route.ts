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
  updateDestination,
  dayNumberOffsetFor,
  setActiveDestinationId,
} from '../trips/destinations';
import {
  loadGoogleMapsScript,
  searchPlacesByText,
  searchPlacesNearby,
  suggestGateFromCategory,
} from '../utils/googleMaps';
import type { GooglePlaceResult } from '../utils/googleMaps';
import { insertGooglePlace, rehostPhoto } from '../trips/addGooglePlace';
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
import type { AiPlanPlace, AiRoutePlanResult, AiDayDetailResult, AiStaySegment } from './aiPlan';
// 화면에 뜨는 숫자(이동시간·거리·요금·체류시간)는 TIMELINE과 반드시 같아야 하므로
// 순수 계산은 전부 공용 모듈 하나에서만 가져온다 — utils/travelEstimate.ts 상단 설명 참고.
import {
  haversineKm,
  estimateLegBetween,
  toApiMode,
  legKey,
  catKeyFor,
  dwellMinutes,
  modeLabel,
  modeColorClass,
  fmtMin,
  fmtKm,
  minToHHMM,
  parseTimeInput,
  CAT_COLOR,
  STRAIGHT_TO_ROAD,
} from '../utils/travelEstimate';
import type { Leg, RealLeg, CatKey } from '../utils/travelEstimate';
import type { Database, StaySegment, TripDestination } from '../types/database';
import './route.css';

type Place = Database['public']['Tables']['places']['Row'];
type Trip = Database['public']['Tables']['trips']['Row'];

/* ── 아이콘 ── */
const IC_WALK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="M11 8l-3 3 2 7M11 8l3 2 3-1M8 11l-3 2v6M13 10l2 4-2 6"/></svg>';
const IC_TRANSIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="14" rx="2"/><path d="M4 11h16M8 21l2-4h4l2 4M8 7h.01M16 7h.01"/></svg>';
const IC_TAXI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M5 17l1.5-5h11L19 17M8 12V8h8v4"/></svg>';
const IC_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
const IC_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const IC_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
const IC_CHEVRON_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>';
const IC_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const IC_SPARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>';
const IC_STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.8 5.9 20.4 7.2 13.7 2.2 9l6.8-.8z"/></svg>';
const IC_BED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 18v2M21 18v2M3 12V8a2 2 0 0 1 2-2h4v6"/></svg>';
const IC_PLANE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
const IC_LANDMARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M4 21V10M20 21V10M2 10l10-6 10 6M6 10v7M10 10v7M14 10v7M18 10v7"/></svg>';
const IC_FORK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2v7a2 2 0 0 0 2 2v11M7 2v7M9 2v7M11 2v7M16 2c-1.5 0-3 1.5-3 4s1.5 4 3 4v10"/></svg>';
const IC_TARGET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>';
const IC_BAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l1 12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>';
// 검색결과 핀 전용 — 카테고리별로 한눈에 구분되도록(카페=커피잔, 편의점=가게 등)
const IC_COFFEE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z"/><path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 2v2M11 2v2M14 2v2"/></svg>';
const IC_BREAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-4 0-9 3-9 8 0 6 5 10 9 10s9-4 9-10c0-5-5-8-9-8Z"/><path d="M7 14c1-2 2-3 5-3s4 1 5 3"/></svg>';
const IC_GLASS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14l-7 9-7-9Z"/><path d="M12 12v9M8 21h8"/></svg>';
const IC_TREE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 7 9h3l-4 6h4l-3 5h10l-3-5h4l-4-6h3L12 2Z"/><path d="M12 22v-4"/></svg>';
const IC_TEMPLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v3M12 5l8 6H4l8-6Z"/><path d="M5 11v9h14v-9"/><path d="M10 20v-5h4v5"/></svg>';
const IC_FERRIS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3 6.3 17.7"/></svg>';
const IC_STORE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M3 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></svg>';
const IC_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
const IC_EXTLINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>';
const IC_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
const IC_PIN_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21C12 21 19 14.5 19 9.5C19 5.9 15.9 3 12 3C8.1 3 5 5.9 5 9.5C5 14.5 12 21 12 21Z"/><path d="M12 6.5v6M9 9.5h6"/></svg>';
const IC_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const IC_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13"/></svg>';
// "여행지 변경" 전용 — Board/Shortlist의 같은 아이콘과 통일
const IC_SWAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3L3 7l4 4M3 7h13a4 4 0 0 1 4 4v1M17 21l4-4-4-4M21 17H8a4 4 0 0 1-4-4v-1"/></svg>';
const IC_UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/></svg>';
const IC_REDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h2"/></svg>';
const IC_ALERT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';
const IC_ROUTEPATH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H14a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h5.5"/></svg>';
// "숙소 들르기"(재방문 스탑) 전용 — Expense 화면의 숙소 카테고리 아이콘(IC_HOTEL)과 동일한
// 건물 모양이라, "이건 숙소 관련 스탑"이라는 게 앱 전체에서 일관되게 읽힌다.
const IC_LODGING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15"/><path d="M15 21v-8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v8"/><path d="M7.5 7.5h1M7.5 11h1M7.5 14.5h1M11.5 7.5h1M11.5 11h1M11.5 14.5h1M17.5 14.5h1M17.5 17.5h1"/><path d="M2 21h20"/></svg>';
// 목적 프리셋 칩 아이콘 — 휴식(소파)/옷 갈아입기(옷걸이)/샤워(샤워기). 짐 두기는 기존 IC_BED 재사용.
const IC_SOFA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M3 12h18v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5Z"/><path d="M5 18v2M19 18v2"/></svg>';
const IC_HANGER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a2 2 0 0 1 2 2c0 1-1 1.6-2 2.2"/><path d="M12 7.2 3 13.5a1.2 1.2 0 0 0 .7 2.2h16.6a1.2 1.2 0 0 0 .7-2.2L12 7.2Z"/><path d="M6 19h12"/></svg>';
const IC_SHOWER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8a4 4 0 0 1 4-4h1"/><circle cx="15" cy="8" r="3"/><path d="M9 9v11M13 13v1M17 13v1M9 17h4M15 17h2"/></svg>';

const CAT_ICON: Record<CatKey, string> = { VISIT: IC_LANDMARK, FOOD: IC_FORK, ACTIVITY: IC_TARGET, SHOPPING: IC_BAG, STAY: IC_BED, AIRPORT: IC_PLANE };
/** 좌측 패널 카테고리 필터 칩 — 후보 목록에 실제로 나타나는 4개 게이트만(숙소 제외) */
const CAT_FILTERS: Array<{ key: CatKey; label: string }> = [
  { key: 'VISIT', label: '관광' },
  { key: 'FOOD', label: '맛집' },
  { key: 'ACTIVITY', label: '액티비티' },
  { key: 'SHOPPING', label: '쇼핑' },
];

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

interface Pt { lat: number; lng: number }

interface HistoryState {
  past: string[][];
  future: string[][];
}

/* ── 모듈 상태 ── */
let currentTripId = '';
let currentTrip: Trip | null = null;
let rtContainer: HTMLElement | null = null;
/** 여행지 전체 기준 "대표" 숙소 — 구간이 하나뿐이거나 날짜로 못 찾을 때의 안전망(폴백)으로만 쓴다.
 * 실제 각 DAY의 숙소는 반드시 basecampForDay()로 구해야 한다(구간별로 다를 수 있으므로). */
let basecamp: Place | null = null;
/** 이 여행지의 모든 숙소 구간(날짜 범위 + 숙소) — DAY별로 어느 숙소에 묵는지 판단하는 근거 */
let staySegments: StaySegment[] = [];
/**
 * DAY 1의 진짜 시작점(공항)과 마지막 DAY의 진짜 종료점(공항).
 * 좌표(lat/lng)는 사용자가 자동완성 드롭다운에서 실제 공항을 선택했을 때만 채워지고,
 * 그때만 지도 위의 진짜 정류지(anchorAirportPlace)로 취급된다 — 이름만 직접 타이핑하고
 * 목록에서 고르지 않으면 좌표가 없어 정류지로 만들 수 없다(원칙 3-1, 좌표를 지어내지 않음).
 * trip_destinations의 arrival_ 및 departure_ 접두사 컬럼에 저장됨.
 */
let activeDestArrivalAirport: string | null = null;
let activeDestArrivalTime: string | null = null;
let activeDestArrivalLat: number | null = null;
let activeDestArrivalLng: number | null = null;
let activeDestArrivalPhoto: string | null = null;
let activeDestArrivalRating: number | null = null;
let activeDestDepartureAirport: string | null = null;
let activeDestDepartureTime: string | null = null;
let activeDestDepartureLat: number | null = null;
let activeDestDepartureLng: number | null = null;
let activeDestDeparturePhoto: string | null = null;
let activeDestDepartureRating: number | null = null;
/** "AI 일정 짜기"에 매번 그대로 전달되는 자유 텍스트 요청사항(여행 컨셉/니즈/특정 Day 지시 등).
 * trip_destinations.ai_plan_notes에 저장 — 한 번 써두면 재사용된다. */
let activeDestAiPlanNotes: string | null = null;
let candidatePlaces: Place[] = []; // 확정 장소들(숙소 제외)
let placeById = new Map<string, Place>();
let days: RouteDay[] = [];
let activeDayId = '';
let dayRangeStartDate: string | null = null;
let panelCollapsed = false;
let leftPanelCollapsed = false;

let highlightedPlaceId: string | null = null;
/** 우측 타임라인에 마우스를 올렸을 때만 잠깐 강조되는 장소 (클릭 선택과 별개인 일시적 미리보기) */
let hoveredPlaceId: string | null = null;
/** 확정된(동선에 담긴) 장소를 클릭하면 뜨는 정보 패널 — 장소 정보 + 앞/뒤로 이어지는 두 구간의
 *  이동시간/비용을 한 번에 보여준다. 지도 위에 얹지 않고 우상단에 반투명 패널로 고정. */
let stopInfoPanelEl: HTMLElement | null = null;
let adhocMode = false;
let adhocSeq = 0;
let placeSearchQuery = '';
/** 좌측 패널 카테고리 필터 — 비어있으면 전체 표시 */
let activeCatFilters = new Set<CatKey>();

/* ── 지도 장소 검색(우상단 검색창 · 확정 장소 근처검색 공용) ──
 * 아직 Brainstorm에 담지 않은, "방금 구글에서 찾은" 임시 결과 — 담기 전까지는 지도 위에만
 * 표시되고 새로고침/새 검색/DAY 전환 시 사라진다(candidatePlaces와는 다른 임시 상태). */
let searchResultPlaces: Place[] = [];
let searchBusy = false;
let historyByDay = new Map<string, HistoryState>();
const memoStore = new Map<string, string>();
const timeOverride = new Map<string, string>();
const legModeOverride = new Map<string, Leg['mode']>();
/** "숙소 들르기"로 하루 중간에 되돌아온 지점(예: 짐 두기) — 실제 candidatePlaces에는 없는
 *  합성 Place라, 이 id로 조회되면 일반 방문이 아니라 이 목적 텍스트로 특별히 그린다. */
const lodgingRevisitPurpose = new Map<string, string>();

let activeDestId: string | null = null;
let activeDestName = '';
/** 이 여행지 앞에 오는(날짜순) 다른 여행지들의 DAY 수 합 — DAY 라벨이 여행 전체 기준으로
 *  이어지도록(예: 방콕 3일 뒤 푸켓은 DAY 4부터) 더해준다. dest.destinationDayCount 참고. */
let dayNumberOffset = 0;
/** 이 트립의 전체 여행지 목록 — 옵션 메뉴의 "여행지 변경"에서 고를 목록으로 쓴다 */
let allDestinations: TripDestination[] = [];

/* ── AI 일정 추천 상태 ── */
let aiPlanBusy = false;
/** 매크로→Day별 세부 호출 진행 상황 — "Day 2/6 짜는 중…" 버튼 라벨용 */
let aiPlanProgressLabel: string | null = null;
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
let placeCardOverlay: any = null;
let placeCardPlaceId: string | null = null;
let resizeHandler: (() => void) | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;
let beforeUnloadHandler: (() => void) | null = null;
let zoomRedrawHandle: number | null = null;

export function teardownRoute(): void {
  if (resizeHandler) { window.removeEventListener('resize', resizeHandler); resizeHandler = null; }
  if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
  if (beforeUnloadHandler) { window.removeEventListener('beforeunload', beforeUnloadHandler); beforeUnloadHandler = null; }
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
  dayNumberOffset = 0;
  allDestinations = [];
  aiPlanBusy = false;
  aiPlanProgressLabel = null;
  aiPlanNotice = null;
  aiPlanUndo = null;
  dayDetailBusy = false;
  realLegs = new Map();
  realLegPending = false;
  lastSavedSig = '';
  currentTrip = null;
  basecamp = null;
  staySegments = [];
  activeDestArrivalAirport = null;
  activeDestArrivalTime = null;
  activeDestArrivalLat = null;
  activeDestArrivalLng = null;
  activeDestArrivalPhoto = null;
  activeDestArrivalRating = null;
  activeDestDepartureAirport = null;
  activeDestDepartureTime = null;
  activeDestDepartureLat = null;
  activeDestDepartureLng = null;
  activeDestDeparturePhoto = null;
  activeDestDepartureRating = null;
  activeDestAiPlanNotes = null;
  candidatePlaces = [];
  placeById = new Map();
  days = [];
  activeDayId = '';
  dayRangeStartDate = null;
  panelCollapsed = false;
  leftPanelCollapsed = false;
  showCostInKRW = false;
  highlightedPlaceId = null;
  hoveredPlaceId = null;
  adhocMode = false;
  placeSearchQuery = '';
  searchResultPlaces = [];
  searchBusy = false;
  activeCatFilters = new Set();
  historyByDay = new Map();
  memoStore.clear();
  timeOverride.clear();
  legModeOverride.clear();
  lodgingRevisitPurpose.clear();
  mapInstance = null;
  mapMarkers = [];
  routePolylines = [];
  stopInfoPanelEl = null;
  placeCardOverlay = null;
  placeCardPlaceId = null;
  rtContainer = null;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * 두 지점 사이의 이동 leg — 공용 추정기(utils/travelEstimate)에 이 화면이 들고 있는
 * 실측 캐시(realLegs)를 얹어서 호출한다.
 */
function estimateLegWithOverride(a: Place, b: Place, override?: Leg['mode']): Leg {
  return estimateLegBetween(
    { lat: a.lat!, lng: a.lng! },
    { lat: b.lat!, lng: b.lng! },
    override,
    realLegs.get(legKey(a.id, b.id))
  );
}

function modeIcon(mode: Leg['mode']): string {
  return mode === 'WALK' ? IC_WALK : mode === 'TRANSIT' ? IC_TRANSIT : IC_TAXI;
}

/* ── 카테고리(방문 유형) → 색상·아이콘 ── */
function categoryMeta(p: Place, isBasecamp: boolean): { key: CatKey; color: string; icon: string } {
  const isAirport = p.id === arrivalAirportId() || p.id === departureAirportId();
  const key = catKeyFor(p.mood, p.category, { isBasecamp, isAirport });
  return { key, color: CAT_COLOR[key], icon: CAT_ICON[key] };
}

/* ── 현재 활성 DAY / 순서대로 이어진 정류지(출발 숙소 포함) ── */
function activeDay(): RouteDay {
  return days.find((d) => d.id === activeDayId) ?? days[0];
}

/** 출발 숙소 + 그날 방문 장소들을 순서대로 (지도 마커/leg 계산의 기준) */
function orderedStops(day: RouteDay): Place[] {
  ensureDayAnchors(day);
  return day.stopIds.map((id) => placeById.get(id)).filter((p): p is Place => !!p);
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
  const arrivalId = arrivalAirportId();
  const departureId = departureAirportId();
  const stops: StoredStop[] = day.stopIds.map((id) => {
    const p = placeById.get(id);
    const idx = seq.findIndex((s) => s.id === id);
    const prev = idx > 0 ? seq[idx - 1] : null;
    // 공항 앵커/숙소 재방문도 실제 places 테이블 행이 없는 합성 Place라 adhoc과 같은 방식
    // (customName/lat/lng)으로 저장한다 — 그래야 place_id FK 없이도 route_stops에 들어갈 수 있다.
    const isAdhoc = id.startsWith('adhoc-') || isRevisitId(id) || id === arrivalId || id === departureId;
    return {
      placeId: isAdhoc ? null : id,
      customName: isAdhoc ? p?.name ?? '직접 추가한 장소' : null,
      customLat: isAdhoc ? p?.lat ?? null : null,
      customLng: isAdhoc ? p?.lng ?? null : null,
      arriveTime: timeOverride.get(timeKey(day.id, id)) ?? null,
      memo: memoStore.get(id) || null,
      travelMode: prev ? legModeOverride.get(legKey(prev.id, id)) ?? null : null,
      purpose: lodgingRevisitPurpose.get(id) ?? null,
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
    // 앵커(숙소/공항)도 이제 sd.stops 안에 실제 위치 그대로 저장돼 있으므로, 예전처럼
    // basecamp로 prevId를 미리 부트스트랩할 필요 없이 저장된 순서를 그대로 따라가면 된다.
    let prevId: string | null = null;

    sd.stops.forEach((s) => {
      let id: string | null = null;
      if (s.placeId) {
        if (placeById.has(s.placeId)) id = s.placeId;
      } else if (s.customLat != null && s.customLng != null) {
        // 도착 공항(DAY 0의 첫 정류지) / 출발 공항(마지막 DAY의 끝 정류지)인지 이름+좌표로
        // 확인 — 맞으면 고정 id의 앵커 Place로 복원(일반 adhoc 핀처럼 취급하면 안 됨: 좌측
        // 후보 목록에 뜨거나, 다음 렌더에서 ensureDayAnchors가 중복으로 또 만들어 버림).
        const isArrivalMatch =
          sd.dayIndex === 0 &&
          s.customName === activeDestArrivalAirport &&
          s.customLat === activeDestArrivalLat &&
          s.customLng === activeDestArrivalLng;
        const isDepartureMatch =
          sd.dayIndex === days.length - 1 &&
          s.customName === activeDestDepartureAirport &&
          s.customLat === activeDestDepartureLat &&
          s.customLng === activeDestDepartureLng;

        if (isArrivalMatch && arrivalAirportPlace()) {
          id = arrivalAirportId();
        } else if (isDepartureMatch && departureAirportPlace()) {
          id = departureAirportId();
        } else if (s.purpose) {
          // "숙소 들르기"로 저장된 재방문 지점 — purpose가 있는 건 이 종류뿐이라(일반 adhoc
          // 핀/공항은 항상 null) 좌표 매칭 없이 purpose 유무만으로 확실히 구분된다.
          const base = makeAdhocPlace(s.customName || '숙소', s.customLat, s.customLng);
          const p = makeRevisitPlace(base, s.purpose);
          placeById.set(p.id, p);
          id = p.id;
        } else {
          // 지도에 직접 찍었던 일반 지점 복원
          const p = makeAdhocPlace(s.customName || '직접 추가한 장소', s.customLat, s.customLng);
          placeById.set(p.id, p);
          candidatePlaces.push(p);
          id = p.id;
        }
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

/** 새 장소를 추가할 때 무조건 맨 끝에 붙이지 않고, 그 DAY의 "끝 정류지"(숙소/공항 앵커)
 * 바로 앞에 끼워 넣는다 — 앵커 위치는 고정이 아니라 사용자가 드래그하면 자유롭게 옮길 수
 * 있지만, 그냥 장소를 추가하는 것만으로 이미 자리잡은 끝 앵커를 마지막 자리에서 밀어내는
 * 건 자연스럽지 않다는 피드백 반영("장소를 추가하면 자연스럽게 첫 숙소와 끝 숙소 사이에
 * 들어가고, 수동으로 옮길 때만 옮겨지게"). 끝 앵커가 아직 stopIds에 없으면(처음 추가하는
 * 경우 등) 그냥 끝에 붙인다. */
function appendStopBeforeEndAnchor(day: RouteDay, placeId: string): void {
  const dayIndex = days.findIndex((d) => d.id === day.id);
  const { startId, endId } = dayAnchorIds(dayIndex);
  // 시작=끝이 같은 앵커(전환 없는 보통 날)면 그 하나뿐인 앵커 자체가 "끝" 자리를 겸하므로,
  // 굳이 앞에 끼울 필요 없이 그냥 맨 끝에 붙이면 이미 앵커 뒤(=시작과 끝 사이)에 놓인다.
  // 앵커가 시작/끝으로 서로 다른 두 개일 때만(DAY1의 공항→숙소, 전환일의 숙소A→숙소B 등)
  // 뒤쪽 앵커 바로 앞에 끼워 넣어야 한다.
  if (!endId || endId === startId) { day.stopIds.push(placeId); return; }
  const endIdx = day.stopIds.indexOf(endId);
  if (endIdx === -1) { day.stopIds.push(placeId); return; }
  day.stopIds.splice(endIdx, 0, placeId);
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
    group_id: null,
    group_name: null,
    group_order: null,
    price_note: null,
    is_excluded: false,
    price_per_night: null,
    price_currency: null,
    room_condition: null,
    excluded_reason: null,
    linked_url: null,
    linked_url_title: null,
  };
}

/* ── "숙소 들르기" — 하루 중간에 숙소로 되돌아오는 지점(짐 두기 등) ──
 * 실제 candidatePlaces에 없는 합성 Place라, id를 'revisit-'로 구분해 adhoc과 같은 방식
 * (place_id 없이 좌표만)으로 저장한다. 좌표는 그 순간 기준 숙소와 동일해 이동시간 계산이
 * 실제 거리로 정확히 되고, 이름도 숙소 이름을 그대로 써서 지도/타임라인에서 "그 숙소"임을
 * 바로 알아볼 수 있게 한다. */
const REVISIT_PREFIX = 'revisit-';
let revisitSeq = 0;
function isRevisitId(id: string): boolean {
  return id.startsWith(REVISIT_PREFIX);
}
function makeRevisitPlace(basecampPlace: Place, purpose: string): Place {
  revisitSeq += 1;
  const id = REVISIT_PREFIX + Date.now() + '-' + revisitSeq;
  const p: Place = { ...basecampPlace, id };
  lodgingRevisitPurpose.set(id, purpose);
  return p;
}

/** 구글 검색 결과 1건을 지도에 임시로 찍을 Place로 변환 — google_place_id가 있는 "진짜"
 * 장소라 makeAdhocPlace(이름만 있는 가짜 핀)와 다르다. Brainstorm에 담기 전까지만 쓰는
 * 임시 id('search-'+place_id)라 담고 나면 실제 DB row의 id로 교체된다. */
function googleResultToPlace(g: GooglePlaceResult): Place {
  return {
    id: 'search-' + (g.place_id || Date.now() + '-' + Math.random().toString(36).slice(2)),
    trip_id: currentTripId,
    name: g.name,
    lat: g.lat,
    lng: g.lng,
    address: g.address,
    photo_url: g.photoUrl,
    category: g.category,
    notes: null,
    added_by: null,
    created_at: new Date().toISOString(),
    likes_count: 0,
    google_place_id: g.place_id,
    google_rating: g.rating,
    photo_ref: null,
    opening_hours: g.openingHours,
    mood: null,
    status: 'idea',
    is_idea: false,
    sort_order: 0,
    destination_id: null,
    group_id: null,
    group_name: null,
    group_order: null,
    price_note: null,
    is_excluded: false,
    price_per_night: null,
    price_currency: null,
    room_condition: null,
    excluded_reason: null,
    linked_url: null,
    linked_url_title: null,
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

/** shortlist 확정 결과(숙소 + 확정 장소들)를 이어받아 초기 상태 구성 */
async function buildFromShortlist(trip: Trip, places: Place[]): Promise<void> {
  placeById = new Map(places.map((p) => [p.id, p]));

  const dests = await loadDestinations(trip);
  allDestinations = dests;
  const activeDest = resolveActiveDestination(trip.id, dests);
  activeDestId = activeDest && !isSyntheticDestination(activeDest.id) ? activeDest.id : null;
  activeDestName = activeDest?.name ?? '';
  activeDestArrivalAirport = activeDest?.arrival_airport ?? null;
  activeDestArrivalTime = activeDest?.arrival_time ?? null;
  activeDestArrivalLat = activeDest?.arrival_lat ?? null;
  activeDestArrivalLng = activeDest?.arrival_lng ?? null;
  activeDestArrivalPhoto = activeDest?.arrival_photo_url ?? null;
  activeDestArrivalRating = activeDest?.arrival_rating ?? null;
  activeDestDepartureAirport = activeDest?.departure_airport ?? null;
  activeDestDepartureTime = activeDest?.departure_time ?? null;
  activeDestDepartureLat = activeDest?.departure_lat ?? null;
  activeDestDepartureLng = activeDest?.departure_lng ?? null;
  activeDestDeparturePhoto = activeDest?.departure_photo_url ?? null;
  activeDestDepartureRating = activeDest?.departure_rating ?? null;
  activeDestAiPlanNotes = activeDest?.ai_plan_notes ?? null;
  const segments = activeDest ? await loadStaySegments(trip, activeDest) : [];
  const seg = activeDest ? resolveActiveSegment(activeDest.id, segments) : null;
  // 날짜 순으로 정렬해 둬야 basecampForDay()가 dayIndex 순서와 맞게 구간을 찾는다
  staySegments = [...segments].sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''));

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
  // DAY 개수 = 숙박 일수 + 1 — 마지막 날(체크아웃/출국하는 날)도 "시작 숙소 → 마지막 공항"으로
  // 이동하는 실제 하루라 그 자체가 DAY여야 한다. nights만 쓰면 그 마지막 날이 통째로 빠져서
  // (예: 26~30일, 4박인데 DAY1~4까지만 생기고 30일이 아예 안 잡히는) 버그가 있었다.
  const dayCount = Math.max(2, Math.min(nights, 10) + 1);

  // 이 여행지 앞에 다른 여행지가 있으면(날짜순) 그만큼 DAY 번호를 밀어서, 여행 전체 기준으로
  // 이어지는 번호를 보여준다(예: 방콕 DAY1~3 다음 푸켓은 DAY4부터). 날짜가 비어 있는 여행지가
  // 섞여 있어도(아직 계획 중) 에러 없이 1일치로 계산해 넘어간다.
  dayNumberOffset = activeDestId ? dayNumberOffsetFor(dests, activeDestId, trip) : 0;

  days = Array.from({ length: dayCount }, (_, i) => ({
    id: 'day-' + (i + 1),
    label: 'DAY ' + (dayNumberOffset + i + 1),
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
    if (!res.ok) {
      // 실패해도 화면은 조용히 추정치를 유지하지만(원칙), 원인 진단을 위해 콘솔에는 남긴다 —
      // 서버 함수 로그(Vercel)는 사용자가 못 보므로, 흔한 원인(키 미설정/Routes API 미활성화)을
      // 여기서 바로 확인할 수 있게 응답 본문까지 찍는다.
      console.error('[Route] /api/route-matrix 실패:', res.status, await res.text().catch(() => ''));
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
    if (!got) {
      console.warn('[Route] /api/route-matrix가 응답은 했지만 실측 구간이 0개 — 키/Routes API 활성화/요금제를 확인하세요.', json);
    }
    if (got && rtContainer) {
      renderRightPanel(rtContainer);
      drawRouteOnMap(false);
    }
  } catch (e) {
    console.error('[Route] /api/route-matrix 요청 자체가 실패(네트워크/CORS 등):', e);
  } finally {
    realLegPending = false;
    setLegLoading(container, false);
  }
}

function setLegLoading(container: HTMLElement, on: boolean): void {
  const el = container.querySelector('#rt-legs-loading') as HTMLElement | null;
  if (el) el.style.display = on ? '' : 'none';
  const btn = container.querySelector('#rt-legs-real-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = on;
}

/** dayIndex(0-based)의 실제 캘린더 날짜(YYYY-MM-DD). 시작일을 모르면 null */
function dayDateISO(dayIndex: number): string | null {
  if (!dayRangeStartDate) return null;
  const d = new Date(dayRangeStartDate);
  d.setDate(d.getDate() + dayIndex);
  return d.toISOString().slice(0, 10);
}

function dayDateLabel(dayIndex: number): string {
  if (!dayRangeStartDate) return '';
  const d = new Date(dayRangeStartDate);
  d.setDate(d.getDate() + dayIndex);
  const week = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return (d.getMonth() + 1) + '.' + String(d.getDate()).padStart(2, '0') + ' (' + week + ')';
}

/**
 * 이 DAY(dayIndex, 0-based)에 실제로 묵는 숙소 — 숙소를 여러 구간으로 나눈 여행이면
 * (예: 앞 3박은 A호텔, 뒤 2박은 B호텔) 구간마다 다른 숙소를 반환한다.
 * 구간이 하나뿐이거나 날짜를 못 찾으면 대표 basecamp로 안전하게 폴백한다.
 * ⚠️ ROUTE 화면과 AI 일정 짜기 양쪽 다 "그날의 출발지"를 구할 땐 반드시 이 함수를 써야
 *    한다 — 예전엔 global `basecamp` 하나만 써서 숙소를 나눠도 첫 구간 호텔에 계속
 *    머무는 것처럼 동선이 짜였던 버그가 있었다.
 */
function basecampForDay(dayIndex: number): Place | null {
  if (staySegments.length <= 1) return basecamp;
  const dateISO = dayDateISO(dayIndex);
  // ⚠️ end_date는 "체크아웃 날짜"라 다음 구간의 start_date와 같은 값을 공유한다(숙소 나누기가
  // 그렇게 저장함 — shortlist.ts의 splitSegmentToRange 참고). 그래서 end_date를 <=로 포함시키면
  // 두 구간이 그 경계일 하루를 동시에 "내 날짜"라고 주장하게 되고, 날짜순 정렬된 배열에서
  // find()는 항상 앞(체크아웃하는 쪽) 구간을 먼저 찾아버려 — 실제로는 그날 밤 새 숙소로
  // 옮겼는데도 전날 숙소가 계속 뜨는 버그가 났었다. end_date는 그 날짜를 포함하지 않는(<)
  // 것으로 봐야 경계일이 "체크인하는 새 구간" 쪽으로 정확히 붙는다.
  const seg = dateISO
    ? staySegments.find((s) => s.start_date && s.end_date && dateISO >= s.start_date && dateISO < s.end_date)
    : null;
  // 어느 구간에도 안 걸리는 날짜는(=마지막 구간의 end_date, 즉 짐 싸서 나가는 출국일 자체)
  // "그 전날 밤을 보낸 마지막 숙소"로 보는 게 맞다 — staySegments[0](첫 구간)으로 폴백하면
  // 출국일에 엉뚱하게 여행 첫 숙소가 나와버린다.
  const id = (seg ?? staySegments[staySegments.length - 1])?.basecamp_place_id ?? null;
  if (!id) return basecamp;
  return placeById.get(id) ?? basecamp;
}

/**
 * 이 DAY를 "시작하는" 숙소 — basecampForDay(그 밤을 보낼 숙소)와는 다른 개념이다.
 * 숙소를 나눈 여행에서 체크아웃하는 날은, 그날 시작은 전날 밤 묵었던 숙소이고 끝은
 * 새로 옮긴 숙소라야 한다(예: A[26~27), B[27~29)일 때 27일은 시작=A, 끝=B).
 * 오늘 날짜에 end_date가 걸리는 구간(=오늘 체크아웃하는 구간)이 있으면 그 숙소가 "시작"이고,
 * 없으면(체크아웃이 없는 보통의 날) 오늘 묵는 숙소와 동일하다.
 */
function startHotelForDay(dayIndex: number): Place | null {
  if (staySegments.length <= 1) return basecamp;
  const dateISO = dayDateISO(dayIndex);
  if (dateISO) {
    const checkoutSeg = staySegments.find((s) => s.end_date === dateISO);
    if (checkoutSeg?.basecamp_place_id) {
      return placeById.get(checkoutSeg.basecamp_place_id) ?? basecamp;
    }
  }
  return basecampForDay(dayIndex);
}

/* ══════════════ 공항 정류지(DAY 1 도착 / 마지막 DAY 출발) ══════════════ */

/** 공항 이름/좌표로 실제 Place 객체를 만든다 — 지도에 그리고 이동시간을 계산할 수 있도록
 * makeAdhocPlace와 같은 모양이지만, id가 destination당 고정이라 매 렌더마다 새로 생기지 않는다.
 * 사진/평점은 자동완성에서 실제로 고른 뒤 getPlaceDetails로 받아온 값을 그대로 넘겨받는다
 * (원칙 3-1 — 실측 없이 지어내지 않고, 없으면 그냥 null로 둔다). */
function makeAnchorPlace(
  id: string,
  name: string,
  lat: number,
  lng: number,
  photoUrl: string | null = null,
  rating: number | null = null
): Place {
  return {
    id,
    trip_id: currentTripId,
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
    price_note: null,
    is_excluded: false,
    price_per_night: null,
    price_currency: null,
    room_condition: null,
    excluded_reason: null,
    linked_url: null,
    linked_url_title: null,
  };
}

function arrivalAirportId(): string | null {
  return activeDestId ? 'arrival-airport:' + activeDestId : null;
}
function departureAirportId(): string | null {
  return activeDestId ? 'departure-airport:' + activeDestId : null;
}

/** 좌표까지 있어야(=자동완성에서 실제로 골랐어야) 진짜 정류지로 취급한다 */
function arrivalAirportPlace(): Place | null {
  const id = arrivalAirportId();
  if (!id || !activeDestArrivalAirport || activeDestArrivalLat == null || activeDestArrivalLng == null) return null;
  const cur = placeById.get(id);
  if (cur && cur.name === activeDestArrivalAirport && cur.lat === activeDestArrivalLat && cur.lng === activeDestArrivalLng) return cur;
  const p = makeAnchorPlace(id, activeDestArrivalAirport, activeDestArrivalLat, activeDestArrivalLng, activeDestArrivalPhoto, activeDestArrivalRating);
  placeById.set(id, p);
  return p;
}

function departureAirportPlace(): Place | null {
  const id = departureAirportId();
  if (!id || !activeDestDepartureAirport || activeDestDepartureLat == null || activeDestDepartureLng == null) return null;
  const cur = placeById.get(id);
  if (cur && cur.name === activeDestDepartureAirport && cur.lat === activeDestDepartureLat && cur.lng === activeDestDepartureLng) return cur;
  const p = makeAnchorPlace(id, activeDestDepartureAirport, activeDestDepartureLat, activeDestDepartureLng, activeDestDeparturePhoto, activeDestDepartureRating);
  placeById.set(id, p);
  return p;
}

/** 이 DAY(dayIndex, 0-based)의 시작/끝 정류지 id — DAY1 시작은 공항(있으면)·아니면 그날 시작
 * 숙소, 마지막 DAY 끝은 출발 공항(있으면)·아니면 그날 묵는 숙소. 숙소를 나눈 여행에서 그날
 * 체크아웃/체크인이 겹치면(예: 26~27 A호텔, 27~29 B호텔일 때 27일) 시작=A, 끝=B로 서로
 * 다르게 나온다 — startHotelForDay/basecampForDay 참고. */
function dayAnchorIds(dayIndex: number): { startId: string | null; endId: string | null } {
  const isFirstDay = dayIndex === 0;
  const isLastDay = dayIndex === days.length - 1;
  const startHotel = startHotelForDay(dayIndex);
  const endHotel = basecampForDay(dayIndex);
  const startPlace = isFirstDay ? arrivalAirportPlace() ?? startHotel : startHotel;
  const endPlace = isLastDay ? departureAirportPlace() ?? endHotel : endHotel;
  return { startId: startPlace?.id ?? null, endId: endPlace?.id ?? null };
}

/**
 * day.stopIds에 그 DAY의 시작/끝 정류지가 없으면 채워 넣는다. 이미 있으면(사용자가 순서를
 * 옮겨놨어도) 손대지 않는다 — "고정은 아니고 자유롭게 재배치 가능"이라는 요구사항 때문에,
 * 매번 강제로 맨 앞/맨 뒤로 되돌리지 않고 "빠져 있을 때만" 채워 넣는 최소 개입만 한다.
 * 순서를 다시 양 끝으로 고정하고 싶을 땐 optimizedOrder()(순서 정리 버튼)를 쓴다.
 */
function ensureDayAnchors(day: RouteDay): void {
  const dayIndex = days.findIndex((d) => d.id === day.id);
  if (dayIndex < 0) return;
  const { startId, endId } = dayAnchorIds(dayIndex);

  if (startId && !day.stopIds.includes(startId)) day.stopIds.unshift(startId);

  // 끝 지점은 시작과 "다른 곳"일 때만 따로 넣는다(DAY1: 공항→숙소, 마지막 DAY: 숙소→공항).
  // 시작=끝이 같은 숙소인 보통의 DAY는 방문지가 몇 곳이든 굳이 두 번 보여줄 필요가 없다
  // — 어차피 "그 숙소에서 하루를 보낸다"는 의미는 한 번만 있어도 충분히 전달된다.
  if (endId && endId !== startId && !day.stopIds.includes(endId)) {
    day.stopIds.push(endId);
  }

  // DAY1 공항의 초기 도착 시각을 한 번 심어둔다(이미 사용자가 손으로 바꿔놨으면 덮어쓰지 않음)
  if (dayIndex === 0 && startId && startId === arrivalAirportId() && activeDestArrivalTime) {
    const key = timeKey(day.id, startId);
    if (!timeOverride.has(key)) timeOverride.set(key, activeDestArrivalTime);
  }
  if (dayIndex === days.length - 1 && endId && endId === departureAirportId() && activeDestDepartureTime) {
    const key = timeKey(day.id, endId);
    if (!timeOverride.has(key)) timeOverride.set(key, activeDestDepartureTime);
  }
}

/** p가 이 dayIndex 기준 "숙소(시작/끝 앵커)"인지 — 위치와 무관하게 정체성으로 판단.
 * 체크아웃/체크인이 겹치는 날은 시작 숙소와 끝 숙소가 서로 다를 수 있어 둘 다 확인한다. */
function isBasecampPlace(p: Place, dayIndex: number): boolean {
  const endBc = basecampForDay(dayIndex);
  if (endBc && p.id === endBc.id) return true;
  const startBc = startHotelForDay(dayIndex);
  return !!startBc && p.id === startBc.id;
}
/** p가 공항 앵커(도착/출발 어느 쪽이든)인지 */
function isAirportAnchorPlace(p: Place): boolean {
  return p.id === arrivalAirportId() || p.id === departureAirportId();
}
/** p가 이 DAY의 시작/끝 앵커(숙소든 공항이든) 중 하나인지 — 삭제 금지 판정에 사용 */
function isAnyAnchor(p: Place, dayIndex: number): boolean {
  return isBasecampPlace(p, dayIndex) || isAirportAnchorPlace(p);
}

/* ══════════════════ 메인 렌더 ══════════════════ */

export async function renderRouteContent(container: HTMLElement, tripId: string): Promise<void> {
  teardownRoute();
  currentTripId = tripId;
  rtContainer = container;

  container.innerHTML = '<div class="rt-loading"><span class="rt-loading-spinner"></span>동선 준비 중...</div>';

  const [trip, places] = await Promise.all([loadTrip(tripId), loadPlaces(tripId)]);
  currentTrip = trip;
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
      '    <div class="rt-empty-hint">STAY에서 숙소를 여행의 중심으로 확정하면, 그 숙소를 출발점으로 하루 동선을 만들 수 있어요.</div>',
      '    <button type="button" class="rt-empty-btn" id="rt-go-shortlist">' + IC_ARROW + ' STAY로 이동</button>',
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

  // 새로고침/탭 닫기로 화면이 완전히 사라질 땐 teardownRoute가 안 불려서, 대기 중인
  // scheduleSave 디바운스(600ms)가 그대로 날아갈 수 있다 — 이 근처 검색으로 담은 장소가
  // 새로고침하면 사라지던 버그가 이 케이스. 언로드 시점에 디바운스를 건너뛰고 즉시 저장을 건다.
  beforeUnloadHandler = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      void persistActiveDay();
    }
  };
  window.addEventListener('beforeunload', beforeUnloadHandler);

  // 같은 트립을 보고 있는 다른 멤버의 변경을 실시간으로 반영
  subscribeRoutePlan(tripId, () => { void reloadFromRemote(); });
  // 실제 경로(Route Matrix API)는 더 이상 자동으로 부르지 않는다 — API 비용을 줄이려고
  // "실제 경로 보기"를 눌렀을 때만 호출한다(estimateNoteHtml의 버튼 참고).
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
    '      <div class="rt-searchbox" id="rt-searchbox-top" title="지도에 실제 장소를 검색해서 핀으로 찍어요 · Enter로 검색">' +
      IC_SEARCH +
      '<input type="text" id="rt-search-top" placeholder="지도에서 장소 검색 (Enter)" />' +
      '<button type="button" class="rt-searchbox-clear" id="rt-search-top-clear" title="검색결과 지우기" hidden>✕</button>' +
      '</div>',
    '      <button type="button" class="rt-iconbtn" id="rt-undo" title="실행 취소 · Ctrl+Z" aria-label="실행 취소" disabled>' + IC_UNDO + '</button>',
    '      <button type="button" class="rt-iconbtn" id="rt-redo" title="다시 실행 · Ctrl+Shift+Z" aria-label="다시 실행" disabled>' + IC_REDO + '</button>',
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
  bindSearchInputs(container);
  bindUndoRedoButtons(container);
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

  // 좌측 패널 접기/펼치기 토글은 bindSearchInputs가 함께 바인딩한다(검색창 옆에 붙어 있어서).

  if (escHandler) document.removeEventListener('keydown', escHandler);
  escHandler = (e: KeyboardEvent) => {
    // 입력 중일 땐 단축키를 가로채지 않음 (메모/시간/검색 입력을 방해하지 않도록)
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

    if (e.key === 'Escape') {
      // 명시적 해제 수단 — 열린 카드 → 즉석추가 모드 → 선택 강조 순으로 하나씩 되돌린다
      if (placeCardOverlay) { closePlaceCard(); return; }
      if (adhocMode) { setAdhocMode(container, false); return; }
      if (highlightedPlaceId) {
        highlightedPlaceId = null;
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
        // 숙소/공항 앵커는 매일 자동으로 채워지므로 "채워짐" 표시엔 실제로 담은 곳만 센다
        const realCount = d.stopIds.filter((id) => {
          const p = placeById.get(id);
          return p && !isAnyAnchor(p, i);
        }).length;
        const filled = realCount > 0;
        const color = dayColorFor(i);
        return [
          i > 0 ? '<span class="rt-daytab-line" aria-hidden="true"></span>' : '',
          '<button type="button" class="rt-daytab' + (active ? ' active' : '') + '" data-day="' + d.id + '"' +
            ' aria-current="' + (active ? 'true' : 'false') + '"' +
            (active ? ' style="border-color:' + color + '"' : '') +
            ' title="' + escapeHtml(d.label) + (filled ? ' · 장소 ' + realCount + '곳' : ' · 비어 있음') + '">',
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
      searchResultPlaces = []; // 검색 결과는 보던 DAY 맥락에 딸린 임시 상태라 전환 시 비움
      refreshAll(container, { refit: true });
    });
  });
  el.querySelector('#rt-day-add')?.addEventListener('click', () => {
    const n = days.length + 1;
    days.push({ id: 'day-' + n, label: 'DAY ' + (dayNumberOffset + n), stopIds: [] });
    activeDayId = 'day-' + n;
    searchResultPlaces = [];
    refreshAll(container, { refit: true });
  });
}

/* ── 좌측 플로팅 검색 패널(내 Brainstorm 목록 필터 — 그대로 유지) ── */
function bindSearchInputs(container: HTMLElement): void {
  const floatInput = container.querySelector('#rt-float-search-input') as HTMLInputElement | null;
  floatInput?.addEventListener('input', () => {
    placeSearchQuery = floatInput.value;
    renderLeftPanel(container);
  });
  bindTopSearch(container);

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

/* ── 우상단 지도 장소 검색 — Brainstorm 목록 필터가 아니라 실제 구글 장소를 지도에 찍는다.
 * 타이핑마다가 아니라 Enter로 제출했을 때만 호출한다(Text Search는 Autocomplete보다
 * 건당 요금이 높다). ── */
function bindTopSearch(container: HTMLElement): void {
  const input = container.querySelector('#rt-search-top') as HTMLInputElement | null;
  const clearBtn = container.querySelector('#rt-search-top-clear') as HTMLElement | null;
  if (!input) return;
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      void runMapPlaceSearch(input.value, container);
    }
  });
  clearBtn?.addEventListener('click', () => clearSearchResults(container));
}

function updateSearchClearButton(container: HTMLElement): void {
  const clearBtn = container.querySelector('#rt-search-top-clear') as HTMLElement | null;
  if (clearBtn) clearBtn.hidden = searchResultPlaces.length === 0;
}

function clearSearchResults(container: HTMLElement): void {
  if (searchResultPlaces.length === 0) return;
  searchResultPlaces = [];
  updateSearchClearButton(container);
  drawRouteOnMap(false);
}

/** 지도 화면 기준으로 실제 장소를 검색해 결과를 지도 위에 임시 핀으로 찍는다(공용 검색
 * 파이프라인 — "이 근처 검색"도 이 함수가 반환하는 결과를 그대로 재사용한다). */
async function runMapPlaceSearch(query: string, container: HTMLElement): Promise<void> {
  const q = query.trim();
  if (!q || searchBusy || !mapInstance) return;
  searchBusy = true;
  const box = container.querySelector('#rt-searchbox-top');
  box?.classList.add('is-busy');
  try {
    const bounds = typeof mapInstance.getBounds === 'function' ? mapInstance.getBounds() : undefined;
    const results = await searchPlacesByText(q, bounds);
    searchResultPlaces = results.map(googleResultToPlace);
    if (searchResultPlaces.length === 0) window.alert('검색 결과가 없어요. 다른 검색어로 시도해보세요.');
  } finally {
    searchBusy = false;
    box?.classList.remove('is-busy');
    updateSearchClearButton(container);
    drawRouteOnMap(false);
  }
}

/** 검색 결과(또는 근처검색 결과) 핀의 "일정에 추가" — 실제 places 행으로 저장해서
 * Brainstorm에도 자동 반영되고, 동시에 지금 보고 있는 DAY의 동선(끝 앵커 바로 앞)에도
 * 바로 들어간다. 새로고침 없이 그 자리에서 일반 정류지 핀으로 전환된다. */
async function addSearchResultToDay(p: Place, container: HTMLElement, cacheSource: string): Promise<void> {
  if (!currentTripId) return;
  const g: GooglePlaceResult = {
    place_id: p.google_place_id ?? '',
    name: p.name,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    rating: p.google_rating,
    category: p.category,
    photoUrl: p.photo_url,
    openingHours: p.opening_hours as string[] | null,
  };
  // 검색 결과 핀은 임시로 Google 원본 사진 URL을 그대로 보여주지만(재호스팅은 비용이 드니
  // 실제로 담을 때만), 여기서 실제 저장하기 전에는 반드시 우리 Storage로 재호스팅해야
  // photo_url이 API 키가 박힌 원본 URL로 영구 저장돼 이미지를 볼 때마다 Google에 요청이
  // 나가는(그리고 언젠가 만료되는) 문제를 피할 수 있다.
  if (g.photoUrl) g.photoUrl = await rehostPhoto(g.photoUrl, g.place_id);
  const mood = suggestGateFromCategory(p.category);
  const result = await insertGooglePlace(currentTripId, activeDestId ?? undefined, mood, g, cacheSource);
  if (!result) {
    window.alert('장소를 담는 데 실패했어요. 잠시 후 다시 시도해주세요.');
    return;
  }
  searchResultPlaces = searchResultPlaces.filter((sp) => sp.id !== p.id);
  // 방금 담은 곳이 세션 캐시엔 여전히 "검색 결과"로 남아있어 같은 검색을 다시 하면 이미
  // 동선에 있는 곳이 또 뜰 수 있다 — 캐시된 모든 결과 목록에서도 함께 제거.
  nearbySearchCache.forEach((list, key) => {
    const next = list.filter((sp) => sp.id !== p.id);
    if (next.length !== list.length) nearbySearchCache.set(key, next);
  });
  placeById.set(result.place.id, result.place);
  if (!candidatePlaces.some((cp) => cp.id === result.place.id)) candidatePlaces.push(result.place);
  pushHistory();
  appendStopBeforeEndAnchor(activeDay(), result.place.id);
  closePlaceCard();
  refreshAll(container, { refit: false });
  // refreshAll이 내부에서 scheduleSave()를 걸지만, 그건 600ms 디바운스라 저장이 끝나기 전에
  // 새로고침하면 유실될 수 있다(beforeunload로 디바운스를 건너뛰어도, 브라우저가 진짜로
  // 페이지를 새로고침하는 순간 진행 중이던 네트워크 요청 자체가 취소돼 소용없었다 — 이 함수는
  // "검색해서 찾은 곳을 담는다"는 명확한 단발성 액션이라, 여기서만큼은 디바운스를 건너뛰고
  // 바로 기다려서 반환 전에 DB 반영을 확정한다.
  await persistActiveDay();
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
      appendStopBeforeEndAnchor(d, id);
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

function bindUndoRedoButtons(container: HTMLElement): void {
  container.querySelector('#rt-undo')?.addEventListener('click', () => doUndo(container));
  container.querySelector('#rt-redo')?.addEventListener('click', () => doRedo(container));
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
      activeDestId
        ? '<div class="rt-options-divider"></div><button type="button" id="rt-opt-switch-dest">' + IC_SWAP + ' 여행지 변경</button>'
        : '',
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
    menu.querySelector('#rt-opt-switch-dest')?.addEventListener('click', () => {
      menu.remove();
      openRouteDestSwitcher(container, btn);
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

/** "N박 · 10.26–11.01" — Board/Shortlist의 여행지 변경 목록과 같은 형식 */
function destMetaLabel(d: TripDestination): string {
  if (!d.start_date || !d.end_date) return '';
  const s = new Date(d.start_date);
  const e = new Date(d.end_date);
  const nights = Math.max(0, Math.round((e.getTime() - s.getTime()) / 86400000));
  const fmt = (dt: Date) => dt.getMonth() + 1 + '.' + dt.getDate();
  return (nights > 0 ? nights + '박 · ' : '') + fmt(s) + '–' + fmt(e);
}

/** "여행지 변경" 드롭다운 — Board/Shortlist와 같은 목적(전환만, 추가/편집/삭제는 없음).
 *  고르면 이 여행지의 candidatePlaces/basecamp/DAY가 전부 새로 바뀌므로, 부분 갱신 대신
 *  renderRouteContent를 처음부터 다시 돌려 안전하게 새로 그린다. */
function openRouteDestSwitcher(container: HTMLElement, anchor: HTMLElement): void {
  document.querySelectorAll('.rt-dest-switcher').forEach((el) => el.remove());

  const items = allDestinations
    .filter((d) => !isSyntheticDestination(d.id))
    .map((d) => {
      const active = d.id === activeDestId;
      const meta = destMetaLabel(d);
      return [
        '<button type="button" class="rt-dest-switch-item' + (active ? ' active' : '') + '" data-dest-id="' + d.id + '">',
        '  <span class="rt-dest-switch-plane">' + IC_PLANE + '</span>',
        '  <span class="rt-dest-switch-text">',
        '    <span class="rt-dest-switch-name">' + escapeHtml(d.name) + '</span>',
        meta ? '    <span class="rt-dest-switch-meta">' + escapeHtml(meta) + '</span>' : '',
        '  </span>',
        active ? '  <span class="rt-dest-switch-check">' + IC_CHECK + '</span>' : '',
        '</button>',
      ].join('');
    })
    .join('');

  const pop = document.createElement('div');
  pop.className = 'rt-dest-switcher';
  pop.innerHTML = '<div class="rt-dest-switch-title">여행지 변경</div><div class="rt-dest-switch-list">' + items + '</div>';
  document.body.appendChild(pop);

  const r = anchor.getBoundingClientRect();
  const popW = 220;
  pop.style.top = r.bottom + 8 + 'px';
  pop.style.left = Math.max(12, r.right - popW) + 'px';

  pop.querySelectorAll('.rt-dest-switch-item').forEach((b) => {
    b.addEventListener('click', () => {
      const id = (b as HTMLElement).dataset.destId;
      pop.remove();
      if (!id || id === activeDestId || !currentTripId) return;
      setActiveDestinationId(currentTripId, id);
      void renderRouteContent(container, currentTripId);
    });
  });

  const dismiss = (ev: MouseEvent) => {
    if (!pop.contains(ev.target as Node) && ev.target !== anchor) {
      pop.remove();
      document.removeEventListener('mousedown', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

function toggleSatellite(): void {
  if (!mapInstance) return;
  const g = (window as any).google;
  const current = mapInstance.getMapTypeId();
  mapInstance.setMapTypeId(current === g.maps.MapTypeId.HYBRID ? g.maps.MapTypeId.ROADMAP : g.maps.MapTypeId.HYBRID);
}

/* ── 지도 위 핀 클릭 — 활성 툴에 따라 다르게 동작 ── */
function handlePinClick(g: any, p: Place): void {
  const activeDayIndex = days.findIndex((d) => d.id === activeDayId);
  const isAnchor = isAnyAnchor(p, activeDayIndex); // 숙소 또는 공항(도착/출발) — 삭제 금지 대상
  closePlaceCard();
  // "이 근처 검색" 결과 핀은 그 검색을 실행한 장소의 정보 패널에 딸린 임시 상태라,
  // 다른 장소를 클릭해 컨텍스트가 바뀌면 함께 지운다(계속 남아있으면 어디서 검색한 건지 헷갈림).
  if (p.id !== highlightedPlaceId) searchResultPlaces = [];

  // 아직 담지 않은 후보는 핀 옆 정보 카드(사진/평점/담기 버튼)를 보여줘 담을지 결정하게 하고,
  // 이미 오늘 동선에 들어간(확정된) 정류지는 핀 옆 카드 대신 우상단 고정 패널에 같은 정보 +
  // 앞뒤로 이어지는 두 구간의 이동시간/비용을 함께 보여준다
  // (drawRouteOnMap이 highlightedPlaceId를 보고 채워 넣음 — updateStopInfoPanel 참고).
  const alreadyIncluded = isAnchor || activeDay().stopIds.includes(p.id);
  highlightedPlaceId = p.id;
  hoveredPlaceId = null;
  if (g?.maps) {
    showRipple(g, p, AERO_BLUE);
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

// 구간(화살표/커넥터) 클릭은 이제 정보 패널을 띄우지 않는다 — 이동시간/비용 확인은 장소를
// 클릭하는 쪽으로 옮겨갔다(장소를 누르면 그 장소와 이어지는 두 구간이 함께 뜬다). 구간을
// 직접 누르면 언제나 이동수단을 바로 바꿀 수 있다.
function handleLegClick(fromId: string, toId: string, anchor?: HTMLElement): void {
  openModeOverridePopover(legKey(fromId, toId), anchor);
}

/** ROUTE의 이동수단 ↔ 구글맵 travelmode 파라미터 매핑 */
function gmTravelMode(mode: Leg['mode']): string {
  return mode === 'WALK' ? 'walking' : mode === 'TRANSIT' ? 'transit' : 'driving';
}

/** 두 지점 사이를 구글맵 경로 화면으로 여는 링크 — 출발/도착이 자동으로 채워진 채 열린다.
 *  좌표만 있으면 되므로(장소 자체를 조회하지 않음) 추가 API 호출이 들지 않는다. */
function googleMapsDirUrl(from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: Leg['mode']): string {
  return (
    'https://www.google.com/maps/dir/?api=1&origin=' + from.lat + ',' + from.lng +
    '&destination=' + to.lat + ',' + to.lng + '&travelmode=' + gmTravelMode(mode)
  );
}

function openModeOverridePopover(key: string, anchor?: HTMLElement): void {
  document.querySelectorAll('.rt-mode-popover').forEach((el) => el.remove());
  const cur = legModeOverride.get(key);
  const measured = realLegs.get(key);

  // "구글맵에서 경로 보기" — 지금 화면에 쓰는(override가 있으면 그것, 없으면 자동 선택된)
  // 이동수단 그대로 구글맵 경로 화면을 연다. 좌표만 있으면 되니 API 호출은 추가로 들지 않는다.
  const [fromId, toId] = key.split('>');
  const fromPlace = placeById.get(fromId);
  const toPlace = placeById.get(toId);
  const gmUrl =
    fromPlace?.lat != null && fromPlace?.lng != null && toPlace?.lat != null && toPlace?.lng != null
      ? googleMapsDirUrl(
          { lat: fromPlace.lat, lng: fromPlace.lng },
          { lat: toPlace.lat, lng: toPlace.lng },
          estimateLegWithOverride(fromPlace, toPlace, cur).mode
        )
      : null;

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
    gmUrl
      ? '<div class="rt-mode-popover-divider"></div><a class="rt-mode-popover-gmaps" href="' + gmUrl +
        '" target="_blank" rel="noopener noreferrer">' + IC_EXTLINK + ' 구글맵에서 경로 보기</a>'
      : '',
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
 * 여행지 이름(사용자가 직접 입력한 도시명, 예: "방콕", "프라하")으로 현지 통화를 추정 —
 * 실측 요금이 아직 없는 추정 구간의 통화 폴백에 쓴다. 국가별 공식 통화(ISO 4217)는 실제
 * 사실 데이터라 원칙 3-1(지어내지 않기)에 어긋나지 않는다 — 예전엔 이 폴백이 무조건
 * THB(태국)였는데, 방콕이 아닌 다른 여행지에서도 늘 THB로 나오던 버그의 원인이었다.
 * 목록에 없는 도시는 임의로 특정 나라를 짚어 맞추지 않고 USD로 무난하게 폴백한다.
 */
const DEST_CURRENCY_KEYWORDS: Array<[string[], string]> = [
  [['방콕', '파타야', '푸켓', '치앙마이', '끄라비', '태국', 'bangkok', 'phuket', 'thailand'], 'THB'],
  [['도쿄', '오사카', '교토', '삿포로', '후쿠오카', '오키나와', '나고야', '일본', 'tokyo', 'osaka', 'japan'], 'JPY'],
  [['다낭', '하노이', '호치민', '나트랑', '호이안', '푸꾸옥', '베트남', 'vietnam'], 'VND'],
  [['프라하', '체코', 'prague', 'czech'], 'CZK'],
  [
    ['파리', '로마', '베를린', '뮌헨', '바르셀로나', '마드리드', '암스테르담', '비엔나', '빈', '밀라노', '피렌체', '베네치아',
      '리스본', '아테네', '더블린', '브뤼셀', '독일', '프랑스', '이탈리아', '스페인', '포르투갈', '오스트리아', '그리스', '네덜란드', '아일랜드'],
    'EUR',
  ],
  [['런던', '영국', 'london'], 'GBP'],
  [['뉴욕', '라스베가스', '로스앤젤레스', '샌프란시스코', '하와이', '괌', '미국', 'new york', 'usa'], 'USD'],
  [['타이베이', '타이페이', '가오슝', '대만', 'taipei', 'taiwan'], 'TWD'],
  [['홍콩', 'hong kong'], 'HKD'],
  [['상하이', '베이징', '광저우', '청두', '시안', '중국', 'china'], 'CNY'],
  [['싱가포르', 'singapore'], 'SGD'],
  [['쿠알라룸푸르', '코타키나발루', '페낭', '말레이시아', 'malaysia'], 'MYR'],
  [['발리', '자카르타', '인도네시아', 'bali', 'indonesia'], 'IDR'],
  [['세부', '마닐라', '보라카이', '팔라완', '필리핀', 'philippines'], 'PHP'],
  [['시드니', '멜버른', '브리즈번', '호주', 'sydney', 'australia'], 'AUD'],
  [['오클랜드', '퀸스타운', '뉴질랜드', 'new zealand'], 'NZD'],
  [['두바이', '아부다비', 'dubai'], 'AED'],
  [['취리히', '제네바', '스위스', 'zurich', 'switzerland'], 'CHF'],
  [['토론토', '밴쿠버', '캐나다', 'toronto', 'vancouver', 'canada'], 'CAD'],
  [['델리', '뭄바이', '인도', 'india'], 'INR'],
];
function guessCurrencyForDestination(name: string | null): string {
  if (!name) return 'USD';
  const n = name.toLowerCase();
  const hit = DEST_CURRENCY_KEYWORDS.find(([keywords]) => keywords.some((k) => n.includes(k.toLowerCase())));
  return hit?.[1] ?? 'USD';
}

/**
 * 화면에 쓸 통화 코드. 실측 대중교통 요금이 오면 그 통화를 그대로 쓰고(여행지가 어디든 정확),
 * 없으면 이 여행지 이름으로 추정한 현지 통화로 폴백한다.
 */
function currencyOf(legs: Leg[]): string {
  const withFare = legs.find((l) => l.fare?.currency);
  return withFare?.fare?.currency ?? guessCurrencyForDestination(activeDestName);
}

// "예상 교통비 원화로 보기" 토글 — 켜져 있으면 fmtCost가 캐시된 환율로 원화 환산해 보여준다.
let showCostInKRW = false;
const krwRateCache = new Map<string, number>();
const krwRateFetchInFlight = new Set<string>();

/** currency→KRW 환율을 백그라운드로 받아와 캐시하고, 도착하면 패널을 다시 그린다.
 * 이미 캐시됐거나 요청 중이면 아무것도 안 함(중복 호출 방지). */
function ensureKrwRate(currency: string): void {
  if (currency === 'KRW' || krwRateCache.has(currency) || krwRateFetchInFlight.has(currency)) return;
  krwRateFetchInFlight.add(currency);
  fetch('/api/exchange-rate?from=' + encodeURIComponent(currency))
    .then((res) => res.json())
    .then((data) => {
      if (typeof data?.rate === 'number' && data.rate > 0) {
        krwRateCache.set(currency, data.rate);
        if (showCostInKRW && rtContainer) renderRightPanel(rtContainer);
      }
    })
    .catch((e) => console.error('[Route] 환율 조회 실패:', (e as Error).message))
    .finally(() => krwRateFetchInFlight.delete(currency));
}

function fmtCost(amount: number, currency: string): string {
  if (showCostInKRW && currency !== 'KRW') {
    const rate = krwRateCache.get(currency);
    if (rate != null) return Math.round(amount * rate).toLocaleString() + '원';
  }
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
  const allReal = realCount === legs.length;

  // 실제 경로(Route Matrix)는 더 이상 자동으로 안 부르고, 이 버튼을 눌렀을 때만 호출한다
  // (API 비용 절감) — 아직 하나라도 추정치인 구간이 남아있으면 계속 보여준다.
  const realBtn = allReal
    ? ''
    : ' <button type="button" class="rt-legs-real-btn" id="rt-legs-real-btn">실제 경로 보기</button>';
  const loadingSpan = '<span id="rt-legs-loading" style="display:none">실제 경로 확인 중… </span>';

  if (realCount === 0) {
    return loadingSpan + '* 직선거리 기반 추정치예요' + realBtn;
  }
  const base =
    allReal
      ? '* 이동시간·거리는 실제 경로 기준'
      : '* 이동시간·거리는 일부만 실제 경로 기준 (' + realCount + '/' + legs.length + '), 나머지는 추정치';
  const costNote = hasTaxi || fareEstimated ? ', 요금은 추정치' : '';
  return loadingSpan + base + costNote + '예요' + realBtn;
}

/* ── 시간 계산 (수동 오버라이드가 있으면 그 시각을 기준으로 이어서 계산) ── */
function timeKey(dayId: string, placeId: string): string {
  return dayId + '|' + placeId;
}

function computeStopTimes(day: RouteDay, stops: Place[], legs: Leg[]): string[] {
  const times: string[] = [];
  const dayIndex = days.findIndex((d) => d.id === day.id);
  // 공항이 이 DAY의 시작 정류지면 ensureDayAnchors()가 이미 도착 시각을 그 정류지의
  // timeOverride로 심어뒀으므로, 여기서는 특별 취급 없이 09:00 기본값 + 아래 override
  // 루프만으로 자연스럽게 처리된다(공항→숙소 구간도 일반 leg 계산을 그대로 탐).
  let clockMin = 9 * 60;
  stops.forEach((p, i) => {
    const isBasecamp = isBasecampPlace(p, dayIndex);
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
  // 숙소/공항 앵커는 매일 자동으로 붙는 출발·도착점이라 "몇 곳을 방문하는지"엔 세지 않는다
  // (안 그러면 실제로는 아무 데도 안 담았는데 앵커 때문에 1곳으로 잡혀 버튼들이 잘못 활성화됨)
  const dayIndex = days.findIndex((d) => d.id === day.id);
  const visitCount = day.stopIds.filter((id) => {
    const p = placeById.get(id);
    return p && !isAnyAnchor(p, dayIndex);
  }).length;
  return { totalMin, totalCost, legCount: legs.length, visitCount };
}

/** 최근접 이웃 재정렬로 총 이동시간을 얼마나 줄일 수 있는지 계산 */
/**
 * "순서 정리" — 이 DAY의 시작/끝 정류지(숙소 또는 공항)는 그대로 양 끝에 고정하고,
 * 그 사이의 실제 방문지들만 최근접 이웃 방식으로 재배열한다. 평소엔 앵커도 자유롭게
 * 재배치할 수 있지만(ensureDayAnchors는 "빠져 있을 때만" 채워 넣음), 이 버튼을 누른
 * 순간만은 명시적으로 다시 양 끝으로 고정한다.
 */
function optimizedOrder(day: RouteDay): { order: string[]; totalMin: number } {
  const dayIndex = days.findIndex((d) => d.id === day.id);
  const { startId, endId } = dayAnchorIds(dayIndex);
  const pts = orderedStops(day).filter((p) => p.lat != null && p.lng != null);
  if (pts.length <= 2) {
    return { order: [...day.stopIds], totalMin: computeDaySummary(day).totalMin };
  }

  const startPt = (startId ? placeById.get(startId) : null) ?? pts[0];
  const endPt = endId && endId !== startPt.id ? placeById.get(endId) ?? null : null;
  const middle = pts.filter((p) => p.id !== startPt.id && (!endPt || p.id !== endPt.id));

  const used = new Set<number>();
  const orderedMiddleIds: string[] = [];
  let cur = startPt;
  let totalMin = 0;
  for (let k = 0; k < middle.length; k++) {
    let best = -1;
    let bestKm = Infinity;
    for (let i = 0; i < middle.length; i++) {
      if (used.has(i)) continue;
      const km = haversineKm(cur.lat!, cur.lng!, middle[i].lat!, middle[i].lng!);
      if (km < bestKm) {
        bestKm = km;
        best = i;
      }
    }
    used.add(best);
    const leg = estimateLegWithOverride(cur, middle[best]);
    totalMin += leg.min;
    orderedMiddleIds.push(middle[best].id);
    cur = middle[best];
  }
  if (endPt) {
    totalMin += estimateLegWithOverride(cur, endPt).min;
  }

  const order = [startPt.id, ...orderedMiddleIds, ...(endPt ? [endPt.id] : [])];
  return { order, totalMin };
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

/**
 * 이 여행지의 숙소 구간을 dayIndex 기준으로 압축한다 — 숙소가 안 나뉘어 있으면 구간 1개,
 * 나뉘어 있으면(예: DAY1~3은 A호텔, DAY4~6은 B호텔) 바뀌는 지점마다 구간을 새로 끊는다.
 * AI에게 "언제 어느 숙소에 묵는지"를 알려줘야 그 구간에 맞는 동선을 짜고, 숙소를 옮기는
 * 날 무리하게 첫 숙소 쪽으로 되돌아가는 동선을 안 짠다.
 */
function buildAiStaySegments(): AiStaySegment[] {
  const segs: Array<{ startDayIndex: number; endDayIndex: number; place: Place | null }> = [];
  for (let i = 0; i < days.length; i++) {
    const place = basecampForDay(i);
    const last = segs[segs.length - 1];
    if (last && (last.place?.id ?? null) === (place?.id ?? null)) {
      last.endDayIndex = i;
    } else {
      segs.push({ startDayIndex: i, endDayIndex: i, place });
    }
  }
  return segs.map((s) => ({
    startDayIndex: s.startDayIndex,
    endDayIndex: s.endDayIndex,
    basecamp: s.place ? toAiPlace(s.place) : null,
  }));
}

/** AI가 짠 일정을 모듈 상태에 반영. 반환값은 실제로 배치된 장소 수 */
function applyAiRoutePlan(result: AiRoutePlanResult): number {
  const seen = new Set<string>();

  // 전체 DAY를 새로 짜는 것이므로 기존 배치·도착시각·수동 이동수단은 비운다.
  // (장소별 메모는 장소에 딸린 사용자 기록이라 그대로 둔다 — 그 장소가 새 일정에도 남으면 계속 보인다)
  days.forEach((d) => { d.stopIds = []; });
  timeOverride.clear();
  legModeOverride.clear();

  result.days.forEach((rd) => {
    const day = days[rd.dayIndex];
    if (!day) return;
    // 숙소를 나눈 여행은 DAY마다 기준 숙소가 다를 수 있어(basecampForDay), "그날의" 숙소만 걸러낸다.
    // 공항은 애초에 AI에게 태그(P숫자)로 주어지지 않으므로 s.placeId로 나올 일이 없다.
    const dayBasecampId = basecampForDay(rd.dayIndex)?.id ?? null;
    rd.stops.forEach((s) => {
      // 서버가 이미 걸렀지만, 그 사이 장소가 지워졌을 수도 있으니 화면 기준으로 한 번 더 확인
      if (!placeById.has(s.placeId) || s.placeId === dayBasecampId || seen.has(s.placeId)) return;
      seen.add(s.placeId);
      day.stopIds.push(s.placeId);
      if (s.arriveTime) timeOverride.set(timeKey(day.id, s.placeId), s.arriveTime);
    });
  });

  // AI는 이 DAY의 시작/끝 앵커(숙소/공항)를 모르므로, 여기서 다시 채워 넣는다
  // (도착 공항의 초기 도착시각도 ensureDayAnchors가 이 시점에 함께 심어준다).
  days.forEach((d) => ensureDayAnchors(d));

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
  // 숙소/공항 앵커만 있고 실제로 담은 곳이 하나도 없으면 "이미 짜둔 동선"으로 치지 않는다
  // (안 그러면 완전히 빈 트립에서도 앵커 때문에 항상 확인창이 떠서 불필요하게 성가심)
  const hasExisting = days.some((d, i) => d.stopIds.some((id) => {
    const p = placeById.get(id);
    return p && !isAnyAnchor(p, i);
  }));
  if (hasExisting && !window.confirm('지금까지 담은 모든 DAY의 동선을 AI 추천으로 바꿀까요?\n도착 시각과 직접 지정한 이동수단도 함께 초기화돼요. (적용 후 "되돌리기"로 지금 상태로 복구할 수 있어요)')) {
    return;
  }

  aiPlanBusy = true;
  aiPlanProgressLabel = null;
  aiPlanNotice = null;
  aiPlanUndo = null;
  renderRightPanel(container);
  updateAiPlanButton(container);

  try {
    const result = await requestRoutePlan(
      {
        destinationId: activeDestId,
        destinationName: activeDestName || currentTrip?.name || '',
        dayCount: days.length,
        startDate: dayRangeStartDate,
        staySegments: buildAiStaySegments(),
        arrivalAirport: activeDestArrivalAirport,
        arrivalTime: activeDestArrivalTime,
        departureAirport: activeDestDepartureAirport,
        departureTime: activeDestDepartureTime,
        places: candidatePlaces.filter((p) => p.lat != null && p.lng != null).map((p) => toAiPlace(p)),
        planNotes: activeDestAiPlanNotes,
      },
      (done, total) => {
        aiPlanProgressLabel = done <= 1 ? '전체 그림 짜는 중…' : 'Day ' + (done - 1) + '/' + (total - 1) + ' 짜는 중…';
        updateAiPlanButton(container);
      }
    );

    // 반영하기 **전에** 쓸 만한 결과인지 먼저 확인한다 — 먼저 지우고 나서 판단하면
    // 결과가 비었을 때 기존 동선만 날아간다. (DAY마다 숙소가 다를 수 있어 그날 기준으로 판단)
    const planned = result.days.reduce((n, d) => {
      const dayBasecampId = basecampForDay(d.dayIndex)?.id ?? null;
      return n + d.stops.filter((s) => placeById.has(s.placeId) && s.placeId !== dayBasecampId).length;
    }, 0);
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
    aiPlanProgressLabel = null;
    refreshAll(container, { refit: true });
    updateAiPlanButton(container);
  }
}

/** 진행 상황 콜백처럼 패널 전체를 다시 그리긴 아까운 잦은 갱신은 이 버튼만 따로 갱신한다
 *  (버튼은 renderRightPanel이 그리는 패널 안에 있지만, 매 진행 단계마다 패널 전체를 다시
 *  그리면 rows 재계산 등 불필요한 비용이 들어서 버튼 노드만 직접 건드린다). */
function updateAiPlanButton(container: HTMLElement): void {
  const btn = container.querySelector('#rt-ai-plan') as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = aiPlanBusy;
  btn.classList.toggle('is-busy', aiPlanBusy);
  btn.innerHTML = aiPlanBusy
    ? '<span class="rt-ai-spinner"></span><span>' + escapeHtml(aiPlanProgressLabel ?? '일정 짜는 중…') + '</span>'
    : IC_SPARK + '<span>AI 일정 짜기</span>';
}

/**
 * "AI 일정 짜기" 버튼을 누르면 실제 실행 전에 이 모달이 먼저 뜬다 — 여행 니즈/요청사항을
 * 자유 텍스트로 적을 수 있는 칸 하나(예: "휴양 위주로 여유롭게", "1일차는 밤 늦게 도착하니
 * 쉬는 날로", "마사지는 저녁에"). 원문 그대로 모든 프롬프트에 전달되고(원칙 3-1 — 우리가
 * 해석/가공하지 않음), 여행지에 저장되어 다음에 다시 열어도 남아있다.
 */
function openAiPlanNotesModal(container: HTMLElement): void {
  if (aiPlanBusy) return;
  if (!activeDestId) {
    window.alert('여행지를 먼저 선택해 주세요.');
    return;
  }
  if (candidatePlaces.length < 2) {
    window.alert('AI가 일정을 짜려면 Brainstorm에서 분류한 장소가 2곳 이상 필요해요.');
    return;
  }

  document.querySelector('.rt-ai-modal-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'rt-ai-modal-backdrop';
  backdrop.innerHTML = [
    '<div class="rt-ai-modal rt-ai-notes-modal" role="dialog" aria-modal="true" aria-label="AI 일정 짜기 요청사항">',
    '  <div class="rt-ai-modal-head">',
    '    <div><div class="rt-ai-modal-eyebrow">AI 일정 짜기</div>',
    '    <div class="rt-ai-modal-title">여행 니즈나 요청사항이 있나요?</div></div>',
    '    <button type="button" class="rt-ai-modal-close" id="rt-ai-notes-close" aria-label="닫기">✕</button>',
    '  </div>',
    '  <div class="rt-ai-modal-body">',
    '    <div class="rt-ai-notes-hint">비워둬도 괜찮아요. 적어두면 AI가 매번 그대로 참고해요 —' +
      ' 예) "휴양 위주로 여유롭게", "1일차는 밤 늦게 도착하니 쉬는 날로", "마사지는 저녁에 가고 싶어"</div>',
    '    <textarea class="rt-ai-notes-input" id="rt-ai-notes-input" rows="4" placeholder="예: 아이 동반이라 낮잠 시간이 필요해요. 맛집 위주로 다니고 싶어요.">' +
      escapeHtml(activeDestAiPlanNotes ?? '') +
      '</textarea>',
    '  </div>',
    '  <div class="rt-ai-notes-actions">',
    '    <button type="button" class="rt-ai-notes-cancel" id="rt-ai-notes-cancel">취소</button>',
    '    <button type="button" class="rt-ai-notes-start" id="rt-ai-notes-start">' + IC_SPARK + ' 일정 짜기 시작</button>',
    '  </div>',
    '</div>',
  ].join('\n');

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };

  backdrop.querySelector('#rt-ai-notes-close')?.addEventListener('click', close);
  backdrop.querySelector('#rt-ai-notes-cancel')?.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);

  backdrop.querySelector('#rt-ai-notes-start')?.addEventListener('click', () => {
    const textarea = backdrop.querySelector('#rt-ai-notes-input') as HTMLTextAreaElement;
    const notes = textarea.value.trim().slice(0, 1000);
    activeDestAiPlanNotes = notes || null;
    if (activeDestId) void updateDestination(activeDestId, { ai_plan_notes: activeDestAiPlanNotes });
    close();
    void runAiRoutePlan(container);
  });

  document.body.appendChild(backdrop);
  (backdrop.querySelector('#rt-ai-notes-input') as HTMLTextAreaElement)?.focus();
}

/** 자주 쓰는 목적 프리셋 — 눌러서 바로 고르고, 없는 목적은 아래 입력칸에 직접 적는다 */
const LODGING_REVISIT_PRESETS: Array<{ label: string; icon: string }> = [
  { label: '짐 두기', icon: IC_BED },
  { label: '휴식', icon: IC_SOFA },
  { label: '옷 갈아입기', icon: IC_HANGER },
  { label: '샤워', icon: IC_SHOWER },
];
const LODGING_REVISIT_MAXLEN = 40;

/** "숙소 들르기" 목적 입력 모달 — 확정하면 그 순간 기준 이 DAY의 숙소를 목적지로 하는
 *  재방문 스탑을 만들어 끝 앵커 바로 앞에 끼워 넣는다(appendStopBeforeEndAnchor와 동일한
 *  자리 규칙 — "장소 추가"와 똑같이 자연스럽게 시작/끝 숙소 사이에 들어감). */
function openLodgingRevisitModal(container: HTMLElement): void {
  const day = activeDay();
  const dayIndex = days.findIndex((d) => d.id === day.id);
  const lodging = basecampForDay(dayIndex);
  if (!lodging) return;

  // 프리셋 칩 선택(눌러서 고르기)과 직접 입력은 서로 배타적 — 하나를 쓰면 다른 쪽 선택은 풀린다.
  let selectedPreset: string | null = LODGING_REVISIT_PRESETS[0].label;

  document.querySelector('.rt-ai-modal-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'rt-ai-modal-backdrop';
  backdrop.innerHTML = [
    '<div class="rt-ai-modal rt-revisit-modal" role="dialog" aria-modal="true" aria-label="숙소 들르기">',
    '  <div class="rt-ai-modal-head">',
    '    <div><div class="rt-ai-modal-eyebrow">' + escapeHtml(lodging.name) + '</div>',
    '    <div class="rt-ai-modal-title">잠깐 들르는 목적이 뭔가요?</div></div>',
    '    <button type="button" class="rt-ai-modal-close" id="rt-revisit-close" aria-label="닫기">✕</button>',
    '  </div>',
    '  <div class="rt-ai-modal-body">',
    '    <div class="rt-revisit-presets">',
    LODGING_REVISIT_PRESETS.map(
      (p, i) =>
        '<button type="button" class="rt-revisit-chip' + (i === 0 ? ' active' : '') + '" data-purpose="' + escapeHtml(p.label) + '">' +
        '<span class="rt-revisit-chip-icon">' + p.icon + '</span><span>' + escapeHtml(p.label) + '</span></button>'
    ).join(''),
    '    </div>',
    '    <label class="rt-revisit-field-label" for="rt-revisit-input">직접 입력 (선택)</label>',
    '    <div class="rt-revisit-input-row">',
    '      <input type="text" class="rt-revisit-input" id="rt-revisit-input" placeholder="예) 짐 보관 후 시내 관광" maxlength="' + LODGING_REVISIT_MAXLEN + '" />',
    '      <span class="rt-revisit-counter" id="rt-revisit-counter">0/' + LODGING_REVISIT_MAXLEN + '</span>',
    '    </div>',
    '  </div>',
    '  <div class="rt-revisit-actions">',
    '    <button type="button" class="rt-revisit-cancel" id="rt-revisit-cancel">취소</button>',
    '    <button type="button" class="rt-revisit-confirm" id="rt-revisit-start">확인</button>',
    '  </div>',
    '</div>',
  ].join('\n');

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  const input = () => backdrop.querySelector('#rt-revisit-input') as HTMLInputElement;
  const counter = () => backdrop.querySelector('#rt-revisit-counter') as HTMLElement;

  backdrop.querySelector('#rt-revisit-close')?.addEventListener('click', close);
  backdrop.querySelector('#rt-revisit-cancel')?.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);

  backdrop.querySelectorAll('.rt-revisit-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      selectedPreset = (chip as HTMLElement).dataset.purpose ?? null;
      backdrop.querySelectorAll('.rt-revisit-chip').forEach((c) => c.classList.toggle('active', c === chip));
      input().value = '';
      counter().textContent = '0/' + LODGING_REVISIT_MAXLEN;
    });
  });

  input().addEventListener('input', () => {
    if (input().value) {
      selectedPreset = null;
      backdrop.querySelectorAll('.rt-revisit-chip').forEach((c) => c.classList.remove('active'));
    }
    counter().textContent = input().value.length + '/' + LODGING_REVISIT_MAXLEN;
  });

  backdrop.querySelector('#rt-revisit-start')?.addEventListener('click', () => {
    const purpose = input().value.trim() || selectedPreset || LODGING_REVISIT_PRESETS[0].label;
    close();
    const p = makeRevisitPlace(lodging, purpose);
    placeById.set(p.id, p);
    pushHistory();
    appendStopBeforeEndAnchor(activeDay(), p.id);
    refreshAll(container, { refit: false });
    void persistActiveDay();
  });

  document.body.appendChild(backdrop);
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
  // 숙소/공항 앵커는 매일 자동으로 붙는 출발·도착점이라 "이 DAY에 담은 장소"에서는 제외하고 판단한다
  const stops = day.stopIds
    .map((id) => placeById.get(id))
    .filter((p): p is Place => !!p && !isAnyAnchor(p, dayIndex));
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
/**
 * 정류지가 된 공항의 ✕ 버튼 — 일반 삭제와 달리 stopIds에서 빼는 것만으론 부족하다(안 지우면
 * ensureDayAnchors가 다음 렌더에서 바로 다시 채워 넣음). 원본 도착/출발 정보 자체를 지운다.
 * 입국/출국은 이제 여행 생성/편집에서 입력하므로(ROUTE엔 입력 칸이 없음), 여기서 지우면
 * 다시 넣으려면 여행 편집으로 가야 한다.
 */
function clearAirportAnchor(id: string, container: HTMLElement): void {
  const isArrival = id === arrivalAirportId();
  const isDeparture = id === departureAirportId();
  if (!isArrival && !isDeparture) return;

  pushHistory();
  days.forEach((d) => {
    d.stopIds = d.stopIds.filter((sid) => sid !== id);
    timeOverride.delete(timeKey(d.id, id));
  });
  memoStore.delete(id);
  placeById.delete(id);

  if (isArrival) {
    activeDestArrivalAirport = null;
    activeDestArrivalTime = null;
    activeDestArrivalLat = null;
    activeDestArrivalLng = null;
    activeDestArrivalPhoto = null;
    activeDestArrivalRating = null;
    if (activeDestId) {
      void updateDestination(activeDestId, {
        arrival_airport: null, arrival_time: null, arrival_lat: null, arrival_lng: null,
        arrival_photo_url: null, arrival_rating: null,
      });
    }
  } else {
    activeDestDepartureAirport = null;
    activeDestDepartureTime = null;
    activeDestDepartureLat = null;
    activeDestDepartureLng = null;
    activeDestDeparturePhoto = null;
    activeDestDepartureRating = null;
    if (activeDestId) {
      void updateDestination(activeDestId, {
        departure_airport: null, departure_time: null, departure_lat: null, departure_lng: null,
        departure_photo_url: null, departure_rating: null,
      });
    }
  }
  refreshAll(container, { refit: true });
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
  if (showCostInKRW) ensureKrwRate(cur);
  const dColor = dayColorFor(Math.max(0, dayIndex));

  const rows: string[] = [];
  // 지도 핀(drawRouteOnMap)도 똑같은 stopIdentityColor를 쓰므로 색이 항상 서로 맞는다.
  stops.forEach((p, i) => {
    const isBasecamp = isBasecampPlace(p, dayIndex);
    const isAirport = isAirportAnchorPlace(p);
    const isAnchor = isBasecamp || isAirport; // 삭제는 금지하되, 순서는 자유롭게 바꿀 수 있음
    const revisitPurpose = lodgingRevisitPurpose.get(p.id) ?? null;
    const memo = memoStore.get(p.id) ?? '';
    const highlighted = p.id === highlightedPlaceId;
    const cardColor = revisitPurpose ? LODGING_REVISIT_COLOR : stopIdentityColor();

    const manualTime = timeOverride.has(timeKey(day.id, p.id));
    // 예상 체류시간(참고용 추정치) 대신, 그 시각에 실제로 도착하는 시각(HH:MM)을 보여준다 —
    // computeStopTimes가 앞선 정류지들의 체류·이동시간을 누적해 이미 계산해둔 값이라
    // 공항이든 숙소든 일반 방문지든 전부 같은 방식으로 편집 가능한 시각 입력으로 통일한다.
    const timeOrDwellHtml =
      '  <input type="text" class="rt-panel-time' + (manualTime ? ' is-manual' : '') + '" value="' + times[i] + '"' +
      ' data-place-id="' + p.id + '" inputmode="numeric" maxlength="5" spellcheck="false"' +
      ' aria-label="' + escapeHtml(p.name) + ' 도착 시각 (24시간 HH:MM)" />';
    rows.push(
      [
        // 앵커(숙소/공항)도 이제 순서를 자유롭게 바꿀 수 있다 — draggable="false"였던 고정을 풂.
        // "순서 정리" 버튼(optimizedOrder)을 누르면 그때만 다시 양 끝으로 고정된다.
        '<div class="rt-panel-stop' + (highlighted ? ' rt-highlighted' : '') + (revisitPurpose ? ' rt-panel-stop-revisit' : '') +
          '" draggable="true" data-place-id="' + p.id + '" title="드래그해서 순서 바꾸기">',
        revisitPurpose
          ? '  <span class="rt-panel-badge" style="background:' + LODGING_REVISIT_TINT + ';color:' + LODGING_REVISIT_COLOR + '">' + IC_LODGING + '</span>'
          : '  <span class="rt-panel-badge" style="background:' + AERO_BLUE_TINT + ';color:' + cardColor + '">' + (i + 1) + '</span>',
        '  <div class="rt-panel-name-col"><div class="rt-panel-name">' + escapeHtml(p.name) + '</div><div class="rt-panel-sub">' +
          escapeHtml(revisitPurpose ? '잠깐 들르기 · ' + revisitPurpose : p.category || (isBasecamp ? '숙소' : '')) + '</div></div>',
        timeOrDwellHtml,
        !isAnchor
          ? '  <button type="button" class="rt-panel-remove" data-place-id="' + p.id + '" title="동선에서 빼기" aria-label="' + escapeHtml(p.name) + ' 동선에서 빼기">✕</button>'
          : isAirport
          ? '  <button type="button" class="rt-panel-remove" data-place-id="' + p.id + '" data-clear-airport="true" title="공항 정보 지우기" aria-label="' + escapeHtml(p.name) + ' 공항 정보 지우기">✕</button>'
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
      // 지도에서 장소를 클릭하면 그 장소로 "들어오는" 구간만 강조되는 것과 같은 기준으로 맞춘다.
      const selected = highlightedPlaceId === stops[i + 1].id;
      const manual = legModeOverride.has(key);
      const extra = leg.costTHB > 0 ? fmtCost(leg.costTHB, cur) : (leg.mode === 'WALK' ? fmtKm(leg.km) : '무료');
      rows.push(
        [
          '<div class="rt-panel-connector ' + modeColorClass(leg.mode) + (selected ? ' rt-highlighted' : '') + '" data-leg-key="' + key + '"' +
            ' role="button" tabindex="0" title="교통수단 툴에서 눌러 이동수단 변경">',
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
    '  <button type="button" class="rt-panel-more" id="rt-panel-more" aria-label="이 DAY 메뉴">' + IC_DOTS + '</button>',
    '</div>',
    aiPlanNoticeHtml(),
    // 예전엔 여기가 공항 정보 입력 칸이었는데, 입국/출국은 이제 여행 생성/편집에서 미리
    // 받으므로(trips/trip-create.ts, trips/trip-edit.ts) 이 칸은 필요 없어졌고, 그 대신
    // 여러 DAY를 한 번에 바꾸는 "AI 일정 짜기"를 DAY 진입 직후 바로 보이는 자리로 옮겼다.
    '<button type="button" class="rt-ai-plan-btn rt-ai-plan-btn-panel" id="rt-ai-plan"' +
      (aiPlanBusy ? ' disabled' : '') +
      ' title="Brainstorm에 담은 장소들을 영업시간·인기 동선·이동 효율 순으로 DAY별 일정으로 배분해요">' +
      (aiPlanBusy
        ? '<span class="rt-ai-spinner"></span><span>' + escapeHtml(aiPlanProgressLabel ?? '일정 짜는 중…') + '</span>'
        : IC_SPARK + '<span>AI 일정 짜기</span>') +
      '</button>',
    '<div class="rt-panel-list" id="rt-panel-list">',
    stops.length
      // 숙소/공항 앵커만 있고 그 사이에 담은 곳이 없어도(예: 공항→숙소만 있는 여유로운 날,
      // 하루 종일 숙소에서 쉬는 날) 그 자체로 완결된 하루라 "아직 안 담았다"는 안내를 덧붙이지
      // 않는다 — 일부러 비워둔 걸 미완성처럼 취급하지 않기 위해.
      ? rows.join('')
      : [
          '<div class="rt-panel-empty">',
          '  <span class="rt-panel-empty-icon">' + IC_ROUTEPATH + '</span>',
          '  <div class="rt-panel-empty-title">아직 숙소가 확정되지 않았어요</div>',
          '  <div class="rt-panel-empty-hint">숙소를 먼저 정하면<br>이 DAY의 동선을 시작할 수 있어요.</div>',
          '</div>',
        ].join(''),
    '</div>',
    '<div class="rt-panel-summary">',
    '  <div class="rt-panel-summary-item"><div class="rt-panel-summary-label">총 이동시간</div><div class="rt-panel-summary-value">' + fmtMin(s.totalMin) + '</div></div>',
    '  <div class="rt-panel-summary-item"><div class="rt-panel-summary-label">총 이동거리</div><div class="rt-panel-summary-value">' + totalKm.toFixed(1) + 'km</div></div>',
    '  <div class="rt-panel-summary-item">' +
      '<div class="rt-panel-summary-label">예상 교통비' +
      '<button type="button" class="rt-cost-toggle' + (showCostInKRW ? ' active' : '') + '" id="rt-cost-toggle"' +
      ' title="' + (showCostInKRW ? '현지 통화(' + cur + ')로 보기' : '원화로 보기') + '" aria-pressed="' + showCostInKRW + '">₩</button>' +
      '</div>' +
      '<div class="rt-panel-summary-value">' + fmtCost(s.totalCost, cur) + '</div></div>',
    '</div>',
    // 원칙 3-1 — 실측/추정을 섞어 쓰므로 어느 쪽인지 반드시 구분해 표기
    '<div class="rt-panel-estimate-note">' + estimateNoteHtml(legs) + '</div>',
    '<div class="rt-panel-actions">',
    '  <button type="button" class="rt-panel-action" id="rt-panel-add-revisit"' +
      (basecampForDay(dayIndex) ? '' : ' disabled') +
      ' title="낮에 숙소에 짐을 두거나 쉬러 잠깐 들르는 것처럼, 하루 중간에 숙소로 돌아오는 지점을 추가해요">' +
      IC_LODGING + ' 숙소 들르기</button>',
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
  el.querySelector('#rt-ai-plan')?.addEventListener('click', () => openAiPlanNotesModal(container));
  el.querySelector('#rt-legs-real-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    void loadRealLegsForActiveDay(container);
  });
  el.querySelectorAll('.rt-panel-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.placeId!;
      const clearAirport = (btn as HTMLElement).dataset.clearAirport === 'true';
      if (clearAirport) {
        // 일반 정류지 삭제가 아니라 "공항 정보 자체를 지우기" — 안 지우면 ensureDayAnchors가
        // 다음 렌더에서 바로 다시 채워 넣으므로, 원본 도착/출발 정보부터 비워야 한다.
        clearAirportAnchor(id, container);
        return;
      }
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
  el.querySelector('#rt-cost-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showCostInKRW = !showCostInKRW;
    renderRightPanel(container);
  });
  el.querySelector('#rt-panel-add-revisit')?.addEventListener('click', () => openLodgingRevisitModal(container));
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
      // 숙소/공항 앵커도 이제 stopIds 안의 평범한 항목이라(자유 재배치 가능),
      // 어디에 있든 그 위치를 그대로 찾아서 앞에 꽂으면 된다 — 별도 특수 처리 불필요.
      const idx = day.stopIds.indexOf(targetId);
      day.stopIds.splice(idx === -1 ? day.stopIds.length : idx, 0, dragged);
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
  drawRouteOnMap(opts.refit);
  // 변경이 실제로 있을 때만 저장된다(지문 비교). 실제 경로는 여기서 자동으로 다시 불러오지
  // 않는다 — 장소를 추가/재배열할 때마다 Route Matrix API를 부르면 비용이 커지므로, 새로
  // 생긴 구간은 "실제 경로 보기"를 다시 눌러야 실측으로 채워진다(estimateNoteHtml 참고).
  scheduleSave();
}

/* ══════════════════ 지도 ══════════════════ */

/**
 * 핀·배지·리스트 강조색 — Aero Blue 한 가지로 통일. 이동수단 구분은 색이 아니라 캡슐
 * 배지의 아이콘/라벨과 모드 전환 노드가 담당한다.
 */
const AERO_BLUE = '#2F86D6';
// 리스트 배지 등 옅은 틴트 배경이 필요한 곳에서 쓰는, AERO_BLUE를 10% 불투명도로 깐 버전.
const AERO_BLUE_TINT = 'rgba(47,134,214,0.1)';
// "다음 장소"를 가리킬 때 쓰는 강조색 — 짙은 남색. 처음 시도한 값(#0B0F5C)이 남색보다
// 검정에 가까워 보인다는 피드백으로, 이 앱 전체에서 이미 쓰는 네이비(--rt-navy)로 교체.
const ROUTE_NEXT = '#0B2A5C';
const ROUTE_GRAY = '#9AA7B8';
// 동선(경로선) 색 — 지도가 구글 기본색(파란 물 포함)이라 핀과 같은 파랑을 쓰면 배경에
// 묻혀서, 핀은 계속 Aero Blue를 쓰고 "길" 자체만 Tangerine(주황)으로 분리했다.
const ROUTE_LINE_COLOR = '#F4801F';
// "숙소 들르기"(짐 두기 등 목적만 있는 재방문 스탑) 전용색 — 다른 어떤 카테고리/강조색과도
// 안 겹치는 바이올렛. 우측 패널 배지·타임라인 카드가 이 색 하나로 서로 짝을 맞춘다.
const LODGING_REVISIT_COLOR = '#7C5CFC';
const LODGING_REVISIT_TINT = 'rgba(124,92,252,0.12)';

/**
 * 지도 핀과 우측 패널 배지가 항상 같은 색을 쓰도록 하는 단일 기준 — "이 핀 = 이 카드"가
 * 색으로도 바로 연결되게 한다. 앵커(숙소/공항)든 일반 방문지든 평소(phase='plain') 상태는
 * 전부 AERO_BLUE 하나로 통일 — 진행 상태 강조(다음/지나옴)만 phaseColor가 다른 색을 얹는다.
 */
function stopIdentityColor(): string {
  return AERO_BLUE;
}
// 방향 화살표 대신 점선 자체로 "동선"임을 표현 — 모든 이동수단을 점선으로 통일했다.
// 두께는 항상 고정(줌 배율과 무관) — 이동수단 구분은 색이 아니라 캡슐 배지의
// 아이콘/라벨과 모드 전환 노드가 담당한다. 점선→실선으로 바꾸면서 실제 길찾기 사이트들이
// 흔히 쓰는 두께로 살짝 키움(2.6 → 3.5).
const MODE_STYLE: Record<Leg['mode'], { weight: number }> = {
  WALK: { weight: 3.5 },
  TRANSIT: { weight: 3.5 },
  TAXI: { weight: 3.5 },
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

  const initialBasecamp = basecampForDay(Math.max(0, days.findIndex((d) => d.id === activeDayId)));
  const center = initialBasecamp && initialBasecamp.lat != null
    ? { lat: initialBasecamp.lat, lng: initialBasecamp.lng! }
    : { lat: 13.74, lng: 100.53 };
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
  addStopInfoPanel(g, mapInstance);

  // 지도 빈 곳 클릭 = 장소 카드/강조 해제 (원칙 3-3 명시적 해제 수단)
  mapInstance.addListener('click', () => {
    if (placeCardOverlay) { closePlaceCard(); return; }
    if (highlightedPlaceId) {
      highlightedPlaceId = null;
      searchResultPlaces = []; // 이 근처 검색 핀은 특정 장소의 정보 패널에 딸린 임시 상태
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
    appendStopBeforeEndAnchor(activeDay(), p.id);
    refreshAll(rtContainer, { refit: true });
    // scheduleSave의 600ms 디바운스를 기다리다 새로고침하면 유실될 수 있어 바로 저장을 확정한다.
    void persistActiveDay();
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
 * 구글 기본 "지도/위성" 버튼(딱딱한 회색 UI)을 끄고, 상단 아이콘 버튼(.rt-iconbtn)과 같은
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

/**
 * 확정된(동선에 담긴) 장소를 클릭했을 때의 정보 안내 — 장소 사진/이름/평점/카테고리와,
 * 그 장소로 들어오고 나가는 두 구간의 이동시간/비용을 한 번에 보여준다. 지도 위 특정 지점에
 * 얹지 않고 우상단(지도/위성 버튼 아래)에 반투명 패널로 고정하고 내용만 바꿔 끼운다.
 */
function addStopInfoPanel(g: any, map: any): void {
  const wrap = document.createElement('div');
  wrap.className = 'rt-stopinfo';
  wrap.style.display = 'none';
  map.controls[g.maps.ControlPosition.RIGHT_TOP].push(wrap);
  stopInfoPanelEl = wrap;
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
}

/** 마커(숙소+후보) + 순서 폴리라인(모드별 스타일)을 다시 그림 — 이동시간/비용은 우하단 고정 패널에 */
function drawRouteOnMap(refit: boolean): void {
  const g = (window as any).google;
  if (!g?.maps || !mapInstance) return;
  clearMapOverlays();

  const day = activeDay();
  const stops = orderedStops(day).filter((p) => p.lat != null && p.lng != null);
  const legs = dayLegs(day);
  const mapCur = currencyOf(legs);
  const dayIndex = days.findIndex((d) => d.id === day.id);

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

  // 지도 검색/근처 검색 결과 — 아직 Brainstorm에도 없는 임시 핀(앰버 톤). clearMapOverlays가
  // 매 렌더마다 mapMarkers를 비우므로 이 배열도 매번 같이 다시 그려야 리드로우에도 안 사라짐.
  searchResultPlaces.forEach((p) => {
    if (p.lat == null || p.lng == null) return;
    const marker = buildSearchResultMarker(g, p);
    marker.addListener('click', () => openSearchResultCard(g, p, 'google_search'));
    mapMarkers.push(marker);
  });

  // 확정된(동선에 담긴) 장소를 클릭하면 정보 패널(사진/평점 + 앞뒤 두 구간)을 채운다.
  let stopInfoShown = false;

  // 오늘 동선의 정류지 — 순서 번호 + 정체성 색(평소) / 진행 상태 색(포커스 중일 때만)
  stops.forEach((p, i) => {
    const isBasecamp = isBasecampPlace(p, dayIndex);
    const baseColor = stopIdentityColor();
    // 어떤 장소를 클릭/호버하면 그 장소(current)와 바로 이전 정류지(adjacent)만 강조하고,
    // 나머지는 전부 회색으로 물러난다 — "그 장소로 가는 구간 + 이전 장소만" 강조라는 원칙.
    // 아무것도 선택하지 않았으면 각자의 정체성 색 그대로.
    let phase: StopPhase = 'plain';
    if (focusIdx >= 0) {
      if (i === focusIdx) phase = 'current';
      else if (i === focusIdx - 1) phase = 'adjacent';
      else phase = 'dimmed';
    }
    const marker = buildMarkerV2(g, p, {
      isBasecamp,
      included: true,
      num: i + 1,
      highlighted: p.id === focusId,
      phase,
      baseColor,
    });
    marker.addListener('click', () => handlePinClick(g, p));
    mapMarkers.push(marker);

    // 정보 패널은 반드시 클릭(highlightedPlaceId)에만 반응한다 — 호버(hoveredPlaceId)까지
    // 반응하면 타임라인 위에서 마우스를 움직일 때마다 패널이 깜빡여 예전에 겪은 문제가 재발한다.
    if (p.id === highlightedPlaceId) {
      stopInfoShown = true;
      updateStopInfoPanel(p, isBasecamp, legs[i - 1] ?? null, stops[i - 1] ?? null, legs[i] ?? null, stops[i + 1] ?? null, mapCur);
    }
  });
  if (!stopInfoShown && stopInfoPanelEl) stopInfoPanelEl.style.display = 'none';

  // 같은 구간이 여러 번 등장하면(같은 길 왕복 등) 겹쳐 보이지 않게 회차를 센다
  const seenLegs = new Map<string, number>();

  for (let i = 0; i < stops.length - 1; i++) {
    const leg = legs[i];
    // 방향이 반대여도 같은 선분이므로 정렬한 키로 겹침을 판단
    const geomKey = [stops[i].id, stops[i + 1].id].sort().join('~');
    const overlapIndex = seenLegs.get(geomKey) ?? 0;
    seenLegs.set(geomKey, overlapIndex + 1);

    // 이 구간이 포커스된 장소로 "들어오는" 구간이면(=stops[i+1]가 포커스) 강조,
    // 포커스가 있는데 이 구간이 아니면 회색으로 물러난다.
    const selected = focusIdx >= 0 && i + 1 === focusIdx;
    const dimmed = focusIdx >= 0 && !selected;
    const line = buildLegPolyline(g, stops[i], stops[i + 1], leg, { overlapIndex, selected, dimmed });
    line.addListener('click', () => handleLegClick(stops[i].id, stops[i + 1].id));
    routePolylines.push(line);

    // 이동수단이 바뀌는 지점에 작은 노드 (첫 구간이거나 앞 구간과 모드가 다를 때)
    if (i > 0 && legs[i - 1] && legs[i - 1].mode !== leg.mode) {
      mapMarkers.push(buildModeChangeNode(g, { lat: stops[i].lat!, lng: stops[i].lng! }));
    }
  }

  if (refit) fitRouteBounds();
}

/** "이 근처 검색" 카테고리 칩 — Google Nearby Search의 includedTypes 그대로. "전체"는
 * 두지 않고, 그 대신 자유 텍스트 입력으로 원하는 걸 직접 검색할 수 있게 한다. */
const NEARBY_CATEGORY_CHIPS: Array<{ label: string; types: string[] }> = [
  { label: '카페', types: ['cafe'] },
  { label: '식당', types: ['restaurant'] },
  { label: '편의점', types: ['convenience_store'] },
  { label: '관광명소', types: ['tourist_attraction'] },
];
const NEARBY_SEARCH_RADIUS_M = 800;

// 같은 장소에서 같은 카테고리/키워드를 다시 검색하면 Google을 또 부르지 않고 세션 캐시를 쓴다
// (Claude.md 3-2: API 호출 최소화). 장소별 근처 상권은 세션 내내 바뀔 일이 없어 TTL 없이
// 페이지를 새로고침할 때까지만 유지해도 충분하다.
const nearbySearchCache = new Map<string, Place[]>();
function nearbySearchCacheKey(placeId: string, types: string[] | null, keyword: string | null): string {
  return placeId + '|' + (types ? types.slice().sort().join(',') : 'q:' + keyword!.trim().toLowerCase());
}

/** 확정된 장소를 클릭했을 때 그 좌표를 기준으로 근처를 찾는다 — 카테고리 칩이면 Nearby
 * Search(카테고리), 직접 입력한 키워드면 그 좌표 반경으로 Text Search(자유 텍스트).
 * 결과는 지도 검색과 같은 파이프라인(searchResultPlaces)을 그대로 공유한다. */
async function runNearbySearch(place: Place, types: string[] | null, keyword: string | null): Promise<void> {
  if (place.lat == null || place.lng == null || !rtContainer || searchBusy) return;
  const cacheKey = nearbySearchCacheKey(place.id, types, keyword);
  const cached = nearbySearchCache.get(cacheKey);
  if (cached) {
    searchResultPlaces = cached;
    updateSearchClearButton(rtContainer);
    drawRouteOnMap(false);
    return;
  }
  searchBusy = true;
  try {
    const center = { lat: place.lat, lng: place.lng };
    const results = types
      ? await searchPlacesNearby(center, NEARBY_SEARCH_RADIUS_M, types)
      : await searchPlacesByText(keyword!, { center, radius: NEARBY_SEARCH_RADIUS_M });
    searchResultPlaces = results.map(googleResultToPlace);
    nearbySearchCache.set(cacheKey, searchResultPlaces);
    if (searchResultPlaces.length === 0) window.alert('이 근처에 검색 결과가 없어요.');
  } finally {
    searchBusy = false;
    updateSearchClearButton(rtContainer);
    drawRouteOnMap(false);
  }
}

/**
 * 우상단 고정 패널에 "확정된 장소" 정보를 채워 넣는다 — 장소 사진/평점/카테고리 +
 * 그 장소로 들어오고(prev) 나가는(next) 두 구간의 이동시간/비용을 함께 보여준다.
 */
function updateStopInfoPanel(
  p: Place,
  isBasecamp: boolean,
  prevLeg: Leg | null,
  prevPlace: Place | null,
  nextLeg: Leg | null,
  nextPlace: Place | null,
  currency: string
): void {
  if (!stopInfoPanelEl) return;
  const meta = categoryMeta(p, isBasecamp);

  const legRow = (arrow: string, leg: Leg | null, place: Place | null, manual: boolean): string => {
    if (!leg || !place) return '';
    const extra = leg.mode === 'WALK' ? fmtKm(leg.km) : (leg.costTHB > 0 ? fmtCost(leg.costTHB, currency) : '무료');
    // 이 구간을 누르면 구글맵 경로 화면으로 — "←"는 place→p, "→"는 p→place 방향.
    const gmUrl =
      p.lat != null && p.lng != null && place.lat != null && place.lng != null
        ? googleMapsDirUrl(
            arrow === '←' ? { lat: place.lat, lng: place.lng } : { lat: p.lat, lng: p.lng },
            arrow === '←' ? { lat: p.lat, lng: p.lng } : { lat: place.lat, lng: place.lng },
            leg.mode
          )
        : null;
    const tag = gmUrl ? 'a' : 'div';
    return [
      '<' + tag + ' class="rt-stopinfo-leg"' +
        (gmUrl ? ' href="' + gmUrl + '" target="_blank" rel="noopener noreferrer" title="구글맵에서 경로 보기"' : '') + '>',
      '  <span class="rt-stopinfo-leg-arrow">' + arrow + '</span>',
      '  <span class="rt-stopinfo-leg-name">' + escapeHtml(place.name) + '</span>',
      '  <span class="rt-stopinfo-leg-mode">' + modeIcon(leg.mode) + '</span>',
      '  <span class="rt-stopinfo-leg-time">' + fmtMin(leg.min) + ' <b>·</b> ' + extra + '</span>',
      !leg.real ? '  <span class="rt-stopinfo-leg-est" title="실제 경로를 못 받아 직선거리로 추정한 값이에요">추정</span>' : '',
      manual ? '  <span class="rt-stopinfo-leg-manual" title="직접 지정한 이동수단"></span>' : '',
      gmUrl ? '  <span class="rt-stopinfo-leg-gmaps">' + IC_EXTLINK + '</span>' : '',
      '</' + tag + '>',
    ].join('');
  };
  const prevManual = prevPlace ? legModeOverride.has(legKey(prevPlace.id, p.id)) : false;
  const nextManual = nextPlace ? legModeOverride.has(legKey(p.id, nextPlace.id)) : false;
  const legsHtml = legRow('←', prevLeg, prevPlace, prevManual) + legRow('→', nextLeg, nextPlace, nextManual);

  stopInfoPanelEl.innerHTML = [
    '<div class="rt-stopinfo-head">',
    p.photo_url
      ? '  <div class="rt-stopinfo-photo" style="background-image:url(\'' + p.photo_url + '\')"></div>'
      : '  <div class="rt-stopinfo-photo rt-stopinfo-photo-icon">' + meta.icon + '</div>',
    '  <div class="rt-stopinfo-headtext">',
    '    <div class="rt-stopinfo-name">' + escapeHtml(p.name) + '</div>',
    '    <div class="rt-stopinfo-meta">',
    p.google_rating ? '      <span class="rt-stopinfo-rate">' + IC_STAR + ' ' + p.google_rating.toFixed(1) + '</span>' : '',
    p.category || isBasecamp ? '      <span class="rt-stopinfo-cat">' + escapeHtml(p.category || '숙소') + '</span>' : '',
    '    </div>',
    '  </div>',
    '  <button type="button" class="rt-stopinfo-close" aria-label="정보 닫기">✕</button>',
    '</div>',
    legsHtml ? '<div class="rt-stopinfo-legs">' + legsHtml + '</div>' : '',
    p.lat != null && p.lng != null
      ? [
          '<div class="rt-stopinfo-nearby">',
          '  <div class="rt-stopinfo-nearby-label">이 근처 검색</div>',
          '  <div class="rt-stopinfo-nearby-chips">',
          NEARBY_CATEGORY_CHIPS.map(
            (c) => '    <button type="button" class="rt-stopinfo-nearby-chip" data-nearby-types="' + c.types.join(',') + '">' + escapeHtml(c.label) + '</button>'
          ).join(''),
          '  </div>',
          '  <input type="text" class="rt-stopinfo-nearby-input" placeholder="직접 검색 (예: 환전소, Enter)" />',
          '</div>',
        ].join('')
      : '',
  ].join('');
  stopInfoPanelEl.style.display = 'flex';
  stopInfoPanelEl.querySelector('.rt-stopinfo-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    highlightedPlaceId = null;
    drawRouteOnMap(false);
    renderRightPanel(rtContainer!);
  });
  stopInfoPanelEl.querySelectorAll('.rt-stopinfo-nearby-chip').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const types = (btn as HTMLElement).dataset.nearbyTypes?.split(',') ?? [];
      void runNearbySearch(p, types, null);
    });
  });
  const nearbyInput = stopInfoPanelEl.querySelector('.rt-stopinfo-nearby-input') as HTMLInputElement | null;
  nearbyInput?.addEventListener('click', (e) => e.stopPropagation());
  nearbyInput?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key !== 'Enter') return;
    e.preventDefault();
    const kw = nearbyInput.value.trim();
    if (kw) void runNearbySearch(p, null, kw);
  });
}

function fitRouteBounds(): void {
  const g = (window as any).google;
  if (!g?.maps || !mapInstance) return;
  const day = activeDay();
  const dayBasecamp = basecampForDay(days.findIndex((d) => d.id === day.id));
  const pts: Place[] = [];
  if (dayBasecamp) pts.push(dayBasecamp);
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
  const activeDayIndex = days.findIndex((d) => d.id === activeDayId);
  const isBasecamp = isBasecampPlace(p, activeDayIndex);
  const isAnchor = isAnyAnchor(p, activeDayIndex);
  const included = isAnchor || activeDay().stopIds.includes(p.id);
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
    isAnchor
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
      if (act === 'add') appendStopBeforeEndAnchor(activeDay(), p.id);
      else removeStop(p.id);
      closePlaceCard();
      refreshAll(rtContainer!, { refit: false });
      // scheduleSave의 600ms 디바운스를 기다리다 새로고침하면 유실될 수 있어 바로 저장을 확정한다.
      void persistActiveDay();
    });
  });
}

/** 구글맵에서 이 장소를 바로 여는 링크 — google_place_id가 있으면 그 장소를 정확히
 * 짚어주고, 없으면 이름으로 검색(shortlist.ts/workspace.ts와 같은 URL 패턴). */
function googleMapsUrl(p: Place): string {
  return p.google_place_id
    ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.name) + '&query_place_id=' + p.google_place_id
    : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.name);
}

/** 지도 검색/근처 검색 결과 핀 클릭 시 뜨는 카드 — 아직 Brainstorm에도 없는 "진짜 구글
 * 장소"라 openPlaceCard와 달리 "일정에 추가" 버튼 하나뿐이다(동선에서 빼기 개념이 없음).
 * 누르면 insertGooglePlace로 실제 places 행을 만들어 Brainstorm에도 자동 반영되고,
 * 동시에 지금 DAY의 동선에도 바로 들어간다. 장소명은 구글맵 링크로 열어서 리뷰·영업시간
 * 등 여기서 안 보여주는 정보를 바로 확인할 수 있게 한다. */
function openSearchResultCard(g: any, p: Place, cacheSource: string): void {
  closePlaceCard();
  const html = [
    p.photo_url
      ? '<div class="rt-clickcard-photo" style="background-image:url(\'' + p.photo_url + '\')"></div>'
      : '<div class="rt-clickcard-photo">' + searchResultIcon(p.category) + '</div>',
    '<button type="button" class="rt-clickcard-close" aria-label="닫기">✕</button>',
    '<div class="rt-clickcard-body">',
    '  <a class="rt-clickcard-name rt-clickcard-name-link" href="' + googleMapsUrl(p) + '" target="_blank" rel="noopener noreferrer" title="구글맵에서 보기">' + escapeHtml(p.name) + ' ' + IC_EXTLINK + '</a>',
    '  <div class="rt-clickcard-meta">',
    p.google_rating ? '    <span class="rt-clickcard-rate">' + IC_STAR + ' ' + p.google_rating.toFixed(1) + '</span>' : '',
    p.category ? '    <span class="rt-clickcard-cat">' + escapeHtml(p.category) + '</span>' : '',
    '  </div>',
    '  <button type="button" class="rt-clickcard-action" data-card-act="add-day">' + IC_PLUS + ' 일정에 추가</button>',
    '</div>',
  ].join('');

  const Ctor = getOverlayCtor(g);
  placeCardOverlay = new Ctor(new g.maps.LatLng(p.lat!, p.lng!), html, 'rt-clickcard');
  placeCardOverlay.setMap(mapInstance);
  placeCardPlaceId = p.id;

  requestAnimationFrame(() => {
    const div: HTMLElement | null = placeCardOverlay?.div ?? null;
    if (!div) return;
    div.querySelector('.rt-clickcard-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closePlaceCard();
    });
    const addBtn = div.querySelector('[data-card-act="add-day"]') as HTMLButtonElement | null;
    addBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      addBtn.disabled = true;
      addBtn.textContent = '추가하는 중…';
      void addSearchResultToDay(p, rtContainer!, cacheSource);
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

/** 동선 안에서의 위치에 따른 핀 상태 — 어떤 장소를 클릭/호버하면 그 장소로 "들어오는" 구간과
 * 바로 이전 정류지만 강조되고, 그 외 전부(이전의 이전, 이후 전부)는 회색으로 물러난다. */
type StopPhase = 'current' | 'adjacent' | 'dimmed' | 'plain';

/** baseColor는 아무것도 포커스하지 않은 평소 상태('plain')에 쓰는 그 정류지 고유색
 * (stopIdentityColor) — 클릭으로 선택된 지점('current')도 halo/ring만으로 강조하고 색은
 * 원래 색 그대로 유지한다. 바로 이전 정류지('adjacent')만 강조색을 얹고, 나머지는
 * 포커스가 있을 때 전부 회색('dimmed')으로 물러난다. */
function phaseColor(phase: StopPhase, baseColor: string): string {
  if (phase === 'adjacent') return ROUTE_NEXT;
  if (phase === 'dimmed') return ROUTE_GRAY;
  return baseColor; // current(선택 강조는 halo가 담당) / plain
}

interface MarkerOpts {
  isBasecamp: boolean;
  included: boolean;
  num?: number;
  highlighted?: boolean;
  phase?: StopPhase;
  baseColor?: string;
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

// 후보(아직 안 담은 곳)도 완전히 배경에 묻히지 않도록 아이콘 톤을 한 단계 진하게(ROUTE_GRAY보다 어두운 slate)
const CANDIDATE_TONE = '#6B7A93';
// 머리 중심에서 끝(뾰족한 점)까지의 거리 / 머리 반지름. 작을수록 짧고 통통한(덜 길쭉한) 핀이 된다.
const PIN_TAIL_RATIO = 1.5;

/** 반지름 r인 원(중심 cx,cy)에 외부 접선 두 개를 그어 tip에서 만나는 "물방울(핀)" 윤곽 경로.
 *  원 위쪽은 완전한 원으로, 아래쪽만 매끄럽게(꺾임 없이) 한 점으로 좁아진다. */
function pinTearPath(cx: number, cy: number, r: number, tipY: number): string {
  const d = tipY - cy; // 중심→끝 거리
  const phi = Math.acos(r / d); // 접선이 원과 만나는 각(라디안) — "아래로 곧장"에서 좌우로 벌어진 정도
  const a1 = Math.PI / 2 - phi;
  const a2 = Math.PI / 2 + phi;
  const t1x = cx + r * Math.cos(a1);
  const t1y = cy + r * Math.sin(a1);
  const t2x = cx + r * Math.cos(a2);
  const t2y = cy + r * Math.sin(a2);
  return (
    'M' + t1x + ' ' + t1y +
    ' A' + r + ' ' + r + ' 0 1 0 ' + t2x + ' ' + t2y +
    ' L' + cx + ' ' + tipY +
    ' Z'
  );
}

/**
 * 지도 핀 — 흰 배경 원 + 진행 상태 색 테두리·숫자로 위계를 낮추고, 동그라미 배지가 아니라
 * 끝이 뾰족한 실제 지도 핀 모양으로. 테두리 색은 얇은 링이 아니라 원 아래로 이어지는 뾰족한
 * 부분 전체를 채운다 — 뒤에 색깔 핀 실루엣을 통째로 깔고, 그 위에 살짝 작은 흰 원을 얹어
 * 위쪽만 링처럼 보이고 아래 꼬리는 그대로 색이 드러나는 방식.
 *  - 동선에 포함된 정류지: 순서 번호 + 진행 상태 색 테두리·숫자
 *  - 아직 담지 않은 후보: 더 옅은 톤 테두리 + 카테고리 아이콘(배경으로 물러나게)
 */
function buildMarkerV2(g: any, p: Place, opts: MarkerOpts): any {
  const meta = categoryMeta(p, opts.isBasecamp);
  const phase: StopPhase = opts.phase ?? 'plain';
  const scale = (opts.highlighted ? 1.18 : 1) * pinZoomScale();
  const r = (opts.included ? 15 : 10) * scale; // 머리(원) 반지름 — 기존 크기 기준 유지

  // halo/그림자까지 담을 여유를 둔 캔버스. 핀은 원보다 세로로 조금 길어서 폭/높이를 따로 잰다.
  const pad = opts.highlighted ? 26 : 12;
  const tail = r * PIN_TAIL_RATIO;
  const w = Math.ceil(r * 2 + pad);
  const h = Math.ceil(r + tail + pad);
  const cx = w / 2;
  // 실제 지도 좌표는 핀의 뾰족한 끝이 가리켜야 하므로, 끝점을 anchor로 쓴다(그림자 여유로 살짝 위).
  const tipY = h - pad / 2;
  const headCy = tipY - tail;

  // "숙소 들르기" 재방문 스탑은 진행 상태색 대신 항상 전용 바이올렛 — 진짜 숙소 핀과
  // 헷갈리지 않도록 번호 대신 캐리어 아이콘을 보여준다.
  const isRevisit = lodgingRevisitPurpose.has(p.id);
  const borderColor = isRevisit ? LODGING_REVISIT_COLOR : opts.included ? phaseColor(phase, opts.baseColor ?? AERO_BLUE) : 'rgba(107,122,147,0.85)';
  const numberColor = borderColor;
  // 위쪽에서만 링처럼 보이도록, 흰 원은 머리 반지름보다 살짝 작게(그 차이만큼이 링 두께)
  const ringWidth = r * 0.24;
  const whiteR = r - ringWidth;

  // 선택된 지점만 아주 옅은 Aero Blue halo로 강조 — 핀의 머리 부분을 중심으로
  const halo = opts.highlighted
    ? '<circle cx="' + cx + '" cy="' + headCy + '" r="' + (r + 9) + '" fill="' + AERO_BLUE + '" fill-opacity="0.09"/>' +
      '<circle cx="' + cx + '" cy="' + headCy + '" r="' + (r + 4.5) + '" fill="' + AERO_BLUE + '" fill-opacity="0.07"/>'
    : '';
  // 그림자는 핀이 실제로 딛고 선 지점(끝)에 얕게
  const shadow =
    '<ellipse cx="' + cx + '" cy="' + (tipY + r * 0.1) + '" rx="' + r * 0.42 + '" ry="' + r * 0.15 + '" fill="rgba(11,42,92,0.18)"/>';

  const inner =
    opts.included && !isRevisit
      ? '<text x="' + cx + '" y="' + (headCy + 4.2) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' +
        Math.round(12 * scale) + '" font-weight="800" fill="' + numberColor + '">' + (opts.num ?? '') + '</text>'
      : '<g transform="translate(' + (cx - 5.5) + ',' + (headCy - 5.5) + ') scale(0.46)" color="' + numberColor +
        '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        iconInner(isRevisit ? IC_LODGING : meta.icon) + '</g>';

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
    halo +
    shadow +
    '<path d="' + pinTearPath(cx, headCy, r, tipY) + '" fill="' + borderColor + '"/>' +
    '<circle cx="' + cx + '" cy="' + headCy + '" r="' + whiteR + '" fill="#FFFFFF"/>' +
    inner +
    '</svg>';

  return new g.maps.Marker({
    position: { lat: p.lat!, lng: p.lng! },
    map: mapInstance,
    title: p.name,
    zIndex: opts.highlighted ? 400 : opts.included ? 100 + (opts.num ?? 0) : 10,
    icon: {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new g.maps.Size(w, h),
      anchor: new g.maps.Point(cx, tipY),
    },
  });
}

// 검색 결과 핀은 후보/정류지와 같은 핀 모양(pinTearPath)을 쓰되, "아직 내 계획에 없는,
// 방금 찾은 곳"이라는 신호로 별도 톤을 쓴다 — ROUTE_NEXT(다음 방문지 표시)와 동시에 지도에
// 뜰 수 있어 헷갈리지 않도록 파랑이 아닌 틸(teal) 계열로 구분.
const SEARCH_PIN_COLOR = '#14B8A6';

/** 구글 카테고리 한글 라벨(googleMaps.ts의 CATEGORY_MAP과 동일한 값) → 검색결과 핀 아이콘.
 * 전부 돋보기로 통일돼 있던 걸, 카페=커피잔·편의점=가게처럼 한눈에 구분되게 한다.
 * 못 찾은 카테고리(명소·null 등)는 돋보기로 폴백. */
const SEARCH_CATEGORY_ICON: Record<string, string> = {
  '음식점': IC_FORK,
  '카페': IC_COFFEE,
  '베이커리': IC_BREAD,
  '바': IC_GLASS,
  '나이트라이프': IC_GLASS,
  '관광명소': IC_LANDMARK,
  '박물관': IC_LANDMARK,
  '미술관': IC_LANDMARK,
  '공원': IC_TREE,
  '종교시설': IC_TEMPLE,
  '숙소': IC_BED,
  '쇼핑': IC_BAG,
  '테마파크': IC_FERRIS,
  '공항': IC_PLANE,
  '편의점': IC_STORE,
};
function searchResultIcon(category: string | null): string {
  return (category && SEARCH_CATEGORY_ICON[category]) || IC_SEARCH;
}

/** 지도 장소 검색 / 근처 검색 결과 핀 — buildMarkerV2와 같은 핀 모양을 공유하되 번호 대신
 * 카테고리에 어울리는 아이콘을 넣어 "검색으로 찾은 곳"임과 어떤 종류인지를 함께 보여준다. */
function buildSearchResultMarker(g: any, p: Place): any {
  const scale = pinZoomScale();
  const r = 11 * scale;
  const pad = 12;
  const tail = r * PIN_TAIL_RATIO;
  const w = Math.ceil(r * 2 + pad);
  const h = Math.ceil(r + tail + pad);
  const cx = w / 2;
  const tipY = h - pad / 2;
  const headCy = tipY - tail;
  const whiteR = r - r * 0.24;

  const shadow =
    '<ellipse cx="' + cx + '" cy="' + (tipY + r * 0.1) + '" rx="' + r * 0.42 + '" ry="' + r * 0.15 + '" fill="rgba(11,42,92,0.18)"/>';
  const inner = '<g transform="translate(' + (cx - 5.5) + ',' + (headCy - 5.5) + ') scale(0.46)" color="' + SEARCH_PIN_COLOR +
    '" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    iconInner(searchResultIcon(p.category)) + '</g>';

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
    shadow +
    '<path d="' + pinTearPath(cx, headCy, r, tipY) + '" fill="' + SEARCH_PIN_COLOR + '"/>' +
    '<circle cx="' + cx + '" cy="' + headCy + '" r="' + whiteR + '" fill="#FFFFFF"/>' +
    inner +
    '</svg>';

  return new g.maps.Marker({
    position: { lat: p.lat!, lng: p.lng! },
    map: mapInstance,
    title: p.name,
    zIndex: 350,
    icon: {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new g.maps.Size(w, h),
      anchor: new g.maps.Point(cx, tipY),
    },
  });
}

/** 이동수단이 바뀌는 지점에 찍는 작은 원형 노드 */
function buildModeChangeNode(g: any, at: LatLngLit): any {
  const size = 14;
  const c = size / 2;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<circle cx="' + c + '" cy="' + c + '" r="4.5" fill="#FFFFFF" stroke="' + AERO_BLUE + '" stroke-width="2.4"/></svg>';
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
  /** 같은 구간이 여러 번 그려질 때의 회차 (0이면 오프셋 없음) */
  overlapIndex: number;
  /** 클릭/호버로 포커스된 장소로 "들어오는" 구간이면 true — 이 구간만 진하게 강조 */
  selected: boolean;
  /** 포커스가 있는데 이 구간은 선택되지 않았으면 true — 회색으로 물러남 */
  dimmed: boolean;
}

function buildLegPolyline(g: any, from: Place, to: Place, leg: Leg, opts: LegDrawOpts): any {
  const style = MODE_STYLE[leg.mode];

  let path: LatLngLit[];
  if (leg.path && leg.path.length >= 2) {
    path = leg.path; // 실측 도로 경로 — 그대로(왜곡 금지)
  } else {
    path = arcBetween({ lat: from.lat!, lng: from.lng! }, { lat: to.lat!, lng: to.lng! }, 0.12);
  }
  if (opts.overlapIndex > 0) path = offsetPath(path, opts.overlapIndex * 28);

  const color = opts.dimmed ? ROUTE_GRAY : ROUTE_LINE_COLOR;
  const opacity = opts.dimmed ? 0.5 : opts.selected ? 1 : 0.85;
  const weight = opts.selected ? style.weight + 1 : style.weight;

  return new g.maps.Polyline({
    map: mapInstance,
    path,
    geodesic: true,
    strokeColor: color,
    strokeOpacity: opacity,
    strokeWeight: weight,
    zIndex: opts.selected ? 12 : 10,
  });
}

/**
 * "구글 기본 지도" 그대로 — 색은 아예 건드리지 않는다(geometry color styler 없음).
 * 커스텀 색을 섞어봤더니 실제 구글 지도와 미묘하게 달라 보인다는 피드백이 있어서,
 * 색은 구글이 렌더링하는 원본 그대로 두고 라벨(글자) 노출만 "Reduced" 밀도로 줄인다 —
 * 대표 지역명(행정동 단위)과 관광명소(POI attraction) 이름만 남기고, 동네 세부 이름·
 * 업체(카페/식당 등) POI·잔도로 이름·지하철 노선은 다 끈다.
 */
const MAP_STYLE_LIGHT = [
  // 업체 POI(카페·식당 등)는 숨기고, 공원과 관광명소 이름만 다시 켠다(색은 구글 기본 그대로)
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.attraction', elementType: 'labels', stylers: [{ visibility: 'on' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  // 대표 지역명(행정동/구 단위)은 위치 감각에 도움되니 남기고, 동네 세부 이름만 끈다
  { featureType: 'administrative.locality', elementType: 'labels', stylers: [{ visibility: 'on' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  // 잔도로 이름까지는 필요 없음 — 주요 도로(고속도로)만 이름을 남긴다
  { featureType: 'road.arterial', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] },
];

