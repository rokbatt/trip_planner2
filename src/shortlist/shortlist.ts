import { supabase } from '../supabase';
import { store } from '../store';
import {
  syntheticDestinationName,
  loadDestinations,
  resolveActiveDestination,
  setActiveDestinationId,
  placeBelongsToDestination,
  isSyntheticDestination,
  loadStaySegments,
  saveStaySegment,
  resolveActiveSegment,
  setActiveSegmentId,
  createStaySegment,
  deleteStaySegment,
  isSyntheticSegment,
  updateStaySegment,
  repairOrphanPlaces,
} from '../trips/destinations';
import { loadGoogleMapsScript, getCategoryLabel, getPlacePredictions, getPlaceDetails } from '../utils/googleMaps';
import { points as turfPoints, polygon as turfPolygon, featureCollection } from '@turf/helpers';
import { voronoi } from '@turf/voronoi';
import { intersect } from '@turf/intersect';
import { union } from '@turf/union';
import { convex } from '@turf/convex';
import { polygonSmooth } from '@turf/polygon-smooth';
import { bbox } from '@turf/bbox';
import type { PlacePrediction } from '../utils/googleMaps';
import type { Database, TripDestination, StaySegment } from '../types/database';
import {
  sendVoteRequest,
  getPendingVoteResponseFor,
  castVote,
  clearPendingVoteResponse,
  getActiveRequestIdForPlace,
  getTally,
  getMyVoteForPlace,
  type VoteTally,
} from '../collab/hotelVote';
import './shortlist.css';

type Place = Database['public']['Tables']['places']['Row'];
type Trip = Database['public']['Tables']['trips']['Row'];

/* ── 아이콘 ── */
const IC_BED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 13.5h17v5h-17z"/><path d="M3.5 13.5V6.5"/><path d="M3.5 18.5V21M20.5 18.5V21"/><path d="M6.5 13.5V11h4.5v2.5"/></svg>';
const IC_WALK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="M11 8l-3 3 2 7M11 8l3 2 3-1M8 11l-3 2v6M13 10l2 4-2 6"/></svg>';
const IC_TAXI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M5 17l1.5-5h11L19 17M8 12V8h8v4"/></svg>';
const IC_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const IC_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const IC_SPARK = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.6L19.4 9.4 13.8 11.2 12 17l-1.8-5.8L4.6 9.4l5.6-1.8L12 2z"/></svg>';
const IC_PLANE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 19.5l19-7.5-19-7.5 4 7.5-4 7.5z"/></svg>';
const IC_SEARCH2 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
const IC_CHEVRON_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
const IC_EXTLINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>';
const IC_XCLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
const IC_SWAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3L3 7l4 4M3 7h13a4 4 0 0 1 4 4v1M17 21l4-4-4-4M21 17H8a4 4 0 0 1-4-4v-1"/></svg>';
const IC_ROUTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
const IC_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>';
const IC_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-7.58 7-12A7 7 0 0 0 5 10c0 4.42 7 12 7 12z"/><circle cx="12" cy="10" r="2.4"/></svg>';
const IC_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
const IC_BUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="13" rx="2"/><path d="M4 11h16M7 20v-3M17 20v-3M8 8h8"/><circle cx="8" cy="14" r=".6" fill="currentColor"/><circle cx="16" cy="14" r=".6" fill="currentColor"/></svg>';
const IC_HOUSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-6 8 6M6 10v9h12v-9M10 19v-5h4v5"/></svg>';
const IC_BUILDING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V6l7-3 7 3v15M9 21v-4h6v4M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01"/></svg>';
const IC_STORE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9l1-5h14l1 5M4 9v10h16V9M4 9h16M9 19v-6h6v6"/></svg>';
const IC_COFFEE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8z"/><path d="M17 9h2a2 2 0 0 1 0 4h-2M7 3v2M11 3v2"/></svg>';
const IC_PHARM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>';
const IC_HOSPITAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12.5c-2 3-8 7-8 7s-6-4-8-7a4.2 4.2 0 0 1 7-4.2A4.2 4.2 0 0 1 20 12.5z"/></svg>';
const IC_ATM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h2M12 15h5"/></svg>';
const IC_CART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.2 11.2a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.2L21 8H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg>';
const IC_STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.6 5.9 20.4l1.4-6.8L2.2 9l6.9-.7L12 2z"/></svg>';

/** Step1 지도 핀 전용 아이콘 세트 — ROUTE(route.ts)의 후보 핀과 똑같은 선(stroke) 스타일로
 *  보이도록 그 파일의 아이콘 원본을 그대로 옮겨왔다(위의 IC_BED/IC_PLANE 등은 다른 UI에서도
 *  쓰고 있어서 겹치지 않게 PIN_IC_ 접두사로 분리). */
const PIN_IC_LANDMARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M4 21V10M20 21V10M2 10l10-6 10 6M6 10v7M10 10v7M14 10v7M18 10v7"/></svg>';
const PIN_IC_FORK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2v7a2 2 0 0 0 2 2v11M7 2v7M9 2v7M11 2v7M16 2c-1.5 0-3 1.5-3 4s1.5 4 3 4v10"/></svg>';
const PIN_IC_TARGET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>';
const PIN_IC_BED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 18v2M21 18v2M3 12V8a2 2 0 0 1 2-2h4v6"/></svg>';
const PIN_IC_BAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l1 12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>';
const PIN_IC_PLANE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 19.5l19-7.5-19-7.5 4 7.5-4 7.5z"/></svg>';
const PIN_IC_COFFEE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z"/><path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 2v2M11 2v2M14 2v2"/></svg>';
const PIN_IC_BREAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-4 0-9 3-9 8 0 6 5 10 9 10s9-4 9-10c0-5-5-8-9-8Z"/><path d="M7 14c1-2 2-3 5-3s4 1 5 3"/></svg>';
const PIN_IC_GLASS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14l-7 9-7-9Z"/><path d="M12 12v9M8 21h8"/></svg>';
const PIN_IC_TREE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 7 9h3l-4 6h4l-3 5h10l-3-5h4l-4-6h3L12 2Z"/><path d="M12 22v-4"/></svg>';
const PIN_IC_TEMPLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v3M12 5l8 6H4l8-6Z"/><path d="M5 11v9h14v-9"/><path d="M10 20v-5h4v5"/></svg>';
const PIN_IC_FERRIS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3 6.3 17.7"/></svg>';

/** place.category → 핀 선 아이콘. ROUTE의 SEARCH_CATEGORY_ICON과 같은 매핑(핀 스타일을
 *  똑같이 맞추기 위해). 없으면 mood 4종으로 폴백. */
const PIN_CATEGORY_ICON: Record<string, string> = {
  '카페': PIN_IC_COFFEE,
  '음식점': PIN_IC_FORK,
  '베이커리': PIN_IC_BREAD,
  '바': PIN_IC_GLASS,
  '나이트라이프': PIN_IC_GLASS,
  '관광명소': PIN_IC_LANDMARK,
  '박물관': PIN_IC_LANDMARK,
  '미술관': PIN_IC_LANDMARK,
  '공원': PIN_IC_TREE,
  '종교시설': PIN_IC_TEMPLE,
  '명소': PIN_IC_LANDMARK,
  '테마파크': PIN_IC_FERRIS,
  '쇼핑': PIN_IC_BAG,
  '숙소': PIN_IC_BED,
  '공항': PIN_IC_PLANE,
};
const PIN_MOOD_ICON: Record<string, string> = {
  '가고싶어': PIN_IC_LANDMARK,
  '먹고싶어': PIN_IC_FORK,
  '하고싶어': PIN_IC_TARGET,
  '숙소': PIN_IC_BED,
};
/** ROUTE route.ts의 iconInner()와 동일 — 아이콘 svg에서 <svg> 껍데기만 벗겨 내부 마크업만 남긴다.
 *  색/굵기는 감싸는 <g>에서 한 번에 지정(=핀 색상과 통일하기 위해). */
function pinIconInner(svg: string): string {
  return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
}

const MOOD_LABEL: Record<string, string> = {
  '가고싶어': 'VISIT',
  '먹고싶어': 'FOOD',
  '하고싶어': 'ACTIVITY',
  '숙소': 'STAY',
};
const MOOD_COLOR: Record<string, string> = {
  '가고싶어': '#E24B4A',
  '먹고싶어': '#1D9E75',
  '하고싶어': '#7F77DD',
  '숙소': '#185FA5',
};
/** place.category(구글 장소 세부 종류, 예: '카페'/'음식점')가 없을 때만 쓰는 대체 아이콘 — mood 4종 기준 */
const MOOD_ICON: Record<string, string> = {
  '가고싶어': '🏰',
  '먹고싶어': '🍝',
  '하고싶어': '🏄',
  '숙소': '🏠',
};
/** place.category → 핀 아이콘. 확실히 구분되는 것만 세분화하고(카페 vs 맛집), 애매한 건 맛집으로 통일 */
const CATEGORY_ICON: Record<string, string> = {
  '카페': '🧋',
  '음식점': '🍝',
  '베이커리': '🍝',
  '바': '🍝',
  '관광명소': '🏰',
  '박물관': '🏰',
  '미술관': '🏰',
  '공원': '🏰',
  '종교시설': '🏰',
  '명소': '🏰',
  '테마파크': '🏄',
  '나이트라이프': '🏄',
  '쇼핑': '🛍️',
  '숙소': '🏠',
  '공항': '✈️',
};

interface Zone {
  id: string;
  name: string;
  features: string[];
  places: Place[];
  centerLat: number;
  centerLng: number;
  avgRating: number | null;
  avgInternalWalkMin: number | null;
  recommendedNights: number;
  topPlaces: Place[];
  efficiencyLabel: string;
  rank: number;
  /** AI 추천이 아니라 사용자가 지역 검색으로 직접 추가한 권역(예: 공항 근처) — 카드가 간소화되고 항상 목록 맨 위 */
  isCustom?: boolean;
  address?: string | null;
}

let highlightedZoneId: string | null = null;
let pendingSelectedZoneId: string | null = null;
let zonePolygons: any[] = [];
let zoneLabelOverlays: any[] = [];
let zoneBlobPoints = new Map<string, { lat: number; lng: number }[]>();
let markersByZone = new Map<string, any[]>();

/* ── 모듈 상태 ── */
let currentTripId = '';
let currentTrip: Trip | null = null;
let slContainer: HTMLElement | null = null;
let slDestinations: TripDestination[] = [];
let slActiveDest: TripDestination | null = null;
let slSegments: StaySegment[] = [];
let slActiveSegment: StaySegment | null = null;
let allPlaces: Place[] = [];
let zones: Zone[] = [];
/** ZONE_ASSIGN_MAX_KM보다 멀어 어느 권역에도 배정되지 않은 장소(예: 공항) — 권역 카드
 *  통계에는 안 들어가지만, Step1 지도에는 계속 마커로 보여줌 */
let unassignedPlaces: Place[] = [];
let step: 1 | 2 | 3 = 1;
let selectedZone: Zone | null = null;
let zoneDataSource = 'curated';
let selectedBasecamp: Place | null = null;
/** Step3 "이 숙소를 여행 중심으로 확정하기" 버튼을 실제로 눌렀을 때만 채워짐(ISO 시각).
 *  Step2에서 후보만 고른 상태(selectedBasecamp만 있고 이건 null)와는 구분해야
 *  "확정됨" 표시가 진짜 확정 전에 뜨는 일이 없음 */
let basecampConfirmedAt: string | null = null;
/** 이 숙소 구간의 총 숙박 예산(원, 전체 인원·전체 숙박일 기준) — "확정하기" 시점에 DB로 저장됨 */
let totalBudgetKRW: number | null = null;
let pendingHotelId: string | null = null;
/** 숙소 투표 요청 토스트의 "보러 가기"로 들어왔을 때, 그 숙소의 Step3로 강제 이동시키기 위한 1회성 타겟 */
let pendingVoteTarget: { destinationId: string; placeId: string } | null = null;
let step2SortMode: 'rating' | 'distance' = 'rating';
let step2FilterText = '';
let confirmedIds = new Set<string>();
let mapInstance: any = null;
let mapMarkers: any[] = [];
let zoneLabelZoomRedrawHandle: number | null = null;

export function teardownShortlist(): void {
  if (shellResizeHandler) {
    window.removeEventListener('resize', shellResizeHandler);
    shellResizeHandler = null;
  }
  if (voteTallyListenerRef) {
    window.removeEventListener('mongsil:voteTallyChanged', voteTallyListenerRef);
    voteTallyListenerRef = null;
  }
  if (zoneLabelZoomRedrawHandle != null) {
    window.cancelAnimationFrame(zoneLabelZoomRedrawHandle);
    zoneLabelZoomRedrawHandle = null;
  }
  if (placeInfoWindow) {
    placeInfoWindow.close();
    placeInfoWindow = null;
  }
  placeInfoWindowPinned = false;
  closeSegPopover();
  closeShortlistDestSwitcher();
  allPlaces = [];
  zones = [];
  unassignedPlaces = [];
  slDestinations = [];
  slActiveDest = null;
  slSegments = [];
  slActiveSegment = null;
  step = 1;
  selectedZone = null;
  zoneDataSource = 'curated';
  selectedBasecamp = null;
  basecampConfirmedAt = null;
  totalBudgetKRW = null;
  pendingHotelId = null;
  step2SortMode = 'rating';
  step2FilterText = '';
  stayFilters = { budget: '', customMinKRW: null, customMaxKRW: null };
  confirmedIds = new Set();
  mapInstance = null;
  step2MapInstance = null;
  step2Markers = new Map();
  step3MapInstance = null;
  step3InfraLines = [];
  step3Facilities = [];
  step3VisitItems = [];
  reviewSummaryData = null;
  reviewSummaryLoading = false;
  reviewSummaryPlaceId = null;
  mapMarkers = [];
  highlightedZoneId = null;
  pendingSelectedZoneId = null;
  zonePolygons = [];
  zoneLabelOverlays = [];
  zoneBlobPoints = new Map();
  markersByZone = new Map();
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ── 거리 계산 (Haversine, API 호출 없음) ── */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── 지역 클러스터링 (거리 기반, API 호출 없음) ── */
interface ZoneSeed {
  name: string;
  features: string[];
  lat: number;
  lng: number;
}

/**
 * 여행지의 숙박 생활권 목록을 가져옴.
 * 큐레이션 DB(stay_zones)에 있으면 그걸 쓰고, AI 호출은 전혀 안 함.
 * 아직 큐레이션 안 된 여행지만 AI 폴백으로 대체됨 (신뢰도가 상대적으로 낮음).
 */
async function fetchDestinationZones(destination: string): Promise<{ seeds: ZoneSeed[]; source: string }> {
  try {
    const res = await fetch('/api/destination-zones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination }),
    });
    const data = await res.json();
    if (!res.ok || !Array.isArray(data.zones)) return { seeds: [], source: 'error' };
    return { seeds: data.zones, source: data.source ?? 'unknown' };
  } catch (e) {
    console.error('[Shortlist] 여행지 지역 목록 로드 실패:', (e as Error).message);
    return { seeds: [], source: 'error' };
  }
}

/** 권역 내부 장소들끼리의 평균 거리를 도보 예상 시간으로 환산 (직선거리 기준 추정치) */
function avgInternalWalkMinutes(places: Place[]): number | null {
  const withCoords = places.filter((p) => p.lat != null && p.lng != null);
  if (withCoords.length < 2) return null;

  let total = 0;
  let count = 0;
  for (let i = 0; i < withCoords.length; i++) {
    for (let j = i + 1; j < withCoords.length; j++) {
      total += haversineKm(withCoords[i].lat!, withCoords[i].lng!, withCoords[j].lat!, withCoords[j].lng!);
      count++;
    }
  }
  if (count === 0) return null;
  const avgKm = total / count;
  return Math.max(2, Math.round(avgKm * 12)); // 도보 약 5km/h 기준
}

/** 평균 이동시간(직선거리 추정치) 기준 이동 효율 등급 — 정밀 경로 데이터 아닌 참고용 */
function travelEfficiencyLabel(avgWalkMin: number | null): string {
  if (avgWalkMin == null) return '보통';
  if (avgWalkMin <= 15) return '매우 좋음↑';
  if (avgWalkMin <= 25) return '좋음↑';
  return '보통';
}

/** 가장 가까운 권역 중심조차 이보다 멀면 "그 도시 생활권 안"이 아니라고 보고 아예 배정하지
 *  않음 — 공항처럼 도심 권역들과 뚝 떨어진 장소가 어중간하게 가까운 권역에 억지로 묶여
 *  장소 수·평균 이동시간·추천 숙박일 같은 카드 통계를 왜곡하는 걸 막기 위함.
 *  큐레이션 권역들은 보통 서로 몇 km 안쪽에 모여 있어서(권역 도형 계산용 outlier 기준도 4km),
 *  10km면 실제 권역 소속 장소를 잘못 걸러낼 위험 없이 공항 같은 원거리 장소만 걸러짐 */
const ZONE_ASSIGN_MAX_KM = 10;

/**
 * 미리 받아온 "유명 지역" 목록에 브레인스토밍 장소들을 배정해서 Zone[]으로 만듦.
 * 각 장소는 가장 가까운 지역 중심점에 배정됨 (클라이언트에서 거리 계산만, API 호출 없음).
 * 다만 가장 가까운 중심조차 ZONE_ASSIGN_MAX_KM보다 멀면 어느 권역에도 배정하지 않음
 * (예: 도심 권역들과 멀리 떨어진 공항).
 * 장소가 하나도 배정되지 않은 지역은 화면에서 제외.
 */
function assignPlacesToZones(seeds: ZoneSeed[], places: Place[]): Zone[] {
  const withCoords = places.filter((p) => p.lat != null && p.lng != null);
  const buckets = new Map<number, Place[]>();

  withCoords.forEach((p) => {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    seeds.forEach((seed, i) => {
      const d = haversineKm(seed.lat, seed.lng, p.lat!, p.lng!);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    });
    if (nearestDist > ZONE_ASSIGN_MAX_KM) return;
    const bucket = buckets.get(nearestIdx) ?? [];
    bucket.push(p);
    buckets.set(nearestIdx, bucket);
  });

  const draft: Omit<Zone, 'rank'>[] = [];
  buckets.forEach((bucketPlaces, seedIdx) => {
    if (bucketPlaces.length === 0) return;
    const seed = seeds[seedIdx];

    const rated = bucketPlaces.filter((p) => typeof p.google_rating === 'number');
    const avgRating = rated.length > 0
      ? rated.reduce((s, p) => s + (p.google_rating ?? 0), 0) / rated.length
      : null;

    const topPlaces = [...bucketPlaces]
      .filter((p) => typeof p.google_rating === 'number')
      .sort((a, b) => (b.google_rating ?? 0) - (a.google_rating ?? 0))
      .slice(0, 6);

    const recommendedNights = Math.max(1, Math.min(4, Math.ceil(bucketPlaces.length / 3)));
    const avgWalk = avgInternalWalkMinutes(bucketPlaces);

    draft.push({
      id: 'zone-' + seedIdx,
      name: seed.name,
      features: seed.features ?? [],
      places: bucketPlaces,
      centerLat: seed.lat,
      centerLng: seed.lng,
      avgRating,
      avgInternalWalkMin: avgWalk,
      recommendedNights,
      topPlaces,
      efficiencyLabel: travelEfficiencyLabel(avgWalk),
    });
  });

  // 추천 순위: 평점 + 장소 수 + 이동 효율(짧을수록 유리) 조합 점수
  const scored = draft.map((z) => {
    const ratingScore = (z.avgRating ?? 3.5) * 20;
    const countScore = Math.min(z.places.length, 30) * 1.5;
    const walkPenalty = z.avgInternalWalkMin != null ? z.avgInternalWalkMin * 0.8 : 15;
    return { zone: z, score: ratingScore + countScore - walkPenalty };
  });
  scored.sort((a, b) => b.score - a.score);

  return scored.map((s, i) => ({ ...s.zone, rank: i + 1 }));
}

/**
 * Step2 숙소 후보 — zone.places(큐레이션 권역 배정 결과)에 기대지 않고, 이 권역 중심에서
 * 실제 거리로 ZONE_ASSIGN_MAX_KM 이내인 "숙소" 무드 장소를 트립 전체에서 직접 찾음.
 * 직접 검색해서 추가한 권역(공항 등, isCustom)은 zone.places가 항상 비어있어서
 * (assignPlacesToZones를 거치지 않으니까) 이렇게 안 하면 근처에 담아둔 숙소가 있어도
 * 후보가 하나도 안 뜸.
 */
function nearbyStayCandidates(zone: Zone): Place[] {
  return allPlaces.filter(
    (p) =>
      p.mood === '숙소' &&
      p.lat != null &&
      p.lng != null &&
      haversineKm(zone.centerLat, zone.centerLng, p.lat, p.lng) <= ZONE_ASSIGN_MAX_KM
  );
}

/* ── 데이터 로드 ── */
async function loadPlaces(tripId: string): Promise<Place[]> {
  const { data, error } = await supabase
    .from('places')
    .select('*')
    .eq('trip_id', tripId)
    .not('mood', 'is', null); // Brainstorm에서 이미 게이트로 분류된 것만 (Inbox 대기 중은 제외)

  if (error) {
    console.error('Shortlist places load error:', error.message);
    return [];
  }
  return data ?? [];
}

async function loadTrip(tripId: string): Promise<Trip | null> {
  const cached = store.get('currentTrip');
  if (cached && cached.id === tripId) return cached;
  const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).single();
  if (error) {
    console.error('Trip load error:', error.message);
    return null;
  }
  return data;
}

async function saveShortlistState(): Promise<void> {
  if (!currentTrip || !slActiveDest || !slActiveSegment) return;
  const prevId = slActiveSegment.id;
  const state = {
    zone_name: selectedZone?.name ?? null,
    zone_place_ids: selectedZone ? selectedZone.places.map((p) => p.id) : null,
    basecamp_place_id: selectedBasecamp?.id ?? null,
    confirmed_place_ids: [...confirmedIds],
    total_budget_krw: totalBudgetKRW,
    basecamp_confirmed_at: basecampConfirmedAt,
  };
  // 활성 여행지의 숙소 구간에 저장 (합성 여행지면 내부적으로 기존 trips.shortlist_* 컬럼으로 폴백).
  // insert된 실제 행의 id를 이어받아 다음 저장이 update가 되도록 slActiveSegment 갱신.
  const saved = await saveStaySegment(currentTrip, slActiveDest, slActiveSegment, state);
  // 구간 목록도 동기화 (합성 구간이 insert되며 id가 바뀌는 경우 포함)
  slSegments = slSegments.map((s) => (s.id === prevId ? saved : s));
  slActiveSegment = saved;

  // 합성 여행지(단일 여행지, 마이그레이션 전)는 trips.shortlist_* 컬럼에 직접 저장되는데,
  // loadTrip()이 store의 캐시된 트립을 그대로 재사용하기 때문에 여기서 캐시도 함께 갱신해야
  // Route로 갔다가 돌아오거나 다시 진입했을 때 방금 확정한 숙소가 "사라진 것처럼" 보이지 않는다.
  if (isSyntheticDestination(slActiveDest.id)) {
    currentTrip = {
      ...currentTrip,
      shortlist_zone_name: state.zone_name,
      shortlist_zone_place_ids: state.zone_place_ids,
      shortlist_basecamp_place_id: state.basecamp_place_id,
      shortlist_confirmed_place_ids: state.confirmed_place_ids,
      shortlist_total_budget_krw: state.total_budget_krw,
      shortlist_basecamp_confirmed_at: state.basecamp_confirmed_at,
    };
    store.set('currentTrip', currentTrip);
  }
}

/**
 * 숙소 투표 요청 토스트의 "보러 가기"에서 호출 — 다음 renderShortlistContent 호출 때
 * 이 숙소가 있는 여행지·구간으로 강제 전환하고 Step3로 바로 진입시킨다(1회성).
 */
export function openVoteTarget(destinationId: string, placeId: string): void {
  pendingVoteTarget = { destinationId, placeId };
}

/* ── 메인 렌더 ── */
export async function renderShortlistContent(container: HTMLElement, tripId: string): Promise<void> {
  teardownShortlist();
  currentTripId = tripId;
  slContainer = container;

  container.innerHTML = '<div class="sl-loading">STAY 준비 중...</div>';

  const [trip, places] = await Promise.all([loadTrip(tripId), loadPlaces(tripId)]);
  currentTrip = trip;

  // 여행지 결정 + 활성 여행지의 장소만 사용
  slDestinations = trip ? await loadDestinations(trip) : [];
  if (pendingVoteTarget && slDestinations.some((d) => d.id === pendingVoteTarget!.destinationId)) {
    setActiveDestinationId(tripId, pendingVoteTarget.destinationId);
  }

  // 과거 버그(여행지를 추가할 때 기존 장소를 새 여행지에 배정하는 걸 놓침) 복구 —
  // 이미 실제 여행지가 있는데 destination_id가 없는 장소가 있으면 첫 여행지로 조용히 배정.
  // 정상 트립은 orphans가 항상 비어있어 추가 쿼리가 안 나감.
  if (slDestinations.length > 0 && !isSyntheticDestination(slDestinations[0].id)) {
    const orphans = places.filter((p) => p.destination_id == null);
    if (orphans.length > 0) {
      await repairOrphanPlaces(slDestinations[0].id, orphans.map((p) => p.id));
      orphans.forEach((p) => { p.destination_id = slDestinations[0].id; });
    }
  }

  slActiveDest = slDestinations.length ? resolveActiveDestination(tripId, slDestinations) : null;
  allPlaces = slActiveDest ? places.filter((p) => placeBelongsToDestination(p, slActiveDest!)) : places;

  const emptyShell = (inner: string): string =>
    '<div id="sl-dest-bar-wrap"></div><div class="sl-empty-wrap">' + inner + '</div>';

  if (allPlaces.length === 0) {
    container.innerHTML = emptyShell([
      '<div class="sl-empty">',
      '  <div class="sl-empty-title">아직 분류된 장소가 없어요</div>',
      '  <div class="sl-empty-hint">Brainstorm(IDEAS) 게이트에서 이 여행지의 장소를 VISIT · FOOD · ACTIVITY · STAY로 분류하면 여기 표시돼요.</div>',
      '</div>',
    ].join('\n'));
    renderShortlistDestBar(container);
    return;
  }

  const destination = slActiveDest?.name || getTripDestination();
  const { seeds, source } = await fetchDestinationZones(destination);

  if (seeds.length === 0) {
    container.innerHTML = emptyShell([
      '<div class="sl-empty">',
      '  <div class="sl-empty-title">' + escapeHtml(destination) + '의 숙박 생활권 정보가 아직 없어요</div>',
      '  <div class="sl-empty-hint">이 여행지는 아직 검수된 지역 데이터가 준비되지 않았어요. 조만간 추가될 예정이에요.</div>',
      '</div>',
    ].join('\n'));
    renderShortlistDestBar(container);
    return;
  }

  zoneDataSource = source;
  zones = assignPlacesToZones(seeds, allPlaces);
  const assignedIds = new Set(zones.flatMap((z) => z.places.map((p) => p.id)));
  unassignedPlaces = allPlaces.filter((p) => p.lat != null && p.lng != null && !assignedIds.has(p.id));

  // 활성 여행지의 숙소 구간들을 로드하고, 활성 구간의 저장 상태를 복원
  if (trip && slActiveDest) {
    slSegments = sortSegmentsByDate(await loadStaySegments(trip, slActiveDest));
    await repairAdjacentSegmentGaps(trip, slActiveDest, slSegments);
    slActiveSegment = resolveActiveSegment(slActiveDest.id, slSegments);
    restoreStateFromSegment(slActiveSegment);
  }

  // Step2까지만(지역은 골랐지만 숙소는 아직 안 고름) 진행하고 나갔다 들어오면 Step1부터
  // 다시 시작하지만, 숙소 후보라도 골라 Step3까지 가봤으면 나갔다 들어와도 Step3를 그대로
  // 유지(이어서 확인/확정하도록) — selectedZone/selectedBasecamp/confirmedIds 등 실제 진행
  // 데이터는 어느 쪽이든 restoreStateFromSegment가 그대로 복원해 둔 상태라 유실되지 않음
  if (step === 2) step = 1;

  // 투표 요청으로 들어온 경우, 방금 복원한 상태를 덮어쓰고 그 숙소의 Step3로 강제 진입
  if (pendingVoteTarget) {
    const targetZone = zones.find((z) => z.places.some((p) => p.id === pendingVoteTarget!.placeId));
    const targetPlace = targetZone?.places.find((p) => p.id === pendingVoteTarget!.placeId);
    if (targetZone && targetPlace) {
      selectedZone = targetZone;
      selectedBasecamp = targetPlace;
      step = 3;
    }
    pendingVoteTarget = null;
  }

  await renderStep(container);
}

function getTripDestination(): string {
  // 활성 여행지가 있으면 그 도시명(지역 데이터·AI 채점·숙소 검색 등 모두 여기에 맞춤)
  return slActiveDest?.name || syntheticDestinationName(currentTrip);
}

let shellResizeHandler: (() => void) | null = null;
let step2MapResizeHandler: (() => void) | null = null;
let voteTallyListenerRef: EventListener | null = null;

/**
 * `.sl-shell`의 높이를 CSS calc()로 추측하는 대신, 실제 화면에서 남은 공간을
 * JS로 직접 측정해서 고정함. 여러 단계의 flex 상속 체인에 의존하는 CSS 방식은
 * 브라우저/줌 레벨에 따라 어긋나기 쉬워서, 훨씬 확실한 이 방식으로 대체.
 */
/**
 * CSS 컨테이너 쿼리(@container slshell)가 세로 스택 모드로 전환됐는지를 JS가 그대로 읽음.
 * .sl-body에 노출된 --sl-mobile 값(0/1)을 신뢰의 원천으로 삼아, JS와 CSS가 항상 같은
 * 기준(뷰포트가 아닌 셸의 실제 가용 폭)으로 판단하도록 보장한다. 임계값을 JS에 중복 하드코딩하지 않음.
 */
function isShortlistStacked(ref: HTMLElement | null): boolean {
  if (!ref) return false;
  const bodyEl = ref.classList.contains('sl-body')
    ? ref
    : (ref.querySelector('.sl-body') as HTMLElement | null);
  if (!bodyEl) return false;
  return getComputedStyle(bodyEl).getPropertyValue('--sl-mobile').trim() === '1';
}

function lockShellHeight(container: HTMLElement): void {
  const shellEl = container.querySelector('.sl-shell') as HTMLElement;
  if (!shellEl) return;

  const applyHeight = () => {
    // 세로 스택(작은 폭)에서는 셸을 뷰포트 높이에 가두지 않고 콘텐츠만큼 자라게 둔다
    // (전체 스크롤은 바깥 .ws-content-body가 담당). 인라인 px 높이는 반드시 걷어내야
    // 아래 지도가 CSS aspect-ratio 비율대로 렌더된다 — 이게 작은 화면 지도 왜곡의 원인이었음.
    if (isShortlistStacked(container)) {
      shellEl.style.height = 'auto';
      return;
    }
    const top = shellEl.getBoundingClientRect().top;
    const available = window.innerHeight - top - 16; // 하단 여백 16px
    shellEl.style.height = Math.max(400, available) + 'px';
  };

  applyHeight();

  if (shellResizeHandler) window.removeEventListener('resize', shellResizeHandler);
  shellResizeHandler = applyHeight;
  window.addEventListener('resize', shellResizeHandler);
}

/**
 * Step2의 sticky 지도는 부모(sl-step2-layout)가 우측 리스트만큼 길게 자라있어야
 * 스크롤 내내 붙어있을 여유 공간이 생김. 그 상태에서 지도 자체 높이는
 * "화면에 실제로 보이는 한 화면 분량"이어야 하므로, sl-shell과 동일하게
 * CSS 추정 대신 JS로 (스크롤 뷰포트 높이 - 헤더 높이)를 직접 측정해서 고정.
 */
function lockStep2MapHeight(body: HTMLElement): void {
  const leftEl = body.querySelector('.sl-step2-left') as HTMLElement;
  const step2El = body.querySelector('.sl-step2') as HTMLElement;
  const headerEl = body.querySelector('.sl-step2-header-row') as HTMLElement;
  if (!leftEl || !step2El || !headerEl) return;

  const applyHeight = () => {
    // 세로 스택(작은 폭)에서는 인라인 높이를 걷어내 CSS(@container)의 aspect-ratio 지도 비율에 맡긴다.
    // 인라인 px 높이를 남기면 .sl-step2-left가 지도(aspect-ratio)보다 훨씬 커져 빈 공간이 생기고
    // 지도 비율도 어긋나므로, stacked 모드에선 반드시 비워야 한다.
    if (isShortlistStacked(body)) {
      leftEl.style.height = '';
      return;
    }
    const headerMarginBottom = parseFloat(getComputedStyle(headerEl).marginBottom || '0');
    const available = step2El.clientHeight - headerEl.offsetHeight - headerMarginBottom;
    // 지도 아래 남는 여백을 채우도록 기본 계산값보다 17% 키움
    // 단, 지도 하단이 페이지 끝과 완전히 붙지 않도록 약 1cm(38px)는 항상 남겨둠
    const bottomGap = 38;
    leftEl.style.height = Math.max(380, available * 1.17 - bottomGap) + 'px';
  };

  applyHeight();

  if (step2MapResizeHandler) window.removeEventListener('resize', step2MapResizeHandler);
  step2MapResizeHandler = applyHeight;
  window.addEventListener('resize', step2MapResizeHandler);
}

async function renderStep(container: HTMLElement): Promise<void> {
  container.innerHTML = [
    '<div id="sl-dest-bar-wrap"></div>',
    '<div class="sl-shell">',
    '  <div class="sl-stepper-row">',
    '    <div class="sl-stepper" id="sl-stepper"></div>',
    '    <div id="sl-stepper-extra"></div>',
    '  </div>',
    '  <div class="sl-body" id="sl-body"></div>',
    '</div>',
  ].join('\n');

  renderShortlistDestBar(container);
  renderSegmentBar(container);
  renderStepper(container);
  lockShellHeight(container);

  if (step !== 2 && step2MapResizeHandler) {
    window.removeEventListener('resize', step2MapResizeHandler);
    step2MapResizeHandler = null;
  }

  const body = container.querySelector('#sl-body') as HTMLElement;
  if (step === 1) await renderStep1(body);
  else if (step === 2) await renderStep2(body);
  else await renderStep3(body);
}

/** "여행지 변경" 버튼 HTML — 실제 멀티 여행지일 때만, 아니면 빈 문자열(래퍼 없는 순수 버튼) */
function destSwitchButtonHtml(): string {
  if (!slActiveDest || isSyntheticDestination(slActiveDest.id) || slDestinations.length < 2) return '';
  return '<button type="button" class="sl-dest-switch" id="sl-dest-switch">' + IC_SWAP + ' 여행지 변경</button>';
}

function bindDestSwitchButton(root: HTMLElement): void {
  root.querySelector('#sl-dest-switch')?.addEventListener('click', (e) => {
    openShortlistDestSwitcher(e.currentTarget as HTMLElement);
  });
}

/**
 * 스테퍼 줄 우측(#sl-stepper-extra)에 "여행지 변경"을 기본으로 채움 — 1·3단계는 이 기본값을
 * 그대로 쓰고, 2단계는 renderStep2가 자신의 요약(선택 지역/숙박 기간/예산 필터) 박스 안에
 * 같은 버튼을 다시 포함시켜 덮어쓴다(2단계 전용 콘텐츠와 한 슬롯을 같이 써야 해서).
 */
function renderShortlistDestBar(container: HTMLElement): void {
  const stepperSlot = container.querySelector('#sl-stepper-extra') as HTMLElement | null;
  if (stepperSlot) {
    stepperSlot.innerHTML = destSwitchButtonHtml();
    bindDestSwitchButton(stepperSlot);
    return;
  }
  // 빈 상태(아직 분류된 장소가 없음 등) 화면엔 스테퍼 자체가 없으므로, 기존처럼
  // 헤더 바로 아래 줄(#sl-dest-bar-wrap)에 래핑해서 우측 정렬로 폴백 표시.
  const wrap = container.querySelector('#sl-dest-bar-wrap') as HTMLElement | null;
  if (!wrap) return;
  const btn = destSwitchButtonHtml();
  wrap.innerHTML = btn ? '<div class="sl-dest-bar">' + btn + '</div>' : '';
  bindDestSwitchButton(wrap);
}

let slDestSwitcherEl: HTMLElement | null = null;
let slDestSwitcherDismiss: ((e: MouseEvent) => void) | null = null;

function closeShortlistDestSwitcher(): void {
  if (slDestSwitcherEl) { slDestSwitcherEl.remove(); slDestSwitcherEl = null; }
  if (slDestSwitcherDismiss) { document.removeEventListener('mousedown', slDestSwitcherDismiss); slDestSwitcherDismiss = null; }
}

/** "여행지 변경" 드롭다운 — 이미 정해진 여행지 중에서 고르기만 함(추가/편집/삭제 없음) */
function openShortlistDestSwitcher(anchor: HTMLElement): void {
  closeShortlistDestSwitcher();

  const items = slDestinations
    .map((d) => {
      const active = d.id === slActiveDest?.id;
      const meta = shortlistDestMeta(d);
      return [
        '<button type="button" class="sl-dest-switch-item' + (active ? ' active' : '') + '" data-dest-id="' + d.id + '">',
        '  <span class="sl-dest-switch-plane">' + IC_PLANE + '</span>',
        '  <span class="sl-dest-switch-text">',
        '    <span class="sl-dest-switch-name">' + escapeHtml(d.name) + '</span>',
        meta ? '    <span class="sl-dest-switch-meta">' + escapeHtml(meta) + '</span>' : '',
        '  </span>',
        active ? '  <span class="sl-dest-switch-check">' + IC_CHECK + '</span>' : '',
        '</button>',
      ].join('');
    })
    .join('');

  const pop = document.createElement('div');
  pop.className = 'sl-dest-switcher';
  pop.innerHTML = '<div class="sl-dest-switch-title">여행지 변경</div><div class="sl-dest-switch-list">' + items + '</div>';
  document.body.appendChild(pop);
  slDestSwitcherEl = pop;

  const r = anchor.getBoundingClientRect();
  const popW = 220;
  let left = r.right - popW;
  if (left < 12) left = 12;
  pop.style.top = r.bottom + 8 + 'px';
  pop.style.left = left + 'px';

  pop.querySelectorAll('.sl-dest-switch-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.destId;
      closeShortlistDestSwitcher();
      if (!id || id === slActiveDest?.id || !slContainer) return;
      setActiveDestinationId(currentTripId, id);
      renderShortlistContent(slContainer, currentTripId);
    });
  });

  slDestSwitcherDismiss = (e: MouseEvent) => {
    if (slDestSwitcherEl && !slDestSwitcherEl.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
      closeShortlistDestSwitcher();
    }
  };
  setTimeout(() => document.addEventListener('mousedown', slDestSwitcherDismiss!), 0);
}

function shortlistDestMeta(d: TripDestination): string {
  return dateRangeMeta(d.start_date, d.end_date);
}

function dateRangeMeta(start: string | null, end: string | null): string {
  if (!start || !end) return '';
  const s = new Date(start);
  const e = new Date(end);
  const nights = Math.max(0, Math.round((e.getTime() - s.getTime()) / 86400000));
  const fmt = (dt: Date) => dt.getMonth() + 1 + '.' + dt.getDate();
  return (nights > 0 ? nights + '박 · ' : '') + fmt(s) + '–' + fmt(e);
}

/** 공항처럼 직접 검색해서 추가한 권역(custom zone)은 zone.places가 항상 비어있고,
 *  그 근처 숙소 자체도 ZONE_ASSIGN_MAX_KM 밖이라 어느 권역의 zone.places에도 안 잡힘 —
 *  그래서 zone_place_ids로는 다시 찾을 방법이 없음(페이지 새로고침·구간 전환마다 매번
 *  Step1로 튕기던 원인). 이런 권역은 어차피 zone_name만 저장돼 있으므로, 이미 고른(혹은
 *  확정한) 숙소 자체의 좌표를 권역 중심으로 삼아 임시 권역을 재구성해 복원을 이어감 */
function reconstructZoneFromBasecamp(zoneName: string, segId: string, basecampPlaceId: string): Zone | null {
  const bc = allPlaces.find((p) => p.id === basecampPlaceId);
  if (!bc || bc.lat == null || bc.lng == null) return null;
  return {
    id: 'custom:restored:' + segId,
    name: zoneName,
    features: [],
    places: [],
    centerLat: bc.lat,
    centerLng: bc.lng,
    avgRating: null,
    avgInternalWalkMin: null,
    recommendedNights: 1,
    topPlaces: [],
    efficiencyLabel: '',
    rank: 0,
    isCustom: true,
  };
}

/** 저장된 구간 상태(zone→hotel→confirm)를 모듈 상태로 복원. 없으면 Step1부터. */
function restoreStateFromSegment(seg: StaySegment | null): void {
  step = 1;
  selectedZone = null;
  selectedBasecamp = null;
  basecampConfirmedAt = null;
  confirmedIds = new Set();
  totalBudgetKRW = seg?.total_budget_krw ?? null;
  if (!seg?.zone_name) return;

  const zpids = seg.zone_place_ids ?? [];
  let restoredZone = zones.find((z) => z.places.some((p) => zpids.includes(p.id))) ?? null;
  if (!restoredZone && seg.basecamp_place_id) {
    restoredZone = reconstructZoneFromBasecamp(seg.zone_name, seg.id, seg.basecamp_place_id);
  }
  if (!restoredZone) return;

  selectedZone = restoredZone;
  step = 2;
  if (seg.basecamp_place_id) {
    const bc = restoredZone.places.find((p) => p.id === seg.basecamp_place_id) ?? allPlaces.find((p) => p.id === seg.basecamp_place_id);
    if (bc) {
      selectedBasecamp = bc;
      basecampConfirmedAt = seg.basecamp_confirmed_at ?? null;
      step = 3;
      confirmedIds = new Set(seg.confirmed_place_ids ?? []);
    }
  }
}

/* ══════════════ 숙소 구간(Phase 3 — 한 여행지 안에서 숙소 나누기) ══════════════ */

/** 구간 전환 — 활성 구간을 바꾸고 그 구간의 상태를 복원해 다시 렌더 (zones/places는 그대로) */
function switchSegment(segId: string): void {
  if (!slActiveDest || !slContainer) return;
  const seg = slSegments.find((s) => s.id === segId);
  if (!seg || seg.id === slActiveSegment?.id) return;
  slActiveSegment = seg;
  setActiveSegmentId(slActiveDest.id, seg.id);
  restoreStateFromSegment(seg);
  renderStep(slContainer);
}

/** 구간 표시 이름: 확정된 숙소가 있으면 그 이름, 없으면 "숙소 N" */
function segmentLabel(seg: StaySegment, index: number): string {
  if (seg.basecamp_place_id) {
    const bc = allPlaces.find((p) => p.id === seg.basecamp_place_id);
    if (bc) return bc.name;
  }
  return '숙소 ' + (index + 1);
}

/** 구간 목록을 체류 시작일 순으로 정렬 (날짜 미정은 맨 뒤) */
function sortSegmentsByDate(segs: StaySegment[]): StaySegment[] {
  return [...segs].sort((a, b) => {
    if (!a.start_date && !b.start_date) return 0;
    if (!a.start_date) return 1;
    if (!b.start_date) return -1;
    return a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0;
  });
}

/**
 * 날짜순으로 재정렬하고, 정렬 결과가 기존 sort_order와 달라진 실제 구간만 DB에도 반영.
 * → 나중 날짜를 먼저 만들었더라도(예: 뒷부분을 먼저 나눔) 항상 일정 순서대로 표시되게.
 */
async function resortSegments(): Promise<void> {
  const sorted = sortSegmentsByDate(slSegments);
  const updates: Promise<unknown>[] = [];
  sorted.forEach((seg, i) => {
    if (seg.sort_order === i) return;
    seg.sort_order = i;
    if (!isSyntheticSegment(seg.id)) updates.push(updateStaySegment(seg.id, { sort_order: i }));
  });
  await Promise.all(updates);
  slSegments = sorted;
}

/** 빈 구간을 하나 추가하고 그 구간으로 전환 (날짜 지정 없이 나눌 때의 폴백) */
async function addEmptySegmentAndSwitch(startDate: string | null, endDate: string | null): Promise<void> {
  if (!currentTrip || !slActiveDest || !slContainer) return;
  const created = await createStaySegment(currentTrip, slActiveDest, {
    startDate,
    endDate,
    sortOrder: slSegments.length,
  });
  if (!created) return;
  slSegments = [...slSegments, created];
  await resortSegments();
  slActiveSegment = created;
  setActiveSegmentId(slActiveDest.id, created.id);
  restoreStateFromSegment(created);
  renderStep(slContainer);
}

/** 여행지 전체 기간([fullStart,fullEnd]) 중 어떤 구간에도 속하지 않는 빈 날짜 범위를 찾음 */
function findCoverageGaps(
  fullStart: string,
  fullEnd: string,
  segs: StaySegment[]
): Array<{ start: string; end: string }> {
  const dated = segs
    .filter((s) => !!s.start_date && !!s.end_date)
    .map((s) => ({ start: s.start_date as string, end: s.end_date as string }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const gaps: Array<{ start: string; end: string }> = [];
  let cursor = fullStart;
  for (const seg of dated) {
    if (seg.start > cursor) gaps.push({ start: cursor, end: seg.start });
    if (seg.end > cursor) cursor = seg.end;
  }
  if (cursor < fullEnd) gaps.push({ start: cursor, end: fullEnd });
  return gaps;
}

/**
 * removeSegment가 인접 구간으로 날짜를 이어받게 고쳐지기 전에 이미 삭제가 일어난 트립은
 * DB에 좁아진 구간이 그대로 남아있어 코드만 고쳐선 반영되지 않는다. 구간을 새로 불러올
 * 때마다 전체 기간 대비 빈 날짜가 있고 그 빈 날짜가 정확히 한 구간에만 맞닿아 있으면
 * (다른 구간과는 안 겹치는, 진짜 "예전에 삭제된 구간이 남긴 빈틈") 그 구간을 확장해
 * 조용히 복구한다 — 기존 구간을 지우거나 새로 만들지 않고 날짜만 넓히므로 진행 중이던
 * 지역/숙소 선택 상태(zone_name, basecamp_place_id 등)는 그대로 유지된다.
 */
async function repairAdjacentSegmentGaps(trip: Trip, destination: TripDestination, segs: StaySegment[]): Promise<void> {
  const fullStart = destination.start_date || trip.start_date;
  const fullEnd = destination.end_date || trip.end_date;
  if (!fullStart || !fullEnd) return;

  const gaps = findCoverageGaps(fullStart, fullEnd, segs);
  for (const gap of gaps) {
    const before = segs.find((s) => s.end_date === gap.start);
    const after = segs.find((s) => s.start_date === gap.end);
    if (before && !after) {
      before.end_date = gap.end;
      if (!isSyntheticSegment(before.id)) await updateStaySegment(before.id, { end_date: before.end_date });
    } else if (after && !before) {
      after.start_date = gap.start;
      if (!isSyntheticSegment(after.id)) await updateStaySegment(after.id, { start_date: after.start_date });
    }
    // 양쪽 다 있거나(다른 이유로 생긴 빈틈) 양쪽 다 없으면 손대지 않고 확정 시점의
    // fillCoverageGapsIfAny가 필요하면 새 빈 구간으로 채우게 둠
  }
}

/**
 * 확정("이 숙소를 여행 중심으로 확정하기") 시점에 전체 숙박 기간 중 어떤 구간도 채우지
 * 않은 빈 날짜가 있으면, 그 빈 기간(들)을 새 빈 구간으로 자동 분리해 첫 구간으로 전환한다.
 * 하나라도 채웠으면 true를 반환 — 호출부는 이 경우 route로 넘어가지 않고 화면 전환에 맡긴다.
 */
async function fillCoverageGapsIfAny(): Promise<boolean> {
  if (!currentTrip || !slActiveDest || !slContainer) return false;
  const fullStart = slActiveDest.start_date || currentTrip.start_date;
  const fullEnd = slActiveDest.end_date || currentTrip.end_date;
  if (!fullStart || !fullEnd) return false;

  const gaps = findCoverageGaps(fullStart, fullEnd, slSegments);
  if (!gaps.length) return false;

  const created: StaySegment[] = [];
  for (const gap of gaps) {
    const seg = await createStaySegment(currentTrip, slActiveDest, { startDate: gap.start, endDate: gap.end });
    if (seg) created.push(seg);
  }
  slSegments = [...slSegments, ...created];
  await resortSegments();

  const target = created[0] ?? null;
  if (target) {
    slActiveSegment = target;
    setActiveSegmentId(slActiveDest.id, target.id);
    restoreStateFromSegment(target);
  }
  renderStep(slContainer);
  return true;
}

/**
 * 사용자가 고른 기간([pickStart,pickEnd])을 품고 있는 기준 구간을 찾아, 그 기간은
 * **현재 숙소가 묵는 기간(설정 유지)**으로 좁히고, 잘려나간 앞/뒤 날짜는 **새 빈 구간**으로
 * 자동 분리한다. "숙소 나누기"와 "숙박 기간 수정"이 공유하는 핵심 로직.
 *
 * 예) 전체 10~15, 현재 숙소를 11~15로 고르면 → 현재 숙소 = 11~15(설정 유지),
 *     남는 10~11 = 새 빈 구간(다음에 숙소 지정). 이후 날짜순으로 정렬해 10~11이 앞에 온다.
 *
 * 기존 구간은 삭제 후 재생성해서 destination 날짜는 건드리지 않고 실제 stay_segments 행으로만 나눈다.
 * 활성 구간 전환이나 렌더링은 호출부(addSegment/openStayDateEditor)가 각자의 정책대로 처리한다.
 */
async function splitSegmentToRange(
  pickStart: string,
  pickEnd: string
): Promise<{ configured: StaySegment | null; leftovers: StaySegment[] } | null> {
  if (!currentTrip || !slActiveDest) return null;

  // 고른 기간을 품고 있는 기준 구간 — 활성 구간을 우선, 아니면 포함하는 구간 탐색
  const containsPick = (s: StaySegment) =>
    !!s.start_date && !!s.end_date && s.start_date <= pickStart && s.end_date >= pickEnd;
  const base =
    slActiveSegment && containsPick(slActiveSegment)
      ? slActiveSegment
      : slSegments.find(containsPick) ?? null;

  if (!base || !base.start_date || !base.end_date) return null;

  const bStart = base.start_date;
  const bEnd = base.end_date;
  // 기준 구간의 지역/숙소 선택 상태 — 고른 기간(현재 숙소)에 그대로 이어붙임
  const keepState = {
    zoneName: base.zone_name,
    zonePlaceIds: base.zone_place_ids,
    basecampPlaceId: base.basecamp_place_id,
    confirmedPlaceIds: base.confirmed_place_ids,
    basecampConfirmedAt: base.basecamp_confirmed_at,
  };

  // 기존 기준 구간 제거(실제 DB 행이면 삭제) — destination 날짜는 건드리지 않음
  if (!isSyntheticSegment(base.id)) await deleteStaySegment(base.id);
  slSegments = slSegments.filter((s) => s.id !== base.id);

  // ① 현재 숙소 = 고른 기간(설정 유지)
  const configured = await createStaySegment(currentTrip, slActiveDest, {
    startDate: pickStart,
    endDate: pickEnd,
    sortOrder: 0,
    zoneName: keepState.zoneName,
    zonePlaceIds: keepState.zonePlaceIds,
    basecampPlaceId: keepState.basecampPlaceId,
    confirmedPlaceIds: keepState.confirmedPlaceIds,
    basecampConfirmedAt: keepState.basecampConfirmedAt,
  });

  // ② 남는 앞/뒤 기간 = 새 빈 구간
  const leftovers: StaySegment[] = [];
  if (bStart < pickStart) {
    const front = await createStaySegment(currentTrip, slActiveDest, { startDate: bStart, endDate: pickStart });
    if (front) leftovers.push(front);
  }
  if (pickEnd < bEnd) {
    const back = await createStaySegment(currentTrip, slActiveDest, { startDate: pickEnd, endDate: bEnd });
    if (back) leftovers.push(back);
  }

  slSegments = [...slSegments, ...(configured ? [configured] : []), ...leftovers];
  await resortSegments(); // 날짜순 정렬 (10~11이 11~15보다 앞)

  return { configured, leftovers };
}

/** "숙소 나누기" — 나뉜 뒤 빈 구간(없으면 설정 구간)으로 전환해 숙소 지정을 유도 */
async function addSegment(pickStart: string | null, pickEnd: string | null): Promise<void> {
  if (!currentTrip || !slActiveDest || !slContainer) return;

  // 날짜를 안 골랐으면 그냥 빈 구간 추가(폴백)
  if (!pickStart || !pickEnd) {
    await addEmptySegmentAndSwitch(pickStart, pickEnd);
    return;
  }

  const result = await splitSegmentToRange(pickStart, pickEnd);
  if (!result) {
    // 포함하는 구간이 없으면(예외) 그냥 빈 구간으로 추가
    await addEmptySegmentAndSwitch(pickStart, pickEnd);
    return;
  }

  const { configured, leftovers } = result;
  const target = leftovers[0] ?? configured ?? slSegments[0] ?? null;
  if (target) {
    slActiveSegment = target;
    setActiveSegmentId(slActiveDest.id, target.id);
    restoreStateFromSegment(target);
  }
  renderStep(slContainer);
}

async function removeSegment(segId: string): Promise<void> {
  if (!slActiveDest || !slContainer || slSegments.length <= 1) return;
  const removed = slSegments.find((s) => s.id === segId) ?? null;
  if (!isSyntheticSegment(segId)) await deleteStaySegment(segId);
  slSegments = slSegments.filter((s) => s.id !== segId);

  // 삭제된 구간이 차지하던 날짜를 인접 구간이 이어받도록 확장. 안 그러면 남은 구간들의
  // 날짜 범위 합이 원래 전체 기간보다 좁아져(예: 26~30을 26~27/27~30으로 나눴다가 26~27을
  // 지우면 27~30만 남음) "수정" 모달이 그 좁아진 범위 밖은 고를 수 없게 됨(openStayDateEditor는
  // slActiveSegment.start_date/end_date를 그대로 선택 가능 범위로 씀).
  if (removed?.start_date && removed?.end_date) {
    const before = slSegments.find((s) => s.end_date === removed.start_date);
    const after = before ? null : slSegments.find((s) => s.start_date === removed.end_date);
    if (before) {
      before.end_date = removed.end_date;
      if (!isSyntheticSegment(before.id)) await updateStaySegment(before.id, { end_date: before.end_date });
    } else if (after) {
      after.start_date = removed.start_date;
      if (!isSyntheticSegment(after.id)) await updateStaySegment(after.id, { start_date: after.start_date });
    }
  }

  if (slActiveSegment?.id === segId) {
    slActiveSegment = slSegments[0] ?? null;
    if (slActiveSegment) setActiveSegmentId(slActiveDest.id, slActiveSegment.id);
    restoreStateFromSegment(slActiveSegment);
  }
  renderStep(slContainer);
}

/**
 * 구간이 이 하나뿐일 때 쓰는 "X" 동작 — removeSegment처럼 구간 자체를 지우면 이 여행지가
 * 구간 0개가 되어버려(나머지 코드는 항상 구간 1개 이상을 가정) 지울 수가 없다. 대신 구간은
 * 그대로 두고 그 안에 고른 지역·숙소·확정 내역만 전부 비워서 "처음부터 다시 고르는" 상태로
 * 되돌린다(날짜 범위는 유지 — 어차피 이 여행지의 전체 숙박 기간과 같음).
 */
async function resetSegment(segId: string): Promise<void> {
  if (!currentTrip || !slActiveDest || !slContainer) return;
  const seg = slSegments.find((s) => s.id === segId);
  if (!seg) return;
  const clearedState = {
    zone_name: null,
    zone_place_ids: null,
    basecamp_place_id: null,
    confirmed_place_ids: null,
    total_budget_krw: null,
    basecamp_confirmed_at: null,
  };
  const saved = await saveStaySegment(currentTrip, slActiveDest, seg, clearedState);
  slSegments = slSegments.map((s) => (s.id === segId ? saved : s));
  if (slActiveSegment?.id === segId) {
    slActiveSegment = saved;
    setActiveSegmentId(slActiveDest.id, saved.id);
    restoreStateFromSegment(saved);
  }
  renderStep(slContainer);
}

/** N박 표기 없이 날짜 범위만("10.26–10.29") — 상단 헤더처럼 최대한 압축해서 보여줄 곳에 사용 */
function dateRangeOnly(start: string | null, end: string | null): string {
  if (!start || !end) return '';
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) => d.getMonth() + 1 + '.' + d.getDate();
  return fmt(s) + '–' + fmt(e);
}

function bindSegmentPillHandlers(wrap: HTMLElement): void {
  wrap.querySelectorAll('.sl-seg-pill').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-del-seg], [data-reset-seg]')) return;
      switchSegment((btn as HTMLElement).dataset.segId!);
    });
  });
  wrap.querySelectorAll('[data-del-seg]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (el as HTMLElement).dataset.delSeg!;
      if (confirm('이 숙소 구간을 삭제할까요? 이 구간에서 고른 지역·숙소·장소 선택이 사라져요.')) {
        removeSegment(id);
      }
    });
  });
  wrap.querySelectorAll('[data-reset-seg]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (el as HTMLElement).dataset.resetSeg!;
      if (confirm('이 숙소 설정을 초기화할까요? 고른 지역·숙소·확정 내역이 모두 사라지고 처음부터 다시 고르게 돼요.')) {
        resetSegment(id);
      }
    });
  });
}

/**
 * 헤더 바로 아래 줄에 최대한 압축된 구간 pill만 보여줌(라벨·숙소 나누기 버튼 없음,
 * N박 표기 없이 기간만) — 1·2·3단계 공통. "숙소 나누기"는 확정(3단계) 본문의
 * 전용 카드(이 여행지에서 숙소를 나눠 묵나요?)에서만 시작하도록 상단에서는 제거.
 * 구간이 하나뿐이어도 "확정됐다"는 표시는 봐야 하므로, 구간이 1개 이상이면 항상 보여줌
 * (구간을 나누지 않은 경우엔 pill 1개만 뜸).
 */
function renderSegmentBar(container: HTMLElement): void {
  const wrap = container.querySelector('#sl-dest-bar-wrap') as HTMLElement | null;
  if (!wrap) return;
  if (!slActiveDest || isSyntheticDestination(slActiveDest.id) || slSegments.length === 0) {
    wrap.innerHTML = '';
    return;
  }

  const pills = slSegments
    .map((seg, i) => {
      const active = seg.id === slActiveSegment?.id;
      const confirmed = !!seg.basecamp_confirmed_at;
      const meta = dateRangeOnly(seg.start_date, seg.end_date);
      // 구간이 이거 하나뿐이면 지울(0개로 만들) 수 없으니 "삭제" 대신 "초기화"로 동작.
      const soleSegment = slSegments.length === 1;
      const actionAttr = soleSegment ? 'data-reset-seg="' + seg.id + '"' : 'data-del-seg="' + seg.id + '"';
      const actionTitle = soleSegment ? '이 숙소 설정 초기화' : '이 숙소 구간 삭제';
      return [
        '<button type="button" class="sl-seg-pill sl-seg-pill-compact' + (active ? ' active' : '') + (confirmed ? ' confirmed' : '') + '" data-seg-id="' + seg.id + '">',
        '  <span class="sl-seg-pill-idx">' + (confirmed ? IC_CHECK : String(i + 1)) + '</span>',
        '  <span class="sl-seg-pill-text">',
        '    <span class="sl-seg-pill-name">' + escapeHtml(segmentLabel(seg, i)) + '</span>',
        '    <span class="sl-seg-pill-meta">' + (meta ? escapeHtml(meta) + (confirmed ? ' · ' : '') : '') + (confirmed ? '<span class="sl-seg-pill-confirmed">확정됨</span>' : '') + '</span>',
        '  </span>',
        '  <span class="sl-seg-pill-del" ' + actionAttr + ' title="' + actionTitle + '">' + IC_XCLOSE + '</span>',
        '</button>',
      ].join('');
    })
    .join('');

  wrap.innerHTML = '<div class="sl-seg-bar sl-seg-bar-compact"><div class="sl-seg-pills">' + pills + '</div></div>';
  bindSegmentPillHandlers(wrap);
}

let segPopoverEl: HTMLElement | null = null;
function closeSegPopover(): void {
  if (segPopoverEl) { segPopoverEl.remove(); segPopoverEl = null; }
}

function isoDate(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** start~end(포함) 사이의 모든 날짜를 YYYY-MM-DD로 나열 */
function enumerateDays(startIso: string, endIso: string): string[] {
  const days: string[] = [];
  const cur = new Date(startIso);
  const end = new Date(endIso);
  while (cur <= end) {
    days.push(isoDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
/** 이 일수를 넘어가면(대략 2주+) 한 줄 스크롤 대신 요일 정렬된 달력 그리드로 전환 */
const SEG_DAYSTRIP_GRID_THRESHOLD = 14;

interface DateRangeModalOptions {
  title: string;
  desc: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  initialStart?: string | null;
  initialEnd?: string | null;
  saveLabel: string;
  /** 날짜 선택 UI 아래, 액션 버튼 위에 끼워 넣을 추가 필드 HTML (예: 예산 입력) */
  extraFieldsHtml?: string;
  onSave: (start: string | null, end: string | null, extra: Record<string, string>) => void | Promise<void>;
}

/**
 * 날짜 범위를 고르는 모달 (공용). 전체 기간(이미 알고 있는 값)을 나열해, 두 번 클릭(시작→끝)으로
 * 구간을 고른다. 기간이 짧으면 가로 한 줄 스트립, 2주가 넘어가면(예: 3~4주) 한 줄에 계속
 * 스크롤하기보다 요일이 맞춰진 달력 그리드로 접어서 한눈에 훑어볼 수 있게 한다.
 * 화면 하단에 팝오버로 띄우면 화면 밖으로 잘리는 문제가 있어 화면 중앙 모달로 띄운다.
 * "새 숙소 구간 추가"와 "숙박 기간 수정" 양쪽에서 재사용.
 */
function openDateRangeModal(opts: DateRangeModalOptions): void {
  closeSegPopover();

  const days = opts.rangeStart && opts.rangeEnd ? enumerateDays(opts.rangeStart, opts.rangeEnd) : [];
  const useGrid = days.length > SEG_DAYSTRIP_GRID_THRESHOLD;

  let pickedStart: string | null = opts.initialStart ?? null;
  let pickedEnd: string | null = opts.initialEnd ?? null;

  const dayPillHtml = (iso: string): string => {
    const d = new Date(iso);
    return [
      '<button type="button" class="sl-seg-day" data-date="' + iso + '">',
      '  <span class="sl-seg-day-dow">' + DOW_KO[d.getDay()] + '</span>',
      '  <span class="sl-seg-day-num">' + d.getDate() + '</span>',
      '</button>',
    ].join('');
  };

  /** 짧으면 가로 스트립, 길면(2주 초과) 요일 헤더 + 첫 날 요일만큼 앞을 비운 달력 그리드 */
  const buildDayStripHtml = (): string => {
    if (!useGrid) {
      return '<div class="sl-seg-daystrip" id="sp-daystrip">' + days.map(dayPillHtml).join('') + '</div>';
    }
    const header = '<div class="sl-seg-dow-header">' + DOW_KO.map((d) => '<span>' + d + '</span>').join('') + '</div>';
    const leadingCount = new Date(days[0]).getDay();
    const cells = days.map(dayPillHtml);
    const trailingCount = (7 - ((leadingCount + cells.length) % 7)) % 7;
    const blank = '<span class="sl-seg-day-empty"></span>';
    const grid =
      '<div class="sl-seg-daystrip grid" id="sp-daystrip">' +
      blank.repeat(leadingCount) +
      cells.join('') +
      blank.repeat(trailingCount) +
      '</div>';
    return header + grid;
  };

  const overlay = document.createElement('div');
  overlay.className = 'sl-seg-modal-overlay';
  overlay.innerHTML = [
    '<div class="sl-seg-modal' + (useGrid ? ' sl-seg-modal-wide' : '') + '">',
    '  <div class="sl-seg-pop-title">' + escapeHtml(opts.title) + '</div>',
    '  <div class="sl-seg-pop-desc">' + opts.desc + '</div>',
    days.length
      ? buildDayStripHtml()
      : [
          '  <div class="sl-seg-pop-dates">',
          '    <input class="sl-seg-pop-input" id="sp-start" type="date" value="' + (pickedStart ?? '') + '" />',
          '    <span class="sl-seg-pop-tilde">~</span>',
          '    <input class="sl-seg-pop-input" id="sp-end" type="date" value="' + (pickedEnd ?? '') + '" />',
          '  </div>',
        ].join(''),
    opts.extraFieldsHtml ?? '',
    '  <div class="sl-seg-pop-actions">',
    '    <button type="button" class="sl-seg-pop-cancel" id="sp-cancel">취소</button>',
    '    <button type="button" class="sl-seg-pop-save" id="sp-save">' + IC_PLUS + ' ' + escapeHtml(opts.saveLabel) + '</button>',
    '  </div>',
    '</div>',
  ].join('');
  document.body.appendChild(overlay);
  segPopoverEl = overlay;

  function refreshDayStates(): void {
    overlay.querySelectorAll<HTMLElement>('.sl-seg-day').forEach((el) => {
      const iso = el.dataset.date!;
      el.classList.remove('is-start', 'is-end', 'is-in-range');
      if (pickedStart && iso === pickedStart) el.classList.add('is-start');
      if (pickedEnd && iso === pickedEnd) el.classList.add('is-end');
      if (pickedStart && pickedEnd && iso > pickedStart && iso < pickedEnd) el.classList.add('is-in-range');
    });
  }
  if (days.length) refreshDayStates();

  overlay.querySelectorAll<HTMLElement>('.sl-seg-day').forEach((el) => {
    el.addEventListener('click', () => {
      const iso = el.dataset.date!;
      if (!pickedStart || pickedEnd || iso < pickedStart) {
        pickedStart = iso;
        pickedEnd = null;
      } else {
        pickedEnd = iso;
      }
      refreshDayStates();
    });
  });

  overlay.querySelector('#sp-cancel')?.addEventListener('click', closeSegPopover);
  overlay.querySelector('#sp-save')?.addEventListener('click', async () => {
    let start: string | null;
    let end: string | null;
    if (days.length) {
      start = pickedStart;
      end = pickedEnd || pickedStart;
    } else {
      start = (overlay.querySelector('#sp-start') as HTMLInputElement).value || null;
      end = (overlay.querySelector('#sp-end') as HTMLInputElement).value || null;
    }
    const extra: Record<string, string> = {};
    overlay.querySelectorAll<HTMLInputElement>('[data-extra-field]').forEach((el) => {
      extra[el.dataset.extraField!] = el.value;
    });
    (overlay.querySelector('#sp-save') as HTMLButtonElement).disabled = true;
    closeSegPopover();
    await opts.onSave(start, end, extra);
  });

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeSegPopover();
  });
}

/** "숙소 나누기" — 현재 숙소가 묵는 기간을 고르면, 남는 날짜를 새 빈 구간으로 자동 분리 */
function openSegmentDatePopover(_anchor: HTMLElement): void {
  // 나눌 대상은 현재(활성) 숙소 구간. 그 구간의 범위 안에서 기간을 고른다.
  const rangeStart = slActiveSegment?.start_date || slActiveDest?.start_date || currentTrip?.start_date || null;
  const rangeEnd = slActiveSegment?.end_date || slActiveDest?.end_date || currentTrip?.end_date || null;
  openDateRangeModal({
    title: '숙소 나누기',
    desc: '현재 숙소가 <b>묵는 기간</b>을 정하면, 남는 날짜는 새 숙소 구간으로 자동 분리돼요 <span class="sl-seg-pop-opt">(시작일→종료일 순으로 클릭)</span>',
    rangeStart,
    rangeEnd,
    initialStart: slActiveSegment?.start_date ?? null,
    initialEnd: slActiveSegment?.end_date ?? null,
    saveLabel: '나누기',
    onSave: async (start, end) => {
      await addSegment(start, end);
    },
  });
}

/**
 * "수정" — 현재 활성 숙소 구간의 숙박 기간을 다시 고르는 모달. "숙소 나누기"와 같은 규칙으로
 * 좁힌 기간 밖으로 밀려난 날짜는 새 빈 구간으로 자동 분리되지만(splitSegmentToRange 공유),
 * 나누기와 달리 화면은 Step1로 넘어가지 않고 지금 편집 중인(좁혀진) 숙소의 3단계에 그대로 머문다.
 */
function openStayDateEditor(): void {
  if (!currentTrip || !slActiveDest || !slActiveSegment || !slContainer) return;
  const rangeStart = slActiveSegment.start_date || slActiveDest.start_date || currentTrip.start_date || null;
  const rangeEnd = slActiveSegment.end_date || slActiveDest.end_date || currentTrip.end_date || null;
  const headcount = getTripHeadcount();
  const budgetFieldHtml = [
    '  <div class="sl-seg-pop-budget">',
    '    <label class="sl-seg-pop-budget-label">총 숙박 예산 (전체 ' + headcount + '인 · 전체 숙박일 기준)</label>',
    '    <div class="sl-seg-pop-budget-row">',
    '      <input type="number" class="sl-seg-pop-input" data-extra-field="totalBudget" id="sp-budget-total" placeholder="예: 900000" value="' + (totalBudgetKRW ?? '') + '" />',
    '      <span class="sl-budget-custom-unit">원</span>',
    '    </div>',
    '    <div class="sl-seg-pop-budget-hint">숙박일 수 × 인원수로 나눠서 "1박 1인" 기준으로 표기돼요</div>',
    '  </div>',
  ].join('\n');

  openDateRangeModal({
    title: '숙박 기간 수정',
    desc: '이 숙소에 묵는 기간을 다시 정해요. 남는 날짜는 새 숙소 구간으로 자동 분리돼요 <span class="sl-seg-pop-opt">(시작일→종료일 순으로 클릭)</span>',
    rangeStart,
    rangeEnd,
    initialStart: slActiveSegment.start_date,
    initialEnd: slActiveSegment.end_date,
    saveLabel: '저장',
    extraFieldsHtml: budgetFieldHtml,
    onSave: async (start, end, extra) => {
      totalBudgetKRW = extra.totalBudget ? Number(extra.totalBudget) : null;
      if (!slContainer) return;
      if (start && end) {
        const result = await splitSegmentToRange(start, end);
        if (result?.configured) {
          slActiveSegment = result.configured;
          setActiveSegmentId(slActiveDest!.id, result.configured.id);
        }
      }
      renderStep(slContainer);
    },
  });
}

function renderStepper(container: HTMLElement): void {
  const stepperEl = container.querySelector('#sl-stepper') as HTMLElement;
  const steps = [
    { n: 1, label: '지역 선택' },
    { n: 2, label: '숙소 선택' },
    { n: 3, label: '확정' },
  ];

  stepperEl.innerHTML = steps
    .map((s, i) => {
      const state = s.n === step ? 'active' : s.n < step ? 'done' : '';
      const clickable = s.n < step;
      return [
        '<div class="sl-step ' + state + (clickable ? ' clickable' : '') + '" data-step="' + s.n + '">',
        '  <span class="sl-step-num">' + (s.n < step ? IC_CHECK : s.n) + '</span>',
        '  <span class="sl-step-label">' + s.label + '</span>',
        '</div>',
        i < steps.length - 1 ? '<div class="sl-step-line"></div>' : '',
      ].join('');
    })
    .join('');

  stepperEl.querySelectorAll('.sl-step.clickable').forEach((el) => {
    el.addEventListener('click', () => {
      step = Number((el as HTMLElement).dataset.step) as 1 | 2 | 3;
      // container는 renderStep()이 넘겨준 바로 그 바깥 컨테이너(.sl-shell의 부모)라 이미 정답.
      // body(.sl-shell 안쪽)에서 쓰는 body.closest('.sl-shell')!.parentElement 패턴을 여기 그대로
      // 베껴 쓰면 container 자신은 .sl-shell의 조상이 아니라 부모라 closest가 null을 반환해 터짐.
      renderStep(container);
    });
  });
}

/* ══════════════════ STEP 1 — Overview Map ══════════════════ */
async function renderStep1(body: HTMLElement): Promise<void> {
  // 이미 진행 중인 지역이 있으면(Step2/3에서 되돌아왔거나, 재진입으로 Step1부터 다시 시작된
  // 경우) 카드/지도에 그 선택을 바로 표시해 어디까지 진행했는지 한눈에 보이게 함
  if (selectedZone) pendingSelectedZoneId = selectedZone.id;

  body.innerHTML = [
    '<div class="sl-step1">',
    '  <div class="sl-step1-header">',
    '    <div class="sl-eyebrow">DEPARTURE HALL</div>',
    '    <div class="sl-title">어느 지역을 중심으로 여행할까요?</div>',
    '  </div>',
    '  <div class="sl-step1-layout">',
    '    <div class="sl-map-wrap">',
    '      <div id="sl-map" class="sl-map"></div>',
    '      <div class="sl-map-legend">',
    '        <span><span class="sl-legend-dot" style="--dot:#E24B4A"></span>관광(VISIT)</span>',
    '        <span><span class="sl-legend-dot" style="--dot:#1D9E75"></span>맛집(FOOD)</span>',
    '        <span><span class="sl-legend-dot" style="--dot:#7F77DD"></span>액티비티(ACTIVITY)</span>',
    '        <span><span class="sl-legend-dot" style="--dot:#185FA5"></span>숙소 후보(STAY)</span>',
    '      </div>',
    '    </div>',
    '    <div class="sl-zone-panel">',
    '      <div class="sl-zone-panel-head"><span class="sl-zone-panel-sort">추천 순</span></div>',
    '      <div class="sl-zone-search">',
    '        <span class="sl-zone-search-icon">' + IC_SEARCH2 + '</span>',
    '        <input type="text" id="sl-zone-search-input" class="sl-zone-search-input" placeholder="추천 목록에 없는 지역·장소 검색해서 추가 (예: 수완나품 공항)" autocomplete="off" />',
    '      </div>',
    '      <div class="sl-zone-list" id="sl-zone-list"></div>',
    zoneDataSource === 'ai_fallback'
      ? '      <div class="sl-ai-reason sl-ai-reason-compact"><span class="sl-ai-reason-icon">' + IC_SPARK + '</span><span class="sl-ai-reason-text">이 여행지는 아직 검수된 지역 데이터가 없어 AI가 추정한 생활권을 사용 중이에요.</span></div>'
      : '',
    '      <div class="sl-zone-cta-sticky" id="sl-zone-cta-sticky"></div>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');

  renderZoneCards(body);
  attachZoneSearch(body);
  renderSelectBar(body);
  await initMap(body);
  if (pendingSelectedZoneId) highlightZone(pendingSelectedZoneId);
}

/** 사용자가 직접 검색해 추가한 권역 카드 — AI 통계(장소 수/이동시간 등)가 없어 간소화된 형태.
 *  직접 추가한 것이라 언제든 제거할 수 있게 우측 상단에 ✕ 버튼을 둔다. */
function buildCustomZoneCardHtml(zone: Zone): string {
  const isSelected = pendingSelectedZoneId === zone.id;
  return [
    '<button type="button" class="sl-zone-card sl-zone-card-custom' + (isSelected ? ' selected' : '') + '" data-zone-id="' + zone.id + '" style="--zone-color:' + zoneColor(zone.id) + '">',
    '  <span class="sl-zone-custom-remove" data-remove-zone="' + zone.id + '" title="이 지역 제거">' + IC_XCLOSE + '</span>',
    '  <div class="sl-zone-card-hero sl-zone-card-hero-empty sl-zone-card-hero-custom">' + IC_PIN + '</div>',
    '  <div class="sl-zone-card-main">',
    '    <div class="sl-zone-card-top">',
    '      <div class="sl-zone-card-name">' + escapeHtml(zone.name) + '</div>',
    '    </div>',
    '    <div class="sl-zone-card-tags"><span class="sl-zone-tag sl-zone-tag-custom">직접 추가</span></div>',
    zone.address ? '    <div class="sl-zone-card-custom-address">' + escapeHtml(zone.address) + '</div>' : '',
    '  </div>',
    '</button>',
  ].join('');
}

/** 직접 추가한 권역을 목록에서 제거 (선택돼 있었으면 해제하고 지도도 재구성) */
async function removeCustomZone(zoneId: string, body: HTMLElement): Promise<void> {
  zones = zones.filter((z) => z.id !== zoneId);
  if (pendingSelectedZoneId === zoneId) pendingSelectedZoneId = null;
  renderZoneCards(body);
  renderSelectBar(body);
  await initMap(body);
}

function renderZoneCards(body: HTMLElement): void {
  const listEl = body.querySelector('#sl-zone-list') as HTMLElement;
  // 직접 추가한 권역은 AI 순위(rank)와 무관하게 항상 맨 위에 고정
  const customZones = zones.filter((z) => z.isCustom);
  const aiZones = [...zones.filter((z) => !z.isCustom)].sort((a, b) => a.rank - b.rank);
  const sorted = [...customZones, ...aiZones];

  listEl.innerHTML = sorted
    .map((zone) => {
      if (zone.isCustom) return buildCustomZoneCardHtml(zone);

      const stars = zone.avgRating != null ? buildStars(zone.avgRating) : '';
      const isSelected = pendingSelectedZoneId === zone.id;
      const heroPhoto = zone.topPlaces.find((p) => p.photo_url)?.photo_url ?? null;
      const THUMB_DEFAULT = 2;

      return [
        '<button type="button" class="sl-zone-card' + (isSelected ? ' selected' : '') + '" data-zone-id="' + zone.id + '" style="--zone-color:' + zoneColor(zone.id) + '">',
        heroPhoto
          ? '<div class="sl-zone-card-hero" style="background-image:url(\'' + heroPhoto + '\')"><span class="sl-zone-card-rank">' + zone.rank + '</span></div>'
          : '<div class="sl-zone-card-hero sl-zone-card-hero-empty"><span class="sl-zone-card-rank">' + zone.rank + '</span></div>',
        '<div class="sl-zone-card-main">',
        '  <div class="sl-zone-card-top">',
        '    <div class="sl-zone-card-name">' + escapeHtml(zone.name) + '</div>',
        stars ? '<div class="sl-zone-card-stars">' + stars + '</div>' : '',
        '  </div>',
        '  <div class="sl-zone-card-tags">',
        (zone.features ?? []).slice(0, 3).map((f) => '<span class="sl-zone-tag">' + escapeHtml(f) + '</span>').join(''),
        '  </div>',
        '  <div class="sl-zone-card-bottom-row">',
        '    <div class="sl-zone-card-stats">',
        '      <div class="sl-zone-stat"><span class="sl-zone-stat-label">장소 수</span><span class="sl-zone-stat-value">' + zone.places.length + '개</span></div>',
        zone.avgInternalWalkMin != null
          ? '<div class="sl-zone-stat"><span class="sl-zone-stat-label">평균 이동시간</span><span class="sl-zone-stat-value">' + zone.avgInternalWalkMin + '분</span></div>'
          : '',
        '      <div class="sl-zone-stat"><span class="sl-zone-stat-label">추천 숙박일</span><span class="sl-zone-stat-value">' + zone.recommendedNights + '일</span></div>',
        '      <div class="sl-zone-stat"><span class="sl-zone-stat-label">이동 효율</span><span class="sl-zone-stat-value sl-zone-eff">' + zone.efficiencyLabel + '</span></div>',
        '    </div>',
        zone.topPlaces.length > 0
          ? '    <div class="sl-zone-card-thumbs">' +
            zone.topPlaces.slice(0, THUMB_DEFAULT).map((p) =>
              p.photo_url
                ? '<div class="sl-zone-thumb" style="background-image:url(\'' + p.photo_url + '\')" title="' + escapeHtml(p.name) + '"></div>'
                : ''
            ).join('') +
            (zone.places.length > THUMB_DEFAULT ? '<div class="sl-zone-thumb-more" data-zone-id="' + zone.id + '">+' + (zone.places.length - THUMB_DEFAULT) + '</div>' : '') +
            '</div>'
          : '',
        '  </div>',
        '</div>',
        '</button>',
      ].join('');
    })
    .join('');

  // 직접 추가한 권역의 ✕ 제거 버튼
  listEl.querySelectorAll('[data-remove-zone]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      void removeCustomZone((btn as HTMLElement).dataset.removeZone!, body);
    });
  });

  listEl.querySelectorAll('.sl-zone-card').forEach((card) => {
    const zoneId = (card as HTMLElement).dataset.zoneId!;
    const isCustom = (card as HTMLElement).classList.contains('sl-zone-card-custom');
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('sl-zone-thumb-more')) return;
      if ((e.target as HTMLElement).closest('[data-remove-zone]')) return; // ✕는 별도 처리
      // 직접 추가한 권역은 이미 선택된 상태에서 다시 누르면(토글 오프) 아예 제거
      if (isCustom && pendingSelectedZoneId === zoneId) {
        void removeCustomZone(zoneId, body);
        return;
      }
      pendingSelectedZoneId = pendingSelectedZoneId === zoneId ? null : zoneId;
      highlightZone(pendingSelectedZoneId);
      renderZoneCards(body);
      renderSelectBar(body);
    });
  });

  listEl.querySelectorAll('.sl-zone-thumb-more').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const zoneId = (btn as HTMLElement).dataset.zoneId!;
      const zone = zones.find((z) => z.id === zoneId);
      const thumbsEl = (btn.closest('.sl-zone-card-thumbs') as HTMLElement);
      if (!zone || !thumbsEl) return;
      thumbsEl.classList.add('expanded');
      thumbsEl.innerHTML = zone.places.map((p) =>
        p.photo_url
          ? '<div class="sl-zone-thumb" style="background-image:url(\'' + p.photo_url + '\')" title="' + escapeHtml(p.name) + '"></div>'
          : ''
      ).join('');
    });
  });

  renderSelectBar(body);
}

/* ══════════ 지역 직접 검색 — AI 추천에 없는 곳(예: 공항 근처)을 직접 추가 ══════════ */

let zoneSearchDebounce: ReturnType<typeof setTimeout> | null = null;
let zoneSearchPredictions: PlacePrediction[] = [];
let zoneSearchDropdownEl: HTMLElement | null = null;
let zoneSearchDismiss: ((e: MouseEvent) => void) | null = null;

function closeZoneSearchDropdown(): void {
  zoneSearchDropdownEl?.remove();
  zoneSearchDropdownEl = null;
  if (zoneSearchDismiss) {
    document.removeEventListener('mousedown', zoneSearchDismiss);
    zoneSearchDismiss = null;
  }
}

function attachZoneSearch(body: HTMLElement): void {
  const input = body.querySelector('#sl-zone-search-input') as HTMLInputElement | null;
  if (!input) return;

  input.addEventListener('input', () => {
    const query = input.value.trim();
    if (zoneSearchDebounce) clearTimeout(zoneSearchDebounce);
    if (query.length < 2) {
      closeZoneSearchDropdown();
      return;
    }
    zoneSearchDebounce = setTimeout(async () => {
      try {
        await loadGoogleMapsScript();
      } catch {
        return;
      }
      const predictions = await getPlacePredictions(query);
      if (input.value.trim() !== query) return; // 그새 입력이 더 바뀌었으면 낡은 결과 무시
      zoneSearchPredictions = predictions;
      if (predictions.length === 0) {
        closeZoneSearchDropdown();
        return;
      }
      renderZoneSearchDropdown(input, body);
    }, 350);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeZoneSearchDropdown();
  });
}

function renderZoneSearchDropdown(input: HTMLInputElement, body: HTMLElement): void {
  closeZoneSearchDropdown();

  const dropdown = document.createElement('div');
  dropdown.className = 'sl-zone-search-dropdown';
  dropdown.innerHTML = zoneSearchPredictions
    .map((p, i) => [
      '<button type="button" class="sl-zone-search-item" data-idx="' + i + '">',
      '  <span class="sl-zone-search-item-icon">' + IC_PIN + '</span>',
      '  <span class="sl-zone-search-item-text">',
      '    <span class="sl-zone-search-item-main">' + escapeHtml(p.mainText) + '</span>',
      p.secondaryText ? '    <span class="sl-zone-search-item-sub">' + escapeHtml(p.secondaryText) + '</span>' : '',
      '  </span>',
      '</button>',
    ].join(''))
    .join('');
  document.body.appendChild(dropdown);
  zoneSearchDropdownEl = dropdown;

  const r = input.getBoundingClientRect();
  dropdown.style.position = 'fixed';
  dropdown.style.left = r.left + 'px';
  dropdown.style.width = r.width + 'px';
  dropdown.style.top = r.bottom + 6 + 'px';

  dropdown.querySelectorAll('.sl-zone-search-item').forEach((el) => {
    el.addEventListener('click', async () => {
      const idx = Number((el as HTMLElement).dataset.idx);
      const prediction = zoneSearchPredictions[idx];
      closeZoneSearchDropdown();
      input.value = '';
      await addCustomZoneFromPrediction(prediction, body);
    });
  });

  zoneSearchDismiss = (e: MouseEvent) => {
    if (zoneSearchDropdownEl && !zoneSearchDropdownEl.contains(e.target as Node) && e.target !== input) {
      closeZoneSearchDropdown();
    }
  };
  setTimeout(() => document.addEventListener('mousedown', zoneSearchDismiss!), 0);
}

/** 검색해서 고른 위치를 places 없는 "직접 추가" 권역으로 만들어 목록 맨 위에 꽂고 바로 선택 상태로 */
async function addCustomZoneFromPrediction(prediction: PlacePrediction, body: HTMLElement): Promise<void> {
  let details: any;
  try {
    details = await getPlaceDetails(prediction.placeId);
  } catch (e) {
    console.error('[Shortlist] 지역 검색 상세정보 조회 실패:', (e as Error).message);
    return;
  }
  const lat = details.location ? details.location.lat() : null;
  const lng = details.location ? details.location.lng() : null;
  if (lat == null || lng == null) return;

  const id = 'custom:' + prediction.placeId;
  if (!zones.some((z) => z.id === id)) {
    const customZone: Zone = {
      id,
      name: details.displayName || prediction.mainText,
      features: [],
      places: [],
      centerLat: lat,
      centerLng: lng,
      avgRating: null,
      avgInternalWalkMin: null,
      recommendedNights: 1,
      topPlaces: [],
      efficiencyLabel: '',
      rank: 0,
      isCustom: true,
      address: details.formattedAddress || prediction.secondaryText || null,
    };
    zones = [customZone, ...zones];
  }
  pendingSelectedZoneId = id;

  renderZoneCards(body);
  renderSelectBar(body);
  // 새 권역의 폴리곤/마커/라벨을 지도에 반영하려면 재초기화 필요(초기화 시 초기 화면 맞춤이
  // 이뤄지므로, 방금 추가한 권역으로 다시 포커스하는 highlightZone을 그 다음에 호출)
  await initMap(body);
  highlightZone(id);
}

function renderSelectBar(body: HTMLElement): void {
  const barEl = body.querySelector('#sl-zone-cta-sticky') as HTMLElement;
  if (!barEl) return;

  if (!pendingSelectedZoneId) {
    barEl.innerHTML = '';
    barEl.classList.remove('visible');
    return;
  }

  const zone = zones.find((z) => z.id === pendingSelectedZoneId);
  if (!zone) return;

  // 이미 이 지역으로 진행 중이었으면(Step1로 되돌아왔을 뿐) "새로 시작"이 아니라 "이어서
  // 진행"임 — 문구도 다르게 보여주고, 클릭해도 이미 고른 숙소/확정 내역을 지우지 않음
  const isResuming = selectedZone?.id === zone.id && (selectedBasecamp != null || confirmedIds.size > 0);

  barEl.classList.add('visible');
  barEl.innerHTML = [
    '<button type="button" class="sl-zone-cta-btn" id="sl-confirm-zone">',
    '  <span>' + IC_PLANE + escapeHtml(zone.name) +
      (isResuming ? ' 지역 — 이어서 진행할게요' : ' 지역을 중심으로 숙소를 선택할게요') + '</span>',
    '  ' + IC_ARROW,
    '</button>',
  ].join('\n');

  barEl.querySelector('#sl-confirm-zone')?.addEventListener('click', () => {
    const isSameZone = selectedZone?.id === zone.id;
    selectedZone = zone;
    if (!isSameZone) {
      selectedBasecamp = null;
      confirmedIds = new Set();
    }
    step = selectedBasecamp ? 3 : 2;
    // 지역 선택 시점에 바로 저장 — 여기서 새로고침해도 Step2부터 복원됨 (진행상황 유실 방지)
    void saveShortlistState();
    const container = body.closest('.sl-shell')!.parentElement as HTMLElement;
    renderStep(container);
  });
}

function countByMood(places: Place[]): Record<string, number> {
  const counts: Record<string, number> = {};
  places.forEach((p) => {
    if (!p.mood) return;
    counts[p.mood] = (counts[p.mood] ?? 0) + 1;
  });
  return counts;
}

function buildStars(rating: number): string {
  const rounded = Math.round(rating);
  return '★'.repeat(Math.min(5, Math.max(0, rounded))) + ' <span class="sl-zone-rating-num">' + rating.toFixed(1) + '</span>';
}

const ZONE_PALETTE = ['#E24B4A', '#1D9E75', '#7F77DD', '#F5A623', '#D4537E', '#378ADD', '#0F9E9E', '#B45309'];
function zoneColor(zoneId: string): string {
  const idx = zones.findIndex((z) => z.id === zoneId);
  return ZONE_PALETTE[(idx < 0 ? 0 : idx) % ZONE_PALETTE.length];
}

/* 권역 도형 스타일 — "지도 위에 살짝 입혀진 생활권"이 목표라 채움은 최소로, 경계선만 살짝 강조 */
const ZONE_FILL_OPACITY = 0.07;
const ZONE_STROKE_OPACITY = 0.6;
const ZONE_STROKE_WEIGHT = 1.8;

/** 권역 중심에서 이 거리보다 먼 장소는 "이 권역 도형" 범위 계산에서만 제외(장소 자체의 권역 소속·마커 표시는 그대로 유지) */
const ZONE_OUTLIER_KM = 4;
/** 전체 장소 외곽선을 이만큼 부풀려 "도시 마스크"를 만들고, 그 밖으로 뻗는 셀을 잘라냄 */
const ZONE_CITY_PAD_KM = 0.9;
/** Chaikin 스무딩 반복 횟수 — 높을수록 모서리가 둥글어지지만 이웃과의 접합면이 조금씩 벌어짐 */
const ZONE_SMOOTH_ITERATIONS = 2;
/** 경계선을 흔들기 전에 이 간격(km)마다 점을 하나씩 끼워 넣음 — 보로노이가 만든 긴 직선
 *  구간에도 흔들림이 실리게 하려면 점이 촘촘해야 함 */
const ZONE_EDGE_DENSIFY_KM = 0.25;
/** 경계선 각 점을 최대 이만큼(km) 밀어내 자연스러운 굴곡을 만듦. 0으로 두면 흔들림 없음 */
const ZONE_EDGE_JITTER_KM = 0.13;
/** densify 후 링 하나가 가질 수 있는 최대 점 개수(그린 뒤 스무딩에서 2배씩 늘어나므로 안전장치) */
const ZONE_EDGE_MAX_POINTS = 400;

type Ring = { lat: number; lng: number }[];

/**
 * 좌표만으로 결정되는 부드러운 의사난수(-1~1). Math.random()이 아니라 위치의 함수라서
 *  ① 렌더링할 때마다 도형이 달라지지 않고,
 *  ② 이웃 권역이 공유하는 경계선은 양쪽에서 "같은 좌표 → 같은 값"이 나와 똑같이 흔들리므로
 *     보로노이로 맞물려 있던 접합면이 벌어지거나 겹치지 않음.
 * 서로 다른 주파수의 sin을 겹쳐 이웃한 점끼리는 비슷하게, 멀어질수록 다르게 움직이게 함.
 */
function coherentNoise(lng: number, lat: number, seed: number): number {
  const x = lng * 100 + seed * 13.7;
  const y = lat * 100 + seed * 7.3;
  return (
    Math.sin(x * 1.7 + Math.cos(y * 1.3) * 2.1) * 0.6 +
    Math.sin(y * 2.3 + Math.cos(x * 1.9) * 1.7) * 0.4
  );
}

/** 긴 변에 중간점을 끼워 넣어 링을 촘촘하게 만듦 (흔들림이 실릴 자리를 확보) */
function densifyRing(ring: number[][], stepKm: number, maxPoints: number): number[][] {
  if (ring.length < 2) return ring;
  const cosLat = Math.cos((ring[0][1] * Math.PI) / 180);
  const out: number[][] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    out.push([lng1, lat1]);
    const segKm = Math.sqrt(((lng2 - lng1) * 111 * cosLat) ** 2 + ((lat2 - lat1) * 111) ** 2);
    const parts = Math.min(Math.floor(segKm / stepKm), maxPoints);
    for (let k = 1; k < parts; k++) {
      const t = k / parts;
      out.push([lng1 + (lng2 - lng1) * t, lat1 + (lat2 - lat1) * t]);
    }
    if (out.length > maxPoints) break;
  }
  out.push(ring[ring.length - 1]);
  return out;
}

/** 각 점을 좌표 기반 노이즈만큼 밀어 경계선을 자연스럽게 구불거리게 만듦 */
function jitterRing(ring: number[][], jitterKm: number): number[][] {
  if (jitterKm <= 0) return ring;
  const cosLat = Math.max(0.1, Math.cos((ring[0][1] * Math.PI) / 180));
  const jittered = ring.map(([lng, lat]) => [
    lng + (coherentNoise(lng, lat, 1) * jitterKm) / (111 * cosLat),
    lat + (coherentNoise(lng, lat, 2) * jitterKm) / 111,
  ]);
  // 링은 첫 점과 끝 점이 같아야 닫힘 — 노이즈는 좌표의 함수라 값이 같게 나오지만 명시적으로 맞춰줌
  jittered[jittered.length - 1] = jittered[0];
  return jittered;
}

/** 볼록 다각형을 중심점 기준 방사형으로 약 kmOut만큼 밀어냄 — 정확한 위상학적 버퍼는 아니지만
 *  볼록 도형에서는 시각적으로 충분히 자연스럽고, @turf/buffer(무거운 JTS 포팅) 없이 처리 가능 */
function inflateConvexRing(ring: number[][], kmOut: number): number[][] {
  const cLng = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const cosLat = Math.cos((cLat * Math.PI) / 180);
  return ring.map(([lng, lat]) => {
    const dLng = lng - cLng;
    const dLat = lat - cLat;
    const distKm = Math.sqrt((dLng * 111 * cosLat) ** 2 + (dLat * 111) ** 2);
    if (distKm < 1e-6) return [lng, lat];
    const scale = (distKm + kmOut) / distKm;
    return [cLng + dLng * scale, cLat + dLat * scale];
  });
}

/** GeoJSON Feature에서 가장 큰(꼭짓점이 많은) 외곽 링을 뽑음 — Polygon/MultiPolygon 모두 처리 */
function largestRing(feature: any): number[][] | null {
  const geom = feature?.geometry;
  if (!geom) return null;
  if (geom.type === 'Polygon') return geom.coordinates[0] ?? null;
  if (geom.type === 'MultiPolygon') {
    let best: number[][] | null = null;
    for (const poly of geom.coordinates) {
      const outer = poly[0];
      if (outer && (!best || outer.length > best.length)) best = outer;
    }
    return best;
  }
  return null;
}

/**
 * 권역 폴리곤 — "권역 중심 1점"이 아니라 "그 권역에 실제로 배정된 장소들 전부"를 보로노이 씨앗으로
 * 삼고, 같은 권역에 속한 셀들을 union해서 만든다.
 *
 * 이렇게 하는 이유(과거 버전들의 문제):
 *  - 사인파 랜덤 얼룩 버전: 실제 장소 위치와 무관해 도형이 장소를 못 감싸고 이웃과 겹침
 *  - 권역중심 1점 보로노이 + 원 트림 버전: 겹침은 사라졌지만 트림 원 때문에 바깥 권역이
 *    사실상 완전한 원이 돼버림(변동계수 cv≈0.00 측정). 실제 도시 생활권처럼 안 보임
 *
 * 장소 기반으로 바꾸면 폴리곤이 장소 분포를 따라 자연스럽게 늘어지고(측정상 종횡비 최대 1.75,
 * cv 0.03 → 0.28), 같은 보로노이 분할에서 나온 셀들이라 이웃 권역과 겹치지 않고 빈틈 없이
 * 맞물린다. 바깥 경계는 원이 아니라 "전체 장소 외곽선 + 여유(ZONE_CITY_PAD_KM)"로 잘라서
 * 도시의 실제 형태를 따르게 한다.
 *
 * outlier(권역 중심에서 ZONE_OUTLIER_KM 이상 떨어진 장소 — 예: 공항)는 도형 계산에서만
 * 제외되고, 그 장소의 권역 소속이나 지도 마커 표시는 그대로 유지된다.
 * 유효한 장소가 없는 권역은 폴리곤을 만들지 않는다(Map에 항목 없음 → 호출부가 도형 없이 렌더).
 */
function computeZonePolygons(allZones: Zone[]): Map<string, Ring> {
  const result = new Map<string, Ring>();

  // 1. 권역별 유효 장소 수집 (좌표 있음 + outlier 아님 + 좌표 중복 제거)
  //    좌표가 완전히 같은 점이 둘 이상이면 보로노이가 빈 셀을 만들어내므로 미리 걸러야 함
  const seenCoords = new Set<string>();
  const seeds: number[][] = [];
  const seedOwner: string[] = [];

  allZones.forEach((zone) => {
    if (!Number.isFinite(zone.centerLat) || !Number.isFinite(zone.centerLng)) return;
    zone.places.forEach((p) => {
      if (p.lat == null || p.lng == null) return;
      if (haversineKm(zone.centerLat, zone.centerLng, p.lat, p.lng) > ZONE_OUTLIER_KM) return;
      const key = p.lng.toFixed(6) + ',' + p.lat.toFixed(6);
      if (seenCoords.has(key)) return;
      seenCoords.add(key);
      seeds.push([p.lng, p.lat]);
      seedOwner.push(zone.id);
    });
  });

  // 보로노이는 씨앗이 최소 3개는 있어야 의미 있는 분할이 나옴
  if (seeds.length < 3) return result;

  const seedFC = turfPoints(seeds);

  // 2. 도시 마스크 — 전체 장소의 외곽선을 부풀린 도형(원이 아니라 실제 분포 형태).
  //    @turf/buffer는 정확한 위상 연산(JTS 포팅)을 쓰느라 번들이 1MB 가까이 커져서,
  //    "볼록 껍질을 중심에서 바깥으로 살짝 밀어내는" 정도로 충분한 이 용도엔 과함 —
  //    convex hull은 볼록 도형이라 중심 기준 방사형 스케일로도 자연스럽게 부풀릴 수 있음.
  let cityMask: any = null;
  try {
    const hull = convex(seedFC);
    const hullRing = hull ? largestRing(hull) : null;
    if (hullRing) cityMask = turfPolygon([inflateConvexRing(hullRing, ZONE_CITY_PAD_KM)]);
  } catch {
    cityMask = null;
  }
  if (!cityMask) return result;

  // 3. 장소 전체로 보로노이 분할
  const rawBbox = bbox(seedFC);
  const padDeg = (ZONE_CITY_PAD_KM * 3) / 111; // 대략 위경도 1도 ≈ 111km
  let cells;
  try {
    cells = voronoi(seedFC, {
      bbox: [rawBbox[0] - padDeg, rawBbox[1] - padDeg, rawBbox[2] + padDeg, rawBbox[3] + padDeg],
    });
  } catch {
    return result; // 씨앗이 일직선상에 있는 등 계산 불가 — 도형 없이 폴백
  }

  // 4. 권역별로 자기 장소들의 셀을 도시 마스크로 자른 뒤 union
  const merged = new Map<string, any>();
  cells.features.forEach((cell: any, i: number) => {
    if (!cell) return;
    const zoneId = seedOwner[i];
    let clipped;
    try {
      clipped = intersect(featureCollection([cell, cityMask]));
    } catch {
      return;
    }
    if (!clipped) return;

    const prev = merged.get(zoneId);
    if (!prev) {
      merged.set(zoneId, clipped);
      return;
    }
    try {
      const joined = union(featureCollection([prev, clipped]));
      if (joined) merged.set(zoneId, joined);
    } catch {
      /* union 실패 시 기존 것 유지 */
    }
  });

  // 5. 촘촘하게 → 자연스럽게 흔들기 → 모서리 스무딩 후 링으로 변환.
  //    보로노이 셀은 직선 변으로만 이뤄져 있어 그대로 두면 "칼로 자른 다각형"처럼 보임.
  //    점을 촘촘히 깐 뒤 좌표 기반 노이즈로 밀어내면 실제 생활권처럼 불규칙한 곡선이 되고,
  //    노이즈가 좌표의 함수라 이웃 권역과 맞닿은 면은 양쪽이 똑같이 움직여 틈이 안 생김.
  merged.forEach((feature, zoneId) => {
    let ring = largestRing(feature);
    if (!ring || ring.length < 4) return;

    ring = jitterRing(densifyRing(ring, ZONE_EDGE_DENSIFY_KM, ZONE_EDGE_MAX_POINTS), ZONE_EDGE_JITTER_KM);

    try {
      const smoothed = polygonSmooth(turfPolygon([ring]), { iterations: ZONE_SMOOTH_ITERATIONS });
      const smoothedRing = largestRing(smoothed.features[0]);
      if (smoothedRing && smoothedRing.length >= 4) ring = smoothedRing;
    } catch {
      /* 스무딩 실패 시 각진 원본 그대로 사용 */
    }

    result.set(
      zoneId,
      ring.map(([lng, lat]) => ({ lat, lng }))
    );
  });

  return result;
}

/** 폴리곤 라벨을 놓을 위치 — 꼭짓점 평균(권역 중심점보다 도형 중앙에 가깝게 보임) */
function ringCentroid(ring: Ring): { lat: number; lng: number } {
  const sum = ring.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / ring.length, lng: sum.lng / ring.length };
}

/** 카테고리별 색상이 채워진 원형 마커 아이콘 (data URI, 추가 요청 없음) */
let placeInfoWindow: any = null;
/** true면 클릭으로 "고정"된 상태 — hover로 다른 마커를 지나가도 안 바뀌고, mouseout으로도 안 닫힘 */
let placeInfoWindowPinned = false;

/* ── 장소 정보창 치수 — 여기 숫자만 바꾸면 Step1/2/3 정보창 크기가 한 번에 바뀜.
 *    INFO_WINDOW_SCALE 하나만 바꿔도 폭·사진·글자·버튼이 전부 같은 비율로 같이 줄거나 늘어남
 *    (호버 정보창이 너무 커 보인다는 피드백으로 기존 크기의 70%로 축소함) ── */
const INFO_WINDOW_SCALE = 0.7;
const INFO_WINDOW_MAX_WIDTH_PX = Math.round(220 * INFO_WINDOW_SCALE);
const INFO_WINDOW_MAX_WIDTH_VW = Math.round(60 * INFO_WINDOW_SCALE); // 좁은 화면에서는 뷰포트 폭의 이 비율을 넘지 않음
const INFO_WINDOW_PHOTO_MIN_H = Math.round(40 * INFO_WINDOW_SCALE);
const INFO_WINDOW_PHOTO_MAX_H = Math.round(90 * INFO_WINDOW_SCALE);
/** 사진 높이 = 지도 컨테이너 실제 높이 × 이 비율 (min/max 사이로 clamp) */
const INFO_WINDOW_PHOTO_HEIGHT_RATIO = 0.22 * INFO_WINDOW_SCALE;
const INFO_WINDOW_CLOSE_BTN_SIZE = Math.round(22 * INFO_WINDOW_SCALE);
const INFO_WINDOW_CLOSE_BTN_ID = 'sl-info-close-btn';
const INFO_WINDOW_NAME_FONT_SIZE = +(13.5 * INFO_WINDOW_SCALE).toFixed(1);
const INFO_WINDOW_TAG_FONT_SIZE = +(10 * INFO_WINDOW_SCALE).toFixed(1);
const INFO_WINDOW_STAR_FONT_SIZE = +(11.5 * INFO_WINDOW_SCALE).toFixed(1);
const INFO_WINDOW_LINK_FONT_SIZE = +(11.5 * INFO_WINDOW_SCALE).toFixed(1);

/**
 * 마커에 마우스를 올리거나 클릭하면 이미 우리 DB에 저장돼 있는 장소 정보(이름/카테고리/평점/
 * 사진)를 보여줌. Google Place Details를 다시 호출하지 않음 — 추가 API 비용 0원.
 * "Google Maps에서 보기" 링크도 google_place_id 기반 딥링크라 API 호출이 필요 없음.
 *
 * pin=true(클릭)면 hover로 열렸을 때와 달리 mouseout으로 닫히지 않고 유지됨 — X 버튼을
 * 누르거나 지도 빈 곳/다른 마커를 클릭해야 풀림.
 */
function showPlaceInfoWindow(g: any, map: any, marker: any, place: Place, pin = false): void {
  if (!placeInfoWindow) {
    // disableAutoPan: 정보창을 열 때 지도가 저절로 움직이던 것 방지(hover만 해도 지도가
    // 흔들리던 문제) — 대신 내용 자체를 작은 화면에서도 안 잘리게 만드는 쪽으로 대응
    placeInfoWindow = new g.maps.InfoWindow({ disableAutoPan: true });
    placeInfoWindow.addListener('closeclick', () => {
      placeInfoWindowPinned = false;
    });
    // 구글 기본 닫기 버튼(사진과 겹쳐 어색하게 뜸)은 CSS로 숨기고, 사진 우측 상단에
    // 우리가 만든 X 버튼을 대신 씀 — domready마다 내용이 새로 그려지므로 매번 다시 바인딩
    placeInfoWindow.addListener('domready', () => {
      document.getElementById(INFO_WINDOW_CLOSE_BTN_ID)?.addEventListener('click', () => {
        placeInfoWindowPinned = false;
        placeInfoWindow.close();
      });
    });
  }

  const moodLabel = MOOD_LABEL[place.mood ?? ''] || '';
  const stars = typeof place.google_rating === 'number' ? '★ ' + place.google_rating.toFixed(1) : '';

  const mapsUrl = place.google_place_id
    ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place.name) + '&query_place_id=' + place.google_place_id
    : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place.name);

  // 작은 노트북 화면에서는 지도 컨테이너 자체가 낮아서(.sl-map-wrap이 overflow:hidden) 사진이
  // 고정 높이면 아래 이름/평점이 정보창 밖으로 밀려 잘려 보이던 문제 — 브라우저 전체 뷰포트가
  // 아니라 "이 지도 컨테이너"의 실제 렌더링 높이에 비례해서 사진 높이를 줄임
  const mapContainerH = (map?.getDiv?.() as HTMLElement | undefined)?.clientHeight || window.innerHeight;
  const photoH = Math.max(
    INFO_WINDOW_PHOTO_MIN_H,
    Math.min(INFO_WINDOW_PHOTO_MAX_H, Math.round(mapContainerH * INFO_WINDOW_PHOTO_HEIGHT_RATIO))
  );

  const closeBtn = [
    '<button type="button" id="' + INFO_WINDOW_CLOSE_BTN_ID + '" style="',
    'position:absolute;top:6px;right:6px;width:' + INFO_WINDOW_CLOSE_BTN_SIZE + 'px;height:' + INFO_WINDOW_CLOSE_BTN_SIZE + 'px;',
    'border:none;border-radius:50%;background:rgba(255,255,255,0.92);color:#334155;',
    'font-size:' + Math.round(13 * INFO_WINDOW_SCALE) + 'px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;',
    'box-shadow:0 1px 4px rgba(11,42,92,0.35);padding:0;">✕</button>',
  ].join('');

  const content = [
    '<div style="font-family:inherit;width:min(' + INFO_WINDOW_MAX_WIDTH_PX + 'px, ' + INFO_WINDOW_MAX_WIDTH_VW + 'vw);position:relative;">',
    closeBtn,
    place.photo_url
      ? '<div style="width:100%;height:' + photoH + 'px;border-radius:8px;background-size:cover;background-position:center;background-image:url(\'' + place.photo_url + '\');margin-bottom:8px;"></div>'
      : '',
    '<div style="font-size:' + INFO_WINDOW_NAME_FONT_SIZE + 'px;font-weight:700;color:#0B2A5C;margin-bottom:2px;">' + escapeHtml(place.name) + '</div>',
    moodLabel
      ? '<span style="display:inline-block;font-size:' + INFO_WINDOW_TAG_FONT_SIZE + 'px;font-weight:700;color:' + MOOD_COLOR[place.mood ?? ''] + ';background:' + MOOD_COLOR[place.mood ?? ''] + '1A;padding:2px 7px;border-radius:999px;margin-bottom:4px;">' + moodLabel + '</span>'
      : '',
    stars ? '<div style="font-size:' + INFO_WINDOW_STAR_FONT_SIZE + 'px;color:#F5A623;font-weight:700;margin-top:4px;">' + stars + '</div>' : '',
    '<a href="' + mapsUrl + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:8px;font-size:' + INFO_WINDOW_LINK_FONT_SIZE + 'px;font-weight:700;color:#185FA5;text-decoration:none;">Google Maps에서 보기 →</a>',
    '</div>',
  ].join('');

  placeInfoWindow.setContent(content);
  placeInfoWindow.open({ map, anchor: marker });
  if (pin) placeInfoWindowPinned = true;
}

/** 구글이 매긴 category가 부정확하거나(예: 공항을 '관광명소'로 분류) 오래된 데이터라 아직
 *  공항 매핑 전에 저장된 place.category를 그대로 갖고 있는 경우를 이름으로 한 번 더 보정.
 *  DB의 category 값을 직접 고치지 않아도 지도 위 아이콘은 항상 최신 규칙을 따르게 됨 */
function isAirportPlace(name: string | null | undefined, category: string | null | undefined): boolean {
  if (category === '공항') return true;
  return !!name && /공항|airport/i.test(name);
}

/**
 * IC_* 아이콘 문자열에서 <svg> 태그의 속성과 내부 마크업을 분리 (buildInfraMarkerIcon 전용 —
 * 지도 카테고리 핀은 이모지라 필요 없음). IC_* 는 fill="none"/stroke/stroke-width 등을 전부
 * 최상위 <svg> 태그에만 걸고 내부 <path>/<rect>는 상속에 의존하기 때문에, 내부 마크업만 다른
 * SVG에 옮겨 심을 땐 이 속성들도 같이 옮겨야 함 — 안 그러면 SVG 기본값(fill:black)이 적용돼
 * 아이콘이 검은 덩어리로 보임(실제로 겪었던 버그).
 */
function splitIconSvg(icon: string): { attrs: string; inner: string } {
  const m = icon.match(/<svg([^>]*)>([\s\S]*)<\/svg>/);
  if (!m) return { attrs: '', inner: icon };
  return { attrs: m[1].replace(/\bviewBox="[^"]*"/, '').trim(), inner: m[2] };
}

/** 핀 크기·글자 크기 — 이 두 값만 바꾸면 Step1/2/3 지도 전체 핀이 한 번에 바뀜 */
const CATEGORY_PIN_SIZE = 24;
const CATEGORY_PIN_FONT_SIZE = 20;

/** 카테고리별(구글 장소 세부 종류 우선, 없으면 mood 4종) 이모지 아이콘만 있는 핀 — 배경 배지 없음 */
function buildCategoryIcon(g: any, mood: string | null, category?: string | null, name?: string | null): any {
  const icon = isAirportPlace(name, category) ? '✈️' : CATEGORY_ICON[category ?? ''] || MOOD_ICON[mood ?? ''] || '📍';
  const size = CATEGORY_PIN_SIZE;
  const r = size / 2;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">',
    '<text x="' + r + '" y="' + r + '" font-size="' + CATEGORY_PIN_FONT_SIZE + '" text-anchor="middle" dominant-baseline="central">' + icon + '</text>',
    '</svg>',
  ].join('');
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new g.maps.Size(size, size),
    anchor: new g.maps.Point(r, r),
  };
}

/** 반지름 r인 원(중심 cx,cy)에 외부 접선 두 개를 그어 tip에서 만나는 "물방울(핀)" 윤곽 경로 —
 *  ROUTE의 pinTearPath(route.ts)와 동일한 수식. 화면(Step1)이 서로 달라 모듈을 공유하지 않고 복제. */
function pinTearPath(cx: number, cy: number, r: number, tipY: number): string {
  const d = tipY - cy;
  const phi = Math.acos(r / d);
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

const STEP1_PIN_HEAD_R = 12;
const STEP1_PIN_TAIL_RATIO = 1.5;
/** 회색이 아니라 mood(4개 게이트)별 색으로 채운 물방울 모양 핀 — ROUTE의 "아직 담지 않은 후보"
 *  핀과 같은 실루엣·아이콘 스타일(선 아이콘 + 그림자)을 쓰되, 색은 회청색이 아니라 이 화면이
 *  원래 쓰던 mood색을, 크기도 이 화면 크기(STEP1_PIN_HEAD_R) 그대로 유지한다.
 *  Step1 지도(Brainstorm에서 담긴 장소 전체 조망)에서만 쓰고, Step2/3의 buildCategoryIcon(배경
 *  없는 순수 이모지)은 그대로 둔다 — 두 화면의 핀 스타일이 서로 다른 의미(전부 다 보기 vs
 *  후보 비교)를 갖고 있어 일부러 구분. */
function buildStep1GatePin(g: any, mood: string | null, category?: string | null, name?: string | null): any {
  const iconSvg = isAirportPlace(name, category)
    ? PIN_IC_PLANE
    : PIN_CATEGORY_ICON[category ?? ''] || PIN_MOOD_ICON[mood ?? ''] || PIN_IC_LANDMARK;
  const color = MOOD_COLOR[mood ?? ''] ?? '#6B7A93'; // mood 없는 경우(이론상 없음)만 대비한 slate 폴백
  const r = STEP1_PIN_HEAD_R;
  const tail = r * STEP1_PIN_TAIL_RATIO;
  const pad = 6;
  const w = Math.ceil(r * 2 + pad);
  const h = Math.ceil(r + tail + pad);
  const cx = w / 2;
  const tipY = h - pad / 2;
  const headCy = tipY - tail;
  const whiteR = r - r * 0.24;

  const shadow =
    '<ellipse cx="' + cx + '" cy="' + (tipY + r * 0.1) + '" rx="' + r * 0.42 + '" ry="' + r * 0.15 + '" fill="rgba(11,42,92,0.18)"/>';
  const inner =
    '<g transform="translate(' + (cx - 5.5) + ',' + (headCy - 5.5) + ') scale(0.46)" fill="none" stroke="' + color +
    '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + pinIconInner(iconSvg) + '</g>';

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
    shadow +
    '<path d="' + pinTearPath(cx, headCy, r, tipY) + '" fill="' + color + '"/>' +
    '<circle cx="' + cx + '" cy="' + headCy + '" r="' + whiteR + '" fill="#FFFFFF"/>' +
    inner +
    '</svg>';

  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new g.maps.Size(w, h),
    anchor: new g.maps.Point(cx, tipY),
  };
}

/** 카드에 마우스를 올리면 해당 권역만 지도에서 진하게, 나머지는 흐리게. null이면 전체를 기본 상태로 */
function highlightZone(zoneId: string | null): void {
  highlightedZoneId = zoneId;
  const g = (window as any).google;
  if (!g?.maps || !mapInstance) return;

  markersByZone.forEach((markers, id) => {
    const isHighlighted = zoneId === null || id === zoneId;
    markers.forEach((marker) => {
      marker.setOpacity(isHighlighted ? 1 : 0.2);
      marker.setZIndex(isHighlighted ? 30 : 1);
    });
  });

  zonePolygons.forEach((polygon) => {
    const isHighlighted = zoneId === null || polygon.get('zoneId') === zoneId;
    polygon.setOptions({
      fillOpacity: zoneId === null ? 0.05 : isHighlighted ? 0.16 : 0.02,
      strokeOpacity: zoneId === null ? 0.4 : isHighlighted ? 0.8 : 0.1,
      strokeWeight: isHighlighted && zoneId !== null ? 1.5 : 1,
      zIndex: isHighlighted ? 10 : 1,
    });
  });

  zoneLabelOverlays.forEach((overlay) => {
    if (typeof overlay.updateSelected === 'function') {
      overlay.updateSelected(overlay.div?.dataset.zoneId === pendingSelectedZoneId);
    }
  });

  if (zoneId) {
    const zone = zones.find((z) => z.id === zoneId);
    if (zone) {
      const bounds = new g.maps.LatLngBounds();
      const blob = zoneBlobPoints.get(zoneId);
      if (blob && blob.length > 0) {
        blob.forEach((pt) => bounds.extend(pt));
      } else {
        zone.places.forEach((p) => {
          if (p.lat != null && p.lng != null) bounds.extend({ lat: p.lat, lng: p.lng });
        });
      }
      if (!bounds.isEmpty()) {
        mapInstance.fitBounds(bounds, 24);
      }
    }
  }
}

/**
 * Google Maps는 컨테이너 높이가 0인 상태에서 초기화되면 타일을 제대로 못 그리고
 * 이후 컨테이너가 정상 크기로 바뀌어도 스스로 다시 그리지 않는 경우가 있음(잘 알려진 이슈).
 * ResizeObserver로 컨테이너가 실제 크기를 갖는 순간을 감지해서 강제로 resize 이벤트를 쏴줌.
 */
function fixMapVisibilityOnResize(g: any, map: any, mapEl: HTMLElement, center: { lat: number; lng: number }): void {
  let lastWidth = 0;
  let lastHeight = 0;

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0 && (width !== lastWidth || height !== lastHeight)) {
        lastWidth = width;
        lastHeight = height;
        g.maps.event.trigger(map, 'resize');
        map.setCenter(center);
      }
    }
  });
  observer.observe(mapEl);
}

async function initMap(body: HTMLElement): Promise<void> {
  try {
    await loadGoogleMapsScript();
  } catch (e) {
    const mapEl = body.querySelector('#sl-map');
    if (mapEl) mapEl.innerHTML = '<div class="sl-map-error">지도를 불러오지 못했어요.</div>';
    return;
  }

  const g = (window as any).google;
  const mapEl = body.querySelector('#sl-map') as HTMLElement;
  if (!g?.maps || !mapEl) return;

  const withCoords = allPlaces.filter((p) => p.lat != null && p.lng != null);
  if (withCoords.length === 0) return;

  const avgLat = withCoords.reduce((s, p) => s + p.lat!, 0) / withCoords.length;
  const avgLng = withCoords.reduce((s, p) => s + p.lng!, 0) / withCoords.length;

  mapInstance = new g.maps.Map(mapEl, {
    center: { lat: avgLat, lng: avgLng },
    zoom: 12,
    disableDefaultUI: true,
    zoomControl: false,
    fullscreenControl: false,
    mapTypeControl: false,
    streetViewControl: false,
    keyboardShortcuts: false,
    isFractionalZoomEnabled: true,
    gestureHandling: 'greedy',
    styles: MAP_STYLE_LIGHT,
  });

  fixMapVisibilityOnResize(g, mapInstance, mapEl, { lat: avgLat, lng: avgLng });

  addCustomZoomControl(mapInstance, body.querySelector('#sl-map') as HTMLElement);

  // 지도를 축소하면 권역 이름 필(pill) 라벨이 화면 픽셀 기준으로는 그대로라 도형에 비해
  // 점점 커 보임 — 줌 레벨에 맞춰 다시 계산. 스크롤 줌 중엔 자주 발생하므로 프레임당 한 번만.
  mapInstance.addListener('zoom_changed', () => {
    if (zoneLabelZoomRedrawHandle != null) return;
    zoneLabelZoomRedrawHandle = window.requestAnimationFrame(() => {
      zoneLabelZoomRedrawHandle = null;
      zoneLabelOverlays.forEach((overlay) => {
        if (typeof overlay.updateZoomScale === 'function') overlay.updateZoomScale();
      });
    });
  });

  // 폴리곤/마커/라벨이 아닌 지도 빈 공간을 클릭하면 강조 해제 + 고정된 정보창도 닫음
  mapInstance.addListener('click', () => {
    pendingSelectedZoneId = null;
    placeInfoWindowPinned = false;
    placeInfoWindow?.close();
    highlightZone(null);
    renderZoneCards(body);
    renderSelectBar(body);
  });

  const bounds = new g.maps.LatLngBounds();
  mapMarkers = [];
  markersByZone = new Map();
  zonePolygons = [];
  zoneLabelOverlays.forEach((o) => o.setMap(null));
  zoneLabelOverlays = [];
  zoneBlobPoints = computeZonePolygons(zones);

  zones.forEach((zone) => {
    const color = zoneColor(zone.id);
    const zoneMarkers: any[] = [];

    // 대표 장소만 마커로 노출 (전체 장소 다 보여주지 않음)
    const representative = [...zone.places]
      .sort((a, b) => (b.google_rating ?? 0) - (a.google_rating ?? 0))
      .slice(0, 4);

    representative.forEach((p) => {
      if (p.lat == null || p.lng == null) return;
      const marker = new g.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: mapInstance,
        title: p.name,
        icon: buildStep1GatePin(g, p.mood, p.category, p.name),
      });
      // 클릭 없이 마우스만 올려도 바로 정보가 뜨게(터치 기기는 hover가 없으니 click도 유지).
      // 클릭으로 고정된 상태(pinned)면 다른 마커 hover에 안 밀리고 mouseout에도 안 닫힘
      marker.addListener('mouseover', () => {
        if (!placeInfoWindowPinned) showPlaceInfoWindow(g, mapInstance, marker, p);
      });
      marker.addListener('mouseout', () => {
        if (!placeInfoWindowPinned) placeInfoWindow?.close();
      });
      marker.addListener('click', () => {
        showPlaceInfoWindow(g, mapInstance, marker, p, true);
      });
      zoneMarkers.push(marker);
      mapMarkers.push(marker);
    });

    zone.places.forEach((p) => {
      if (p.lat != null && p.lng != null) bounds.extend({ lat: p.lat, lng: p.lng });
    });

    markersByZone.set(zone.id, zoneMarkers);

    // 보로노이 계산에서 폴리곤이 안 나온 권역(좌표 없음/전부 outlier 등)은 도형 없이 마커만 표시
    const hullPoints = zoneBlobPoints.get(zone.id);
    if (!hullPoints) {
      return;
    }

    // 지도가 먼저 보이고 권역은 "살짝 입혀진" 느낌 — 채움은 아주 연하게, 경계선만 살짝 강조
    const polygon = new g.maps.Polygon({
      map: mapInstance,
      paths: hullPoints,
      fillColor: color,
      fillOpacity: ZONE_FILL_OPACITY,
      strokeColor: color,
      strokeOpacity: ZONE_STROKE_OPACITY,
      strokeWeight: ZONE_STROKE_WEIGHT,
      clickable: true,
    });
    polygon.set('zoneId', zone.id);
    polygon.addListener('click', () => {
      pendingSelectedZoneId = zone.id;
      highlightZone(zone.id);
      renderZoneCards(body);
      renderSelectBar(body);
    });
    zonePolygons.push(polygon);

    // 라벨은 권역 중심점이 아니라 실제 그려진 폴리곤의 중앙에 (도형이 늘어나면 라벨도 따라감)
    const overlay = createZoneLabelOverlay(g, zone, color, ringCentroid(hullPoints));
    overlay.setMap(mapInstance);
    zoneLabelOverlays.push(overlay);
  });

  // 어느 권역에도 배정되지 않은 장소(예: 공항)도 지도에는 계속 표시 — 권역 카드 통계에는
  // 안 들어가지만 "권역 밖에 있다"는 걸 사용자가 지도에서 직접 확인할 수 있어야 하므로.
  // 특정 권역 색과 엮이지 않는 장소라 markersByZone에는 안 넣어(하이라이트/흐림 대상 제외)
  unassignedPlaces.forEach((p) => {
    if (p.lat == null || p.lng == null) return;
    const marker = new g.maps.Marker({
      position: { lat: p.lat, lng: p.lng },
      map: mapInstance,
      title: p.name,
      icon: buildStep1GatePin(g, p.mood, p.category, p.name),
    });
    marker.addListener('mouseover', () => {
      if (!placeInfoWindowPinned) showPlaceInfoWindow(g, mapInstance, marker, p);
    });
    marker.addListener('mouseout', () => {
      if (!placeInfoWindowPinned) placeInfoWindow?.close();
    });
    marker.addListener('click', () => {
      showPlaceInfoWindow(g, mapInstance, marker, p, true);
    });
    mapMarkers.push(marker);
  });

  if (!bounds.isEmpty()) mapInstance.fitBounds(bounds, 40);
}

/** 지도 위에 뜨는 지역 정보 카드 (Google Maps 커스텀 OverlayView, 실제 DOM 엘리먼트) */
// 기본 진입 줌(12)에서의 라벨 크기가 "적절한" 기준 — 더 축소하면 화면 픽셀 크기가 고정된
// 채로 남아 필(pill) 라벨이 도형에 비해 점점 커 보이므로, 축소한 만큼 함께 줄인다.
const ZONE_LABEL_REFERENCE_ZOOM = 12;
const ZONE_LABEL_MIN_ZOOM_SCALE = 0.6;
function zoneLabelZoomScale(): number {
  if (!mapInstance || typeof mapInstance.getZoom !== 'function') return 1;
  const zoom = mapInstance.getZoom();
  if (typeof zoom !== 'number' || !Number.isFinite(zoom)) return 1;
  const diff = ZONE_LABEL_REFERENCE_ZOOM - zoom;
  if (diff <= 0) return 1; // 기준 줌보다 확대한 상태는 기존 크기 그대로
  return Math.max(ZONE_LABEL_MIN_ZOOM_SCALE, 1 - diff * 0.09);
}

function createZoneLabelOverlay(g: any, zone: Zone, color: string, labelPos: { lat: number; lng: number }): any {
  class ZoneLabelOverlay extends g.maps.OverlayView {
    div: HTMLDivElement | null = null;

    onAdd() {
      const div = document.createElement('div');
      div.className = 'sl-map-zone-label';
      div.dataset.zoneId = zone.id;
      div.style.setProperty('--zone-color', color);
      div.style.setProperty('--zone-zoom-scale', String(zoneLabelZoomScale()));
      div.innerHTML = '<span class="sl-map-label-name">' + escapeHtml(zone.name) + '</span>';

      div.addEventListener('click', () => {
        pendingSelectedZoneId = zone.id;
        highlightZone(zone.id);
        const bodyEl = document.querySelector('.sl-step1') as HTMLElement;
        if (bodyEl) {
          renderZoneCards(bodyEl);
          renderSelectBar(bodyEl);
        }
      });

      this.div = div;
      const panes = this.getPanes();
      panes.overlayMouseTarget.appendChild(div);
    }

    draw() {
      if (!this.div) return;
      const projection = this.getProjection();
      if (!projection) return;
      const pos = projection.fromLatLngToDivPixel(new g.maps.LatLng(labelPos.lat, labelPos.lng));
      if (!pos) return;
      this.div.style.left = pos.x + 'px';
      this.div.style.top = pos.y + 'px';
    }

    onRemove() {
      if (this.div) {
        this.div.remove();
        this.div = null;
      }
    }

    updateSelected(isSelected: boolean) {
      if (!this.div) return;
      this.div.classList.toggle('selected', isSelected);
    }

    /** 지도를 축소해도 라벨이 상대적으로 커 보이지 않게 줌 레벨에 맞춰 크기를 다시 계산 */
    updateZoomScale() {
      if (!this.div) return;
      this.div.style.setProperty('--zone-zoom-scale', String(zoneLabelZoomScale()));
    }
  }

  return new ZoneLabelOverlay();
}

/** 프리미엄 화이트 + 공항 라운지 컨셉에 맞춘 미니멀 지도 스타일 — 도로/행정구역/POI 라벨 최대한 축소 */
/** 기본 줌 버튼(1레벨씩)보다 절반 단위(0.5레벨씩)로 세밀하게 확대/축소되는 커스텀 버튼 */
function addCustomZoomControl(map: any, mapEl: HTMLElement): void {
  const g = (window as any).google;
  const wrap = document.createElement('div');
  wrap.className = 'sl-zoom-control';
  wrap.innerHTML = [
    '<button type="button" class="sl-zoom-btn" data-dir="in">+</button>',
    '<button type="button" class="sl-zoom-btn" data-dir="out">−</button>',
  ].join('');

  wrap.querySelector('[data-dir="in"]')?.addEventListener('click', () => {
    map.setZoom((map.getZoom() ?? 14) + 0.5);
  });
  wrap.querySelector('[data-dir="out"]')?.addEventListener('click', () => {
    map.setZoom((map.getZoom() ?? 14) - 0.5);
  });

  map.controls[g.maps.ControlPosition.RIGHT_BOTTOM].push(wrap);
}

/** Step2/Step3 공용 "디테일한 지도" 절충 스타일 — 도로·건물·대중교통 등 실제 디테일은 그대로 두되,
 *  기본 구글 업체 POI 아이콘(작은 색색 마커들)만 줄여서 우리 핀이 묻히지 않도록 함.
 *  Step1/Step3 이전 버전이 쓰던 MAP_STYLE_LIGHT(도로/POI를 다 지운 추상 지도)보다
 *  주변 편의 인프라처럼 "실제 동네 맥락"이 중요한 화면에 더 적합함 */
const MAP_STYLE_STEP2 = [
  { featureType: 'poi.business', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ saturation: -40 }, { lightness: 25 }] },
  { featureType: 'poi', elementType: 'labels.text', stylers: [{ visibility: 'simplified' }] },
];

const MAP_STYLE_LIGHT = [
  { elementType: 'geometry', stylers: [{ color: '#F8FBFE' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#94A3B8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#F8FBFE' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#E7EEF5' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#EDF3F9' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#DCE8F2' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D5EEFB' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#F1F6FB' }] },
];


/* ══════════════════ STEP 2 — Base Camp Selection ══════════════════ */
async function renderStep2(body: HTMLElement): Promise<void> {
  if (!selectedZone) {
    step = 1;
    await renderStep1(body);
    return;
  }

  // selectedZone.places만 보면 "직접 검색해서 추가한 권역"(공항 등)은 항상 비어있어
  // (assignPlacesToZones를 거치지 않음) 근처에 담아둔 숙소가 있어도 후보가 하나도 안 뜸.
  // 대신 이 지역 중심에서 실제 거리로 가까운 숙소를 찾음 — 큐레이션 권역이든 직접 추가한
  // 권역이든 동일하게 동작.
  const candidates = nearbyStayCandidates(selectedZone);
  const destination = getTripDestination();
  const dateRange = formatTripDateRange();

  // 스테퍼 줄 우측(#sl-stepper-extra)은 1·3단계와 동일하게 "여행지 변경"만 두고(이미
  // renderShortlistDestBar가 채워둠), 지역/기간/예산 필터 박스는 타이틀과 같은 줄로 내림.

  body.innerHTML = [
    '<div class="sl-step2">',
    '  <div class="sl-step2-header-row">',
    '    <div class="sl-step1-header sl-step2-header-text">',
    '      <div class="sl-eyebrow">IMMIGRATION COUNTER</div>',
    '      <div class="sl-title">숙소를 선택하면 여행의 중심이 결정됩니다</div>',
    '    </div>',
    '    <div class="sl-step2-summary-card">',
    '      <div class="sl-step2-summary-item"><span class="sl-step2-summary-label">선택 지역</span><span class="sl-step2-summary-value">' + escapeHtml(selectedZone.name) + '</span></div>',
    '      <div class="sl-step2-summary-divider"></div>',
    '      <div class="sl-step2-summary-item"><span class="sl-step2-summary-label">숙박 기간</span><span class="sl-step2-summary-value">' + escapeHtml(dateRange) + '</span></div>',
    '      <div class="sl-step2-summary-divider"></div>',
    '      <div class="sl-step2-summary-item sl-step2-summary-budget">',
    '        <span class="sl-step2-summary-label">예산 (1박 1인)</span>',
    '        <select id="sl-budget-select" class="sl-budget-select">',
    '          <option value=""' + (stayFilters.budget === '' ? ' selected' : '') + '>전체</option>',
    '          <option value="under5"' + (stayFilters.budget === 'under5' ? ' selected' : '') + '>5만원 이하</option>',
    '          <option value="under10"' + (stayFilters.budget === 'under10' ? ' selected' : '') + '>10만원 이하</option>',
    '          <option value="over20"' + (stayFilters.budget === 'over20' ? ' selected' : '') + '>20만원 이상</option>',
    '          <option value="custom"' + (stayFilters.budget === 'custom' ? ' selected' : '') + '>직접설정</option>',
    '        </select>',
    '        <div class="sl-budget-custom-row" id="sl-budget-custom-row" style="display:' + (stayFilters.budget === 'custom' ? 'flex' : 'none') + '">',
    '          <input type="number" id="sl-budget-min" class="sl-budget-custom-input" placeholder="최소" value="' + (stayFilters.customMinKRW ?? '') + '" />',
    '          <span>~</span>',
    '          <input type="number" id="sl-budget-max" class="sl-budget-custom-input" placeholder="최대" value="' + (stayFilters.customMaxKRW ?? '') + '" />',
    '          <span class="sl-budget-custom-unit">원</span>',
    '        </div>',
    '      </div>',
    '      <div class="sl-step2-summary-divider"></div>',
    '      <button type="button" class="sl-step2-summary-edit" id="sl-step2-date-edit">' + IC_EXTLINK + ' 수정</button>',
    '    </div>',
    '  </div>',

    '  <div class="sl-step2-layout">',

    '    <div class="sl-step2-left">',
    '      <div class="sl-map-wrap">',
    '        <div id="sl-map2" class="sl-map"></div>',
    '        <div class="sl-map-legend">',
    '          <span><span class="sl-legend-dot" style="--dot:#E24B4A"></span>관광(VISIT)</span>',
    '          <span><span class="sl-legend-dot" style="--dot:#1D9E75"></span>맛집(FOOD)</span>',
    '          <span><span class="sl-legend-dot" style="--dot:#7F77DD"></span>액티비티(ACTIVITY)</span>',
    '          <span><span class="sl-legend-dot" style="--dot:#185FA5"></span>숙소 후보(STAY)</span>',
    '        </div>',
    '      </div>',
    '    </div>',

    '    <div class="sl-step2-right">',

    '      <section class="sl-hotel-sites-section">',
    '        <div class="sl-section-title">숙소 검색 사이트</div>',
    '        <div class="sl-section-desc">선택한 지역 기준으로 바로 검색해보세요. <span class="sl-rating-caveat">★ 점수는 예약 편의를 종합한 Claude 편집 평가로, 각 사이트의 실제 이용자 평점이 아니에요.</span></div>',
    '        <div class="sl-hotel-sites-grid" id="sl-hotel-sites"></div>',
    '      </section>',

    '      <div class="sl-step2-divider"></div>',

    '      <section class="sl-direct-select-section">',
    '        <div class="sl-section-title">직접 숙소 선택하기</div>',
    '        <div class="sl-section-desc">예약 사이트에서 본 숙소 이름을 붙여넣으면 자동으로 추가돼요.</div>',

    '        <div class="sl-import-link-wrap">',
    '          <div class="sl-import-link-row">',
    '            <input type="text" id="sl-import-link-input" class="sl-import-link-input" placeholder="예: Grande Centre Point Siam" />',
    '            <button type="button" id="sl-import-link-btn" class="sl-import-link-btn">추가</button>',
    '          </div>',
    '          <div class="sl-import-link-status" id="sl-import-link-status"></div>',
    '        </div>',

    '        <div class="sl-direct-select-subtitle-row">',
    '          <div class="sl-direct-select-subtitle">또는 Brainstorm에서 담아둔 숙소 후보 중에서 골라보세요</div>',
    '          <div class="sl-step2-sort">',
    '            <span class="sl-step2-sort-label">정렬</span>',
    '            <select id="sl-sort-select">',
    '              <option value="rating"' + (step2SortMode === 'rating' ? ' selected' : '') + '>평점순</option>',
    '              <option value="distance"' + (step2SortMode === 'distance' ? ' selected' : '') + '>지역 중심 거리순</option>',
    '            </select>',
    '          </div>',
    '        </div>',
    '        <div class="sl-direct-search-wrap">',
    '          <span class="sl-direct-search-icon">' + IC_SEARCH2 + '</span>',
    '          <input type="text" id="sl-hotel-filter" class="sl-direct-search-input" placeholder="숙소명으로 찾기" value="' + escapeHtml(step2FilterText) + '" />',
    '        </div>',
    '        <div class="sl-basecamp-list" id="sl-basecamp-list"></div>',
    '      </section>',

    '      <button class="sl-step2-cta" id="sl-step2-cta" disabled>',
    '        <span>' + IC_CHECK + ' 이 숙소를 여행 중심으로 선택하기</span>',
    '      </button>',
    '      <div class="sl-step2-cta-hint">선택한 숙소를 기준으로 이동시간과 동선을 계산해요.</div>',

    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');

  body.querySelector('#sl-sort-select')?.addEventListener('change', (e) => {
    step2SortMode = (e.target as HTMLSelectElement).value as 'rating' | 'distance';
    renderBasecampList(body, candidates);
  });

  body.querySelector('#sl-step2-date-edit')?.addEventListener('click', openStayDateEditor);

  body.querySelector('#sl-budget-select')?.addEventListener('change', (e) => {
    stayFilters.budget = (e.target as HTMLSelectElement).value;
    const customRow = body.querySelector('#sl-budget-custom-row') as HTMLElement;
    if (customRow) customRow.style.display = stayFilters.budget === 'custom' ? 'flex' : 'none';
    renderHotelSiteCards(body, destination, selectedZone!.name);
  });

  const applyCustomBudget = () => {
    const minInput = body.querySelector('#sl-budget-min') as HTMLInputElement;
    const maxInput = body.querySelector('#sl-budget-max') as HTMLInputElement;
    stayFilters.customMinKRW = minInput?.value ? Number(minInput.value) : null;
    stayFilters.customMaxKRW = maxInput?.value ? Number(maxInput.value) : null;
    renderHotelSiteCards(body, destination, selectedZone!.name);
  };
  body.querySelector('#sl-budget-min')?.addEventListener('input', applyCustomBudget);
  body.querySelector('#sl-budget-max')?.addEventListener('input', applyCustomBudget);

  body.querySelector('#sl-hotel-filter')?.addEventListener('input', (e) => {
    step2FilterText = (e.target as HTMLInputElement).value;
    renderBasecampList(body, candidates);
  });

  body.querySelector('#sl-import-link-btn')?.addEventListener('click', () => {
    handleImportHotelLink(body, candidates);
  });
  body.querySelector('#sl-import-link-input')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') handleImportHotelLink(body, candidates);
  });

  renderHotelSiteCards(body, destination, selectedZone.name);
  renderBasecampList(body, candidates);
  renderSelectedHotelPreview(body, candidates);

  // 실시간 환율은 백그라운드로 불러오고, 도착하면 사이트 카드만 조용히 갱신 (화면 로딩을 막지 않음)
  loadLiveExchangeRate().then(() => {
    if (step === 2 && selectedZone) {
      renderHotelSiteCards(body, destination, selectedZone.name);
    }
  });

  lockStep2MapHeight(body);
  await initMapStep2(body, candidates);
}

/** 활성 숙소 구간 자체의 기간이 있으면 그걸(숙소를 나눈 경우), 없으면 여행지 기간, 그것도 없으면 트립 전체 기간 */
function formatTripDateRange(): string {
  const start = slActiveSegment?.start_date || slActiveDest?.start_date || currentTrip?.start_date;
  const end = slActiveSegment?.end_date || slActiveDest?.end_date || currentTrip?.end_date;
  if (!start || !end) return '기간 미정';
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) => (d.getMonth() + 1) + '.' + String(d.getDate()).padStart(2, '0');
  return fmt(s) + ' – ' + fmt(e);
}

/** formatTripDateRange()와 같은 우선순위로 현재 숙박 일수(박)를 계산 — 최소 1박 */
function currentStayNights(): number {
  const start = slActiveSegment?.start_date || slActiveDest?.start_date || currentTrip?.start_date;
  const end = slActiveSegment?.end_date || slActiveDest?.end_date || currentTrip?.end_date;
  if (!start || !end) return 1;
  const nights = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000);
  return Math.max(1, nights);
}

/* 예산 단계(1박 1인 기준, 원화) → USD 환산 (사이트 기본 통화가 USD인 경우가 많아 근사 환산에 사용) */
const BUDGET_PRESETS: Record<string, { minKRW: number; maxKRW: number; label: string }> = {
  'under5': { minKRW: 0, maxKRW: 50000, label: '5만원 이하' },
  'under10': { minKRW: 0, maxKRW: 100000, label: '10만원 이하' },
  'over20': { minKRW: 200000, maxKRW: 3000000, label: '20만원 이상' },
};

// 실시간 환율(Frankfurter API, 키 불필요) — 세션 동안 재사용, 실패 시 대략치로 폴백
let liveKrwPerUsd: number | null = null;
const FALLBACK_KRW_PER_USD = 1495;

async function loadLiveExchangeRate(): Promise<void> {
  if (liveKrwPerUsd != null) return;
  try {
    // 브라우저에서 Frankfurter를 직접 부르면 배포 환경에서 CORS로 막혀서,
    // 우리 서버(/api/exchange-rate)가 대신 호출해서 프록시함
    const res = await fetch('/api/exchange-rate');
    const data = await res.json();
    if (typeof data?.rate === 'number' && data.rate > 0) {
      liveKrwPerUsd = data.rate;
      console.log('[Shortlist] 환율 로드(' + data.source + '):', data.rate, '원/$');
    }
  } catch (e) {
    console.error('[Shortlist] 환율 조회 실패, 대략치로 폴백:', (e as Error).message);
  }
}

function krwToUsd(krw: number): number {
  const rate = liveKrwPerUsd ?? FALLBACK_KRW_PER_USD;
  return Math.round(krw / rate);
}

/** 현재 선택된 예산 필터를 min/max KRW로 환산 (프리셋 또는 직접설정) */
/** 트립에 설정된 인원수 (없으면 1명으로 취급) */
function getTripHeadcount(): number {
  const trip = currentTrip;
  return trip?.headcount && trip.headcount > 0 ? trip.headcount : 1;
}

/**
 * 예산 필터는 UI상 "1인 기준"으로 입력받지만, 숙소 사이트(Booking/Airbnb 등)는
 * 객실 1박 전체 가격으로 필터링함(인원수로 나눈 값이 아님).
 * 그래서 실제 사이트에 보낼 때는 1인 기준 금액 × 여행 인원수로 환산해야 함.
 */
function resolveBudgetRangeKRW(f: StayFilters): { minKRW: number; maxKRW: number; label: string } | null {
  const headcount = getTripHeadcount();

  if (f.budget === 'custom') {
    if (f.customMinKRW == null && f.customMaxKRW == null) return null;
    const minKRW = (f.customMinKRW ?? 0) * headcount;
    const maxKRW = (f.customMaxKRW ?? 3000000) * headcount;
    const label = (f.customMinKRW ? (f.customMinKRW).toLocaleString() + '원' : '') + '~' + (f.customMaxKRW ? (f.customMaxKRW).toLocaleString() + '원' : '');
    return { minKRW, maxKRW, label };
  }

  const preset = BUDGET_PRESETS[f.budget];
  if (!preset) return null;
  return {
    minKRW: preset.minKRW * headcount,
    maxKRW: preset.maxKRW * headcount,
    label: preset.label,
  };
}

interface StayFilters {
  budget: string; // '' | 'under5' | 'under10' | 'over20' | 'custom'
  customMinKRW: number | null;
  customMaxKRW: number | null;
}

let stayFilters: StayFilters = { budget: '', customMinKRW: null, customMaxKRW: null };

/**
 * 숙소 검색 URL의 checkin/checkout에 쓸 날짜(YYYY-MM-DD).
 * formatTripDateRange()와 같은 우선순위: 활성 숙소 구간(나뉜 경우) → 여행지 기간 → 트립 전체 기간.
 * "수정" 버튼으로 숙박 기간을 바꾸면 이 값도 즉시 갱신돼야 검색 필터가 실제로 반영됨.
 */
function getTripDatesISO(): { checkin: string; checkout: string } | null {
  const start = slActiveSegment?.start_date || slActiveDest?.start_date || currentTrip?.start_date;
  const end = slActiveSegment?.end_date || slActiveDest?.end_date || currentTrip?.end_date;
  if (!start || !end) return null;
  return { checkin: start.slice(0, 10), checkout: end.slice(0, 10) };
}

interface HotelSite {
  name: string;
  domain: string;
  /** 이 사이트에 필터를 얼마나 신뢰성 있게 적용할 수 있는지 (사용자에게 투명하게 표시) */
  filterSupport: 'confirmed' | 'best_effort' | 'unsupported';
  /** 숙소 예약 목적으로 봤을 때 Claude가 매긴 종합 평가 (해당 사이트의 실제 이용자 평점이 아님) */
  editorialRating: number;
  buildUrl: (destination: string, zoneName: string, filters: StayFilters) => string;
}

const HOTEL_SITES: HotelSite[] = [
  {
    name: 'Booking.com',
    domain: 'booking.com',
    filterSupport: 'confirmed',
    editorialRating: 4.6,
    buildUrl: (d, z, f) => {
      const url = new URL('https://www.booking.com/searchresults.ko.html');
      url.searchParams.set('ss', z + ' ' + d);
      const dates = getTripDatesISO();
      if (dates) {
        url.searchParams.set('checkin', dates.checkin);
        url.searchParams.set('checkout', dates.checkout);
      }
      url.searchParams.set('group_adults', String(getTripHeadcount()));
      url.searchParams.set('no_rooms', '1');
      url.searchParams.set('group_children', '0');
      const range = resolveBudgetRangeKRW(f);
      if (range) {
        url.searchParams.set('nflt', 'price=USD-' + krwToUsd(range.minKRW) + '-' + krwToUsd(range.maxKRW) + '-1');
      }
      return url.toString();
    },
  },
  {
    name: 'Agoda',
    domain: 'agoda.com',
    filterSupport: 'unsupported',
    editorialRating: 4.4,
    buildUrl: (d, z) => {
      // Agoda 실제 검색 URL은 도시 고유 숫자ID(city=1234) 기반이라 우리가 알 방법이 없음.
      // checkIn/checkOut/price 파라미터를 텍스트 검색에 붙여봤지만 실제로 안 먹혀서(확인됨) 제거.
      // 지역명 텍스트로만 검색되도록 단순화 — 날짜/가격은 사용자가 Agoda 화면에서 직접 설정 필요.
      return 'https://www.agoda.com/ko-kr/search?text=' + encodeURIComponent(z + ' ' + d);
    },
  },
  {
    name: 'Airbnb',
    domain: 'airbnb.co.kr',
    filterSupport: 'confirmed',
    editorialRating: 4.2,
    buildUrl: (d, z, f) => {
      const url = new URL('https://www.airbnb.co.kr/s/' + encodeURIComponent(z + ' ' + d) + '/homes');
      const dates = getTripDatesISO();
      if (dates) {
        url.searchParams.set('checkin', dates.checkin);
        url.searchParams.set('checkout', dates.checkout);
      }
      url.searchParams.set('adults', String(getTripHeadcount()));
      const range = resolveBudgetRangeKRW(f);
      if (range) {
        url.searchParams.set('price_min', String(krwToUsd(range.minKRW)));
        url.searchParams.set('price_max', String(krwToUsd(range.maxKRW)));
      }
      return url.toString();
    },
  },
  {
    name: 'Google Hotels',
    domain: 'google.com',
    filterSupport: 'best_effort',
    editorialRating: 4.3,
    buildUrl: (d, z, f) => {
      // 날짜를 검색어에 자연어로 넣는 게 실제로 필터에 반영되는지 확인된 바가 없어서 뺐음
      // (Google이 계정/세션 컨텍스트로 알아서 처리하는 것으로 보임)
      let q = z + ' ' + d + ' 호텔';
      const range = resolveBudgetRangeKRW(f);
      if (range) q += ' ' + range.label;
      return 'https://www.google.com/travel/search?q=' + encodeURIComponent(q);
    },
  },
];

/**
 * Step3에서 확정한 숙소 이름을 클릭하면 이동할 검색 URL — Google 호텔 가격비교.
 *
 * 시행착오 기록: Booking.com 딥링크(searchresults.ko.html?ss=...)는 한동안 "숙소명 +
 * 도시명" 조합으로 잘 됐지만 이후 안 먹히는 사례가 보고돼(리다이렉트/빈 결과) 신뢰할 수
 * 없다고 판단, 아래 HOTEL_SITES의 Google Hotels 카드와 같은 방식(travel/search?q=)으로
 * 바꿈. 이쪽은 Google 자체 검색이라 어떤 OTA로 리다이렉트되든 항상 결과가 뜨고, 특정
 * 호텔명을 쿼리에 넣으면 그 호텔의 여러 예약 사이트 가격을 한 번에 비교해서 보여준다.
 * 날짜는(위 Google Hotels 카드와 동일한 이유로) 쿼리에 넣지 않음 — 실제로 필터에
 * 반영되는지 확인된 바가 없고, Google이 계정/세션 컨텍스트로 알아서 처리하는 것으로 보임.
 */
function buildHotelSearchUrl(place: Place): string {
  const q = place.name + ' ' + getTripDestination() + ' 호텔';
  return 'https://www.google.com/travel/search?q=' + encodeURIComponent(q);
}

function renderHotelSiteCards(body: HTMLElement, destination: string, zoneName: string): void {
  const gridEl = body.querySelector('#sl-hotel-sites') as HTMLElement;
  const filterNote = stayFilters.budget ? (BUDGET_PRESETS[stayFilters.budget]?.label ?? '직접설정 가격대') : '전체 숙소';

  gridEl.innerHTML = HOTEL_SITES.map((site) => [
    '<a class="sl-hotel-site-card" href="' + site.buildUrl(destination, zoneName, stayFilters) + '" target="_blank" rel="noopener noreferrer">',
    '  <img class="sl-hotel-site-logo" src="https://www.google.com/s2/favicons?domain=' + site.domain + '&sz=128" alt="" />',
    '  <div class="sl-hotel-site-name">' + escapeHtml(site.name) + '</div>',
    '  <div class="sl-hotel-site-rating" title="Claude 편집 평가 (실제 이용자 평점 아님)"><span class="sl-hotel-site-rating-tag">편집</span>★ ' + site.editorialRating.toFixed(1) + '</div>',
    '  <div class="sl-hotel-site-zone">' + escapeHtml(zoneName) + ' 지역</div>',
    '  <div class="sl-hotel-site-filter">' + (site.filterSupport === 'unsupported' ? '지역만 검색' : escapeHtml(filterNote) + (site.filterSupport === 'best_effort' ? ' · 참고용' : '')) + '</div>',
    '  <div class="sl-hotel-site-cta">바로 검색 ' + IC_EXTLINK + '</div>',
    '</a>',
  ].join('')).join('');
}

function renderBasecampList(body: HTMLElement, candidates: Place[]): void {
  const listEl = body.querySelector('#sl-basecamp-list') as HTMLElement;
  if (!listEl) return;

  const filtered = candidates.filter((c) =>
    step2FilterText.trim() === '' || c.name.toLowerCase().includes(step2FilterText.trim().toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    if (step2SortMode === 'rating') {
      return (b.google_rating ?? 0) - (a.google_rating ?? 0);
    }
    if (!selectedZone) return 0;
    const da = a.lat != null && a.lng != null ? haversineKm(selectedZone.centerLat, selectedZone.centerLng, a.lat, a.lng) : Infinity;
    const db = b.lat != null && b.lng != null ? haversineKm(selectedZone.centerLat, selectedZone.centerLng, b.lat, b.lng) : Infinity;
    return da - db;
  });

  if (candidates.length === 0) {
    listEl.innerHTML = [
      '<div class="sl-no-candidates">',
      '  <div>이 지역엔 아직 담아둔 숙소 후보가 없어요.</div>',
      '  <div class="sl-sub">위의 <b>숙소 검색 사이트</b>에서 찾아보거나, <b>직접 숙소 선택하기</b>에 숙소 이름을 붙여넣어 바로 추가할 수 있어요.</div>',
      '  <div class="sl-sub">Brainstorm(IDEAS) 게이트에서 숙소를 STAY로 분류해두면 여기 자동으로 모여요.</div>',
      '</div>',
    ].join('\n');
    return;
  }

  if (sorted.length === 0) {
    listEl.innerHTML = '<div class="sl-no-candidates"><div>검색 결과가 없어요.</div></div>';
    return;
  }

  listEl.innerHTML = sorted
    .map((c) => {
      const isSelected = pendingHotelId === c.id;
      return [
        '<button type="button" class="sl-basecamp-card' + (isSelected ? ' selected' : '') + '" data-place-id="' + c.id + '">',
        c.photo_url ? '<div class="sl-basecamp-thumb" style="background-image:url(\'' + c.photo_url + '\')"></div>' : '<div class="sl-basecamp-thumb sl-basecamp-thumb-empty">' + IC_BED + '</div>',
        '  <div class="sl-basecamp-info">',
        '    <div class="sl-basecamp-name">' + escapeHtml(c.name) + '</div>',
        typeof c.google_rating === 'number' ? '<div class="sl-basecamp-rating">★ ' + c.google_rating.toFixed(1) + '</div>' : '',
        '  </div>',
        isSelected ? '<span class="sl-basecamp-selected-badge">' + IC_CHECK + '</span>' : '',
        '</button>',
      ].join('');
    })
    .join('');

  listEl.querySelectorAll('.sl-basecamp-card').forEach((card) => {
    card.addEventListener('click', () => {
      const placeId = (card as HTMLElement).dataset.placeId;
      pendingHotelId = pendingHotelId === placeId ? null : (placeId ?? null);
      renderBasecampList(body, candidates);
      renderSelectedHotelPreview(body, candidates);
      highlightBasecampMarker(pendingHotelId);
    });
  });
}

function renderSelectedHotelPreview(body: HTMLElement, candidates: Place[]): void {
  const ctaBtn = body.querySelector('#sl-step2-cta') as HTMLButtonElement;
  if (!ctaBtn) return;

  const hotel = candidates.find((c) => c.id === pendingHotelId) ?? null;
  ctaBtn.disabled = !hotel;
  if (!hotel) return;

  ctaBtn.onclick = () => {
    // 후보만 고른 것(Step3 미리보기)이지 "확정"이 아님 — 다른 숙소로 바꿔 고른 거면
    // 이전에 확정했던 기록도 더 이상 유효하지 않으니 같이 지움(같은 숙소 재선택이면 유지)
    if (selectedBasecamp?.id !== hotel.id) basecampConfirmedAt = null;
    selectedBasecamp = hotel;
    confirmedIds = new Set();
    step = 3;
    // 숙소 선택 시점에 바로 저장 — 여기서 새로고침해도 Step3부터 복원됨 (진행상황 유실 방지)
    void saveShortlistState();
    const container = body.closest('.sl-shell')!.parentElement as HTMLElement;
    renderStep(container);
  };
}

let step2Markers = new Map<string, any>();
let step2MapInstance: any = null;

/**
 * 숙소 이름을 붙여넣으면 자동으로 숙소를 추가.
 * Google Places Text Search로 실제 장소를 찾은 뒤,
 * 이 트립의 places 테이블에 STAY로 저장하고, 화면(리스트+지도)에 즉시 반영함.
 */
async function handleImportHotelLink(body: HTMLElement, candidates: Place[]): Promise<void> {
  const input = body.querySelector('#sl-import-link-input') as HTMLInputElement;
  const btn = body.querySelector('#sl-import-link-btn') as HTMLButtonElement;
  const statusEl = body.querySelector('#sl-import-link-status') as HTMLElement;
  if (!input || !btn || !statusEl || !selectedZone) return;

  const name = input.value.trim();
  if (!name) return;

  btn.disabled = true;
  btn.textContent = '확인 중...';
  statusEl.textContent = '';
  statusEl.className = 'sl-import-link-status';

  try {
    const res = await fetch('/api/import-hotel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, contextHint: selectedZone.name + ' ' + getTripDestination() }),
    });
    const data = await res.json();

    if (!res.ok) {
      statusEl.textContent = data.error || '숙소를 찾지 못했어요.';
      statusEl.classList.add('error');
      return;
    }

    // 이미 이 트립에 같은 장소가 있으면 중복 추가하지 않음
    const existing = allPlaces.find((p) => p.google_place_id && p.google_place_id === data.place_id);
    if (existing) {
      statusEl.textContent = '"' + existing.name + '"은 이미 추가돼 있어요.';
      pendingHotelId = existing.id;
      renderBasecampList(body, candidates);
      renderSelectedHotelPreview(body, candidates);
      highlightBasecampMarker(existing.id);
      return;
    }

    const user = store.get('user');
    const category = getCategoryLabel(data.types ?? []);
    const { data: inserted, error } = await supabase
      .from('places')
      .insert({
        trip_id: currentTripId,
        name: data.name,
        mood: '숙소',
        status: 'idea',
        is_idea: false,
        added_by: user?.id ?? null,
        sort_order: Math.floor(Date.now() / 1000),
        // 실제 여행지(마이그레이션 후)에서는 destination_id를 태깅해야 placeBelongsToDestination
        // 필터에 걸리지 않고 재로드(예: Route 갔다 오는 경우) 후에도 계속 후보로 남는다.
        destination_id: slActiveDest && !isSyntheticDestination(slActiveDest.id) ? slActiveDest.id : null,
        address: data.address,
        lat: data.lat,
        lng: data.lng,
        google_place_id: data.place_id,
        google_rating: data.rating,
        category,
        photo_url: data.photoUrl,
      })
      .select()
      .single();

    if (error || !inserted) {
      statusEl.textContent = '저장 중 오류가 났어요: ' + (error?.message ?? '알 수 없는 오류');
      statusEl.classList.add('error');
      return;
    }

    // 화면 상태에 즉시 반영 (다시 불러오지 않고 메모리에서 바로 추가)
    allPlaces.push(inserted);
    selectedZone.places.push(inserted);
    candidates.push(inserted);

    input.value = '';
    statusEl.textContent = '"' + inserted.name + '" 추가 완료!';
    pendingHotelId = inserted.id;

    renderBasecampList(body, candidates);
    renderSelectedHotelPreview(body, candidates);
    addMarkerForNewCandidate(inserted);
  } catch (e) {
    statusEl.textContent = '네트워크 오류: ' + (e as Error).message;
    statusEl.classList.add('error');
  } finally {
    btn.disabled = false;
    btn.textContent = '추가';
  }
}

/** 새로 추가된 숙소를 Step2 지도에 마커로 즉시 표시 (지도를 통째로 다시 그리지 않고 마커만 추가) */
function addMarkerForNewCandidate(place: Place): void {
  const g = (window as any).google;
  if (!g?.maps || !step2MapInstance || place.lat == null || place.lng == null) return;

  const marker = new g.maps.Marker({
    position: { lat: place.lat, lng: place.lng },
    map: step2MapInstance,
    title: place.name,
    icon: buildCategoryIcon(g, place.mood, place.category, place.name),
    zIndex: 20,
  });
  step2Markers.set(place.id, marker);
  marker.addListener('click', () => {
    pendingHotelId = place.id;
    highlightBasecampMarker(place.id);
  });
  highlightBasecampMarker(place.id);
}

async function initMapStep2(body: HTMLElement, candidates: Place[]): Promise<void> {
  step2Markers = new Map();

  try {
    await loadGoogleMapsScript();
  } catch (e) {
    return;
  }
  const g = (window as any).google;
  const mapEl = body.querySelector('#sl-map2') as HTMLElement;
  if (!g?.maps || !mapEl || !selectedZone) return;

  const map = new g.maps.Map(mapEl, {
    center: { lat: selectedZone.centerLat, lng: selectedZone.centerLng },
    zoom: 15,
    disableDefaultUI: true,
    zoomControl: false,
    fullscreenControl: false,
    mapTypeControl: false,
    streetViewControl: false,
    keyboardShortcuts: false,
    isFractionalZoomEnabled: true,
    gestureHandling: 'greedy',
    // Step1처럼 완전히 추상화하진 않고 도로명·건물 등 실제 디테일은 유지하되,
    // 우리 핀이 묻히지 않도록 구글 기본 업체 POI 아이콘만 옅게 처리
    styles: MAP_STYLE_STEP2,
  });
  step2MapInstance = map;
  fixMapVisibilityOnResize(g, map, mapEl, { lat: selectedZone.centerLat, lng: selectedZone.centerLng });

  addCustomZoomControl(map, mapEl);

  // candidates(거리 기반 숙소 후보)와 selectedZone.places(큐레이션 배정 결과) 둘 다
  // "이 지역 안"으로 쳐서 강조 표시 대상에서 배경 마커 루프를 제외 — 안 그러면 candidates로
  // 새로 잡힌 숙소가 배경에도, 강조 마커에도 중복으로 찍힘
  const inZoneIds = new Set([...selectedZone.places.map((p) => p.id), ...candidates.map((p) => p.id)]);

  // 선택한 지역 밖 장소도 함께 찍어서, 사용자가 축소했을 때 트립 전체 장소를 파악할 수 있게 함
  allPlaces.forEach((p) => {
    if (p.lat == null || p.lng == null) return;
    if (inZoneIds.has(p.id)) return; // 지역 안 장소는 아래에서 강조된 스타일로 별도 처리

    const marker = new g.maps.Marker({
      position: { lat: p.lat, lng: p.lng },
      map,
      title: p.name,
      icon: buildCategoryIcon(g, p.mood, p.category, p.name),
      zIndex: 0,
    });
    marker.addListener('click', () => {
      showPlaceInfoWindow(g, map, marker, p);
    });
  });

  // 숙소 후보 — zone.places가 아니라 거리 기반 candidates 기준(직접 추가한 권역도 동작하도록)
  candidates.forEach((p) => {
    if (p.lat == null || p.lng == null) return;
    const marker = new g.maps.Marker({
      position: { lat: p.lat, lng: p.lng },
      map,
      title: p.name,
      icon: buildCategoryIcon(g, p.mood, p.category, p.name),
      zIndex: 20,
    });
    step2Markers.set(p.id, marker);
    marker.addListener('click', () => {
      pendingHotelId = p.id;
      renderBasecampList(body, candidates);
      renderSelectedHotelPreview(body, candidates);
      highlightBasecampMarker(p.id);
      showPlaceInfoWindow(g, map, marker, p);
    });
  });

  // 큐레이션 권역에 배정된 숙소 외 장소(관광/맛집/액티비티) — 직접 추가한 권역은 항상 비어있음
  selectedZone.places.forEach((p) => {
    if (p.mood === '숙소' || p.lat == null || p.lng == null) return; // 위에서 이미 처리
    const marker = new g.maps.Marker({
      position: { lat: p.lat, lng: p.lng },
      map,
      title: p.name,
      icon: buildCategoryIcon(g, p.mood, p.category, p.name),
      zIndex: 1,
    });
    // 숙소 후보가 아닌 장소는 선택 동작 없이 정보만 표시 (이미 저장된 데이터, 추가 API 호출 없음)
    marker.addListener('click', () => {
      showPlaceInfoWindow(g, map, marker, p);
    });
  });
}

/** 숙소를 선택했을 때 지도를 이동시켜 보여줄 적당한 줌 레벨(기본 지도 줌 15보다 한 단계 더 확대) */
const STEP2_SELECT_ZOOM = 17;

/** 숙소 후보 리스트에서 클릭한 항목을 지도 마커에서도 확대·강조하고, 그 위치로 지도를 이동·줌인 */
function highlightBasecampMarker(placeId: string | null): void {
  const g = (window as any).google;
  if (!g?.maps) return;
  let selectedMarker: any = null;
  step2Markers.forEach((marker, id) => {
    const isSelected = id === placeId;
    marker.setZIndex(isSelected ? 50 : 20);
    marker.setAnimation(isSelected ? g.maps.Animation.BOUNCE : null);
    if (isSelected) {
      selectedMarker = marker;
      setTimeout(() => marker.setAnimation(null), 700);
    }
  });

  // 선택 취소 후 같은 숙소를 다시 선택하는 경우에도 매번 다시 이동·줌인되도록,
  // 매 선택 시점마다(이전 상태와 무관하게) 무조건 실행한다.
  if (selectedMarker && step2MapInstance) {
    const pos = selectedMarker.getPosition?.();
    if (pos) {
      step2MapInstance.panTo(pos);
      const currentZoom = step2MapInstance.getZoom() ?? STEP2_SELECT_ZOOM;
      step2MapInstance.setZoom(Math.max(currentZoom, STEP2_SELECT_ZOOM));
    }
  }
}


/* ══════════════════ STEP 3 — Final Check ══════════════════ */

interface Step3Item {
  place: Place;
  km: number;
  minutes: number;
  real: boolean;
  realMode?: 'WALKING' | 'DRIVING';
  realText?: string;
}

/**
 * 주변 편의 인프라 — 전세계 공통 시설 타입만 (특정 국가 노선/브랜드 배제).
 * key는 /api/nearby-infra 서버 응답의 key와 1:1 매칭됨.
 */
const INFRA_META: Record<string, { icon: string; color: string; name: string }> = {
  transit: { icon: IC_BUS, color: '#0B7CC4', name: '대중교통 (역/정류장)' },
  convenience: { icon: IC_STORE, color: '#1D9E75', name: '편의점' },
  cafe: { icon: IC_COFFEE, color: '#B45309', name: '카페' },
  pharmacy: { icon: IC_PHARM, color: '#E24B4A', name: '약국' },
  hospital: { icon: IC_HOSPITAL, color: '#D4537E', name: '병원/클리닉' },
  atm: { icon: IC_ATM, color: '#F5A623', name: 'ATM' },
  taxi: { icon: IC_TAXI, color: '#D9931B', name: '택시 승차장' },
  supermarket: { icon: IC_CART, color: '#7F77DD', name: '슈퍼마켓' },
};

interface InfraFacility {
  key: string;
  name: string;
  meters: number;
  walkMin: number;
  lat: number;
  lng: number;
  placeId?: string;
  rating?: number;
  address?: string;
}

/** 실데이터 도착 전 초기/폴백 표시용 예시 (API 실패 시 그대로 유지) */
const INFRA_SAMPLE: { key: string; dist: string; min: string }[] = [
  { key: 'transit', dist: '210m', min: '3분' },
  { key: 'convenience', dist: '350m', min: '5분' },
  { key: 'cafe', dist: '280m', min: '4분' },
  { key: 'pharmacy', dist: '430m', min: '6분' },
  { key: 'hospital', dist: '450m', min: '6분' },
  { key: 'atm', dist: '500m', min: '7분' },
  { key: 'taxi', dist: '600m', min: '8분' },
  { key: 'supermarket', dist: '520m', min: '7분' },
];

/** 여행 효율 점수 — 실데이터(Gemini) 도착 전 초기/폴백 표시용 예시 */
const EFFICIENCY_SAMPLE = {
  score: 88,
  grade: 'Excellent',
  note: '이 숙소는 여행 거점으로 적합해요',
  items: [
    { label: '이동 편의성', stars: 4 },
    { label: '관광 접근성', stars: 5 },
    { label: '편의시설', stars: 4 },
    { label: '위치 만족도', stars: 4 },
    { label: '가성비', stars: 4 },
  ],
};

/** score 응답의 한글 키(공백 없음) → 화면 라벨(공백 있음) */
const SCORE_LABELS: { key: string; label: string }[] = [
  { key: '이동편의성', label: '이동 편의성' },
  { key: '관광접근성', label: '관광 접근성' },
  { key: '편의시설', label: '편의시설' },
  { key: '위치만족도', label: '위치 만족도' },
  { key: '가성비', label: '가성비' },
];

/** api/hotel-score.ts의 gradeFor()와 같은 기준(85/70/55) — 등급 배지 옆 한 줄 설명을 점수와 어긋나지 않게 매핑 */
const GRADE_NOTE: Record<string, string> = {
  Excellent: '여행 거점으로 아주 적합한 숙소예요',
  Good: '여행 거점으로 적합한 숙소예요',
  Fair: '여행 거점으로 무난한 숙소예요',
  Basic: '여행 거점으로는 다소 아쉬울 수 있어요',
};

/** 평균 이동시간 등 집계용 분 단위 환산 — 도보/대중교통/차량 속도 가정을 모든 구간에 적용 */
function estimateMinutes(km: number): number {
  if (km <= 1.2) return Math.max(2, Math.round(km * 12));
  if (km <= 4) return Math.max(8, Math.round(km * 4));
  return Math.max(5, Math.round(km * 2.4));
}

async function renderStep3(body: HTMLElement): Promise<void> {
  if (!selectedZone || !selectedBasecamp) {
    step = 2;
    await renderStep2(body);
    return;
  }

  const zone = selectedZone;
  const basecamp = selectedBasecamp;
  const dateRange = formatTripDateRange();

  // 접근성 타일이 이전(다른) 숙소의 인프라 데이터를 한 프레임이라도 잘못 보여주지 않도록,
  // 매 Step3 진입 시 여기서 먼저 리셋 — 실제 재조회는 아래 loadNearbyInfra가 담당(서버 캐시라 저렴함)
  step3Facilities = [];
  step3FacilitiesLoaded = false;

  // AI 리뷰 요약은 호출당 비용이 있어 같은 숙소면 재렌더링(투표 등)이 와도 유지하고,
  // 다른 숙소로 바뀔 때만 리셋함
  if (reviewSummaryPlaceId !== basecamp.id) {
    reviewSummaryData = null;
    reviewSummaryLoading = false;
    reviewSummaryPlaceId = basecamp.id;
  }

  const others = zone.places.filter((p) => p.id !== basecamp.id);
  const withDistance: Step3Item[] = others
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => {
      const km = haversineKm(basecamp.lat!, basecamp.lng!, p.lat!, p.lng!);
      return { place: p, km, minutes: estimateMinutes(km), real: false };
    })
    .sort((a, b) => a.km - b.km);

  // 처음 진입 시 기본적으로 가까운 곳(4km 이내)은 자동 체크
  if (confirmedIds.size === 0) {
    withDistance.forEach((item) => {
      if (item.km <= 4) confirmedIds.add(item.place.id);
    });
  }

  // "관광지 접근성" 타일용 — 이 권역이 아니라 활성 여행지 전체의 VISIT 장소 기준(자기충족 오류 방지).
  // 우선 직선거리 추정치로 즉시 채우고, 아래에서 실측 배치 호출로 교체함.
  step3VisitItems = allPlaces
    .filter((p) => p.id !== basecamp.id && p.mood === '가고싶어' && p.lat != null && p.lng != null)
    .map((p) => {
      const km = haversineKm(basecamp.lat!, basecamp.lng!, p.lat!, p.lng!);
      return { place: p, km, minutes: estimateMinutes(km), real: false };
    });

  const closeCount = withDistance.filter((item) => item.km <= 1.5).length;
  const stayNights = currentStayNights();
  const stayHeadcount = getTripHeadcount();
  const perNightPerPerson =
    totalBudgetKRW != null && totalBudgetKRW > 0
      ? Math.round(totalBudgetKRW / stayNights / stayHeadcount)
      : null;
  const budgetLabel = perNightPerPerson != null ? perNightPerPerson.toLocaleString() + '원' : '미입력';

  void closeCount;
  // 스테퍼 줄 우측(#sl-stepper-extra)은 이제 renderShortlistDestBar가 "여행지 변경"을
  // 대신 채우므로(상단 정보 압축), Step3 전용 요약 박스는 더 이상 그리지 않음 —
  // 같은 정보(선택 지역/숙박 기간/예산)는 아래 "여행 중심 요약" 카드에 이미 있고,
  // 그 카드의 "수정" 버튼이 openStayDateEditor로 계속 연결돼 있어 기능은 그대로 유지됨.

  // 투표 요청을 타고 이 숙소의 Step3로 들어온 경우엔 응답 카드를, 이미 투표했으면 결과 카드를,
  // 요청을 보내놓고 기다리는 중이면 결과+재요청 카드를, 아니면 기본 요청 카드를 보여줌
  const pendingVote = getPendingVoteResponseFor(basecamp.id);
  const myVote = getMyVoteForPlace(basecamp.id);
  const activeRequestId = getActiveRequestIdForPlace(basecamp.id);
  const tally: VoteTally = activeRequestId ? getTally(activeRequestId) : { up: 0, down: 0 };
  const tallyRowHtml =
    '        <div class="hv-tally" id="hv-tally">' +
    '<span class="hv-tally-up">👍 좋아요 ' + tally.up + '명</span>' +
    '<span class="hv-tally-down">👎 별로예요 ' + tally.down + '명</span>' +
    '</div>';

  let voteCardHtml: string;
  if (pendingVote) {
    voteCardHtml = [
      '      <div class="sl-step3-card hv-vote-card" data-request-id="' + pendingVote.requestId + '">',
      '        <div class="sl-step3-card-title">' + IC_SPARK + ' 이 숙소 어때요?</div>',
      '        <div class="sl-step3-card-desc">투표를 요청받았어요. 의견을 남겨주세요.</div>',
      '        <div class="hv-respond-actions">',
      '          <button type="button" class="hv-respond-btn hv-respond-up" id="hv-vote-up">👍 좋아요</button>',
      '          <button type="button" class="hv-respond-btn hv-respond-down" id="hv-vote-down">👎 별로예요</button>',
      '        </div>',
      '        <button type="button" class="hv-vote-skip-btn" id="hv-vote-skip">나중에 할게요</button>',
      '      </div>',
    ].join('\n');
  } else if (myVote && activeRequestId) {
    voteCardHtml = [
      '      <div class="sl-step3-card hv-vote-card" data-request-id="' + activeRequestId + '">',
      '        <div class="sl-step3-card-title">' + IC_SPARK + ' 멤버 투표</div>',
      '        <div class="hv-my-vote">내 투표: ' + (myVote === 'up' ? '👍 좋아요' : '👎 별로예요') + '</div>',
      tallyRowHtml,
      '      </div>',
    ].join('\n');
  } else if (activeRequestId) {
    voteCardHtml = [
      '      <div class="sl-step3-card hv-vote-card" data-request-id="' + activeRequestId + '">',
      '        <div class="sl-step3-card-title">멤버 투표</div>',
      '        <div class="sl-step3-card-desc">멤버에게 요청을 보냈어요. 응답을 기다리는 중이에요.</div>',
      '        <button type="button" class="hv-request-btn hv-request-btn-block" id="hv-request-vote">' + IC_SPARK + ' 다시 요청하기</button>',
      tallyRowHtml,
      '      </div>',
    ].join('\n');
  } else {
    voteCardHtml = [
      '      <div class="sl-step3-card hv-vote-card">',
      '        <div class="sl-step3-card-title">멤버 투표</div>',
      '        <div class="sl-step3-card-desc">이 숙소가 어떤지 다른 멤버에게 물어보세요.</div>',
      '        <button type="button" class="hv-request-btn hv-request-btn-block" id="hv-request-vote">' + IC_SPARK + ' 멤버에게 투표 요청</button>',
      '      </div>',
    ].join('\n');
  }

  const stars = typeof basecamp.google_rating === 'number' ? buildStars(basecamp.google_rating) : '';
  const categoryLabel = basecamp.category || (basecamp.mood ? MOOD_LABEL[basecamp.mood] : '') || '숙소';

  const eff = EFFICIENCY_SAMPLE;
  const effRatings = eff.items.map((it) => buildEffRatingRow(it.label, it.stars)).join('');

  const infraRows = INFRA_SAMPLE
    .map((f) => {
      const meta = INFRA_META[f.key];
      return buildInfraRow(meta, f.min + ' · ' + f.dist, f.key);
    })
    .join('');

  // 이미 이 숙소의 AI 리뷰 요약을 불러온 적이 있으면(다른 카드 갱신으로 재렌더링된 경우) 버튼 대신 결과를 바로 보여줌
  const reviewAlreadyLoaded = reviewSummaryData != null;

  body.innerHTML = [
    '<div class="sl-step3">',

    '  <div class="sl-step2-header-row">',
    '    <div class="sl-step1-header sl-step2-header-text">',
    '      <div class="sl-eyebrow">FINAL CHECK</div>',
    '      <div class="sl-title">이 숙소를 여행의 중심으로 확정할까요?</div>',
    '    </div>',
    '  </div>',

    '  <div class="sl-step3-layout">',

    /* ── 좌측 메인 (65%) ── */
    '    <div class="sl-step3-left">',

    // ① 여행 중심 요약
    '      <div class="sl-step3-card sl-step3-summary-card">',
    '        <div class="sl-step3-card-title">여행 중심 요약</div>',
    '        <div class="sl-step3-summary-body-wrap">',
    '          <div class="sl-step3-summary-photo"' + (basecamp.photo_url ? ' style="background-image:url(\'' + basecamp.photo_url + '\')"' : '') + '>' + (basecamp.photo_url ? '' : IC_BED) + '</div>',
    '          <div class="sl-step3-summary-body">',
    '            <div class="sl-step3-summary-top">',
    '              <a class="sl-step3-summary-name sl-step3-summary-name-link" href="' + buildHotelSearchUrl(basecamp) + '" target="_blank" rel="noopener noreferrer" title="Google 호텔 가격비교에서 이 숙소 검색">' + escapeHtml(basecamp.name) + ' ' + IC_EXTLINK + '</a>',
    stars ? '              <div class="sl-step3-summary-stars">' + stars + '</div>' : '',
    '            </div>',
    '            <div class="sl-step3-summary-tags"><span class="sl-zone-tag">' + escapeHtml(categoryLabel) + '</span></div>',
    basecamp.address ? '            <div class="sl-step3-summary-address">' + escapeHtml(basecamp.address) + '</div>' : '',
    '            <div class="sl-step3-summary-grid">',
    '              <div class="sl-step3-summary-field"><span class="sl-step3-summary-field-label">선택 지역</span><span class="sl-step3-summary-field-value">' + escapeHtml(zone.name) + '</span></div>',
    '              <div class="sl-step3-summary-field"><span class="sl-step3-summary-field-label">숙박 기간</span><span class="sl-step3-summary-field-value">' + escapeHtml(dateRange) + '</span></div>',
    '              <div class="sl-step3-summary-field"><span class="sl-step3-summary-field-label">예산 (1박 1인)</span><span class="sl-step3-summary-field-value">' + escapeHtml(budgetLabel) + '</span></div>',
    '              <button class="sl-step2-summary-edit sl-step3-summary-edit" id="sl-back-2c">' + IC_EXTLINK + ' 수정</button>',
    '            </div>',
    '          </div>',
    '        </div>',
    '      </div>',

    // ② 주변 편의 인프라 — 지도 + 시설 리스트(Phase 2 예시)
    '      <div class="sl-step3-card sl-step3-infra-card">',
    '        <div class="sl-step3-card-title">주변 편의 인프라</div>',
    '        <div class="sl-step3-infra-body">',
    '          <div class="sl-map-wrap sl-step3-map-wrap">',
    '            <div id="sl-map3" class="sl-map"></div>',
    '          </div>',
    '          <div class="sl-step3-infra-side">',
    '            <div class="sl-step3-infra-list" id="sl-infra-list">' + infraRows + '</div>',
    '            <div class="sl-step3-infra-scale">',
    '              <span><span class="sl-infra-scale-line" style="--sc:#1D9E75"></span>도보 5분 (400m)</span>',
    '              <span><span class="sl-infra-scale-line" style="--sc:#0B7CC4"></span>도보 10분 (800m)</span>',
    '              <span><span class="sl-infra-scale-line" style="--sc:#94A3B8"></span>도보 15분 (1.2km)</span>',
    '            </div>',
    '          </div>',
    '        </div>',
    '      </div>',

    // ③ 여행 효율 점수 (Gemini 정형 채점 — 도착 전엔 예시)
    '      <div class="sl-step3-card sl-step3-eff-card">',
    '        <div class="sl-step3-eff-score">',
    '          <div class="sl-step3-eff-num" id="sl-eff-num">' + eff.score + '<span class="sl-step3-eff-max">/100</span></div>',
    '          <div class="sl-step3-eff-grade" id="sl-eff-grade" style="' + gradeBadgeStyle(eff.grade) + '">' + escapeHtml(eff.grade) + '</div>',
    '          <div class="sl-step3-eff-note" id="sl-eff-grade-note">' + escapeHtml(eff.note) + '</div>',
    '        </div>',
    '        <div class="sl-step3-eff-ratings" id="sl-eff-ratings">' + effRatings + '</div>',
    '      </div>',

    '    </div>',

    /* ── 우측 사이드 (35%) ── */
    '    <div class="sl-step3-right">',

    // ① 이 숙소를 선택하면 (2x3 컬러 타일)
    '      <div class="sl-step3-card">',
    '        <div class="sl-step3-card-title">이 숙소를 선택하면</div>',
    '        <div class="sl-step3-stat-grid" id="sl-step3-stats"></div>',
    '      </div>',

    // ② AI 리뷰 요약 — 버튼을 눌러야 그때 Gemini(Google 검색 그라운딩) 요청 (비용이 드는 기능이라 자동 조회 안 함)
    '      <div class="sl-step3-card">',
    '        <div class="sl-step3-card-title">AI 리뷰 요약</div>',
    '        <div class="sl-step3-card-desc">실제 이용자 후기를 AI가 찾아 정리해드려요.</div>',
    '        <button type="button" class="sl-review-summary-btn" id="sl-review-summary-btn"' + (reviewAlreadyLoaded ? ' style="display:none"' : '') + '>' + IC_SPARK + ' AI 리뷰 요약 보기</button>',
    '        <div class="sl-review-summary-header" id="sl-review-summary-header" style="display:' + (reviewAlreadyLoaded ? 'flex' : 'none') + '">',
    '          <span class="sl-review-summary-header-label">AI가 찾은 실제 후기 요약</span>',
    '          <button type="button" class="sl-nearby-toggle-btn" id="sl-review-summary-toggle">' + IC_CHEVRON_DOWN + '</button>',
    '        </div>',
    '        <div class="sl-review-summary-body" id="sl-review-summary-body"></div>',
    '      </div>',

    // ③ 숙소 근처 검색 (자유 검색어로 거리순 결과, 접고 펼 수 있음)
    '      <div class="sl-step3-card">',
    '        <div class="sl-step3-card-title">숙소 근처 검색</div>',
    '        <div class="sl-step3-card-desc">숙소 근처를 검색해보세요.</div>',
    '        <div class="sl-nearby-search-box">',
    '          <span class="sl-nearby-search-icon">' + IC_SEARCH2 + '</span>',
    '          <input type="text" class="sl-nearby-search-input" id="sl-nearby-search-input" placeholder="예: 마사지, PC방, 편의점" maxlength="40" />',
    '          <button type="button" class="sl-nearby-search-btn" id="sl-nearby-search-btn">검색</button>',
    '        </div>',
    '        <div class="sl-nearby-results-header" id="sl-nearby-results-header" style="display:none">',
    '          <span class="sl-nearby-results-count" id="sl-nearby-results-count"></span>',
    '          <button type="button" class="sl-nearby-toggle-btn" id="sl-nearby-toggle-btn">' + IC_CHEVRON_DOWN + '</button>',
    '        </div>',
    '        <div class="sl-nearby-search-results" id="sl-nearby-search-results"></div>',
    '      </div>',

    // ④ 멤버 투표
    voteCardHtml,

    // ⑤ 숙소 나누기 진입 (실제 여행지 + 아직 단일 구간일 때만 — 구간이 2개 이상이면 상단 바로 대체됨)
    (slActiveDest && !isSyntheticDestination(slActiveDest.id) && slSegments.length < 2)
      ? [
          '      <div class="sl-step3-split-card">',
          '        <div class="sl-step3-split-text">',
          '          <div class="sl-step3-split-title">' + IC_BED + ' 이 여행지에서 숙소를 나눠 묵나요?</div>',
          '          <div class="sl-step3-split-desc">앞·뒤 며칠씩 다른 숙소에 묵는다면 구간을 나눠 각각 지역·숙소를 정할 수 있어요.</div>',
          '        </div>',
          '        <button type="button" class="sl-step3-split-btn" id="sl-split-add">' + IC_PLUS + ' 숙소 나누기</button>',
          '      </div>',
        ].join('\n')
      : '',

    // ⑥ 하단 CTA (우측 컬럼 맨 아래 — 레퍼런스와 동일)
    '      <div class="sl-step3-cta-wrap">',
    '        <button class="sl-step2-cta sl-step3-cta" id="sl-proceed"><span class="sl-step3-cta-main">' + IC_CHECK + ' 이 숙소를 여행 중심으로 확정하기</span></button>',
    '      </div>',

    '    </div>',
    '  </div>',

    '</div>',
  ].join('\n');

  body.querySelector('#sl-back-2c')?.addEventListener('click', openStayDateEditor);

  const infraListEl = body.querySelector('#sl-infra-list') as HTMLElement | null;
  if (infraListEl) attachInfraRowClickHandlers(infraListEl);

  // 멤버에게 투표 요청 — 응답을 못 받았어도 잠기지 않고 버튼을 다시 눌러 몇 번이든 재요청 가능
  body.querySelector('#hv-request-vote')?.addEventListener('click', () => {
    if (!slActiveDest) return;
    sendVoteRequest(currentTripId, slActiveDest.id, {
      id: basecamp.id,
      name: basecamp.name,
      photo_url: basecamp.photo_url,
    });
    renderStep3(body);
  });

  // 실시간으로 다른 멤버의 응답이 오면(요청자·이미 투표한 멤버 모두) 집계 숫자만 바로 갱신
  if (voteTallyListenerRef) window.removeEventListener('mongsil:voteTallyChanged', voteTallyListenerRef);
  voteTallyListenerRef = ((e: CustomEvent<{ requestId: string; placeId: string; tally: VoteTally }>) => {
    if (e.detail.placeId !== basecamp.id) return;
    const tallyEl = body.querySelector('#hv-tally');
    if (tallyEl) {
      tallyEl.innerHTML =
        '<span class="hv-tally-up">👍 좋아요 ' + e.detail.tally.up + '명</span>' +
        '<span class="hv-tally-down">👎 별로예요 ' + e.detail.tally.down + '명</span>';
    } else {
      // 집계 영역이 아직 없던 상태(예: 요청 전이었는데 방금 첫 응답이 옴)면 카드 자체를 다시 그림
      renderStep3(body);
    }
  }) as EventListener;
  window.addEventListener('mongsil:voteTallyChanged', voteTallyListenerRef);

  body.querySelector('#hv-vote-up')?.addEventListener('click', () => {
    castVote('up');
    renderStep3(body);
  });
  body.querySelector('#hv-vote-down')?.addEventListener('click', () => {
    castVote('down');
    renderStep3(body);
  });
  body.querySelector('#hv-vote-skip')?.addEventListener('click', () => {
    clearPendingVoteResponse();
    renderStep3(body);
  });

  body.querySelector('#sl-proceed')?.addEventListener('click', async () => {
    const btn = body.querySelector('#sl-proceed') as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = '저장 중...';
    basecampConfirmedAt = new Date().toISOString();
    await saveShortlistState();

    // 전체 숙박 기간 중 아직 아무 구간도 채우지 않은 빈 날짜가 있으면 자동으로 나눠서
    // 그 구간을 채우게 하고, route로는 넘어가지 않는다.
    const filled = await fillCoverageGapsIfAny();
    if (filled) return;

    // 숙소 나누기로 이미 구간이 여러 개 생겼는데, 그중 아직 숙소를 확정하지 않은(버튼을
    // 실제로 안 누른) 구간이 남아있으면 그 구간으로 전환해 마저 확정하게 하고 route로는
    // 넘어가지 않는다.
    const unresolved = slSegments.find((s) => !s.basecamp_confirmed_at);
    if (unresolved) {
      switchSegment(unresolved.id);
      return;
    }

    window.dispatchEvent(
      new CustomEvent('mongsil:navigateGate', { detail: { tripId: currentTripId, gate: 'route' } })
    );
  });

  body.querySelector('#sl-split-add')?.addEventListener('click', async (e) => {
    // e.currentTarget은 이벤트 디스패치가 끝나는 즉시(= await 지점에서) null이 되므로
    // await 이전에 반드시 동기적으로 값을 꺼내둬야 함(안 그러면 getBoundingClientRect에서 TypeError)
    const anchor = e.currentTarget as HTMLElement;
    await saveShortlistState(); // 지금 구간(현재 숙소 선택)을 먼저 저장하고 새 구간 추가
    openSegmentDatePopover(anchor);
  });

  body.querySelector('#sl-nearby-search-btn')?.addEventListener('click', () => runNearbySearch(body, basecamp));
  body.querySelector('#sl-nearby-search-input')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      runNearbySearch(body, basecamp);
    }
  });
  body.querySelector('#sl-nearby-toggle-btn')?.addEventListener('click', () => {
    const resultsEl = body.querySelector('#sl-nearby-search-results') as HTMLElement | null;
    const toggleBtn = body.querySelector('#sl-nearby-toggle-btn') as HTMLElement | null;
    const collapsed = resultsEl?.classList.toggle('sl-nearby-collapsed') ?? false;
    toggleBtn?.classList.toggle('sl-nearby-toggle-collapsed', collapsed);
  });

  body.querySelector('#sl-review-summary-btn')?.addEventListener('click', () => runReviewSummary(body, basecamp, zone.name, getTripDestination()));
  body.querySelector('#sl-review-summary-toggle')?.addEventListener('click', () => {
    const resultsEl = body.querySelector('#sl-review-summary-body') as HTMLElement | null;
    const toggleBtn = body.querySelector('#sl-review-summary-toggle') as HTMLElement | null;
    const collapsed = resultsEl?.classList.toggle('sl-nearby-collapsed') ?? false;
    toggleBtn?.classList.toggle('sl-nearby-toggle-collapsed', collapsed);
  });
  // 재렌더링(투표 등)으로 버튼/헤더 DOM이 새로 생겼어도 이미 불러온 결과가 있으면 즉시 다시 채워줌
  if (reviewSummaryData) renderReviewSummary(body, reviewSummaryData);

  renderStep3Lists(body, withDistance);
  initMapStep3(body);

  // 실제 길찾기(Distance Matrix API) — 직선거리 추정치를 실제 이동시간으로 백그라운드에서 교체
  loadRealTravelTimes(basecamp, withDistance).then((realTimes) => {
    if (!realTimes || step !== 3) return;
    withDistance.forEach((item) => {
      const real = realTimes.get(item.place.id);
      if (!real) return;
      item.minutes = real.durationMin;
      item.real = true;
      item.realMode = real.mode;
      item.realText = real.durationText;
    });
    renderStep3Lists(body, withDistance);
  });

  // "관광지 접근성"(트립 전체 VISIT 장소)도 같은 방식으로 배치 실측 — withDistance와 별개 호출이지만
  // 여기서도 장소 수만큼이 아니라 도보/차량 묶음당 1회씩(최대 2회)이라 비용이 크게 늘지 않음
  if (step3VisitItems.length > 0) {
    loadRealTravelTimes(basecamp, step3VisitItems).then((realTimes) => {
      if (!realTimes || step !== 3) return;
      step3VisitItems.forEach((item) => {
        const real = realTimes.get(item.place.id);
        if (!real) return;
        item.minutes = real.durationMin;
        item.real = true;
        item.realMode = real.mode;
        item.realText = real.durationText;
      });
      renderStep3Lists(body, withDistance);
    });
  }

  // Phase 2 실데이터 — 도착하면 예시를 실데이터로 교체, 실패하면 예시+안내를 그대로 유지
  const walkable = withDistance.filter((item) => item.km <= 1.5).length;
  const avgMin = withDistance.length
    ? Math.round(withDistance.reduce((s, item) => s + item.minutes, 0) / withDistance.length)
    : 0;
  loadNearbyInfra(body, basecamp, withDistance);
  loadHotelScore(body, {
    placeId: basecamp.google_place_id ?? undefined,
    hotelName: basecamp.name,
    address: basecamp.address ?? '',
    zoneName: zone.name,
    destination: getTripDestination(),
    googleRating: basecamp.google_rating,
    budgetLabel,
    nearby: { walkableCount: walkable, avgWalkMin: avgMin },
  });
}

function buildInfraRow(meta: { icon: string; color: string; name: string } | undefined, distText: string, key?: string): string {
  if (!meta) return '';
  return [
    '<div class="sl-infra-row"' + (key ? ' data-infra-key="' + key + '"' : '') + '>',
    '  <span class="sl-infra-icon" style="--infra-color:' + meta.color + '">' + meta.icon + '</span>',
    '  <span class="sl-infra-name">' + escapeHtml(meta.name) + '</span>',
    '  <span class="sl-infra-dist">' + escapeHtml(distText) + '</span>',
    '</div>',
  ].join('');
}

/** 리스트 행 클릭 → 해당 카테고리의 지도 마커로 확대 이동 (한 카테고리엔 마커가 하나뿐이라 key로 바로 찾음) */
function attachInfraRowClickHandlers(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('.sl-infra-row[data-infra-key]').forEach((row) => {
    row.addEventListener('click', () => {
      const key = row.dataset.infraKey;
      if (key) zoomToInfraMarker(key);
    });
  });
}

interface ReviewSummaryResult {
  pros: string[];
  cons: string[];
  tips: string[];
  sources: { title: string; uri: string }[];
}

/** 한 번 불러온 결과는 재요청 없이 접었다 펼 수 있도록 보관 (Google Search 그라운딩은 호출당 비용이 있어 재요청을 피함) */
let reviewSummaryData: ReviewSummaryResult | null = null;
let reviewSummaryLoading = false;
/** reviewSummaryData가 어느 숙소(placeId) 결과인지 — 다른 숙소로 바꾸면 리셋해야 함 */
let reviewSummaryPlaceId: string | null = null;

function buildReviewSection(icon: string, title: string, items: string[]): string {
  return [
    '<div class="sl-review-section">',
    '  <div class="sl-review-section-title">' + icon + ' ' + title + '</div>',
    '  <ul class="sl-review-section-list">' + items.map((t) => '<li>' + escapeHtml(t) + '</li>').join('') + '</ul>',
    '</div>',
  ].join('');
}

function renderReviewSummary(body: HTMLElement, data: ReviewSummaryResult): void {
  const bodyEl = body.querySelector('#sl-review-summary-body') as HTMLElement | null;
  if (!bodyEl) return;
  bodyEl.innerHTML = [
    buildReviewSection('👍', '장점', data.pros),
    buildReviewSection('👎', '단점 및 주의사항', data.cons),
    buildReviewSection('💡', '꿀팁', data.tips),
    data.sources.length
      ? '<div class="sl-review-sources">출처: ' +
        data.sources.map((s) => '<a href="' + s.uri + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(s.title) + '</a>').join(', ') +
        '</div>'
      : '',
  ].join('');
}

/** "AI 리뷰 요약 보기" 클릭 — 이미 불러왔으면 재요청 없이 접기/펼치기만, 처음이면 /api/hotel-review-summary 호출 */
async function runReviewSummary(
  body: HTMLElement,
  basecamp: Place,
  zoneName: string,
  destination: string
): Promise<void> {
  const btn = body.querySelector('#sl-review-summary-btn') as HTMLButtonElement | null;
  const headerEl = body.querySelector('#sl-review-summary-header') as HTMLElement | null;
  const bodyEl = body.querySelector('#sl-review-summary-body') as HTMLElement | null;
  if (!btn || !headerEl || !bodyEl) return;

  if (reviewSummaryData) {
    const collapsed = bodyEl.classList.toggle('sl-nearby-collapsed');
    body.querySelector('#sl-review-summary-toggle')?.classList.toggle('sl-nearby-toggle-collapsed', collapsed);
    return;
  }
  if (reviewSummaryLoading) return;

  reviewSummaryLoading = true;
  btn.disabled = true;
  btn.textContent = 'AI가 후기를 찾는 중...';

  let result: ReviewSummaryResult | null = null;
  try {
    // Gemini를 쓰는 엔드포인트들은 Vercel 함수 12개 한도(Claude.md 3-7) 때문에
    // /api/ai 한 파일로 합쳐져 있고 body의 kind로 분기한다.
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'hotel-review',
        placeId: basecamp.google_place_id ?? undefined,
        hotelName: basecamp.name,
        address: basecamp.address ?? '',
        zoneName,
        destination,
      }),
    });
    if (res.ok) result = await res.json();
  } catch {
    /* result는 null로 유지 → 아래 실패 처리 */
  }

  reviewSummaryLoading = false;
  if (step !== 3) return;

  if (!result) {
    btn.disabled = false;
    btn.textContent = 'AI 리뷰 요약을 가져오지 못했어요. 다시 시도';
    return;
  }

  reviewSummaryData = result;
  btn.style.display = 'none';
  headerEl.style.display = 'flex';
  renderReviewSummary(body, result);
}

interface NearbySearchResult {
  name: string;
  meters: number;
  walkMin: number;
  lat: number;
  lng: number;
  placeId?: string;
  rating?: number;
  address?: string;
}

/** 이전 검색이 나중에 응답이 와서 최신 검색 결과를 덮어쓰지 않도록 막는 시퀀스 번호 */
let nearbySearchSeq = 0;

/** 클릭하면 구글에서 이 장소를 검색한 결과 창으로 이동 (이름+주소로 검색해 동명 장소와 헷갈리지 않게 함) */
function googleSearchUrl(r: NearbySearchResult): string {
  const q = r.address ? r.name + ' ' + r.address : r.name;
  return 'https://www.google.com/search?q=' + encodeURIComponent(q);
}

function buildNearbySearchRow(r: NearbySearchResult): string {
  const km = r.meters >= 1000 ? (r.meters / 1000).toFixed(1) + 'km' : r.meters + 'm';
  return [
    '<a class="sl-nearby-result-row" href="' + googleSearchUrl(r) + '" target="_blank" rel="noopener noreferrer">',
    '  <span class="sl-nearby-result-icon">' + IC_PIN + '</span>',
    '  <div class="sl-nearby-result-main">',
    '    <div class="sl-nearby-result-name">' + escapeHtml(r.name) + '</div>',
    r.address ? '    <div class="sl-nearby-result-addr">' + escapeHtml(r.address) + '</div>' : '',
    '  </div>',
    '  <div class="sl-nearby-result-meta">',
    '    <div class="sl-nearby-result-dist">' + r.walkMin + '분 · ' + km + '</div>',
    r.rating != null ? '    <div class="sl-nearby-result-rating">★ ' + r.rating.toFixed(1) + '</div>' : '',
    '  </div>',
    '</a>',
  ].join('');
}

/** 결과 유무에 따라 "N개 결과 + 접기/펼치기" 헤더를 보이거나 숨김 (검색 중/실패/빈 결과일 땐 숨김) */
function setNearbyResultsHeader(body: HTMLElement, count: number | null): void {
  const headerEl = body.querySelector('#sl-nearby-results-header') as HTMLElement | null;
  const countEl = body.querySelector('#sl-nearby-results-count') as HTMLElement | null;
  const resultsEl = body.querySelector('#sl-nearby-search-results') as HTMLElement | null;
  const toggleBtn = body.querySelector('#sl-nearby-toggle-btn') as HTMLElement | null;
  if (!headerEl) return;
  if (count == null || count === 0) {
    headerEl.style.display = 'none';
    return;
  }
  headerEl.style.display = 'flex';
  if (countEl) countEl.textContent = count + '개 결과';
  // 새 검색 결과는 항상 펼친 상태로 보여줌
  resultsEl?.classList.remove('sl-nearby-collapsed');
  toggleBtn?.classList.remove('sl-nearby-toggle-collapsed');
}

/** 자유 검색어로 숙소 근처 결과 조회 (/api/nearby-search) — Text Search + Route Matrix, 숙소+검색어 조합 단위로 서버 캐싱됨 */
async function runNearbySearch(body: HTMLElement, basecamp: Place): Promise<void> {
  const input = body.querySelector('#sl-nearby-search-input') as HTMLInputElement | null;
  const resultsEl = body.querySelector('#sl-nearby-search-results') as HTMLElement | null;
  const btn = body.querySelector('#sl-nearby-search-btn') as HTMLButtonElement | null;
  if (!input || !resultsEl) return;

  const query = input.value.trim();
  if (!query) return;

  if (basecamp.lat == null || basecamp.lng == null) {
    setNearbyResultsHeader(body, null);
    resultsEl.innerHTML = '<div class="sl-nearby-search-empty">숙소 좌표를 확인할 수 없어요.</div>';
    return;
  }

  const seq = ++nearbySearchSeq;
  if (btn) btn.disabled = true;
  setNearbyResultsHeader(body, null);
  resultsEl.innerHTML = '<div class="sl-nearby-search-empty">검색 중...</div>';

  let results: NearbySearchResult[] = [];
  let failed = false;
  try {
    const res = await fetch('/api/nearby-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeId: basecamp.google_place_id ?? undefined,
        lat: basecamp.lat,
        lng: basecamp.lng,
        query,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      results = Array.isArray(data.results) ? data.results : [];
    } else {
      failed = true;
    }
  } catch {
    failed = true;
  }

  // 그 사이 새 검색이 시작됐거나 다른 화면으로 이동했으면 이 응답은 버림
  if (seq !== nearbySearchSeq || step !== 3) return;
  if (btn) btn.disabled = false;

  if (failed) {
    resultsEl.innerHTML = '<div class="sl-nearby-search-empty">검색에 실패했어요. 다시 시도해주세요.</div>';
    return;
  }
  if (results.length === 0) {
    resultsEl.innerHTML = '<div class="sl-nearby-search-empty">"' + escapeHtml(query) + '" 검색 결과가 없어요.</div>';
    return;
  }
  resultsEl.innerHTML = results.map(buildNearbySearchRow).join('');
  setNearbyResultsHeader(body, results.length);
}

function buildEffRatingRow(label: string, stars: number): string {
  const filled = IC_STAR.repeat(stars);
  const empty = '<span class="sl-eff-star-empty">' + IC_STAR + '</span>'.repeat(Math.max(0, 5 - stars));
  return [
    '<div class="sl-eff-rating">',
    '  <span class="sl-eff-rating-label">' + escapeHtml(label) + '</span>',
    '  <span class="sl-eff-rating-stars">' + filled + empty + '</span>',
    '</div>',
  ].join('');
}

/** 주변 편의 인프라 실데이터 (/api/nearby-infra) — 성공 시 리스트+지도 점선+접근성 타일 교체 */
async function loadNearbyInfra(body: HTMLElement, basecamp: Place, withDistance: Step3Item[]): Promise<void> {
  if (basecamp.lat == null || basecamp.lng == null) {
    step3FacilitiesLoaded = true; // 좌표가 없어 확인 자체가 불가 — "확인 중" 대신 바로 결과 없음으로 표시
    if (step === 3) renderStep3Lists(body, withDistance);
    return;
  }

  let facilities: InfraFacility[] = [];
  try {
    const res = await fetch('/api/nearby-infra', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId: basecamp.google_place_id ?? undefined, lat: basecamp.lat, lng: basecamp.lng }),
    });
    if (res.ok) {
      const data = await res.json();
      facilities = Array.isArray(data.facilities) ? data.facilities : [];
    }
  } catch {
    /* 실패하면 빈 결과로 취급 — 아래에서 "로드는 됐지만 못 찾음" 상태로 마무리 */
  }

  step3FacilitiesLoaded = true;
  step3Facilities = facilities;
  if (step !== 3) return;

  if (facilities.length > 0) {
    const listEl = body.querySelector('#sl-infra-list') as HTMLElement;
    if (listEl) {
      listEl.innerHTML = facilities
        .map((f) => {
          const meta = INFRA_META[f.key];
          const km = f.meters >= 1000 ? (f.meters / 1000).toFixed(1) + 'km' : f.meters + 'm';
          return buildInfraRow(meta, f.walkMin + '분 · ' + km, f.key);
        })
        .join('');
      attachInfraRowClickHandlers(listEl);
    }
    drawInfraLines(basecamp, facilities); // 지도가 아직이면 no-op → 지도 준비 후 initMapStep3에서 다시 그림
  }

  renderStep3Lists(body, withDistance); // "이 숙소를 선택하면" 접근성 타일도 이 데이터 기준이라 함께 갱신
}

/** 여행 효율 점수 실데이터 (/api/hotel-score) — 성공 시 점수/등급/별점 교체 */
async function loadHotelScore(
  body: HTMLElement,
  payload: { placeId?: string; hotelName: string; address: string; zoneName: string; destination: string; googleRating: number | null; budgetLabel: string; nearby: { walkableCount: number; avgWalkMin: number } }
): Promise<void> {
  let result: { score: number; grade: string; ratings: Record<string, number> } | null = null;
  try {
    const res = await fetch('/api/hotel-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    result = await res.json();
  } catch {
    return;
  }
  if (step !== 3 || !result || typeof result.score !== 'number') return;

  const numEl = body.querySelector('#sl-eff-num') as HTMLElement;
  if (numEl) numEl.innerHTML = result.score + '<span class="sl-step3-eff-max">/100</span>';
  const gradeEl = body.querySelector('#sl-eff-grade') as HTMLElement;
  if (gradeEl) {
    gradeEl.textContent = result.grade;
    gradeEl.setAttribute('style', gradeBadgeStyle(result.grade));
  }
  const gradeNoteEl = body.querySelector('#sl-eff-grade-note') as HTMLElement;
  if (gradeNoteEl) gradeNoteEl.textContent = GRADE_NOTE[result.grade] ?? '';
  const ratingsEl = body.querySelector('#sl-eff-ratings') as HTMLElement;
  if (ratingsEl) {
    ratingsEl.innerHTML = SCORE_LABELS
      .map((r) => buildEffRatingRow(r.label, result!.ratings[r.key] ?? 3))
      .join('');
  }
}

interface RealTravelResult {
  mode: 'WALKING' | 'DRIVING';
  durationText: string;
  durationMin: number;
}

function formatDurationMin(min: number): string {
  if (min < 60) return min + '분';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? h + '시간' : h + '시간 ' + m + '분';
}

/**
 * 숙소 기준 실제 길찾기 (서버 /api/route-matrix, Google Routes API 기반).
 * 가까운 곳(≤2km)은 도보, 먼 곳은 차량 모드로 배치 조회.
 * 실패해도 화면은 이미 직선거리 추정치로 채워져 있어서 조용히 무시됨.
 *
 * Google Distance Matrix(Legacy)는 지원 종료 예정이자 레거시 API 미활성화 프로젝트에서
 * REQUEST_DENIED를 반환하므로, api/nearby-infra.ts와 동일하게 서버에서 Routes API로 조회한다.
 */
async function loadRealTravelTimes(
  basecamp: Place,
  items: { place: Place; km: number }[]
): Promise<Map<string, RealTravelResult> | null> {
  if (basecamp.lat == null || basecamp.lng == null) return null;

  const results = new Map<string, RealTravelResult>();

  const closeItems = items.filter((i) => i.km <= 2 && i.place.lat != null && i.place.lng != null);
  const farItems = items.filter((i) => i.km > 2 && i.place.lat != null && i.place.lng != null);

  async function runBatch(batchItems: { place: Place; km: number }[], mode: 'WALKING' | 'DRIVING'): Promise<void> {
    if (batchItems.length === 0) return;
    try {
      const resp = await fetch('/api/route-matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: basecamp.lat, lng: basecamp.lng },
          destinations: batchItems.map((i) => ({ id: i.place.id, lat: i.place.lat, lng: i.place.lng })),
          mode: mode === 'WALKING' ? 'WALK' : 'DRIVE',
        }),
      });
      if (!resp.ok) {
        console.error('[Shortlist] Route Matrix 조회 실패(' + mode + '):', resp.status);
        return;
      }
      const data = await resp.json();
      (data?.results ?? []).forEach((r: { id: string; meters: number; seconds: number }) => {
        const durationMin = Math.max(1, Math.round(r.seconds / 60));
        results.set(r.id, { mode, durationText: formatDurationMin(durationMin), durationMin });
      });
    } catch (e) {
      console.error('[Shortlist] Route Matrix 조회 실패(' + mode + '):', e);
    }
  }

  await Promise.all([runBatch(closeItems, 'WALKING'), runBatch(farItems, 'DRIVING')]);
  return results;
}

// "이 숙소를 선택하면" 팔레트 — 계속 다듬을 예정이라 색을 여기 한 군데에 모아둠.
// 다음에 바꿀 땐 이 상수만 건드리면 됨. 하단 설명(desc, 회색 캡션)은 이 실험과 별개로 절대 건드리지 않음.
const STAT_BRAND_COLOR = '#5B9BD5'; // 아이콘 칩 배경 구 버전 — 지금은 6개 타일 전부 지도 마커 색(대중교통 톤)으로 통일해 미사용
const STAT_VALUE_COLOR = '#0D2F6B'; // 값 텍스트 — 직전에 아이콘 배경으로 쓰던 네이비 톤
const STAT_ALERT_COLOR = '#C0524B'; // "나쁨"류를 강조할 때 쓰는 경고색 — 여행 효율 등급 배지(Basic)에 사용 중

/** 여행 효율 등급 배지 색 — api/hotel-score.ts의 gradeFor() 임계값(85/70/55)과 1:1 대응.
 *  전엔 등급과 무관하게 항상 초록 하나였는데(버그), 등급별로 실제 구분되게 함 */
const GRADE_BADGE_COLOR: Record<string, string> = {
  Excellent: '#0F6E56',
  Good: '#0B7CC4',
  Fair: '#B45309',
  Basic: STAT_ALERT_COLOR,
};
function gradeBadgeStyle(grade: string): string {
  const c = GRADE_BADGE_COLOR[grade] ?? STAT_VALUE_COLOR;
  return '--grade-bg:' + mixWithWhite(c, 0.14) + ';--grade-fg:' + c;
}

/** 접근성 등급 4단계 — 인프라 지도 범례(도보 5/10/15분)와 같은 기준을 그대로 씀 */
type AccessTier = 'great' | 'good' | 'ok' | 'bad';
const ACCESS_TIER_LABEL: Record<AccessTier, string> = { great: '아주 좋음', good: '좋음', ok: '보통', bad: '나쁨' };
// 우선은 등급(좋음/나쁨)과 무관하게 값 텍스트를 전부 STAT_VALUE_COLOR로 통일
void STAT_BRAND_COLOR;
const ACCESS_TIER_COLOR: Record<AccessTier, string> = {
  great: STAT_VALUE_COLOR,
  good: STAT_VALUE_COLOR,
  ok: STAT_VALUE_COLOR,
  bad: STAT_VALUE_COLOR,
};

function walkAccessTier(walkMin: number | null): AccessTier {
  if (walkMin == null) return 'bad';
  if (walkMin <= 5) return 'great';
  if (walkMin <= 10) return 'good';
  if (walkMin <= 15) return 'ok';
  return 'bad';
}

/** 관광지 접근성 — 이 트립에 담은 장소까지 평균 "이동시간"(도보/차량 혼합) 기준이라 분 단위를 더 넉넉하게 잡음 */
function visitAccessTier(avgMin: number | null): AccessTier {
  if (avgMin == null) return 'bad';
  if (avgMin <= 10) return 'great';
  if (avgMin <= 20) return 'good';
  if (avgMin <= 30) return 'ok';
  return 'bad';
}

function facilityWalkMin(key: string): number | null {
  const found = step3Facilities.find((f) => f.key === key);
  return found ? found.walkMin : null;
}

/** "편의시설 접근성" = 편의점·카페·마트·약국·ATM 5개 평균 도보 시간(찾은 것만 평균) */
const AMENITY_KEYS = ['convenience', 'cafe', 'supermarket', 'pharmacy', 'atm'];
function amenityAccess(): { avgMin: number | null; foundCount: number } {
  const mins = AMENITY_KEYS.map(facilityWalkMin).filter((m): m is number => m != null);
  if (mins.length === 0) return { avgMin: null, foundCount: 0 };
  return { avgMin: Math.round(mins.reduce((a, b) => a + b, 0) / mins.length), foundCount: mins.length };
}

/**
 * bgColor는 아이콘 칩 배경, valueColor는 등급(있으면)만 값 텍스트 색으로 표시.
 * glyphColor를 넘기면 아이콘 자체 색을 흰색 대신 해당 색으로 표시(파스텔 배경 + 색상 아이콘 조합용).
 */
function buildStatTile(icon: string, bgColor: string, title: string, value: string, desc: string, valueColor?: string, glyphColor?: string): string {
  const iconStyle = '--stat-color:' + bgColor + (glyphColor ? ';color:' + glyphColor : '');
  return [
    '<div class="sl-step3-stat-tile">',
    '  <span class="sl-step3-stat-icon" style="' + iconStyle + '">' + icon + '</span>',
    '  <div class="sl-step3-stat-title">' + title + '</div>',
    '  <div class="sl-step3-stat-value"' + (valueColor ? ' style="color:' + valueColor + '"' : '') + '>' + value + '</div>',
    '  <div class="sl-step3-stat-desc">' + desc + '</div>',
    '</div>',
  ].join('');
}

/** 통계 타일을 confirmedIds/실측 데이터 기준으로 다시 그림 */
function renderStep3Lists(body: HTMLElement, withDistance: Step3Item[]): void {
  if (!selectedZone || !selectedBasecamp) return;

  const statsEl = body.querySelector('#sl-step3-stats') as HTMLElement;
  if (statsEl) {
    const walkable = withDistance.filter((item) => item.km <= 1.5).length;
    const avgMin = withDistance.length
      ? Math.round(withDistance.reduce((sum, item) => sum + item.minutes, 0) / withDistance.length)
      : 0;

    // 아이콘 색은 카테고리별 고정 톤(서로 겹치지 않게), 등급은 값 텍스트 색으로만 표시.
    // /api/nearby-infra가 아직 응답 전이면 등급 대신 "확인 중"으로 표시(잘못된 등급을 잠깐 보여주지 않기 위함)
    const accessValue = (tier: AccessTier): { label: string; valueColor: string } =>
      step3FacilitiesLoaded
        ? { label: ACCESS_TIER_LABEL[tier], valueColor: ACCESS_TIER_COLOR[tier] }
        : { label: '확인 중', valueColor: '#94A3B8' };

    const transitMin = facilityWalkMin('transit');
    const transit = accessValue(walkAccessTier(transitMin));
    const transitDesc = !step3FacilitiesLoaded ? '잠시만요' : transitMin != null ? '도보 ' + transitMin + '분' : '2km 내 없음';

    const convMin = facilityWalkMin('convenience');
    const conv = accessValue(walkAccessTier(convMin));
    const convDesc = !step3FacilitiesLoaded ? '잠시만요' : convMin != null ? '도보 ' + convMin + '분' : '2km 내 없음';

    const amenity = amenityAccess();
    const amenityAcc = accessValue(walkAccessTier(amenity.avgMin));
    const amenityDesc = !step3FacilitiesLoaded
      ? '잠시만요'
      : amenity.avgMin != null
        ? '평균 도보 ' + amenity.avgMin + '분 (' + amenity.foundCount + '/5)'
        : '2km 내 없음';

    // 관광지 접근성 — 이 권역 안 장소가 아니라 "이 여행지에 담은 VISIT(가고싶어) 장소 전체" 대상.
    // 권역별로 나눠서 보면 권역 배정 자체가 거리 기준이라 항상 "가깝다"로 나오는 자기충족 오류가 생겨서,
    // 다른 권역 장소까지 포함한 step3VisitItems(트립 전체 VISIT)로 계산함.
    const visitAvgMin = step3VisitItems.length
      ? Math.round(step3VisitItems.reduce((sum, item) => sum + item.minutes, 0) / step3VisitItems.length)
      : null;
    const visit = accessValue(visitAccessTier(visitAvgMin));
    const visitDesc = visitAvgMin != null ? '담은 관광지 ' + step3VisitItems.length + '곳 평균' : '담은 관광지 없음';

    // 평균 이동시간·도보권 장소·관광지 접근성: 이 트립에 담은 실제 장소까지 거리/이동시간(실측 도착 시 자동 교체).
    // 대중교통·편의시설·편의점 접근성: /api/nearby-infra(Google Places Nearby Search + Routes API 실측 도보시간).
    // 6개 타일 전부 대중교통 접근성 타일과 동일한 톤(지도 마커와 같은 색)으로 통일 — 파스텔 배경 + 해당 색 아이콘.
    const STAT_ICON_BG = mixWithWhite(INFRA_META.transit.color, 0.12);
    const STAT_ICON_GLYPH = INFRA_META.transit.color;
    statsEl.innerHTML = [
      buildStatTile(IC_CLOCK, STAT_ICON_BG, '평균 이동시간', avgMin + '분', '전체 장소 기준', STAT_VALUE_COLOR, STAT_ICON_GLYPH),
      buildStatTile(IC_WALK, STAT_ICON_BG, '도보권 장소', walkable + '곳', '도보 15분 이내', STAT_VALUE_COLOR, STAT_ICON_GLYPH),
      buildStatTile(IC_BUS, STAT_ICON_BG, '대중교통 접근성', transit.label, transitDesc, transit.valueColor, STAT_ICON_GLYPH),
      buildStatTile(IC_HOUSE, STAT_ICON_BG, '편의시설 접근성', amenityAcc.label, amenityDesc, amenityAcc.valueColor, STAT_ICON_GLYPH),
      buildStatTile(IC_BUILDING, STAT_ICON_BG, '관광지 접근성', visit.label, visitDesc, visit.valueColor, STAT_ICON_GLYPH),
      buildStatTile(IC_CART, STAT_ICON_BG, '편의점 접근성', conv.label, convDesc, conv.valueColor, STAT_ICON_GLYPH),
    ].join('');
  }
}

let step3MapInstance: any = null;
let step3InfraLines: any[] = [];
let step3Facilities: InfraFacility[] = []; // 지도 준비/인프라 도착 순서와 무관하게 다시 그리기 위해 보관
/** 리스트 행 클릭 시 확대 이동할 마커 — 카테고리(key)당 마커가 하나뿐이라 key로 바로 찾음 */
let step3InfraMarkersByKey: Map<string, any> = new Map();

/** 지도를 해당 마커 위치로 부드럽게 이동 + 단계적으로 확대(즉시 점프 대신 줌인되는 느낌) */
function zoomToInfraMarker(key: string): void {
  const g = (window as any).google;
  const marker = step3InfraMarkersByKey.get(key);
  if (!g?.maps || !step3MapInstance || !marker) return;
  const position = marker.getPosition();
  if (!position) return;

  step3MapInstance.panTo(position);

  const targetZoom = 17;
  const startZoom = step3MapInstance.getZoom() ?? targetZoom;
  if (startZoom >= targetZoom) return; // 이미 그 이상 확대돼 있으면 팬 이동만으로 충분

  let zoom = startZoom;
  const timer = setInterval(() => {
    zoom += 1;
    step3MapInstance.setZoom(zoom);
    if (zoom >= targetZoom) clearInterval(timer);
  }, 90);
}
/** /api/nearby-infra 응답이 (결과가 비어있더라도) 한 번이라도 도착했는지 — 접근성 타일에서
 *  "아직 확인 중"과 "실제로 시설이 없어서 나쁨"을 구분하기 위해 필요 */
let step3FacilitiesLoaded = false;
/** "관광지 접근성" 계산용 — 활성 여행지 전체(권역 무관)의 VISIT(가고싶어) 장소. 초기엔 직선거리
 *  추정치로 채우고, loadRealTravelTimes 배치 호출 결과가 오면 실측으로 교체됨 */
let step3VisitItems: Step3Item[] = [];

/** hex 색을 흰색과 섞어 파스텔 톤으로 — 우측 시설 리스트의 color-mix(in srgb, color 12%, white)와 동일 공식 */
function mixWithWhite(hex: string, ratio: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number) => Math.round(255 * (1 - ratio) + c * ratio);
  return '#' + [mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/**
 * 편의시설 카테고리 아이콘을 지도 마커로 사용 — 우측 "주변 편의 인프라" 리스트 아이콘과 같은
 * 파스텔 배경(색 12% + 흰색) + 카테고리색 아이콘. 리스트는 둥근 사각형(8px)이지만 지도 위
 * 마커는 원형이 자연스러워 배경만 원형으로 바꿈(롤백 가능성 있어 크기는 상수로 모아둠).
 */
const INFRA_MARKER_SIZE = 26; // 파스텔 원형 배경 지름 — 리스트 아이콘 칩과 같은 크기
const INFRA_ICON_SIZE = 15; // 아이콘 자체 크기 — 리스트 아이콘과 같은 크기
function buildInfraMarkerIcon(g: any, meta: { icon: string; color: string }): any {
  const { attrs, inner } = splitIconSvg(meta.icon.replace(/currentColor/g, meta.color));

  const canvas = INFRA_MARKER_SIZE;
  const bg = mixWithWhite(meta.color, 0.12);
  const scale = INFRA_ICON_SIZE / 24;
  const offset = (canvas - INFRA_ICON_SIZE) / 2;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + canvas + '" height="' + canvas + '" viewBox="0 0 ' + canvas + ' ' + canvas + '">' +
    '<circle cx="' + canvas / 2 + '" cy="' + canvas / 2 + '" r="' + canvas / 2 + '" fill="' + bg + '"/>' +
    '<g ' + attrs + ' transform="translate(' + offset + ',' + offset + ') scale(' + scale + ')">' + inner + '</g>' +
    '</svg>';

  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new g.maps.Size(canvas, canvas),
    anchor: new g.maps.Point(canvas / 2, canvas / 2),
  };
}

/**
 * 편의시설 아이콘 클릭 시 기본정보 + 길찾기 버튼 표시.
 * 추가 API 호출 없음 — nearby-infra 조회 시 이미 캐싱된 데이터만 사용.
 * 길찾기는 Google 지도 딥링크(좌표 기반)라 별도 API 호출이 필요 없음.
 */
function showInfraInfoWindow(
  g: any,
  map: any,
  marker: any,
  meta: { icon: string; color: string; name: string },
  facility: InfraFacility,
  basecamp: Place
): void {
  if (!placeInfoWindow) placeInfoWindow = new g.maps.InfoWindow();

  const km = facility.meters >= 1000 ? (facility.meters / 1000).toFixed(1) + 'km' : facility.meters + 'm';
  const stars = typeof facility.rating === 'number' ? '★ ' + facility.rating.toFixed(1) : '';
  const dirUrl =
    'https://www.google.com/maps/dir/?api=1&origin=' + basecamp.lat + ',' + basecamp.lng +
    '&destination=' + facility.lat + ',' + facility.lng +
    (facility.placeId ? '&destination_place_id=' + encodeURIComponent(facility.placeId) : '') +
    '&travelmode=walking';

  const content = [
    '<div style="font-family:inherit;min-width:180px;max-width:220px;">',
    '<span style="display:inline-block;font-size:10px;font-weight:700;color:' + meta.color + ';background:' + meta.color + '1A;padding:2px 7px;border-radius:999px;margin-bottom:4px;">' + escapeHtml(meta.name) + '</span>',
    '<div style="font-size:13.5px;font-weight:700;color:#0B2A5C;margin:2px 0;">' + escapeHtml(facility.name) + '</div>',
    stars ? '<div style="font-size:11.5px;color:#F5A623;font-weight:700;">' + stars + '</div>' : '',
    facility.address ? '<div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4;">' + escapeHtml(facility.address) + '</div>' : '',
    '<div style="font-size:11.5px;color:#334155;margin-top:6px;">숙소에서 도보 ' + facility.walkMin + '분 · ' + km + '</div>',
    '<a href="' + dirUrl + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:8px;font-size:11.5px;font-weight:700;color:#185FA5;text-decoration:none;">길찾기 (숙소 → 이곳) →</a>',
    '</div>',
  ].join('');

  placeInfoWindow.setContent(content);
  placeInfoWindow.open({ map, anchor: marker });
}

/** 숙소 → 각 편의시설로 컬러 실선 연결 + 카테고리 아이콘 마커 (Nearby Search 실데이터 도착 시 호출) */
function drawInfraLines(basecamp: Place, facilities: InfraFacility[]): void {
  const g = (window as any).google;
  if (!g?.maps || !step3MapInstance || basecamp.lat == null || basecamp.lng == null) return;

  step3InfraLines.forEach((l) => l.setMap(null));
  step3InfraLines = [];
  step3InfraMarkersByKey = new Map();

  facilities.forEach((f) => {
    const meta = INFRA_META[f.key];
    if (!meta) return;
    const line = new g.maps.Polyline({
      path: [
        { lat: basecamp.lat!, lng: basecamp.lng! },
        { lat: f.lat, lng: f.lng },
      ],
      map: step3MapInstance,
      strokeColor: meta.color,
      strokeOpacity: 0.7,
      strokeWeight: 2,
      zIndex: 5,
    });
    step3InfraLines.push(line);

    const marker = new g.maps.Marker({
      position: { lat: f.lat, lng: f.lng },
      map: step3MapInstance,
      title: meta.name + ' · ' + f.name,
      icon: buildInfraMarkerIcon(g, meta),
      zIndex: 6,
    });
    marker.addListener('click', () => {
      showInfraInfoWindow(g, step3MapInstance, marker, meta, f, basecamp);
    });
    step3InfraLines.push(marker);
    step3InfraMarkersByKey.set(f.key, marker);
  });

  // 숙소를 중심으로 가장 먼 시설이 화면 끝에서 약 1cm(38px) 안쪽에 들어오도록 확대
  if (facilities.length > 0) {
    const bounds = new g.maps.LatLngBounds();
    bounds.extend({ lat: basecamp.lat, lng: basecamp.lng });
    facilities.forEach((f) => bounds.extend({ lat: f.lat, lng: f.lng }));
    step3MapInstance.fitBounds(bounds, 38);
  }
}

/** 숙소 + 주변 편의 인프라를 지도에 표시 (브레인스토밍 장소는 이 지도에 넣지 않음 — Step1/Step2 지도에서 이미 확인 가능) */
async function initMapStep3(body: HTMLElement): Promise<void> {
  step3MapInstance = null;
  step3InfraLines = [];
  step3InfraMarkersByKey = new Map();
  step3Facilities = [];
  step3FacilitiesLoaded = false;
  if (!selectedBasecamp) return;

  try {
    await loadGoogleMapsScript();
  } catch (e) {
    return;
  }
  const g = (window as any).google;
  const mapEl = body.querySelector('#sl-map3') as HTMLElement;
  if (!g?.maps || !mapEl || selectedBasecamp.lat == null || selectedBasecamp.lng == null) return;

  const map = new g.maps.Map(mapEl, {
    center: { lat: selectedBasecamp.lat, lng: selectedBasecamp.lng },
    zoom: 14,
    disableDefaultUI: true,
    zoomControl: false,
    fullscreenControl: false,
    mapTypeControl: false,
    streetViewControl: false,
    keyboardShortcuts: false,
    isFractionalZoomEnabled: true,
    gestureHandling: 'greedy',
    styles: MAP_STYLE_STEP2,
  });
  step3MapInstance = map;
  fixMapVisibilityOnResize(g, map, mapEl, { lat: selectedBasecamp.lat, lng: selectedBasecamp.lng });
  addCustomZoomControl(map, mapEl);

  new g.maps.Marker({
    position: { lat: selectedBasecamp.lat, lng: selectedBasecamp.lng },
    map,
    title: selectedBasecamp.name,
    icon: buildCategoryIcon(g, '숙소', selectedBasecamp.category, selectedBasecamp.name),
    zIndex: 30,
  });

  // 이 권역뿐 아니라 다른 권역 브레인스토밍 장소도 작고 옅게 표시 — 줌아웃하면 트립 전체 그림이
  // 한눈에 보여서 "이 숙소가 실제 관광지들과 얼마나 떨어져 있는지" 감이 오도록 함
  allPlaces.forEach((p) => {
    if (p.id === selectedBasecamp!.id || p.lat == null || p.lng == null) return;
    const marker = new g.maps.Marker({
      position: { lat: p.lat, lng: p.lng },
      map,
      title: p.name,
      icon: buildCategoryIcon(g, p.mood, p.category, p.name),
      opacity: 0.55,
      zIndex: 1,
    });
    marker.addListener('click', () => showPlaceInfoWindow(g, map, marker, p));
  });

  // 인프라 데이터가 지도보다 먼저 도착했으면 이제 그림
  if (step3Facilities.length && selectedBasecamp) drawInfraLines(selectedBasecamp, step3Facilities);
}
