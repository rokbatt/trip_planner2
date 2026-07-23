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
  updateSegmentDates,
} from '../trips/destinations';
import { loadGoogleMapsScript, getCategoryLabel } from '../utils/googleMaps';
import type { Database, TripDestination, StaySegment } from '../types/database';
import './shortlist.css';

type Place = Database['public']['Tables']['places']['Row'];
type Trip = Database['public']['Tables']['trips']['Row'];

/* ── 아이콘 ── */
const IC_BED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 18v2M21 18v2M3 12V8a2 2 0 0 1 2-2h4v6"/></svg>';
const IC_WALK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="M11 8l-3 3 2 7M11 8l3 2 3-1M8 11l-3 2v6M13 10l2 4-2 6"/></svg>';
const IC_TRAIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="14" rx="2"/><path d="M4 11h16M8 21l2-4h4l2 4M8 7h.01M16 7h.01"/></svg>';
const IC_TAXI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M5 17l1.5-5h11L19 17M8 12V8h8v4"/></svg>';
const IC_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const IC_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const IC_SPARK = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.6L19.4 9.4 13.8 11.2 12 17l-1.8-5.8L4.6 9.4l5.6-1.8L12 2z"/></svg>';
const IC_PLANE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 19.5l19-7.5-19-7.5 4 7.5-4 7.5z"/></svg>';
const IC_SEARCH2 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
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
let step: 1 | 2 | 3 = 1;
let selectedZone: Zone | null = null;
let zoneDataSource = 'curated';
let selectedBasecamp: Place | null = null;
let pendingHotelId: string | null = null;
let step2SortMode: 'rating' | 'distance' = 'rating';
let step2FilterText = '';
let confirmedIds = new Set<string>();
let mapInstance: any = null;
let mapMarkers: any[] = [];

export function teardownShortlist(): void {
  if (shellResizeHandler) {
    window.removeEventListener('resize', shellResizeHandler);
    shellResizeHandler = null;
  }
  if (placeInfoWindow) {
    placeInfoWindow.close();
    placeInfoWindow = null;
  }
  closeSegPopover();
  closeShortlistDestSwitcher();
  allPlaces = [];
  zones = [];
  slDestinations = [];
  slActiveDest = null;
  slSegments = [];
  slActiveSegment = null;
  step = 1;
  selectedZone = null;
  zoneDataSource = 'curated';
  selectedBasecamp = null;
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

/** 직선거리 기준 예상 이동수단/시간 (실제 Routes API 호출 없음 — 대략치) */
function estimateTravel(km: number): { mode: string; icon: string; label: string } {
  if (km <= 1.2) {
    const min = Math.max(2, Math.round(km * 12));
    return { mode: 'walk', icon: IC_WALK, label: '도보 ' + min + '분' };
  }
  if (km <= 4) {
    return { mode: 'transit', icon: IC_TRAIN, label: '대중교통 이용 (약 ' + km.toFixed(1) + 'km)' };
  }
  const min = Math.max(5, Math.round(km * 2.4));
  return { mode: 'taxi', icon: IC_TAXI, label: '택시 약 ' + min + '분' };
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

/**
 * 미리 받아온 "유명 지역" 목록에 브레인스토밍 장소들을 배정해서 Zone[]으로 만듦.
 * 각 장소는 가장 가까운 지역 중심점에 배정됨 (클라이언트에서 거리 계산만, API 호출 없음).
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
  };
  // 활성 여행지의 숙소 구간에 저장 (합성 여행지면 내부적으로 기존 trips.shortlist_* 컬럼으로 폴백).
  // insert된 실제 행의 id를 이어받아 다음 저장이 update가 되도록 slActiveSegment 갱신.
  const saved = await saveStaySegment(currentTrip, slActiveDest, slActiveSegment, state);
  // 구간 목록도 동기화 (합성 구간이 insert되며 id가 바뀌는 경우 포함)
  slSegments = slSegments.map((s) => (s.id === prevId ? saved : s));
  slActiveSegment = saved;
}

/* ── 메인 렌더 ── */
export async function renderShortlistContent(container: HTMLElement, tripId: string): Promise<void> {
  teardownShortlist();
  currentTripId = tripId;
  slContainer = container;

  container.innerHTML = '<div class="sl-loading">Shortlist 준비 중...</div>';

  const [trip, places] = await Promise.all([loadTrip(tripId), loadPlaces(tripId)]);
  currentTrip = trip;

  // 여행지 결정 + 활성 여행지의 장소만 사용
  slDestinations = trip ? await loadDestinations(trip) : [];
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

  // 활성 여행지의 숙소 구간들을 로드하고, 활성 구간의 저장 상태를 복원
  if (trip && slActiveDest) {
    slSegments = sortSegmentsByDate(await loadStaySegments(trip, slActiveDest));
    slActiveSegment = resolveActiveSegment(slActiveDest.id, slSegments);
    restoreStateFromSegment(slActiveSegment);
  }

  await renderStep(container);
}

function getTripDestination(): string {
  // 활성 여행지가 있으면 그 도시명(지역 데이터·AI 채점·숙소 검색 등 모두 여기에 맞춤)
  return slActiveDest?.name || syntheticDestinationName(currentTrip);
}

let shellResizeHandler: (() => void) | null = null;
let step2MapResizeHandler: (() => void) | null = null;

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

/** 저장된 구간 상태(zone→hotel→confirm)를 모듈 상태로 복원. 없으면 Step1부터. */
function restoreStateFromSegment(seg: StaySegment | null): void {
  step = 1;
  selectedZone = null;
  selectedBasecamp = null;
  confirmedIds = new Set();
  if (seg?.zone_name && seg.zone_place_ids) {
    const zpids = seg.zone_place_ids;
    const restoredZone = zones.find((z) => z.places.some((p) => zpids.includes(p.id)));
    if (restoredZone) {
      selectedZone = restoredZone;
      step = 2;
      if (seg.basecamp_place_id) {
        const bc = restoredZone.places.find((p) => p.id === seg.basecamp_place_id);
        if (bc) {
          selectedBasecamp = bc;
          step = 3;
          confirmedIds = new Set(seg.confirmed_place_ids ?? []);
        }
      }
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

/**
 * 새로 나눌 구간의 날짜([newStart,newEnd])를 품고 있던 기존 구간을 찾아 자동으로 정리한다.
 *  - 기존 구간의 한쪽 끝에 맞닿아 있으면 → 기존 구간은 남는 쪽만 남기고 축소(구간 1개 그대로 update)
 *  - 기존 구간 중간을 잘라내면 → 기존 구간은 앞쪽만 남기고, 뒤쪽 남는 기간은 기존 구간과
 *    동일한 지역/숙소 선택 상태를 그대로 이어받은 새 구간으로 하나 더 만듦
 * → 사용자가 남는 기간을 또 손으로 지정할 필요 없이 항상 날짜가 이가 맞게 자동 세팅됨.
 */
async function splitCoveringSegment(newStart: string, newEnd: string): Promise<void> {
  if (!currentTrip || !slActiveDest) return;
  const covering = slSegments.find((s) => {
    if (!s.start_date || !s.end_date) return false;
    if (s.start_date === newStart && s.end_date === newEnd) return false;
    return s.start_date <= newStart && s.end_date >= newEnd;
  });
  if (!covering) return;

  const covStart = covering.start_date!;
  const covEnd = covering.end_date!;
  const touchesStart = covStart === newStart;
  const touchesEnd = covEnd === newEnd;

  if (touchesStart && !touchesEnd) {
    // 앞쪽을 잘라냄 → 기존 구간은 뒤쪽 남는 기간만 유지
    const updated = await updateSegmentDates(currentTrip, slActiveDest, covering, newEnd, covEnd);
    slSegments = slSegments.map((s) => (s.id === covering.id ? updated : s));
  } else if (touchesEnd && !touchesStart) {
    // 뒤쪽을 잘라냄 → 기존 구간은 앞쪽 남는 기간만 유지
    const updated = await updateSegmentDates(currentTrip, slActiveDest, covering, covStart, newStart);
    slSegments = slSegments.map((s) => (s.id === covering.id ? updated : s));
  } else if (!touchesStart && !touchesEnd) {
    // 중간을 잘라냄 → 기존 구간은 앞쪽만 남기고, 뒤쪽 남는 기간은 같은 숙소 상태로 구간 하나 더 생성
    const updatedFront = await updateSegmentDates(currentTrip, slActiveDest, covering, covStart, newStart);
    slSegments = slSegments.map((s) => (s.id === covering.id ? updatedFront : s));
    const back = await createStaySegment(currentTrip, slActiveDest, {
      startDate: newEnd,
      endDate: covEnd,
      sortOrder: slSegments.length,
      zoneName: covering.zone_name,
      zonePlaceIds: covering.zone_place_ids,
      basecampPlaceId: covering.basecamp_place_id,
      confirmedPlaceIds: covering.confirmed_place_ids,
    });
    if (back) slSegments = [...slSegments, back];
  }
}

/** "숙소 나누기" — 새 빈 구간을 만들고 그 구간으로 전환 (선택한 기간과 함께). 겹치는 기존 구간은 자동으로 정리. */
async function addSegment(startDate: string | null, endDate: string | null): Promise<void> {
  if (!currentTrip || !slActiveDest || !slContainer) return;
  if (startDate && endDate) {
    await splitCoveringSegment(startDate, endDate);
  }
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
  restoreStateFromSegment(created); // 새 구간은 빈 상태 → Step1부터
  renderStep(slContainer);
}

async function removeSegment(segId: string): Promise<void> {
  if (!slActiveDest || !slContainer || slSegments.length <= 1) return;
  if (!isSyntheticSegment(segId)) await deleteStaySegment(segId);
  slSegments = slSegments.filter((s) => s.id !== segId);
  if (slActiveSegment?.id === segId) {
    slActiveSegment = slSegments[0] ?? null;
    if (slActiveSegment) setActiveSegmentId(slActiveDest.id, slActiveSegment.id);
    restoreStateFromSegment(slActiveSegment);
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
      if ((e.target as HTMLElement).closest('[data-del-seg]')) return;
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
}

/**
 * 헤더 바로 아래 줄에 최대한 압축된 구간 pill만 보여줌(라벨·숙소 나누기 버튼 없음,
 * N박 표기 없이 기간만) — 1·2·3단계 공통. "숙소 나누기"는 확정(3단계) 본문의
 * 전용 카드(이 여행지에서 숙소를 나눠 묵나요?)에서만 시작하도록 상단에서는 제거.
 */
function renderSegmentBar(container: HTMLElement): void {
  const wrap = container.querySelector('#sl-dest-bar-wrap') as HTMLElement | null;
  if (!wrap) return;
  if (!slActiveDest || isSyntheticDestination(slActiveDest.id) || slSegments.length < 2) {
    wrap.innerHTML = '';
    return;
  }

  const pills = slSegments
    .map((seg, i) => {
      const active = seg.id === slActiveSegment?.id;
      const meta = dateRangeOnly(seg.start_date, seg.end_date);
      return [
        '<button type="button" class="sl-seg-pill sl-seg-pill-compact' + (active ? ' active' : '') + '" data-seg-id="' + seg.id + '">',
        '  <span class="sl-seg-pill-idx">' + (i + 1) + '</span>',
        '  <span class="sl-seg-pill-text">',
        '    <span class="sl-seg-pill-name">' + escapeHtml(segmentLabel(seg, i)) + '</span>',
        meta ? '    <span class="sl-seg-pill-meta">' + escapeHtml(meta) + '</span>' : '',
        '  </span>',
        slSegments.length > 1 ? '  <span class="sl-seg-pill-del" data-del-seg="' + seg.id + '" title="이 숙소 구간 삭제">' + IC_XCLOSE + '</span>' : '',
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
  onSave: (start: string | null, end: string | null) => void | Promise<void>;
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
    (overlay.querySelector('#sp-save') as HTMLButtonElement).disabled = true;
    closeSegPopover();
    await opts.onSave(start, end);
  });

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeSegPopover();
  });
}

/** "숙소 나누기" — 새 숙소 구간의 기간을 고르는 모달 (선택) */
function openSegmentDatePopover(_anchor: HTMLElement): void {
  const rangeStart = slActiveDest?.start_date || currentTrip?.start_date || null;
  const rangeEnd = slActiveDest?.end_date || currentTrip?.end_date || null;
  openDateRangeModal({
    title: '새 숙소 구간',
    desc: '이 숙소에 묵는 기간을 정해요 <span class="sl-seg-pop-opt">(선택, 시작일→종료일 순으로 클릭)</span>',
    rangeStart,
    rangeEnd,
    saveLabel: '추가',
    onSave: async (start, end) => {
      await addSegment(start, end);
    },
  });
}

/** "수정" — 현재 활성 숙소 구간의 숙박 기간을 다시 고르는 모달 */
function openStayDateEditor(): void {
  if (!currentTrip || !slActiveDest || !slActiveSegment || !slContainer) return;
  const rangeStart = slActiveDest.start_date || currentTrip.start_date || null;
  const rangeEnd = slActiveDest.end_date || currentTrip.end_date || null;
  openDateRangeModal({
    title: '숙박 기간 수정',
    desc: '이 숙소에 묵는 기간을 다시 정해요 <span class="sl-seg-pop-opt">(시작일→종료일 순으로 클릭)</span>',
    rangeStart,
    rangeEnd,
    initialStart: slActiveSegment.start_date,
    initialEnd: slActiveSegment.end_date,
    saveLabel: '저장',
    onSave: async (start, end) => {
      const trip = currentTrip!;
      const dest = slActiveDest!;
      const seg = slActiveSegment!;
      const updated = await updateSegmentDates(trip, dest, seg, start, end);
      slSegments = slSegments.map((s) => (s.id === seg.id ? updated : s));
      slActiveSegment = updated;
      if (isSyntheticDestination(dest.id)) {
        currentTrip = { ...trip, start_date: start, end_date: end };
      } else if (isSyntheticSegment(updated.id)) {
        slActiveDest = { ...dest, start_date: start, end_date: end };
      }
      await resortSegments();
      renderStep(slContainer!);
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
    '      <div class="sl-zone-panel-head"><span>AI 추천 지역</span><span class="sl-zone-panel-sort">추천 순</span></div>',
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
  await initMap(body);
}

function renderZoneCards(body: HTMLElement): void {
  const listEl = body.querySelector('#sl-zone-list') as HTMLElement;
  const sorted = [...zones].sort((a, b) => a.rank - b.rank);

  listEl.innerHTML = sorted
    .map((zone) => {
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

  listEl.querySelectorAll('.sl-zone-card').forEach((card) => {
    const zoneId = (card as HTMLElement).dataset.zoneId!;
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('sl-zone-thumb-more')) return;
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

  barEl.classList.add('visible');
  barEl.innerHTML = [
    '<button type="button" class="sl-zone-cta-btn" id="sl-confirm-zone">',
    '  <span>' + IC_PLANE + escapeHtml(zone.name) + ' 지역을 중심으로 숙소를 선택할게요</span>',
    '  ' + IC_ARROW,
    '</button>',
  ].join('\n');

  barEl.querySelector('#sl-confirm-zone')?.addEventListener('click', () => {
    selectedZone = zone;
    selectedBasecamp = null;
    confirmedIds = new Set();
    step = 2;
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

/** 장소들의 좌표로 볼록 껍질(convex hull)을 계산 — 지역을 자연스러운 영역 형태로 표시하기 위함 */
/** 문자열 시드로부터 안정적인(매번 같은) 난수를 만드는 간단한 PRNG */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/**
 * 실제 저장된 장소 개수와 무관하게, 그 동네다운 자연스러운 크기의 얼룩(blob) 모양 영역을 만듦.
 * 장소가 1~2개뿐이어도 좁은 사각형이 되지 않도록, 중심점 기준으로 일정 범위를 두르는 방식.
 * (정밀한 행정구역 경계 데이터가 없어서 완전히 정확한 경계는 아니고, 시각적으로 "이 동네 근처"를 보여주는 근사치)
 */
function generateZoneBlob(zone: Zone): { lat: number; lng: number }[] {
  const rand = seededRandom(zone.id + zone.name);
  const baseRadiusKm = Math.min(2.4, Math.max(1.1, 0.95 + Math.sqrt(zone.places.length) * 0.22));
  const numPoints = 28;

  // 저주파 사인파 여러 개를 합성해서 각지지 않고 부드럽게 굴곡진 얼룩 모양을 만듦
  // (점마다 독립적인 난수를 쓰면 뾰족뾰족한 별 모양이 되기 쉬움)
  const harmonics = [
    { freq: 2, amp: 0.10 + rand() * 0.07, phase: rand() * Math.PI * 2 },
    { freq: 3, amp: 0.07 + rand() * 0.05, phase: rand() * Math.PI * 2 },
    { freq: 5, amp: 0.04 + rand() * 0.03, phase: rand() * Math.PI * 2 },
  ];

  const points: { lat: number; lng: number }[] = [];
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    let variance = 1;
    harmonics.forEach((h) => {
      variance += h.amp * Math.sin(h.freq * angle + h.phase);
    });
    const r = baseRadiusKm * variance;
    const dLat = (r / 111) * Math.cos(angle);
    const dLng = (r / (111 * Math.cos((zone.centerLat * Math.PI) / 180))) * Math.sin(angle);
    points.push({ lat: zone.centerLat + dLat, lng: zone.centerLng + dLng });
  }
  return points;
}

const MOOD_ICON_SYMBOL: Record<string, string> = {
  '가고싶어': '📷',
  '먹고싶어': '🍴',
  '하고싶어': '🎟',
  '숙소': '🛏',
};

/** 카테고리별 색상이 채워진 원형 마커 아이콘 (data URI, 추가 요청 없음) */
let placeInfoWindow: any = null;

/**
 * 마커 클릭 시 이미 우리 DB에 저장돼 있는 장소 정보(이름/카테고리/평점/주소/사진)를 보여줌.
 * Google Place Details를 다시 호출하지 않음 — 추가 API 비용 0원.
 * "Google Maps에서 보기" 링크도 google_place_id 기반 딥링크라 API 호출이 필요 없음.
 */
function showPlaceInfoWindow(g: any, map: any, marker: any, place: Place): void {
  if (!placeInfoWindow) {
    placeInfoWindow = new g.maps.InfoWindow();
  }

  const color = MOOD_COLOR[place.mood ?? ''] || '#94A3B8';
  const moodLabel = MOOD_LABEL[place.mood ?? ''] || '';
  const stars = typeof place.google_rating === 'number' ? '★ ' + place.google_rating.toFixed(1) : '';

  const mapsUrl = place.google_place_id
    ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place.name) + '&query_place_id=' + place.google_place_id
    : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place.name);

  const content = [
    '<div style="font-family:inherit;min-width:180px;max-width:220px;">',
    place.photo_url
      ? '<div style="width:100%;height:90px;border-radius:8px;background-size:cover;background-position:center;background-image:url(\'' + place.photo_url + '\');margin-bottom:8px;"></div>'
      : '',
    '<div style="font-size:13.5px;font-weight:700;color:#0B2A5C;margin-bottom:2px;">' + escapeHtml(place.name) + '</div>',
    moodLabel
      ? '<span style="display:inline-block;font-size:10px;font-weight:700;color:' + color + ';background:' + color + '1A;padding:2px 7px;border-radius:999px;margin-bottom:4px;">' + moodLabel + '</span>'
      : '',
    stars ? '<div style="font-size:11.5px;color:#F5A623;font-weight:700;margin-top:4px;">' + stars + '</div>' : '',
    place.address ? '<div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4;">' + escapeHtml(place.address) + '</div>' : '',
    '<a href="' + mapsUrl + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:8px;font-size:11.5px;font-weight:700;color:#185FA5;text-decoration:none;">Google Maps에서 보기 →</a>',
    '</div>',
  ].join('');

  placeInfoWindow.setContent(content);
  placeInfoWindow.open({ map, anchor: marker });
}

function buildCategoryIcon(g: any, mood: string | null, variant: 'compact' | 'detailed' | 'detailed-lg' = 'compact'): any {
  const color = MOOD_COLOR[mood ?? ''] || '#94A3B8';

  if (variant === 'compact') {
    // Step1의 추상화된 지도 위에서는 작고 얇은 핀이 오히려 자연스러움
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="22" viewBox="0 0 16 22">',
      '<path d="M8 0C3.6 0 0 3.6 0 8c0 6 8 14 8 14s8-8 8-14c0-4.4-3.6-8-8-8z" fill="' + color + '"/>',
      '<circle cx="8" cy="7.7" r="2.7" fill="white"/>',
      '</svg>',
    ].join('');
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new g.maps.Size(16, 22),
      anchor: new g.maps.Point(8, 22),
    };
  }

  // Step2처럼 정보가 많은 실제 구글맵 위에서는 두꺼운 흰 테두리 + 그림자로 대비를 크게 줘야 눈에 띔
  const big = variant === 'detailed-lg';
  const w = big ? 30 : 22;
  const h = big ? 41 : 30;
  const cx = w / 2;
  const holeR = big ? 5.1 : 3.7;
  const holeCy = big ? 14.4 : 10.6;
  const pinPath = big
    ? 'M15 0C6.75 0 0 6.75 0 15c0 15.75 15 26.25 15 26.25s15-10.5 15-26.25C30 6.75 23.25 0 15 0z'
    : 'M11 0C4.95 0 0 4.95 0 11c0 8.25 11 19.25 11 19.25s11-11 11-19.25C22 4.95 17.05 0 11 0z';

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">',
    '<defs><filter id="ds" x="-50%" y="-30%" width="200%" height="160%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.3" flood-color="#0B2A5C" flood-opacity="0.5"/></filter></defs>',
    '<path filter="url(#ds)" d="' + pinPath + '" fill="' + color + '" stroke="white" stroke-width="' + (big ? 3 : 2.4) + '" paint-order="stroke fill"/>',
    '<circle cx="' + cx + '" cy="' + holeCy + '" r="' + holeR + '" fill="white"/>',
    '</svg>',
  ].join('');

  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new g.maps.Size(w, h),
    anchor: new g.maps.Point(cx, h),
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

  // 폴리곤/마커/라벨이 아닌 지도 빈 공간을 클릭하면 강조 해제
  mapInstance.addListener('click', () => {
    pendingSelectedZoneId = null;
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
  zoneBlobPoints = new Map();

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
        icon: buildCategoryIcon(g, p.mood),
      });
      marker.addListener('click', () => {
        showPlaceInfoWindow(g, mapInstance, marker, p);
      });
      zoneMarkers.push(marker);
      mapMarkers.push(marker);
    });

    zone.places.forEach((p) => {
      if (p.lat != null && p.lng != null) bounds.extend({ lat: p.lat, lng: p.lng });
    });

    markersByZone.set(zone.id, zoneMarkers);

    // 좌표가 유효하지 않으면(예전 캐시 데이터 등) 폴리곤을 그리지 않고 건너뜀 — 지도 전체를 뒤덮는 렌더링 오류 방지
    if (!Number.isFinite(zone.centerLat) || !Number.isFinite(zone.centerLng)) {
      return;
    }

    // 권역 영역 — 저장된 장소 개수와 무관하게 그 동네다운 자연스러운 크기의 얼룩 모양으로
    const hullPoints = generateZoneBlob(zone);
    zoneBlobPoints.set(zone.id, hullPoints);

    const polygon = new g.maps.Polygon({
      map: mapInstance,
      paths: hullPoints,
      fillColor: color,
      fillOpacity: 0.05,
      strokeColor: color,
      strokeOpacity: 0.4,
      strokeWeight: 1,
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

    // 지역 정보 라벨 (아이콘 + 이름 + 대표 특징 + 장소 수 + 평점) — 지도 위에서 바로 비교 가능하도록
    const overlay = createZoneLabelOverlay(g, zone, color);
    overlay.setMap(mapInstance);
    zoneLabelOverlays.push(overlay);
  });

  if (!bounds.isEmpty()) mapInstance.fitBounds(bounds, 40);
}

const ZONE_ICON: Record<string, string> = {
  '가고싶어': '📷',
  '먹고싶어': '🍴',
  '하고싶어': '🎟',
  '숙소': '🛏',
};

/** 지도 위에 뜨는 지역 정보 카드 (Google Maps 커스텀 OverlayView, 실제 DOM 엘리먼트) */
function createZoneLabelOverlay(g: any, zone: Zone, color: string): any {
  class ZoneLabelOverlay extends g.maps.OverlayView {
    div: HTMLDivElement | null = null;

    onAdd() {
      const div = document.createElement('div');
      div.className = 'sl-map-zone-label';
      div.dataset.zoneId = zone.id;
      div.style.setProperty('--zone-color', color);
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
      const pos = projection.fromLatLngToDivPixel(new g.maps.LatLng(zone.centerLat, zone.centerLng));
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

  const candidates = selectedZone.places.filter((p) => p.mood === '숙소');
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

/** 트립의 실제 여행 날짜를 YYYY-MM-DD로 반환 (사이트 검색 URL의 checkin/checkout에 사용) */
function getTripDatesISO(): { checkin: string; checkout: string } | null {
  const trip = currentTrip;
  if (!trip?.start_date || !trip?.end_date) return null;
  return { checkin: trip.start_date.slice(0, 10), checkout: trip.end_date.slice(0, 10) };
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
    icon: buildCategoryIcon(g, place.mood, 'detailed'),
    zIndex: 20,
  });
  step2Markers.set(place.id, marker);
  marker.addListener('click', () => {
    pendingHotelId = place.id;
    highlightBasecampMarker(place.id);
  });
  step2MapInstance.panTo({ lat: place.lat, lng: place.lng });
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

  const inZoneIds = new Set(selectedZone.places.map((p) => p.id));

  // 선택한 지역 밖 장소도 함께 찍어서, 사용자가 축소했을 때 트립 전체 장소를 파악할 수 있게 함
  allPlaces.forEach((p) => {
    if (p.lat == null || p.lng == null) return;
    if (inZoneIds.has(p.id)) return; // 지역 안 장소는 아래에서 강조된 스타일로 별도 처리

    const marker = new g.maps.Marker({
      position: { lat: p.lat, lng: p.lng },
      map,
      title: p.name,
      icon: buildCategoryIcon(g, p.mood, 'compact'),
      zIndex: 0,
    });
    marker.addListener('click', () => {
      showPlaceInfoWindow(g, map, marker, p);
    });
  });

  selectedZone.places.forEach((p) => {
    if (p.lat == null || p.lng == null) return;
    const isCandidate = p.mood === '숙소';
    const marker = new g.maps.Marker({
      position: { lat: p.lat, lng: p.lng },
      map,
      title: p.name,
      icon: buildCategoryIcon(g, p.mood, 'detailed'),
      zIndex: isCandidate ? 20 : 1,
    });

    if (isCandidate) {
      step2Markers.set(p.id, marker);
      marker.addListener('click', () => {
        pendingHotelId = p.id;
        renderBasecampList(body, candidates);
        renderSelectedHotelPreview(body, candidates);
        highlightBasecampMarker(p.id);
        showPlaceInfoWindow(g, map, marker, p);
      });
    } else {
      // 숙소 후보가 아닌 장소는 선택 동작 없이 정보만 표시 (이미 저장된 데이터, 추가 API 호출 없음)
      marker.addListener('click', () => {
        showPlaceInfoWindow(g, map, marker, p);
      });
    }
  });
}

/** 숙소 후보 리스트에서 클릭한 항목을 지도 마커에서도 확대·강조 */
function highlightBasecampMarker(placeId: string | null): void {
  const g = (window as any).google;
  if (!g?.maps) return;
  step2Markers.forEach((marker, id) => {
    const isSelected = id === placeId;
    marker.setZIndex(isSelected ? 50 : 20);
    marker.setAnimation(isSelected ? g.maps.Animation.BOUNCE : null);
    if (isSelected) {
      setTimeout(() => marker.setAnimation(null), 700);
    }
  });
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

/** 평균 이동시간 등 집계용 분 단위 환산 — estimateTravel과 동일한 속도 가정(도보/대중교통/차량)을 모든 구간에 적용 */
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

  const closeCount = withDistance.filter((item) => item.km <= 1.5).length;
  const budgetLabel = stayFilters.budget ? (BUDGET_PRESETS[stayFilters.budget]?.label ?? '직접설정') : '전체';

  void closeCount;
  // 스테퍼 줄 우측(#sl-stepper-extra)은 이제 renderShortlistDestBar가 "여행지 변경"을
  // 대신 채우므로(상단 정보 압축), Step3 전용 요약 박스는 더 이상 그리지 않음 —
  // 같은 정보(선택 지역/숙박 기간/예산)는 아래 "여행 중심 요약" 카드에 이미 있고,
  // 그 카드의 "수정" 버튼이 openStayDateEditor로 계속 연결돼 있어 기능은 그대로 유지됨.

  const stars = typeof basecamp.google_rating === 'number' ? buildStars(basecamp.google_rating) : '';
  const categoryLabel = basecamp.category || (basecamp.mood ? MOOD_LABEL[basecamp.mood] : '') || '숙소';

  const eff = EFFICIENCY_SAMPLE;
  const effRatings = eff.items.map((it) => buildEffRatingRow(it.label, it.stars)).join('');

  const infraRows = INFRA_SAMPLE
    .map((f) => {
      const meta = INFRA_META[f.key];
      return buildInfraRow(meta, f.min + ' · ' + f.dist);
    })
    .join('');

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
    '              <div class="sl-step3-summary-name">' + escapeHtml(basecamp.name) + '</div>',
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
    '        <div class="sl-step3-card-desc">숙소를 기준으로 주요 편의시설까지의 거리입니다.</div>',
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
    '        <div class="sl-step3-sample-note" id="sl-infra-note">* 시설별 거리는 레이아웃 예시예요. 실제 데이터는 곧 연동됩니다.</div>',
    '      </div>',

    // ③ 여행 효율 점수 (Gemini 정형 채점 — 도착 전엔 예시)
    '      <div class="sl-step3-card sl-step3-eff-card">',
    '        <div class="sl-step3-eff-score">',
    '          <div class="sl-step3-eff-num" id="sl-eff-num">' + eff.score + '<span class="sl-step3-eff-max">/100</span></div>',
    '          <div class="sl-step3-eff-grade" id="sl-eff-grade">' + escapeHtml(eff.grade) + '</div>',
    '          <div class="sl-step3-eff-note">' + escapeHtml(eff.note) + '</div>',
    '        </div>',
    '        <div class="sl-step3-eff-ratings" id="sl-eff-ratings">' + effRatings + '</div>',
    '      </div>',
    '      <div class="sl-step3-sample-note sl-step3-eff-samplenote" id="sl-eff-note">* AI가 분석할 예정이에요 (현재 예시 점수)</div>',

    '    </div>',

    /* ── 우측 사이드 (35%) ── */
    '    <div class="sl-step3-right">',

    // ① 이 숙소를 선택하면 (2x3 컬러 타일)
    '      <div class="sl-step3-card">',
    '        <div class="sl-step3-card-title">이 숙소를 선택하면</div>',
    '        <div class="sl-step3-stat-grid" id="sl-step3-stats"></div>',
    '        <div class="sl-step3-sample-note">* 접근성 지표는 곧 실제 데이터로 연동돼요 (현재 예시)</div>',
    '      </div>',

    // ② 놓친 장소 체크
    '      <div class="sl-step3-card">',
    '        <div class="sl-step3-card-title">놓친 장소 체크</div>',
    '        <div class="sl-step3-card-desc">선택하지 않은 주변 장소예요. 추가하면 여행이 더 풍성해져요.</div>',
    '        <div class="sl-step3-missed-list" id="sl-missed-list"></div>',
    '      </div>',

    // ③ 예상 교통비
    '      <div class="sl-step3-card">',
    '        <div class="sl-step3-card-title">예상 교통비 (1인 기준)</div>',
    '        <div class="sl-step3-card-desc">입력한 예산은 Expense 탭에 연동돼요.</div>',
    '        <div class="sl-step3-transport-row">',
    '          <input type="number" class="sl-budget-custom-input sl-step3-transport-input" id="sl-transport-cost" placeholder="교통비 예산 입력 (예: 100000)" />',
    '          <span class="sl-budget-custom-unit">원</span>',
    '        </div>',
    '        <button class="sl-step3-expense-btn" id="sl-expense-link">Expense 탭에서 관리하기 ' + IC_EXTLINK + '</button>',
    '      </div>',

    // ④ 숙소 나누기 진입 (실제 여행지 + 아직 단일 구간일 때만 — 구간이 2개 이상이면 상단 바로 대체됨)
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

    // ⑤ 하단 CTA (우측 컬럼 맨 아래 — 레퍼런스와 동일)
    '      <div class="sl-step3-cta-wrap">',
    '        <button class="sl-step2-cta sl-step3-cta" id="sl-proceed"><span class="sl-step3-cta-main">' + IC_CHECK + ' 이 숙소를 여행 중심으로 확정하기</span></button>',
    '      </div>',

    '    </div>',
    '  </div>',

    '</div>',
  ].join('\n');

  body.querySelector('#sl-back-2c')?.addEventListener('click', openStayDateEditor);
  body.querySelector('#sl-expense-link')?.addEventListener('click', () => {
    window.dispatchEvent(
      new CustomEvent('mongsil:navigateGate', { detail: { tripId: currentTripId, gate: 'expense' } })
    );
  });

  body.querySelector('#sl-proceed')?.addEventListener('click', async () => {
    const btn = body.querySelector('#sl-proceed') as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = '저장 중...';
    await saveShortlistState();
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

  // Phase 2 실데이터 — 도착하면 예시를 실데이터로 교체, 실패하면 예시+안내를 그대로 유지
  const walkable = withDistance.filter((item) => item.km <= 1.5).length;
  const avgMin = withDistance.length
    ? Math.round(withDistance.reduce((s, item) => s + item.minutes, 0) / withDistance.length)
    : 0;
  loadNearbyInfra(body, basecamp);
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

function buildInfraRow(meta: { icon: string; color: string; name: string } | undefined, distText: string): string {
  if (!meta) return '';
  return [
    '<div class="sl-infra-row">',
    '  <span class="sl-infra-icon" style="--infra-color:' + meta.color + '">' + meta.icon + '</span>',
    '  <span class="sl-infra-name">' + escapeHtml(meta.name) + '</span>',
    '  <span class="sl-infra-dist">' + escapeHtml(distText) + '</span>',
    '</div>',
  ].join('');
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

/** 주변 편의 인프라 실데이터 (/api/nearby-infra) — 성공 시 리스트+지도 점선 교체 */
async function loadNearbyInfra(body: HTMLElement, basecamp: Place): Promise<void> {
  if (basecamp.lat == null || basecamp.lng == null) return;
  let facilities: InfraFacility[] = [];
  try {
    const res = await fetch('/api/nearby-infra', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId: basecamp.google_place_id ?? undefined, lat: basecamp.lat, lng: basecamp.lng }),
    });
    if (!res.ok) return;
    const data = await res.json();
    facilities = Array.isArray(data.facilities) ? data.facilities : [];
  } catch {
    return;
  }
  if (step !== 3 || facilities.length === 0) return;

  const listEl = body.querySelector('#sl-infra-list') as HTMLElement;
  if (listEl) {
    listEl.innerHTML = facilities
      .map((f) => {
        const meta = INFRA_META[f.key];
        const km = f.meters >= 1000 ? (f.meters / 1000).toFixed(1) + 'km' : f.meters + 'm';
        return buildInfraRow(meta, f.walkMin + '분 · ' + km);
      })
      .join('');
  }
  const noteEl = body.querySelector('#sl-infra-note') as HTMLElement;
  if (noteEl) noteEl.textContent = '* 숙소 기준 실제 도보 경로 거리·시간이에요.';

  step3Facilities = facilities;
  drawInfraLines(basecamp, facilities); // 지도가 아직이면 no-op → 지도 준비 후 initMapStep3에서 다시 그림
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
  if (gradeEl) gradeEl.textContent = result.grade;
  const ratingsEl = body.querySelector('#sl-eff-ratings') as HTMLElement;
  if (ratingsEl) {
    ratingsEl.innerHTML = SCORE_LABELS
      .map((r) => buildEffRatingRow(r.label, result!.ratings[r.key] ?? 3))
      .join('');
  }
  const noteEl = body.querySelector('#sl-eff-note') as HTMLElement;
  if (noteEl) noteEl.textContent = '* AI가 위치·주변 정보를 종합해 평가한 점수예요 (이용자 리뷰 점수 아님).';
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

/** 실제 경로가 도착했으면 그걸, 아니면 직선거리 추정치를 라벨로 */
function step3TravelLabel(item: Step3Item): { icon: string; text: string } {
  if (item.real && item.realMode && item.realText) {
    const icon = item.realMode === 'WALKING' ? IC_WALK : IC_TAXI;
    return { icon, text: (item.realMode === 'WALKING' ? '도보 ' : '차량 ') + item.realText };
  }
  const travel = estimateTravel(item.km);
  return { icon: travel.icon, text: travel.label };
}

function buildStatTile(icon: string, color: string, title: string, value: string, desc: string): string {
  return [
    '<div class="sl-step3-stat-tile">',
    '  <span class="sl-step3-stat-icon" style="--stat-color:' + color + '">' + icon + '</span>',
    '  <div class="sl-step3-stat-title">' + title + '</div>',
    '  <div class="sl-step3-stat-value">' + value + '</div>',
    '  <div class="sl-step3-stat-desc">' + desc + '</div>',
    '</div>',
  ].join('');
}

/** 놓친 장소 · 통계 타일을 confirmedIds 기준으로 다시 그림 (장소를 '추가'해 확정할 때마다 호출) */
function renderStep3Lists(body: HTMLElement, withDistance: Step3Item[]): void {
  if (!selectedZone || !selectedBasecamp) return;

  const missedEl = body.querySelector('#sl-missed-list') as HTMLElement;
  if (missedEl) {
    const missed = withDistance.filter((item) => !confirmedIds.has(item.place.id));
    missedEl.innerHTML = missed.length
      ? missed
          .map((item) => {
            const { text } = step3TravelLabel(item);
            const moodLabel = MOOD_LABEL[item.place.mood ?? ''] || '';
            return [
              '<div class="sl-basecamp-card sl-missed-item">',
              item.place.photo_url
                ? '  <div class="sl-basecamp-thumb" style="background-image:url(\'' + item.place.photo_url + '\')"></div>'
                : '  <div class="sl-basecamp-thumb sl-basecamp-thumb-empty">' + IC_PIN + '</div>',
              '  <div class="sl-basecamp-info">',
              '    <div class="sl-basecamp-name">' + escapeHtml(item.place.name) + '</div>',
              '    <div class="sl-missed-tag"><span class="sl-missed-badge" style="--badge-color:' + (MOOD_COLOR[item.place.mood ?? ''] || '#94A3B8') + '">' + escapeHtml(moodLabel) + '</span>' + escapeHtml(text) + '</div>',
              '  </div>',
              '  <button type="button" class="sl-missed-add-btn" data-place-id="' + item.place.id + '">' + IC_PLUS + ' 추가</button>',
              '</div>',
            ].join('');
          })
          .join('')
      : '<div class="sl-step3-missed-empty">모든 주변 장소를 확정했어요.</div>';

    missedEl.querySelectorAll('.sl-missed-add-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const placeId = (btn as HTMLElement).dataset.placeId!;
        confirmedIds.add(placeId);
        renderStep3Lists(body, withDistance);
      });
    });
  }

  const statsEl = body.querySelector('#sl-step3-stats') as HTMLElement;
  if (statsEl) {
    const walkable = withDistance.filter((item) => item.km <= 1.5).length;
    const avgMin = withDistance.length
      ? Math.round(withDistance.reduce((sum, item) => sum + item.minutes, 0) / withDistance.length)
      : 0;

    // 평균 이동시간·도보권 장소는 실데이터(직선거리/실측 경로) 기반.
    // 대중교통·편의시설·관광지·편의점 접근성은 Phase 2(Nearby Search) 예시 — 안전도(야간)는 실측 불가라 제외.
    statsEl.innerHTML = [
      buildStatTile(IC_CLOCK, '#0B7CC4', '평균 이동시간', avgMin + '분', '전체 장소 기준'),
      buildStatTile(IC_WALK, '#1D9E75', '도보권 장소', walkable + '곳', '도보 15분 이내'),
      buildStatTile(IC_BUS, '#0B7CC4', '대중교통 접근성', '좋음', '주요 역·정류장 인접'),
      buildStatTile(IC_HOUSE, '#F5A623', '편의시설 접근성', '좋음', '편의점·카페·마트 등'),
      buildStatTile(IC_BUILDING, '#1D9E75', '관광지 접근성', '좋음', '주요 관광지 근접'),
      buildStatTile(IC_CART, '#0F9E9E', '편의점 접근성', '좋음', '24시 편의점 인근'),
    ].join('');
  }
}

let step3MapInstance: any = null;
let step3InfraLines: any[] = [];
let step3Facilities: InfraFacility[] = []; // 지도 준비/인프라 도착 순서와 무관하게 다시 그리기 위해 보관

/** 편의시설 카테고리 아이콘을 배경 없이 지도 마커로 사용 (흰 아웃라인 필터로 대비만 확보) */
function buildInfraMarkerIcon(g: any, meta: { icon: string; color: string }): any {
  const colored = meta.icon.replace(/currentColor/g, meta.color);
  const withOutline = colored.replace(
    /(<svg[^>]*>)([\s\S]*)(<\/svg>)/,
    (_m: string, open: string, inner: string, close: string) =>
      // IC_* 아이콘 상수는 innerHTML로 인라인 삽입될 때만 쓰도록 만들어져 xmlns가 없음.
      // data:image/svg+xml <img>는 독립 SVG 문서로 파싱되므로 xmlns가 없으면 파싱에 실패해
      // 아이콘이 아예 안 보임(깨진 이미지) — 여기서만 보강해서 넣어준다.
      open.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ') +
      '<defs><filter id="infraOutline" x="-60%" y="-60%" width="220%" height="220%">' +
      '<feMorphology in="SourceAlpha" operator="dilate" radius="1.2" result="thick"/>' +
      '<feFlood flood-color="#ffffff" flood-opacity="0.95" result="white"/>' +
      '<feComposite in="white" in2="thick" operator="in" result="outline"/>' +
      '<feMerge><feMergeNode in="outline"/><feMergeNode in="SourceGraphic"/></feMerge>' +
      '</filter></defs>' +
      '<g filter="url(#infraOutline)">' + inner + '</g>' +
      close
  );
  const size = 22;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(withOutline),
    scaledSize: new g.maps.Size(size, size),
    anchor: new g.maps.Point(size / 2, size / 2),
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

/** 숙소 → 각 편의시설로 컬러 점선 연결 + 카테고리 아이콘 마커 (Nearby Search 실데이터 도착 시 호출) */
function drawInfraLines(basecamp: Place, facilities: InfraFacility[]): void {
  const g = (window as any).google;
  if (!g?.maps || !step3MapInstance || basecamp.lat == null || basecamp.lng == null) return;

  step3InfraLines.forEach((l) => l.setMap(null));
  step3InfraLines = [];

  facilities.forEach((f) => {
    const meta = INFRA_META[f.key];
    if (!meta) return;
    const line = new g.maps.Polyline({
      path: [
        { lat: basecamp.lat!, lng: basecamp.lng! },
        { lat: f.lat, lng: f.lng },
      ],
      map: step3MapInstance,
      strokeOpacity: 0,
      icons: [
        {
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.7, strokeWeight: 2, scale: 2, strokeColor: meta.color },
          offset: '0',
          repeat: '9px',
        },
      ],
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
  step3Facilities = [];
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
    icon: buildCategoryIcon(g, '숙소', 'detailed'),
    zIndex: 30,
  });

  // 인프라 데이터가 지도보다 먼저 도착했으면 이제 그림 (basecamp 마커 외엔 이 지도에 다른 장소를 넣지 않음)
  if (step3Facilities.length && selectedBasecamp) drawInfraLines(selectedBasecamp, step3Facilities);
}
