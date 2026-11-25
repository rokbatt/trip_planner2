/**
 * IDEAS 지도 영역 검색(PC 전용).
 *
 *  · 지도에서 왼쪽 버튼을 **0.4초 꾹 누른 뒤** 끌면 영역을 그린다(바로 끌면 평소처럼 지도 이동).
 *    도구 줄의 [영역 검색]을 누르면 다음 한 번은 꾹 누르지 않고 바로 그린다.
 *  · 다 그리면 지도 위에 [맛집][카페][관광지][쇼핑][술집] + 직접 입력 → 찾기.
 *  · 결과는 **왼쪽 체크인 칸**에 목록으로(지도를 좁히지 않으려고), 지도에는 번호 작은 핀.
 *    정렬 3가지, [+]로 체크인에 담기. 목록 ↔ 핀 마우스 올리면 서로 강조.
 *  · 검색은 휴대폰 '주변' 탭과 같은 함수·캐시(mobile/exploreApi)를 쓴다. 하루 20번(이 기기·사용자별).
 */

import { store } from '../store';
import { escapeHtml } from '../utils/html';
import { searchNearbyCat, searchText, type ExplorePlace } from '../mobile/exploreApi';
import type { ExploreCat } from '../mobile/explore';
import {
  AREA_DAILY_LIMIT, AREA_SORTS, coveringCircle, filterAndSort, isUsableArea, remainingToday, useOne, type AreaSort,
} from './areaModel';
import { formatDistance, haversineMeters, type LatLng } from './penModel';
import { todayIso } from '../trips/tripListModel';

export interface AreaSearchController {
  destroy(): void;
}

type AddResult = 'added' | 'dup' | 'fail';

const CHOICES: Array<{ label: string; cat?: Exclude<ExploreCat, 'all'>; query?: string }> = [
  { label: '맛집', cat: 'food' },
  { label: '카페', cat: 'cafe' },
  { label: '관광지', cat: 'sight' },
  { label: '쇼핑', query: 'shopping' },
  { label: '술집', query: 'bar' },
];

const ICON_AREA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9c0-3 3-5 7-5s7 2 7 5-2 4-2 7-2 4-5 4-6-2-6-5 1-3 1-6z" stroke-dasharray="2.5 2.5"/><circle cx="11" cy="11" r="2.5"/><path d="M13 13l3 3"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const LONG_PRESS_MS = 400;
const MOVE_TOLERANCE_PX = 6;

function kv(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function mountAreaSearch(opts: {
  g: any;
  map: any;
  toolsEl: HTMLElement;
  /** 결과 목록을 띄울 칸(왼쪽 체크인 칸) */
  panelHost: HTMLElement | null;
  /** 펜이 켜져 있으면 꾹 누르기를 무시한다 */
  isPenActive: () => boolean;
  /** [+] 담기 */
  onAdd: (p: ExplorePlace) => Promise<AddResult>;
}): AreaSearchController {
  const { g, map, toolsEl, panelHost, isPenActive, onAdd } = opts;
  const userId: string = store.get('user')?.id ?? 'anon';
  const mapDiv: HTMLElement = map.getDiv();

  let destroyed = false;
  let armed = false; // [영역 검색]을 눌러 다음 한 번 바로 그리기
  let drawing: LatLng[] | null = null;
  let liveLine: any = null;
  let area: LatLng[] | null = null;
  let areaShape: any = null;
  let lastLatLng: any = null;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressStart: { x: number; y: number } | null = null;

  let results: ExplorePlace[] = [];
  let sort: AreaSort = 'rating';
  let label = '';
  let loading = false;
  let error = '';
  const added = new Map<string, AddResult>();
  let pins: any[] = [];
  let hoverId: string | null = null;

  const popEl = document.createElement('div');
  popEl.className = 'bd-area-pop';
  popEl.hidden = true;
  mapDiv.appendChild(popEl);

  const panelEl = document.createElement('section');
  panelEl.className = 'bd-area-panel';
  panelEl.hidden = true;
  panelHost?.appendChild(panelEl);

  /* ── 도구 버튼 ── */
  function renderTool(): void {
    const left = remainingToday(kv(), userId, todayIso());
    toolsEl.innerHTML =
      '<button type="button" class="bd-tool-btn' + (armed ? ' on' : '') + '" data-tool="area" aria-pressed="' + armed + '" ' +
      'title="영역 검색 — 지도를 꾹 누른 채 영역을 그려도 돼요 (오늘 ' + left + '번 남음)">' + ICON_AREA + '<span>영역 검색</span></button>';
    toolsEl.querySelector('[data-tool="area"]')?.addEventListener('click', () => setArmed(!armed));
  }

  function setArmed(on: boolean): void {
    armed = on;
    map.setOptions(on ? { draggable: false, draggableCursor: 'crosshair' } : { draggable: true, draggableCursor: null });
    renderTool();
  }

  /* ── 그리기 ──
   * 버튼을 누른 채 움직이는 동안 구글 지도가 자기 mousemove를 안 줄 수 있어서, 화면 좌표 → 지도 좌표를
   * 직접 바꾼다(빈 OverlayView의 projection). projection이 없으면 지도 이벤트로 대신한다. */
  const listeners: any[] = [];
  let projOverlay: any = null;
  try {
    projOverlay = new g.maps.OverlayView();
    projOverlay.onAdd = () => undefined;
    projOverlay.draw = () => undefined;
    projOverlay.onRemove = () => undefined;
    projOverlay.setMap(map);
  } catch { projOverlay = null; }
  const pixelToLatLng = (clientX: number, clientY: number): any => {
    const proj = projOverlay?.getProjection?.();
    if (!proj?.fromContainerPixelToLatLng) return null;
    const r = mapDiv.getBoundingClientRect();
    return proj.fromContainerPixelToLatLng(new g.maps.Point(clientX - r.left, clientY - r.top));
  };
  const addPoint = (ll: any) => {
    if (!drawing || !ll) return;
    drawing.push([ll.lat(), ll.lng()]);
    liveLine?.getPath().push(ll);
  };
  listeners.push(map.addListener('mousemove', (e: any) => {
    if (e.latLng) lastLatLng = e.latLng;
    if (drawing && !projOverlay?.getProjection?.()) addPoint(e.latLng);
  }));
  listeners.push(map.addListener('mousedown', (e: any) => {
    if (e.latLng) lastLatLng = e.latLng;
    if (armed && !isPenActive()) beginDraw();
  }));

  function beginDraw(): void {
    if (!lastLatLng) return;
    clearArea();
    map.setOptions({ draggable: false, draggableCursor: 'crosshair' });
    drawing = [[lastLatLng.lat(), lastLatLng.lng()]];
    liveLine = new g.maps.Polyline({
      path: [lastLatLng], strokeColor: '#0B2A5C', strokeOpacity: 0.85, strokeWeight: 2, clickable: false, map, zIndex: 70,
    });
  }

  // 꾹 누르기 감지 — 지도 DOM에서 직접 본다(지도 끌기가 시작되기 전에 끌기를 끈다)
  const onDown = (e: MouseEvent) => {
    if (e.button !== 0 || armed || isPenActive() || drawing) return;
    if ((e.target as HTMLElement).closest('.bd-area-pop, .bd-pen-float, .gm-style-iw-c, button')) return;
    pressStart = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (pressStart) lastLatLng = pixelToLatLng(pressStart.x, pressStart.y) ?? lastLatLng;
      beginDraw();
      mapDiv.classList.add('bd-area-drawing');
    }, LONG_PRESS_MS);
  };
  const onMove = (e: MouseEvent) => {
    if (drawing) { const ll = pixelToLatLng(e.clientX, e.clientY); if (ll) addPoint(ll); }
    if (pressTimer && pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > MOVE_TOLERANCE_PX) {
      clearTimeout(pressTimer); // 움직였으면 평소 지도 끌기
      pressTimer = null;
    }
  };
  const onUp = () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressStart = null;
    if (drawing) finishDraw();
  };
  mapDiv.addEventListener('mousedown', onDown, true);
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseup', onUp);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (drawing) { liveLine?.setMap(null); liveLine = null; drawing = null; restoreDrag(); }
    else if (armed) setArmed(false);
    else if (!popEl.hidden) clearArea();
  };
  document.addEventListener('keydown', onKey);

  function restoreDrag(): void {
    mapDiv.classList.remove('bd-area-drawing');
    if (!isPenActive()) map.setOptions({ draggable: true, draggableCursor: null });
  }

  function finishDraw(): void {
    const pts = drawing ?? [];
    drawing = null;
    liveLine?.setMap(null);
    liveLine = null;
    if (armed) { armed = false; renderTool(); }
    restoreDrag();
    if (!isUsableArea(pts)) return;
    area = pts;
    areaShape = new g.maps.Polygon({
      paths: pts.map(([lat, lng]) => ({ lat, lng })),
      strokeColor: '#0B2A5C', strokeOpacity: 0.8, strokeWeight: 2,
      fillColor: '#2F80ED', fillOpacity: 0.08, clickable: false, map, zIndex: 40,
    });
    showPop();
  }

  /* ── 무엇을 찾을지 ── */
  function showPop(): void {
    const left = remainingToday(kv(), userId, todayIso());
    popEl.innerHTML =
      '<div class="bd-area-pop-head"><b>이 영역에서 찾기</b><span>오늘 ' + left + '/' + AREA_DAILY_LIMIT + '번 남음</span>' +
      '<button type="button" class="bd-area-x" data-act="close" aria-label="영역 지우기">' + ICON_CLOSE + '</button></div>' +
      '<div class="bd-area-chips">' +
      CHOICES.map((c, i) => '<button type="button" class="bd-area-chip" data-choice="' + i + '"' + (left ? '' : ' disabled') + '>' + c.label + '</button>').join('') +
      '</div>' +
      '<form class="bd-area-form"><input type="text" class="bd-area-input" placeholder="직접 입력 (예: 야경, 쌀국수)" maxlength="40"' + (left ? '' : ' disabled') + ' />' +
      '<button type="submit" class="bd-area-go"' + (left ? '' : ' disabled') + '>찾기</button></form>' +
      (left ? '' : '<p class="bd-area-limit">오늘 영역 검색을 다 썼어요. 내일 다시 쓸 수 있어요.</p>');
    popEl.hidden = false;
    popEl.querySelector('[data-act="close"]')?.addEventListener('click', clearArea);
    popEl.querySelectorAll<HTMLElement>('[data-choice]').forEach((b) => {
      b.addEventListener('click', () => { const c = CHOICES[Number(b.dataset.choice)]; void run(c.label, c.cat, c.query); });
    });
    popEl.querySelector('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = (popEl.querySelector('.bd-area-input') as HTMLInputElement).value.trim();
      if (q) void run(q, undefined, q);
    });
    (popEl.querySelector('.bd-area-input') as HTMLInputElement | null)?.focus({ preventScroll: true });
  }

  async function run(name: string, cat?: Exclude<ExploreCat, 'all'>, query?: string): Promise<void> {
    if (!area || loading) return;
    if (remainingToday(kv(), userId, todayIso()) <= 0) { showPop(); return; }
    const { center, radius } = coveringCircle(area);
    label = name;
    loading = true;
    error = '';
    results = [];
    added.clear();
    renderPanel();
    try {
      const key = 'area:' + (cat ?? 'q:' + query) + ':' + center.lat.toFixed(4) + ',' + center.lng.toFixed(4) + ':' + radius;
      const found = cat ? await searchNearbyCat(key, cat, center, radius) : await searchText(key, query ?? name, center, radius);
      useOne(kv(), userId, todayIso());
      if (destroyed) return;
      results = found;
    } catch (e) {
      console.warn('[area] 검색 실패:', e);
      error = '검색하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    }
    loading = false;
    popEl.hidden = true;
    renderTool();
    renderPanel();
  }

  /* ── 결과 목록(왼쪽) + 지도 번호 핀 ── */
  function sorted(): ExplorePlace[] {
    return area ? filterAndSort(results, area, sort) : [];
  }

  function renderPanel(): void {
    if (!panelHost) return;
    const list = sorted();
    const c = area ? coveringCircle(area).center : null;
    panelHost.classList.toggle('is-area', true);
    panelEl.hidden = false;
    panelEl.innerHTML =
      '<div class="bd-area-panel-head">' +
      '<div><p class="bd-area-eyebrow">AREA SEARCH</p><h3>' + escapeHtml(label) + (loading ? '' : ' <em>' + list.length + '곳</em>') + '</h3></div>' +
      '<button type="button" class="bd-area-x" data-act="close" aria-label="영역 검색 닫기">' + ICON_CLOSE + '</button></div>' +
      '<div class="bd-area-sorts" role="tablist">' +
      AREA_SORTS.map((s) => '<button type="button" role="tab" class="bd-area-sort' + (s.key === sort ? ' on' : '') + '" data-sort="' + s.key + '" aria-selected="' + (s.key === sort) + '">' + s.label + '</button>').join('') +
      '</div>' +
      '<ol class="bd-area-list">' +
      (loading ? '<li class="bd-area-empty">찾는 중…</li>'
        : error ? '<li class="bd-area-empty">' + escapeHtml(error) + '</li>'
        : !list.length ? '<li class="bd-area-empty">이 영역 안에서 찾은 곳이 없어요.<br/>영역을 넓히거나 다른 걸 찾아보세요.</li>'
        : list.map((p, i) => {
          const st = added.get(p.id);
          const dist = c ? formatDistance(haversineMeters([c.lat, c.lng], [p.lat, p.lng])) : '';
          return '<li class="bd-area-item' + (hoverId === p.id ? ' hover' : '') + '" data-id="' + escapeHtml(p.id) + '">' +
            '<span class="bd-area-num">' + (i + 1) + '</span>' +
            '<div class="bd-area-info"><b>' + escapeHtml(p.name) + '</b>' +
            '<small>' + (p.rating != null ? '★ ' + p.rating.toFixed(1) + (p.ratingCount ? ' (' + p.ratingCount.toLocaleString('ko-KR') + ')' : '') + ' · ' : '') +
            '가운데서 ' + dist + (p.typeLabel ? ' · ' + escapeHtml(p.typeLabel) : '') + '</small></div>' +
            '<button type="button" class="bd-area-add' + (st === 'added' || st === 'dup' ? ' done' : '') + '" data-add="' + escapeHtml(p.id) + '"' +
            (st === 'added' || st === 'dup' ? ' disabled' : '') + ' aria-label="' + escapeHtml(p.name) + ' 체크인에 담기">' +
            (st === 'added' ? '담음' : st === 'dup' ? '있음' : st === 'fail' ? '다시' : '+') + '</button></li>';
        }).join('')) +
      '</ol>';

    panelEl.querySelector('[data-act="close"]')?.addEventListener('click', clearArea);
    panelEl.querySelectorAll<HTMLElement>('[data-sort]').forEach((b) => {
      b.addEventListener('click', () => { sort = b.dataset.sort as AreaSort; renderPanel(); });
    });
    panelEl.querySelectorAll<HTMLElement>('.bd-area-item').forEach((li) => {
      li.addEventListener('mouseenter', () => setHover(li.dataset.id ?? null, false));
      li.addEventListener('mouseleave', () => setHover(null, false));
      li.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        const p = results.find((x) => x.id === li.dataset.id);
        if (p) map.panTo({ lat: p.lat, lng: p.lng });
      });
    });
    panelEl.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) => {
      b.addEventListener('click', async () => {
        const p = results.find((x) => x.id === b.dataset.add);
        if (!p) return;
        b.disabled = true;
        b.textContent = '…';
        added.set(p.id, await onAdd(p));
        renderPanel();
      });
    });
    drawPins(list);
  }

  function pinIcon(n: number, on: boolean): any {
    const size = on ? 26 : 20;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 20 20">' +
      '<circle cx="10" cy="10" r="9" fill="' + (on ? '#2F80ED' : '#0B2A5C') + '" stroke="#fff" stroke-width="2"/>' +
      '<text x="10" y="10.5" text-anchor="middle" dominant-baseline="central" font-family="-apple-system,Segoe UI,sans-serif" font-size="' + (n > 9 ? 8 : 10) + '" font-weight="700" fill="#fff">' + n + '</text></svg>';
    return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new g.maps.Size(size, size), anchor: new g.maps.Point(size / 2, size / 2) };
  }

  function drawPins(list: ExplorePlace[]): void {
    pins.forEach((m) => m.setMap(null));
    pins = list.map((p, i) => {
      const m = new g.maps.Marker({ position: { lat: p.lat, lng: p.lng }, map, icon: pinIcon(i + 1, hoverId === p.id), zIndex: 1300 + (hoverId === p.id ? 100 : 0), title: p.name });
      m.addListener('mouseover', () => setHover(p.id, true));
      m.addListener('mouseout', () => setHover(null, true));
      (m as any).__areaId = p.id;
      return m;
    });
  }

  function setHover(id: string | null, fromMap: boolean): void {
    if (hoverId === id) return;
    hoverId = id;
    pins.forEach((m, i) => {
      const on = (m as any).__areaId === id;
      m.setIcon(pinIcon(i + 1, on));
      m.setZIndex(1300 + (on ? 100 : 0));
    });
    panelEl.querySelectorAll<HTMLElement>('.bd-area-item').forEach((li) => {
      const on = li.dataset.id === id;
      li.classList.toggle('hover', on);
      if (on && fromMap) li.scrollIntoView({ block: 'nearest' });
    });
  }

  function clearArea(): void {
    areaShape?.setMap(null);
    areaShape = null;
    area = null;
    popEl.hidden = true;
    pins.forEach((m) => m.setMap(null));
    pins = [];
    results = [];
    hoverId = null;
    panelEl.hidden = true;
    panelEl.innerHTML = '';
    panelHost?.classList.remove('is-area');
  }

  renderTool();

  return {
    destroy() {
      destroyed = true;
      clearArea();
      if (pressTimer) clearTimeout(pressTimer);
      liveLine?.setMap(null);
      mapDiv.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey);
      listeners.forEach((l) => l?.remove?.());
      projOverlay?.setMap?.(null);
      if (armed) map.setOptions({ draggable: true, draggableCursor: null });
      popEl.remove();
      panelEl.remove();
      toolsEl.innerHTML = '';
    },
  };
}
