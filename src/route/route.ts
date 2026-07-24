/**
 * ROUTE 게이트 — 확정한 숙소·장소를 하루 동선으로 배치하는 화면.
 *
 * shortlist(SHORTLIST)에서 확정한 결과를 이어받아:
 *   - 숙소(basecamp) = 하루의 출발점
 *   - 확정 장소들      = 지도에 후보 마커로 표시, 클릭하면 그날 동선에 순서대로 추가
 *   - 체류 일수         = DAY 탭 개수 (기본값, "DAY 추가"로 더 늘릴 수 있음)
 *
 * 이동시간/교통비/최적화 제안/동선 점수는 shortlist와 동일하게 직선거리(Haversine)
 * 기반 추정치예요(실제 Directions API 호출 없음) — 화면에도 "추정" 표기.
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
  syntheticDestinationName,
} from '../trips/destinations';
import { loadGoogleMapsScript } from '../utils/googleMaps';
import type { Database } from '../types/database';
import './route.css';

type Place = Database['public']['Tables']['places']['Row'];
type Trip = Database['public']['Tables']['trips']['Row'];

/* ── 아이콘 ── */
const IC_WALK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="M11 8l-3 3 2 7M11 8l3 2 3-1M8 11l-3 2v6M13 10l2 4-2 6"/></svg>';
const IC_TRANSIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="14" rx="2"/><path d="M4 11h16M8 21l2-4h4l2 4M8 7h.01M16 7h.01"/></svg>';
const IC_BUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9H4V6z"/><path d="M4 15h16v2a1 1 0 0 1-1 1h-1M4 15v2a1 1 0 0 0 1 1h1M8 18v1M16 18v1M4 10h16"/></svg>';
const IC_TAXI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M5 17l1.5-5h11L19 17M8 12V8h8v4"/></svg>';
const IC_CAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l1.5-5h11L19 13M5 17h14M5 13h14v4H5zM7 17v2M17 17v2"/><circle cx="7.5" cy="15" r="0.6"/><circle cx="16.5" cy="15" r="0.6"/></svg>';
const IC_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
const IC_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const IC_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
const IC_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const IC_SPARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>';
const IC_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const IC_COINS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="9" cy="6" rx="6" ry="3"/><path d="M3 6v6c0 1.66 2.69 3 6 3s6-1.34 6-3V6"/><path d="M15 12c0 1.66 2.69 3 6 3M21 12v6c0 1.66-2.69 3-6 3-1.2 0-2.3-.16-3.2-.44"/></svg>';
const IC_FOOT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16c0-2 1-3 1-6 0-2 1-4 3-4s2 3 2 5-1 5-3 5-3-1-3 0M18 8c1 0 2 1 2 3s-1 4-3 4"/></svg>';
const IC_TRAIN_MINI = IC_TRANSIT;
const IC_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21C12 21 19 14.5 19 9.5C19 5.9 15.9 3 12 3C8.1 3 5 5.9 5 9.5C5 14.5 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.2"/></svg>';
const IC_STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.8 5.9 20.4 7.2 13.7 2.2 9l6.8-.8z"/></svg>';
const IC_BED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 18v2M21 18v2M3 12V8a2 2 0 0 1 2-2h4v6"/></svg>';

/* 동선 leg 색 팔레트 — 각 구간(leg)을 서로 다른 색 폴리라인으로 (레퍼런스와 동일 컨셉) */
const LEG_PALETTE = ['#0B7CC4', '#1D9E75', '#F5A623', '#7F77DD', '#E24B4A', '#0F9E9E'];

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
}

/* ── 모듈 상태 ── */
let currentTripId = '';
let currentTrip: Trip | null = null;
let rtContainer: HTMLElement | null = null;
let basecamp: Place | null = null;
let candidatePlaces: Place[] = []; // 확정 장소들(숙소 제외)
let placeById = new Map<string, Place>();
let days: RouteDay[] = [];
let activeDayId = '';
let panelCollapsed = false;

let mapInstance: any = null;
let mapMarkers: any[] = [];
let routePolylines: any[] = [];
let resizeHandler: (() => void) | null = null;

export function teardownRoute(): void {
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }
  currentTrip = null;
  basecamp = null;
  candidatePlaces = [];
  placeById = new Map();
  days = [];
  activeDayId = '';
  panelCollapsed = false;
  mapInstance = null;
  mapMarkers = [];
  routePolylines = [];
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

/** 두 지점 사이의 추정 이동 leg (거리에 따라 도보/대중교통/택시 자동 선택) */
function estimateLeg(a: Place, b: Place): Leg {
  const km = haversineKm(a.lat!, a.lng!, b.lat!, b.lng!) * 1.25; // 직선→실주행 보정
  if (km <= 1.0) {
    return { mode: 'WALK', km, min: Math.max(2, Math.round(km * 13)), costTHB: 0 };
  }
  if (km <= 6) {
    // 대중교통: 표정속도 ~18km/h + 대기, 요금은 거리 비례(방콕 BTS 대략)
    return { mode: 'TRANSIT', km, min: Math.max(6, Math.round((km / 18) * 60) + 6), costTHB: Math.min(62, 20 + Math.round(km) * 6) };
  }
  // 택시: ~24km/h(시내), 기본 35 + 6.5/km
  return { mode: 'TAXI', km, min: Math.max(8, Math.round((km / 24) * 60)), costTHB: 35 + Math.round(km * 6.5) };
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

/** 순서대로의 leg들 (stops.length - 1개) */
function dayLegs(day: RouteDay): Leg[] {
  const stops = orderedStops(day).filter((p) => p.lat != null && p.lng != null);
  const legs: Leg[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    legs.push(estimateLeg(stops[i], stops[i + 1]));
  }
  return legs;
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
  const activeDest = resolveActiveDestination(trip.id, dests);
  const segments = activeDest ? await loadStaySegments(trip, activeDest) : [];
  const seg = activeDest ? resolveActiveSegment(activeDest.id, segments) : null;

  const basecampId = seg?.basecamp_place_id ?? trip.shortlist_basecamp_place_id ?? null;
  basecamp = basecampId ? placeById.get(basecampId) ?? null : null;

  const confirmedIds = seg?.confirmed_place_ids ?? trip.shortlist_confirmed_place_ids ?? [];
  candidatePlaces = confirmedIds
    .map((id) => placeById.get(id))
    .filter((p): p is Place => !!p && p.id !== basecampId && p.lat != null && p.lng != null);

  // 체류 일수 = 구간 날짜 기준(없으면 트립 기준), 기본 1일
  const start = seg?.start_date ?? activeDest?.start_date ?? trip.start_date;
  const end = seg?.end_date ?? activeDest?.end_date ?? trip.end_date;
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
    stopIds: i === 0 ? sorted.map((p) => p.id) : [],
  }));
  activeDayId = days[0].id;
}

/* ══════════════════ 메인 렌더 ══════════════════ */

export async function renderRouteContent(container: HTMLElement, tripId: string): Promise<void> {
  teardownRoute();
  currentTripId = tripId;
  rtContainer = container;

  container.innerHTML = '<div class="rt-loading">동선 준비 중...</div>';

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

    '  <div class="rt-header">',
    '    <div class="rt-header-text">',
    '      <div class="rt-eyebrow">ROUTE</div>',
    '      <div class="rt-title">지도를 클릭하여 하루의 동선을 만들어보세요</div>',
    '    </div>',
    '    <button type="button" class="rt-to-timeline-top" id="rt-to-timeline-top">' + IC_ARROW + ' 타임라인으로</button>',
    '  </div>',

    '  <div class="rt-toolbar">',
    '    <div class="rt-daytabs" id="rt-daytabs"></div>',
    '    <div class="rt-modefilter">',
    '      <span class="rt-modefilter-label">' + IC_SPARK + ' 이동수단은 거리 기준 자동 추정</span>',
    '      <span class="rt-modechip walk">' + IC_WALK + '</span>',
    '      <span class="rt-modechip transit">' + IC_TRANSIT + '</span>',
    '      <span class="rt-modechip taxi">' + IC_TAXI + '</span>',
    '    </div>',
    '  </div>',

    '  <div class="rt-main" id="rt-main">',
    '    <div class="rt-map-col">',
    '      <div class="rt-map-wrap"><div id="rt-map" class="rt-map"></div>',
    '        <div class="rt-map-hint" id="rt-map-hint">숙소 주변 확정 장소를 클릭해 동선에 추가/제외할 수 있어요.</div>',
    '      </div>',
    '      <div class="rt-timeline" id="rt-timeline"></div>',
    '    </div>',
    '    <button type="button" class="rt-collapse-toggle" id="rt-collapse-toggle" title="정보 패널 접기/펼치기" aria-label="정보 패널 접기/펼치기">' + IC_CHEVRON + '</button>',
    '    <div class="rt-panel-col" id="rt-panel-col">',
    '      <div class="rt-panel-inner" id="rt-panel-inner"></div>',
    '    </div>',
    '  </div>',

    '  <div class="rt-scorebar" id="rt-scorebar"></div>',
    '</div>',
  ].join('\n');
}

function bindPage(container: HTMLElement): void {
  renderDayTabs(container);
  renderTimeline(container);
  renderPanel(container);
  renderScorebar(container);

  // 접기/펼치기 토글 — 패널이 슬라이드되고, 애니메이션 종료 후 지도를 실제로 resize
  const toggle = container.querySelector('#rt-collapse-toggle') as HTMLElement;
  const mainEl = container.querySelector('#rt-main') as HTMLElement;
  const panelCol = container.querySelector('#rt-panel-col') as HTMLElement;
  toggle?.addEventListener('click', () => {
    panelCollapsed = !panelCollapsed;
    mainEl.classList.toggle('rt-panel-collapsed', panelCollapsed);
    toggle.classList.toggle('is-collapsed', panelCollapsed);
  });
  // transitionend에서 지도 resize (transform/width 애니메이션이 끝난 뒤 정확한 크기로)
  panelCol?.addEventListener('transitionend', (e) => {
    if ((e as TransitionEvent).propertyName !== 'width' && (e as TransitionEvent).propertyName !== 'transform') return;
    resizeMap();
  });
}

/* ── DAY 탭 ── */
function renderDayTabs(container: HTMLElement): void {
  const el = container.querySelector('#rt-daytabs') as HTMLElement;
  if (!el) return;
  el.innerHTML =
    days
      .map(
        (d) =>
          '<button type="button" class="rt-daytab' + (d.id === activeDayId ? ' active' : '') + '" data-day="' + d.id + '">' + escapeHtml(d.label) + '</button>'
      )
      .join('') + '<button type="button" class="rt-daytab-add" id="rt-day-add">' + IC_PLUS + ' DAY 추가</button>';

  el.querySelectorAll('.rt-daytab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeDayId = (btn as HTMLElement).dataset.day!;
      refreshAll(container);
    });
  });
  el.querySelector('#rt-day-add')?.addEventListener('click', () => {
    const n = days.length + 1;
    days.push({ id: 'day-' + n, label: 'DAY ' + n, stopIds: [] });
    activeDayId = 'day-' + n;
    refreshAll(container);
  });
}

/* ── 하단 타임라인 스트립 ── */
function renderTimeline(container: HTMLElement): void {
  const el = container.querySelector('#rt-timeline') as HTMLElement;
  if (!el) return;
  const day = activeDay();
  const stops = orderedStops(day);
  const legs = dayLegs(day);

  if (!basecamp) {
    el.innerHTML = '';
    return;
  }

  const cells: string[] = [];
  stops.forEach((p, i) => {
    const isStart = i === 0;
    cells.push(buildStopCardHtml(p, i, isStart));
    if (i < legs.length) cells.push(buildLegHtml(legs[i]));
  });
  cells.push(
    '<button type="button" class="rt-add-stop" id="rt-add-stop">' + IC_PLUS + '<span>장소 추가</span></button>'
  );

  el.innerHTML =
    '<div class="rt-timeline-track">' + cells.join('') + '</div>' +
    '<div class="rt-timeline-note">지도에서 장소를 눌러 순서대로 추가하세요. 카드의 ✕로 제외할 수 있어요.</div>';

  el.querySelectorAll('.rt-stop-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.placeId!;
      removeStop(id);
      refreshAll(container);
    });
  });
  el.querySelector('#rt-add-stop')?.addEventListener('click', () => {
    const hint = container.querySelector('#rt-map-hint') as HTMLElement;
    if (hint) {
      hint.classList.add('pulse');
      setTimeout(() => hint.classList.remove('pulse'), 1200);
    }
  });
}

function buildStopCardHtml(p: Place, index: number, isStart: boolean): string {
  const numHtml = isStart
    ? '<span class="rt-stop-num start">' + IC_BED + '</span>'
    : '<span class="rt-stop-num">' + index + '</span>';
  return [
    '<div class="rt-stop-card' + (isStart ? ' start' : '') + '">',
    isStart ? '  <div class="rt-stop-badge">출발</div>' : '',
    !isStart ? '  <button type="button" class="rt-stop-remove" data-place-id="' + p.id + '" title="이 장소 제외">✕</button>' : '',
    '  ' + numHtml,
    '  <div class="rt-stop-name">' + escapeHtml(p.name) + '</div>',
    p.category ? '  <div class="rt-stop-sub">' + escapeHtml(p.category) + '</div>' : (isStart ? '  <div class="rt-stop-sub">숙소</div>' : ''),
    '</div>',
  ].join('');
}

function buildLegHtml(leg: Leg): string {
  return [
    '<div class="rt-leg ' + modeColorClass(leg.mode) + '">',
    '  <span class="rt-leg-icon">' + modeIcon(leg.mode) + '</span>',
    '  <span class="rt-leg-min">' + fmtMin(leg.min) + '</span>',
    '  <span class="rt-leg-dist">' + fmtKm(leg.km) + '</span>',
    leg.costTHB > 0 ? '  <span class="rt-leg-cost">' + leg.costTHB + ' THB</span>' : '  <span class="rt-leg-cost free">무료</span>',
    '</div>',
  ].join('');
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

/* ── 우측 정보 패널 ── */
function computeDaySummary(day: RouteDay): {
  totalMin: number;
  totalCost: number;
  walkMeters: number;
  transitCount: number;
  taxiCount: number;
  legCount: number;
  visitCount: number;
} {
  const legs = dayLegs(day);
  let totalMin = 0;
  let totalCost = 0;
  let walkMeters = 0;
  let transitCount = 0;
  let taxiCount = 0;
  legs.forEach((l) => {
    totalMin += l.min;
    totalCost += l.costTHB;
    if (l.mode === 'WALK') walkMeters += l.km * 1000;
    else if (l.mode === 'TRANSIT') transitCount++;
    else taxiCount++;
  });
  return {
    totalMin,
    totalCost,
    walkMeters: Math.round(walkMeters),
    transitCount,
    taxiCount,
    legCount: legs.length,
    visitCount: day.stopIds.length,
  };
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
    const leg = estimateLeg(cur, rest[best]);
    totalMin += leg.min;
    orderedIds.push(rest[best].id);
    cur = rest[best];
  }
  return { order: orderedIds, totalMin };
}

function renderPanel(container: HTMLElement): void {
  const el = container.querySelector('#rt-panel-inner') as HTMLElement;
  if (!el) return;
  const day = activeDay();
  const s = computeDaySummary(day);
  const stops = orderedStops(day);
  const legs = dayLegs(day);

  const totalKm = legs.reduce((sum, l) => sum + l.km, 0);
  const walkRatio = totalKm > 0 ? Math.round(((s.walkMeters / 1000) / totalKm) * 100) : 0;
  const transitRatio = s.legCount > 0 ? Math.round((s.transitCount / s.legCount) * 100) : 0;
  const taxiRatio = s.legCount > 0 ? Math.round((s.taxiCount / s.legCount) * 100) : 0;

  const opt = optimizedOrder(day);
  const saved = Math.max(0, s.totalMin - opt.totalMin);
  const alreadyOptimal = saved < 2 || s.visitCount < 2;

  const legRows = legs
    .map((l, i) => {
      const from = stops[i];
      const to = stops[i + 1];
      return [
        '<div class="rt-legrow ' + modeColorClass(l.mode) + '">',
        '  <span class="rt-legrow-icon">' + modeIcon(l.mode) + '</span>',
        '  <div class="rt-legrow-text">',
        '    <div class="rt-legrow-path">' + escapeHtml(from.name) + ' <span class="rt-legrow-arrow">→</span> ' + escapeHtml(to.name) + '</div>',
        '    <div class="rt-legrow-meta">' + modeLabel(l.mode) + ' · ' + fmtMin(l.min) + ' · ' + fmtKm(l.km) + ' · ' + (l.costTHB > 0 ? l.costTHB + ' THB' : '0 THB') + '</div>',
        '  </div>',
        '</div>',
      ].join('');
    })
    .join('');

  el.innerHTML = [
    // ① AI 동선 요약
    '<div class="rt-card">',
    '  <div class="rt-card-title">AI 동선 요약</div>',
    '  <div class="rt-stat-grid">',
    buildStat(IC_CLOCK, '#0B7CC4', '총 이동시간', fmtMin(s.totalMin), s.visitCount + '개 장소 방문'),
    buildStat(IC_COINS, '#F5A623', '예상 교통비', s.totalCost + ' THB', '약 ' + Math.round(s.totalCost * 39).toLocaleString() + '원'),
    buildStat(IC_FOOT, '#1D9E75', '도보 비율', walkRatio + '%', (s.walkMeters / 1000).toFixed(1) + 'km'),
    buildStat(IC_TRANSIT, '#0B7CC4', '대중교통 비율', transitRatio + '%', s.transitCount + '개 구간'),
    buildStat(IC_TAXI, '#0F9E9E', '택시/차량 비율', taxiRatio + '%', s.taxiCount + '개 구간'),
    buildStat(IC_PIN, '#7F77DD', '방문 장소', s.visitCount + '곳', '출발 숙소 제외'),
    '  </div>',
    '  <div class="rt-card-note">* 이동시간·교통비는 직선거리 기반 추정치예요.</div>',
    '</div>',

    // ② AI 최적화 제안
    '<div class="rt-card">',
    '  <div class="rt-card-title-row"><span class="rt-card-title">AI 최적화 제안</span><span class="rt-badge-new">' + IC_SPARK + ' 추정</span></div>',
    alreadyOptimal
      ? '  <div class="rt-opt-done">' + IC_CHECK + ' 지금 동선이 이미 효율적이에요. 더 줄일 구간이 거의 없어요.'
      : [
          '  <div class="rt-opt-desc">현재 동선을 최적화하면<br><b>이동시간이 ' + fmtMin(saved) + ' 단축</b>돼요.</div>',
          '  <div class="rt-opt-compare">',
          '    <div class="rt-opt-box"><div class="rt-opt-box-label">현재 동선</div><div class="rt-opt-box-val">' + fmtMin(s.totalMin) + '</div></div>',
          '    <span class="rt-opt-arrow">' + IC_ARROW + '</span>',
          '    <div class="rt-opt-box best"><div class="rt-opt-box-label">추천 동선</div><div class="rt-opt-box-val">' + fmtMin(opt.totalMin) + '<span class="rt-opt-box-diff">(-' + fmtMin(saved) + ')</span></div></div>',
          '  </div>',
          '  <button type="button" class="rt-opt-apply" id="rt-opt-apply">' + IC_SPARK + ' 추천 순서로 정렬하기</button>',
        ].join(''),
    '</div>',

    // ③ 경로 상세 정보
    '<div class="rt-card">',
    '  <div class="rt-card-title">경로 상세 정보</div>',
    legs.length ? '  <div class="rt-legrows">' + legRows + '</div>' : '  <div class="rt-legrows-empty">동선에 장소를 추가하면 구간별 이동정보가 표시돼요.</div>',
    '</div>',
  ].join('\n');

  el.querySelector('#rt-opt-apply')?.addEventListener('click', () => {
    const day2 = activeDay();
    day2.stopIds = opt.order;
    refreshAll(container);
  });
}

function buildStat(icon: string, color: string, title: string, value: string, desc: string): string {
  return [
    '<div class="rt-stat-tile">',
    '  <span class="rt-stat-icon" style="--stat-color:' + color + '">' + icon + '</span>',
    '  <div class="rt-stat-title">' + title + '</div>',
    '  <div class="rt-stat-value">' + value + '</div>',
    '  <div class="rt-stat-desc">' + desc + '</div>',
    '</div>',
  ].join('');
}

/* ── 하단 점수 바 ── */
const SCORE_LABELS = [
  { key: 'move', label: '이동 효율성' },
  { key: 'sight', label: '관광 효율성' },
  { key: 'time', label: '시간 활용도' },
  { key: 'balance', label: '여행 균형감' },
  { key: 'value', label: '가성비' },
];

function computeScore(day: RouteDay): { score: number; grade: string; ratings: Record<string, number> } {
  const s = computeDaySummary(day);
  const legs = dayLegs(day);
  const totalKm = legs.reduce((sum, l) => sum + l.km, 0);
  const walkRatio = totalKm > 0 ? (s.walkMeters / 1000) / totalKm : 0;

  // 이동 효율: 방문 장소당 평균 이동시간이 짧을수록↑
  const avgLegMin = s.legCount > 0 ? s.totalMin / s.legCount : 0;
  const move = clampStar(5 - (avgLegMin - 10) / 8);
  const sight = clampStar(1 + s.visitCount); // 방문 장소 많을수록↑ (최대 5)
  const time = clampStar(5 - Math.abs(s.totalMin - 180) / 60); // 하루 총 3시간 이동 근처가 이상적
  const balance = clampStar(2 + walkRatio * 4); // 도보 비율 적당히 높으면↑
  const value = clampStar(5 - s.totalCost / 120); // 교통비 낮을수록↑
  const ratings = { move, sight, time, balance, value };
  const avg = (move + sight + time + balance + value) / 5;
  const score = Math.round(avg * 20);
  const grade = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 55 ? 'Fair' : 'Basic';
  return { score, grade, ratings };
}
function clampStar(v: number): number {
  return Math.max(1, Math.min(5, Math.round(v)));
}

function renderScorebar(container: HTMLElement): void {
  const el = container.querySelector('#rt-scorebar') as HTMLElement;
  if (!el) return;
  const day = activeDay();
  const { score, grade, ratings } = computeScore(day);

  const ratingCols = SCORE_LABELS.map((r) => {
    const stars = ratings[r.key as keyof typeof ratings] ?? 3;
    const starHtml = Array.from({ length: 5 }, (_, i) => '<span class="rt-rate-star' + (i < stars ? ' on' : '') + '">' + IC_STAR + '</span>').join('');
    return '<div class="rt-rate-col"><div class="rt-rate-label">' + r.label + '</div><div class="rt-rate-stars">' + starHtml + '</div></div>';
  }).join('');

  el.innerHTML = [
    '<div class="rt-score-card">',
    '  <div class="rt-score-main">',
    '    <div class="rt-score-num">' + score + '<span class="rt-score-max">/100</span></div>',
    '    <span class="rt-score-grade">' + grade + '</span>',
    '    <div class="rt-score-sub">' + activeDay().label + ' 동선 점수예요.</div>',
    '  </div>',
    '  <div class="rt-rate-grid">' + ratingCols + '</div>',
    '</div>',
    '<button type="button" class="rt-to-timeline-cta" id="rt-to-timeline-cta">',
    '  <span class="rt-to-timeline-cta-main">' + IC_CHECK + ' 타임라인으로 이동하기</span>',
    '  <span class="rt-to-timeline-cta-sub">이 동선으로 시간표를 만들어보세요.</span>',
    '</button>',
  ].join('\n');

  el.querySelector('#rt-to-timeline-cta')?.addEventListener('click', () => gotoGate('timeline'));
}

/* ── 전체 갱신 (지도 제외 UI + 지도 오버레이 재드로우) ── */
function refreshAll(container: HTMLElement): void {
  renderDayTabs(container);
  renderTimeline(container);
  renderPanel(container);
  renderScorebar(container);
  drawRouteOnMap();
}

/* ══════════════════ 지도 ══════════════════ */
async function initMap(container: HTMLElement): Promise<void> {
  const mapEl = container.querySelector('#rt-map') as HTMLElement;
  if (!mapEl) return;
  try {
    await loadGoogleMapsScript();
  } catch {
    mapEl.innerHTML = '<div class="rt-map-error">지도를 불러오지 못했어요.</div>';
    return;
  }
  const g = (window as any).google;
  if (!g?.maps) return;

  const center = basecamp && basecamp.lat != null ? { lat: basecamp.lat, lng: basecamp.lng! } : { lat: 13.74, lng: 100.53 };
  mapInstance = new g.maps.Map(mapEl, {
    center,
    zoom: 13,
    disableDefaultUI: true,
    gestureHandling: 'greedy',
    isFractionalZoomEnabled: true,
    styles: MAP_STYLE_LIGHT,
  });

  drawRouteOnMap();

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
}

/** 마커(숙소+후보) + 순서 폴리라인(색상 leg별)을 다시 그림 */
function drawRouteOnMap(): void {
  const g = (window as any).google;
  if (!g?.maps || !mapInstance) return;
  clearMapOverlays();

  const day = activeDay();
  const inRoute = new Set(day.stopIds);

  // 숙소 마커
  if (basecamp && basecamp.lat != null) {
    mapMarkers.push(buildMarker(g, basecamp, { kind: 'basecamp' }));
  }

  // 후보 장소 마커 — 동선에 포함된 건 번호, 아닌 건 흐린 점
  candidatePlaces.forEach((p) => {
    if (p.lat == null || p.lng == null) return;
    const idx = day.stopIds.indexOf(p.id);
    const marker = buildMarker(g, p, idx >= 0 ? { kind: 'stop', num: idx + 1 } : { kind: 'candidate' });
    marker.addListener('click', () => {
      toggleStop(p.id);
      refreshAll(rtContainer!);
    });
    mapMarkers.push(marker);
    void inRoute;
  });

  // 순서 폴리라인 (leg별 색)
  const stops = orderedStops(day).filter((p) => p.lat != null && p.lng != null);
  for (let i = 0; i < stops.length - 1; i++) {
    const line = new g.maps.Polyline({
      map: mapInstance,
      path: [
        { lat: stops[i].lat!, lng: stops[i].lng! },
        { lat: stops[i + 1].lat!, lng: stops[i + 1].lng! },
      ],
      strokeColor: LEG_PALETTE[i % LEG_PALETTE.length],
      strokeOpacity: 0.9,
      strokeWeight: 4,
    });
    routePolylines.push(line);
  }

  fitRouteBounds();
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
  // 동선에 포함된 정류지가 있으면 그것 위주로, 없으면 전체 후보로
  const focus = orderedStops(day).filter((p) => p.lat != null && p.lng != null);
  const target = focus.length >= 2 ? focus : withCoords;
  target.forEach((p) => bounds.extend({ lat: p.lat!, lng: p.lng! }));
  mapInstance.fitBounds(bounds, 56);
}

/** 커스텀 SVG 마커 생성 */
function buildMarker(g: any, p: Place, opt: { kind: 'basecamp' | 'stop' | 'candidate'; num?: number }): any {
  let svg: string;
  if (opt.kind === 'basecamp') {
    svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="42" height="50" viewBox="0 0 42 50">' +
      '<path d="M21 49C21 49 39 30 39 17.5C39 8.4 31 1 21 1C11 1 3 8.4 3 17.5C3 30 21 49 21 49Z" fill="#0B2A5C" stroke="#fff" stroke-width="2.5"/>' +
      '<g transform="translate(11,10)" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M0 12v-4a1.3 1.3 0 0 1 1.3-1.3h17.4A1.3 1.3 0 0 1 20 8v4M0 12v2M20 12v2M0 8V5.3A1.3 1.3 0 0 1 1.3 4h2.7v4"/></g>' +
      '</svg>';
  } else if (opt.kind === 'stop') {
    const color = LEG_PALETTE[((opt.num ?? 1) - 1) % LEG_PALETTE.length];
    svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="38" height="46" viewBox="0 0 38 46">' +
      '<path d="M19 45C19 45 35 28 35 16C35 7.7 27.8 1 19 1C10.2 1 3 7.7 3 16C3 28 19 45 19 45Z" fill="' + color + '" stroke="#fff" stroke-width="2.5"/>' +
      '<text x="19" y="21" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700" fill="#fff">' + (opt.num ?? '') + '</text>' +
      '</svg>';
  } else {
    svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">' +
      '<circle cx="11" cy="11" r="7" fill="#fff" stroke="#94A3B8" stroke-width="2"/>' +
      '<circle cx="11" cy="11" r="3" fill="#94A3B8"/>' +
      '</svg>';
  }
  const size = opt.kind === 'basecamp' ? { w: 42, h: 50 } : opt.kind === 'stop' ? { w: 38, h: 46 } : { w: 22, h: 22 };
  return new g.maps.Marker({
    position: { lat: p.lat!, lng: p.lng! },
    map: mapInstance,
    title: p.name,
    zIndex: opt.kind === 'basecamp' ? 100 : opt.kind === 'stop' ? 50 : 10,
    icon: {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new g.maps.Size(size.w, size.h),
      anchor: opt.kind === 'candidate' ? new g.maps.Point(size.w / 2, size.h / 2) : new g.maps.Point(size.w / 2, size.h),
    },
  });
}

const MAP_STYLE_LIGHT = [
  { elementType: 'geometry', stylers: [{ color: '#F8FBFE' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#94A3B8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#F8FBFE' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#E7EEF5' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D5EEFB' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#F1F6FB' }] },
];

void syntheticDestinationName;
void IC_BUS;
void IC_CAR;
void IC_TRAIN_MINI;
