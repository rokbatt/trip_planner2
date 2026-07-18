import { supabase } from '../supabase';
import { store } from '../store';
import { loadGoogleMapsScript, getCategoryLabel } from '../utils/googleMaps';
import type { Database } from '../types/database';
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
const IC_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
const IC_SEARCH2 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
const IC_EXTLINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>';
const IC_XCLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
const IC_ROUTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';

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
  allPlaces = [];
  zones = [];
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
  if (!currentTripId) return;
  await supabase
    .from('trips')
    .update({
      shortlist_zone_name: selectedZone?.name ?? null,
      shortlist_zone_place_ids: selectedZone ? selectedZone.places.map((p) => p.id) : null,
      shortlist_basecamp_place_id: selectedBasecamp?.id ?? null,
      shortlist_confirmed_place_ids: [...confirmedIds],
    })
    .eq('id', currentTripId);
}

/* ── 메인 렌더 ── */
export async function renderShortlistContent(container: HTMLElement, tripId: string): Promise<void> {
  teardownShortlist();
  currentTripId = tripId;

  container.innerHTML = '<div class="sl-loading">Shortlist 준비 중...</div>';

  const [trip, places] = await Promise.all([loadTrip(tripId), loadPlaces(tripId)]);
  currentTrip = trip;
  allPlaces = places;

  if (allPlaces.length === 0) {
    container.innerHTML = [
      '<div class="sl-empty">',
      '  <div class="sl-empty-title">아직 분류된 장소가 없어요</div>',
      '  <div class="sl-empty-hint">Brainstorm(IDEAS) 게이트에서 장소를 VISIT · FOOD · ACTIVITY · STAY로 분류하면 여기 표시돼요.</div>',
      '</div>',
    ].join('\n');
    return;
  }

  const destination = getTripDestination();
  const { seeds, source } = await fetchDestinationZones(destination);

  if (seeds.length === 0) {
    container.innerHTML = [
      '<div class="sl-empty">',
      '  <div class="sl-empty-title">' + escapeHtml(destination) + '의 숙박 생활권 정보가 아직 없어요</div>',
      '  <div class="sl-empty-hint">이 여행지는 아직 검수된 지역 데이터가 준비되지 않았어요. 조만간 추가될 예정이에요.</div>',
      '</div>',
    ].join('\n');
    return;
  }

  zoneDataSource = source;
  zones = assignPlacesToZones(seeds, allPlaces);

  // 이미 저장된 선택 상태가 있으면 복원
  if (trip?.shortlist_zone_name && trip.shortlist_zone_place_ids) {
    const restoredZone = zones.find(
      (z) => z.places.some((p) => trip.shortlist_zone_place_ids!.includes(p.id))
    );
    if (restoredZone) {
      selectedZone = restoredZone;
      step = 2;
      if (trip.shortlist_basecamp_place_id) {
        const bc = restoredZone.places.find((p) => p.id === trip.shortlist_basecamp_place_id);
        if (bc) {
          selectedBasecamp = bc;
          step = 3;
          confirmedIds = new Set(trip.shortlist_confirmed_place_ids ?? []);
        }
      }
    }
  }

  await renderStep(container);
}

function getTripDestination(): string {
  if (!currentTrip) return '';
  return currentTrip.destinations?.[0] ?? currentTrip.name ?? '';
}

let shellResizeHandler: (() => void) | null = null;
let step2MapResizeHandler: (() => void) | null = null;

/**
 * `.sl-shell`의 높이를 CSS calc()로 추측하는 대신, 실제 화면에서 남은 공간을
 * JS로 직접 측정해서 고정함. 여러 단계의 flex 상속 체인에 의존하는 CSS 방식은
 * 브라우저/줌 레벨에 따라 어긋나기 쉬워서, 훨씬 확실한 이 방식으로 대체.
 */
function lockShellHeight(container: HTMLElement): void {
  const shellEl = container.querySelector('.sl-shell') as HTMLElement;
  if (!shellEl) return;

  const applyHeight = () => {
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
    const headerMarginBottom = parseFloat(getComputedStyle(headerEl).marginBottom || '0');
    const available = step2El.clientHeight - headerEl.offsetHeight - headerMarginBottom;
    // 지도 아래 남는 여백을 채우도록 기본 계산값보다 17% 키움
    leftEl.style.height = Math.max(380, available * 1.17) + 'px';
  };

  applyHeight();

  if (step2MapResizeHandler) window.removeEventListener('resize', step2MapResizeHandler);
  step2MapResizeHandler = applyHeight;
  window.addEventListener('resize', step2MapResizeHandler);
}

async function renderStep(container: HTMLElement): Promise<void> {
  container.innerHTML = [
    '<div class="sl-shell">',
    '  <div class="sl-stepper-row">',
    '    <div class="sl-stepper" id="sl-stepper"></div>',
    '    <div id="sl-stepper-extra"></div>',
    '  </div>',
    '  <div class="sl-body" id="sl-body"></div>',
    '</div>',
  ].join('\n');

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
      renderStep(container.closest('.sl-shell')!.parentElement as HTMLElement);
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
    '    <div class="sl-sub">AI가 Brainstorm에서 모은 장소를 분석해 권역을 추천했어요.</div>',
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

/** Step2용 절충 스타일 — 도로·건물·대중교통 등 실제 디테일은 그대로 두되,
 *  기본 구글 업체 POI 아이콘(작은 색색 마커들)만 줄여서 우리 핀이 묻히지 않도록 함 */
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

  const shellEl = body.closest('.sl-shell') as HTMLElement;
  const stepperExtraEl = shellEl?.querySelector('#sl-stepper-extra') as HTMLElement;
  if (stepperExtraEl) {
    stepperExtraEl.innerHTML = [
      '<div class="sl-step2-topbar">',
      '  <div class="sl-step2-summary-card">',
      '    <div class="sl-step2-summary-item"><span class="sl-step2-summary-label">선택 지역</span><span class="sl-step2-summary-value">' + escapeHtml(selectedZone.name) + '</span></div>',
      '    <div class="sl-step2-summary-divider"></div>',
      '    <div class="sl-step2-summary-item"><span class="sl-step2-summary-label">여행 기간</span><span class="sl-step2-summary-value">' + escapeHtml(dateRange) + '</span></div>',
      '    <div class="sl-step2-summary-divider"></div>',
      '    <div class="sl-step2-summary-item sl-step2-summary-budget">',
      '      <span class="sl-step2-summary-label">예산 (1박 1인)</span>',
      '      <select id="sl-budget-select" class="sl-budget-select">',
      '        <option value=""' + (stayFilters.budget === '' ? ' selected' : '') + '>전체</option>',
      '        <option value="under5"' + (stayFilters.budget === 'under5' ? ' selected' : '') + '>5만원 이하</option>',
      '        <option value="under10"' + (stayFilters.budget === 'under10' ? ' selected' : '') + '>10만원 이하</option>',
      '        <option value="over20"' + (stayFilters.budget === 'over20' ? ' selected' : '') + '>20만원 이상</option>',
      '        <option value="custom"' + (stayFilters.budget === 'custom' ? ' selected' : '') + '>직접설정</option>',
      '      </select>',
      '      <div class="sl-budget-custom-row" id="sl-budget-custom-row" style="display:' + (stayFilters.budget === 'custom' ? 'flex' : 'none') + '">',
      '        <input type="number" id="sl-budget-min" class="sl-budget-custom-input" placeholder="최소" value="' + (stayFilters.customMinKRW ?? '') + '" />',
      '        <span>~</span>',
      '        <input type="number" id="sl-budget-max" class="sl-budget-custom-input" placeholder="최대" value="' + (stayFilters.customMaxKRW ?? '') + '" />',
      '        <span class="sl-budget-custom-unit">원</span>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <button class="sl-back-link" id="sl-back-1">' + IC_BACK + ' 지역 다시 선택</button>',
      '</div>',
    ].join('\n');
  }

  body.innerHTML = [
    '<div class="sl-step2">',
    '  <div class="sl-step2-header-row">',
    '    <div class="sl-step1-header sl-step2-header-text">',
    '      <div class="sl-eyebrow">IMMIGRATION COUNTER</div>',
    '      <div class="sl-title">숙소를 선택하면 여행의 중심이 결정됩니다</div>',
    '      <div class="sl-sub">숙소를 기준으로 모든 장소의 이동시간이 계산돼요.</div>',
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
    '        <div class="sl-section-desc">선택한 지역 기준으로 바로 검색해보세요.</div>',
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

  const goBackToStep1 = () => {
    step = 1;
    const container = body.closest('.sl-shell')!.parentElement as HTMLElement;
    renderStep(container);
  };
  stepperExtraEl?.querySelector('#sl-back-1')?.addEventListener('click', goBackToStep1);

  body.querySelector('#sl-sort-select')?.addEventListener('change', (e) => {
    step2SortMode = (e.target as HTMLSelectElement).value as 'rating' | 'distance';
    renderBasecampList(body, candidates);
  });

  stepperExtraEl?.querySelector('#sl-budget-select')?.addEventListener('change', (e) => {
    stayFilters.budget = (e.target as HTMLSelectElement).value;
    const customRow = stepperExtraEl.querySelector('#sl-budget-custom-row') as HTMLElement;
    if (customRow) customRow.style.display = stayFilters.budget === 'custom' ? 'flex' : 'none';
    renderHotelSiteCards(body, destination, selectedZone!.name);
  });

  const applyCustomBudget = () => {
    const minInput = stepperExtraEl?.querySelector('#sl-budget-min') as HTMLInputElement;
    const maxInput = stepperExtraEl?.querySelector('#sl-budget-max') as HTMLInputElement;
    stayFilters.customMinKRW = minInput?.value ? Number(minInput.value) : null;
    stayFilters.customMaxKRW = maxInput?.value ? Number(maxInput.value) : null;
    renderHotelSiteCards(body, destination, selectedZone!.name);
  };
  stepperExtraEl?.querySelector('#sl-budget-min')?.addEventListener('input', applyCustomBudget);
  stepperExtraEl?.querySelector('#sl-budget-max')?.addEventListener('input', applyCustomBudget);

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

function formatTripDateRange(): string {
  const trip = currentTrip;
  if (!trip?.start_date || !trip?.end_date) return '기간 미정';
  const s = new Date(trip.start_date);
  const e = new Date(trip.end_date);
  const nights = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
  const fmt = (d: Date) => (d.getMonth() + 1) + '.' + String(d.getDate()).padStart(2, '0');
  return fmt(s) + ' – ' + fmt(e) + ' / ' + nights + '박 ' + (nights + 1) + '일';
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
    '  <div class="sl-hotel-site-rating">★ ' + site.editorialRating.toFixed(1) + '</div>',
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
      '  <div>이 지역엔 STAY로 분류된 숙소가 없어요.</div>',
      '  <div class="sl-sub">Brainstorm(IDEAS) 게이트에서 숙소 후보를 STAY로 분류해주세요.</div>',
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


/* ══════════════════ STEP 3 — Confirm + Boarding Pass ══════════════════ */
async function renderStep3(body: HTMLElement): Promise<void> {
  if (!selectedZone || !selectedBasecamp) {
    step = 2;
    await renderStep2(body);
    return;
  }

  const others = selectedZone.places.filter((p) => p.id !== selectedBasecamp!.id);
  const withDistance = others
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({
      place: p,
      km: haversineKm(selectedBasecamp!.lat!, selectedBasecamp!.lng!, p.lat!, p.lng!),
    }))
    .sort((a, b) => a.km - b.km);

  // 처음 진입 시 기본적으로 가까운 곳(4km 이내)은 자동 체크
  if (confirmedIds.size === 0) {
    withDistance.forEach((item) => {
      if (item.km <= 4) confirmedIds.add(item.place.id);
    });
  }

  const closeCount = withDistance.filter((item) => item.km <= 1.5).length;

  body.innerHTML = [
    '<div class="sl-step3">',
    '  <button class="sl-back-link" id="sl-back-2">' + IC_BACK + ' 숙소 다시 선택</button>',
    '  <div class="sl-step1-header">',
    '    <div class="sl-eyebrow">FINAL CHECK</div>',
    '    <div class="sl-title">' + escapeHtml(selectedBasecamp.name) + ' 기준으로 갈 곳을 확정하세요</div>',
    closeCount > 0
      ? '<div class="sl-ai-note">' + closeCount + '곳은 숙소 기준 이동효율이 매우 좋아요.</div>'
      : '',
    '  </div>',
    '  <div class="sl-confirm-list" id="sl-confirm-list"></div>',
    '  <div class="sl-boarding-pass" id="sl-boarding-pass"></div>',
    '</div>',
  ].join('\n');

  body.querySelector('#sl-back-2')?.addEventListener('click', () => {
    step = 2;
    const container = body.closest('.sl-shell')!.parentElement as HTMLElement;
    renderStep(container);
  });

  const listEl = body.querySelector('#sl-confirm-list') as HTMLElement;
  listEl.innerHTML = withDistance
    .map(({ place, km }) => {
      const travel = estimateTravel(km);
      const checked = confirmedIds.has(place.id);
      return [
        '<label class="sl-confirm-item' + (checked ? ' checked' : '') + '">',
        '  <input type="checkbox" data-place-id="' + place.id + '"' + (checked ? ' checked' : '') + ' />',
        '  <span class="sl-confirm-mood-dot" style="--dot-color:' + (MOOD_COLOR[place.mood ?? ''] || '#94A3B8') + '"></span>',
        '  <span class="sl-confirm-name">' + escapeHtml(place.name) + '</span>',
        '  <span class="sl-confirm-travel">' + travel.icon + escapeHtml(travel.label) + '</span>',
        '</label>',
      ].join('');
    })
    .join('');

  listEl.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      const placeId = (input as HTMLInputElement).dataset.placeId!;
      if ((input as HTMLInputElement).checked) confirmedIds.add(placeId);
      else confirmedIds.delete(placeId);
      (input.closest('.sl-confirm-item') as HTMLElement).classList.toggle(
        'checked',
        (input as HTMLInputElement).checked
      );
      renderBoardingPass(body);
    });
  });

  renderBoardingPass(body);

  // 실제 길찾기(Distance Matrix API) — 직선거리 추정치를 실제 이동시간으로 백그라운드에서 교체
  loadRealTravelTimes(selectedBasecamp, withDistance).then((realTimes) => {
    if (!realTimes || step !== 3) return;
    listEl.querySelectorAll('.sl-confirm-item').forEach((item) => {
      const input = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const placeId = input?.dataset.placeId;
      const real = placeId ? realTimes.get(placeId) : undefined;
      if (!real) return;
      const travelEl = item.querySelector('.sl-confirm-travel') as HTMLElement;
      if (!travelEl) return;
      const icon = real.mode === 'WALKING' ? IC_WALK : IC_TAXI;
      travelEl.innerHTML = icon + escapeHtml((real.mode === 'WALKING' ? '도보 ' : '차량 ') + real.durationText + ' (실제 경로)');
    });
  });
}

interface RealTravelResult {
  mode: 'WALKING' | 'DRIVING';
  durationText: string;
  durationMin: number;
}

/**
 * 숙소 기준 실제 길찾기 (Google Distance Matrix API).
 * 가까운 곳(≤2km)은 도보, 먼 곳은 차량 모드로 배치 조회.
 * 실패해도 화면은 이미 직선거리 추정치로 채워져 있어서 조용히 무시됨.
 *
 * 필요: Google Cloud Console에서 "Distance Matrix API" 활성화 필요 (월 10,000건까지 무료 — Essentials 등급).
 */
async function loadRealTravelTimes(
  basecamp: Place,
  items: { place: Place; km: number }[]
): Promise<Map<string, RealTravelResult> | null> {
  if (basecamp.lat == null || basecamp.lng == null) return null;

  try {
    await loadGoogleMapsScript();
  } catch (e) {
    return null;
  }
  const g = (window as any).google;
  if (!g?.maps?.DistanceMatrixService) return null;

  const service = new g.maps.DistanceMatrixService();
  const results = new Map<string, RealTravelResult>();

  const closeItems = items.filter((i) => i.km <= 2 && i.place.lat != null && i.place.lng != null);
  const farItems = items.filter((i) => i.km > 2 && i.place.lat != null && i.place.lng != null);

  function runBatch(batchItems: { place: Place; km: number }[], mode: 'WALKING' | 'DRIVING'): Promise<void> {
    if (batchItems.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      service.getDistanceMatrix(
        {
          origins: [{ lat: basecamp.lat!, lng: basecamp.lng! }],
          destinations: batchItems.map((i) => ({ lat: i.place.lat!, lng: i.place.lng! })),
          travelMode: g.maps.TravelMode[mode],
        },
        (response: any, status: string) => {
          if (status === 'OK' && response?.rows?.[0]) {
            response.rows[0].elements.forEach((el: any, idx: number) => {
              if (el.status === 'OK') {
                results.set(batchItems[idx].place.id, {
                  mode,
                  durationText: el.duration.text,
                  durationMin: Math.round(el.duration.value / 60),
                });
              }
            });
          } else {
            console.error('[Shortlist] Distance Matrix 조회 실패(' + mode + '):', status);
          }
          resolve();
        }
      );
    });
  }

  await Promise.all([runBatch(closeItems, 'WALKING'), runBatch(farItems, 'DRIVING')]);
  return results;
}

function renderBoardingPass(body: HTMLElement): void {
  const passEl = body.querySelector('#sl-boarding-pass') as HTMLElement;
  if (!selectedZone || !selectedBasecamp) return;

  const confirmedPlaces = selectedZone.places.filter((p) => confirmedIds.has(p.id));
  const counts = countByMood(confirmedPlaces);

  passEl.innerHTML = [
    '<div class="sl-pass-card">',
    '  <div class="sl-pass-header">',
    '    <span class="sl-pass-eyebrow">BASE</span>',
    '    <span class="sl-pass-zone">' + escapeHtml(selectedZone.name) + '</span>',
    '  </div>',
    '  <div class="sl-pass-divider"></div>',
    '  <div class="sl-pass-row">',
    '    <div class="sl-pass-field"><span class="sl-pass-label">Hotel</span><span class="sl-pass-value">' + escapeHtml(selectedBasecamp.name) + '</span></div>',
    '    <div class="sl-pass-field"><span class="sl-pass-label">Visit</span><span class="sl-pass-value">' + (counts['가고싶어'] ?? 0) + '</span></div>',
    '    <div class="sl-pass-field"><span class="sl-pass-label">Food</span><span class="sl-pass-value">' + (counts['먹고싶어'] ?? 0) + '</span></div>',
    '    <div class="sl-pass-field"><span class="sl-pass-label">Activity</span><span class="sl-pass-value">' + (counts['하고싶어'] ?? 0) + '</span></div>',
    '  </div>',
    '  <div class="sl-pass-divider"></div>',
    '  <button class="sl-pass-cta" id="sl-proceed">Proceed to Route ' + IC_ARROW + '</button>',
    '</div>',
  ].join('\n');

  passEl.querySelector('#sl-proceed')?.addEventListener('click', async () => {
    const btn = passEl.querySelector('#sl-proceed') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '저장 중...';
    await saveShortlistState();
    window.dispatchEvent(
      new CustomEvent('mongsil:navigateGate', { detail: { tripId: currentTripId, gate: 'route' } })
    );
  });
}
