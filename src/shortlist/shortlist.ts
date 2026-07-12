import { supabase } from '../supabase';
import { store } from '../store';
import { loadGoogleMapsScript } from '../utils/googleMaps';
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
const IC_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';

const MOOD_LABEL: Record<string, string> = {
  '가고싶어': 'VISIT',
  '먹고싶어': 'FOOD',
  '하고싶어': 'ACTIVITY',
  '숙소': 'STAY',
};
const MOOD_COLOR: Record<string, string> = {
  '가고싶어': '#E24B4A',
  '먹고싶어': '#F5A623',
  '하고싶어': '#7F77DD',
  '숙소': '#185FA5',
};

interface Zone {
  id: string;
  name: string;
  keyword: string;
  places: Place[];
  centerLat: number;
  centerLng: number;
  avgRating: number | null;
  avgInternalWalkMin: number | null;
  recommendedNights: number;
  topPlaces: Place[];
}

let highlightedZoneId: string | null = null;
let zoneCircles: any[] = [];
let markersByZone = new Map<string, any[]>();

/* ── 모듈 상태 ── */
let currentTripId = '';
let currentTrip: Trip | null = null;
let allPlaces: Place[] = [];
let zones: Zone[] = [];
let step: 1 | 2 | 3 = 1;
let selectedZone: Zone | null = null;
let selectedBasecamp: Place | null = null;
let confirmedIds = new Set<string>();
let mapInstance: any = null;
let mapMarkers: any[] = [];

export function teardownShortlist(): void {
  allPlaces = [];
  zones = [];
  step = 1;
  selectedZone = null;
  selectedBasecamp = null;
  confirmedIds = new Set();
  mapInstance = null;
  mapMarkers = [];
  highlightedZoneId = null;
  zoneCircles = [];
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
  keyword: string;
  lat: number;
  lng: number;
}

/**
 * 여행지의 유명 지역 목록을 가져옴 (트립마다 새로 계산하지 않고, 여행지 단위로 DB 캐싱됨).
 * 같은 여행지를 여러 트립이 가더라도 Gemini는 그 여행지 최초 1회만 호출됨.
 */
async function fetchDestinationZones(destination: string): Promise<ZoneSeed[]> {
  try {
    const res = await fetch('/api/destination-zones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination }),
    });
    const data = await res.json();
    if (!res.ok || !Array.isArray(data.zones)) return [];
    return data.zones;
  } catch (e) {
    console.error('[Shortlist] 여행지 지역 목록 로드 실패:', (e as Error).message);
    return [];
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

  const result: Zone[] = [];
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
      .slice(0, 3);

    const recommendedNights = Math.max(1, Math.min(4, Math.ceil(bucketPlaces.length / 3)));

    result.push({
      id: 'zone-' + seedIdx,
      name: seed.name,
      keyword: seed.keyword,
      places: bucketPlaces,
      centerLat: seed.lat,
      centerLng: seed.lng,
      avgRating,
      avgInternalWalkMin: avgInternalWalkMinutes(bucketPlaces),
      recommendedNights,
      topPlaces,
    });
  });

  return result.sort((a, b) => b.places.length - a.places.length);
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
  const seeds = await fetchDestinationZones(destination);

  if (seeds.length === 0) {
    container.innerHTML = [
      '<div class="sl-empty">',
      '  <div class="sl-empty-title">이 여행지의 지역 정보를 불러오지 못했어요</div>',
      '  <div class="sl-empty-hint">잠시 후 다시 시도해주세요.</div>',
      '</div>',
    ].join('\n');
    return;
  }

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

async function renderStep(container: HTMLElement): Promise<void> {
  container.innerHTML = [
    '<div class="sl-shell">',
    '  <div class="sl-stepper" id="sl-stepper"></div>',
    '  <div class="sl-body" id="sl-body"></div>',
    '</div>',
  ].join('\n');

  renderStepper(container);

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
    '    <div class="sl-sub">Brainstorm에서 담은 장소들을 지도 위에 펼쳐봤어요. 가까운 곳끼리 자동으로 묶었어요.</div>',
    '  </div>',
    '  <div class="sl-step1-layout">',
    '    <div class="sl-map-wrap"><div id="sl-map" class="sl-map"></div></div>',
    '    <div class="sl-zone-list" id="sl-zone-list"></div>',
    '  </div>',
    '</div>',
  ].join('\n');

  renderZoneCards(body);
  await initMap(body);
}

function renderZoneCards(body: HTMLElement): void {
  const listEl = body.querySelector('#sl-zone-list') as HTMLElement;
  listEl.innerHTML = zones
    .map((zone, i) => {
      const stars = zone.avgRating != null ? buildStars(zone.avgRating) : '';
      return [
        '<button type="button" class="sl-zone-card" data-zone-id="' + zone.id + '" style="--zone-color:' + zoneColor(i) + '">',
        '  <div class="sl-zone-card-top">',
        '    <div>',
        '      <div class="sl-zone-card-name">' + escapeHtml(zone.name) + '</div>',
        '      <div class="sl-zone-card-keyword">' + escapeHtml(zone.keyword) + '</div>',
        '    </div>',
        stars ? '<div class="sl-zone-card-stars">' + stars + '</div>' : '',
        '  </div>',
        '  <div class="sl-zone-card-stats">',
        '    <div class="sl-zone-stat"><span class="sl-zone-stat-label">장소</span><span class="sl-zone-stat-value">' + zone.places.length + '개</span></div>',
        zone.avgInternalWalkMin != null
          ? '<div class="sl-zone-stat"><span class="sl-zone-stat-label">평균 이동</span><span class="sl-zone-stat-value">도보 ' + zone.avgInternalWalkMin + '분</span></div>'
          : '',
        '    <div class="sl-zone-stat"><span class="sl-zone-stat-label">추천 숙박</span><span class="sl-zone-stat-value">' + zone.recommendedNights + '박</span></div>',
        '  </div>',
        zone.topPlaces.length > 0
          ? '  <div class="sl-zone-card-thumbs">' +
            zone.topPlaces
              .map((p) =>
                p.photo_url
                  ? '<div class="sl-zone-thumb" style="background-image:url(\'' + p.photo_url + '\')" title="' + escapeHtml(p.name) + '"></div>'
                  : ''
              )
              .join('') +
            '</div>'
          : '',
        '</button>',
      ].join('');
    })
    .join('');

  listEl.querySelectorAll('.sl-zone-card').forEach((card) => {
    const zoneId = (card as HTMLElement).dataset.zoneId!;
    card.addEventListener('mouseenter', () => highlightZone(zoneId));
    card.addEventListener('mouseleave', () => highlightZone(null));
    card.addEventListener('click', () => {
      const zone = zones.find((z) => z.id === zoneId) ?? null;
      selectedZone = zone;
      selectedBasecamp = null;
      confirmedIds = new Set();
      step = 2;
      const container = body.closest('.sl-shell')!.parentElement as HTMLElement;
      renderStep(container);
    });
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

const ZONE_PALETTE = ['#E24B4A', '#1D9E75', '#7F77DD', '#F5A623', '#D4537E', '#378ADD'];
function zoneColor(i: number): string {
  return ZONE_PALETTE[i % ZONE_PALETTE.length];
}

/** 카드에 마우스를 올리면 해당 권역만 지도에서 크게/진하게, 나머지는 흐리게 */
function highlightZone(zoneId: string | null): void {
  highlightedZoneId = zoneId;
  const g = (window as any).google;
  if (!g?.maps || !mapInstance) return;

  markersByZone.forEach((markers, id) => {
    const isHighlighted = zoneId === null || id === zoneId;
    markers.forEach((marker) => {
      marker.setIcon({
        path: g.maps.SymbolPath.CIRCLE,
        scale: isHighlighted ? 8 : 5,
        fillColor: marker.get('zoneColor'),
        fillOpacity: isHighlighted ? 0.95 : 0.25,
        strokeColor: '#fff',
        strokeWeight: isHighlighted ? 2 : 1,
      });
      marker.setZIndex(isHighlighted ? 20 : 1);
    });
  });

  zoneCircles.forEach((circle) => {
    const isHighlighted = zoneId === null || circle.get('zoneId') === zoneId;
    circle.setOptions({
      fillOpacity: zoneId === null ? 0.06 : isHighlighted ? 0.16 : 0.02,
      strokeOpacity: zoneId === null ? 0.35 : isHighlighted ? 0.7 : 0.08,
    });
  });

  if (zoneId) {
    const zone = zones.find((z) => z.id === zoneId);
    if (zone) {
      const bounds = new g.maps.LatLngBounds();
      zone.places.forEach((p) => {
        if (p.lat != null && p.lng != null) bounds.extend({ lat: p.lat, lng: p.lng });
      });
      if (!bounds.isEmpty()) mapInstance.fitBounds(bounds, 60);
    }
  }
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
    zoomControl: true,
    styles: MAP_STYLE_LIGHT,
  });

  const bounds = new g.maps.LatLngBounds();
  mapMarkers = [];
  markersByZone = new Map();
  zoneCircles = [];

  zones.forEach((zone, i) => {
    const color = zoneColor(i);
    const zoneMarkers: any[] = [];

    zone.places.forEach((p) => {
      if (p.lat == null || p.lng == null) return;
      const marker = new g.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: mapInstance,
        title: p.name,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 5,
          fillColor: color,
          fillOpacity: 0.25,
          strokeColor: '#fff',
          strokeWeight: 1,
        },
      });
      marker.set('zoneColor', color);
      zoneMarkers.push(marker);
      mapMarkers.push(marker);
      bounds.extend({ lat: p.lat, lng: p.lng });
    });

    markersByZone.set(zone.id, zoneMarkers);

    // 권역 전체를 감싸는 반투명 영역 (권역이 한눈에 보이도록)
    let maxDist = 0.4;
    zone.places.forEach((p) => {
      if (p.lat == null || p.lng == null) return;
      const d = haversineKm(zone.centerLat, zone.centerLng, p.lat, p.lng);
      if (d > maxDist) maxDist = d;
    });

    const circle = new g.maps.Circle({
      map: mapInstance,
      center: { lat: zone.centerLat, lng: zone.centerLng },
      radius: (maxDist + 0.3) * 1000,
      fillColor: color,
      fillOpacity: 0.06,
      strokeColor: color,
      strokeOpacity: 0.35,
      strokeWeight: 1.5,
      clickable: false,
    });
    circle.set('zoneId', zone.id);
    zoneCircles.push(circle);
  });

  if (!bounds.isEmpty()) mapInstance.fitBounds(bounds, 40);
}

const MAP_STYLE_LIGHT = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
];

/* ══════════════════ STEP 2 — Base Camp Selection ══════════════════ */
async function renderStep2(body: HTMLElement): Promise<void> {
  if (!selectedZone) {
    step = 1;
    await renderStep1(body);
    return;
  }

  const candidates = selectedZone.places.filter((p) => p.mood === '숙소');

  body.innerHTML = [
    '<div class="sl-step2">',
    '  <button class="sl-back-link" id="sl-back-1">' + IC_BACK + ' 지역 다시 선택</button>',
    '  <div class="sl-step1-header">',
    '    <div class="sl-eyebrow">BASE CAMP</div>',
    '    <div class="sl-title">' + escapeHtml(selectedZone.name) + '에서 어디에 머물까요?</div>',
    '    <div class="sl-sub">숙소를 바꾸면 지도 반경과 주변 장소 추천이 바로 다시 계산돼요.</div>',
    '  </div>',
    '  <div class="sl-step1-layout">',
    '    <div class="sl-map-wrap"><div id="sl-map2" class="sl-map"></div></div>',
    '    <div class="sl-basecamp-list" id="sl-basecamp-list"></div>',
    '  </div>',
    '</div>',
  ].join('\n');

  body.querySelector('#sl-back-1')?.addEventListener('click', () => {
    step = 1;
    const container = body.closest('.sl-shell')!.parentElement as HTMLElement;
    renderStep(container);
  });

  const listEl = body.querySelector('#sl-basecamp-list') as HTMLElement;

  if (candidates.length === 0) {
    listEl.innerHTML = [
      '<div class="sl-no-candidates">',
      '  <div>이 지역엔 STAY로 분류된 숙소가 없어요.</div>',
      '  <div class="sl-sub">Brainstorm(IDEAS) 게이트에서 숙소 후보를 STAY로 분류해주세요.</div>',
      '</div>',
    ].join('\n');
  } else {
    listEl.innerHTML = candidates
      .map((c) => {
        const isSelected = selectedBasecamp?.id === c.id;
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
        selectedBasecamp = candidates.find((c) => c.id === placeId) ?? null;
        confirmedIds = new Set();
        step = 3;
        const container = body.closest('.sl-shell')!.parentElement as HTMLElement;
        renderStep(container);
      });
    });
  }

  await initMapStep2(body, candidates);
}

async function initMapStep2(body: HTMLElement, candidates: Place[]): Promise<void> {
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
    zoom: 14,
    disableDefaultUI: true,
    zoomControl: true,
    styles: MAP_STYLE_LIGHT,
  });

  selectedZone.places.forEach((p) => {
    if (p.lat == null || p.lng == null) return;
    const isCandidate = p.mood === '숙소';
    new g.maps.Marker({
      position: { lat: p.lat, lng: p.lng },
      map,
      title: p.name,
      icon: {
        path: g.maps.SymbolPath.CIRCLE,
        scale: isCandidate ? 8 : 5,
        fillColor: isCandidate ? '#185FA5' : '#E24B4A',
        fillOpacity: 0.9,
        strokeColor: '#fff',
        strokeWeight: isCandidate ? 2 : 1.5,
      },
    });
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
