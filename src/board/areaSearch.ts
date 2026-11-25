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
import { fetchDetail, searchNearbyCat, searchText, type ExploreDetail, type ExplorePlace } from '../mobile/exploreApi';
import type { ExploreCat } from '../mobile/explore';
import {
  AREA_DAILY_LIMIT, AREA_SORTS, TOP_RANKS, coveringCircle, filterAndSort, isUsableArea, rankColor, remainingToday, tint, useOne, type AreaSort,
} from './areaModel';
import type { LatLng } from './penModel';
import { todayIso } from '../trips/tripListModel';
import { createProjector, isOverlayUi } from './mapPixel';
import { fetchMyPlan } from '../assistant/assistantClient';
import { navigate } from '../router';

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
/** 1위 번호 동그라미 오른쪽 위에 비스듬히 얹는 작은 왕관(금색 + 흰 테두리로 어떤 배경에서도 또렷하게) */
const CROWN_PATH = 'M3 17.5 L1.5 6.5 L7 10.5 L12 3 L17 10.5 L22.5 6.5 L21 17.5 Z';
/** 순위별 왕관 색 — 1위 금, 2위 은, 3위 동 (밝은 면, 어두운 띠, 꼭짓점 구슬) */
const CROWN_TONES = [
  { main: '#F5C04A', band: '#E0A526', gem: '#FFE08A', edge: '#E0A526' },
  { main: '#C9D1DB', band: '#9AA6B4', gem: '#F1F5F9', edge: '#9AA6B4' },
  { main: '#D99A6C', band: '#B87444', gem: '#F3C9A8', edge: '#B87444' },
] as const;
function crown(rank: number): string {
  const t = CROWN_TONES[rank];
  return '<svg class="bd-area-crown" viewBox="0 0 24 21" aria-hidden="true"><path d="' + CROWN_PATH + '" fill="' + t.main + '" stroke="#FFFFFF" stroke-width="2.2" stroke-linejoin="round"/><path d="M3.6 15.2h16.8" stroke="' + t.band + '" stroke-width="1.6"/><circle cx="12" cy="3" r="1.6" fill="' + t.gem + '"/></svg>';
}
function crownInline(rank: number): string {
  const t = CROWN_TONES[rank];
  return '<svg class="bd-area-crown-inline" viewBox="0 0 24 21" aria-hidden="true"><path d="' + CROWN_PATH + '" fill="' + t.main + '" stroke="' + t.edge + '" stroke-width="1.2" stroke-linejoin="round"/></svg>';
}
/** 구글이 업종 이름을 안 줄 때 쓰는 한국어 분류 */
const CAT_LABEL: Record<ExplorePlace['cat'], string> = { food: '음식점', cafe: '카페', sight: '관광지', stay: '숙소', amenity: '편의시설' };
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

  /* ── PRO 전용(2026-11 사용자 결정) ──
   * 요금제는 화면 표시용으로 한 번 읽어 둔다. 확인되기 전·실패하면 무료로 본다(유료 기능을 실수로 열지 않는다).
   * 주의: 이 검색은 브라우저가 구글 지도 서비스를 직접 부르는 구조라 이 잠금은 화면 수준이다 — 서버가 막는 게 아니다.
   * (구글 키는 사이트 주소로 제한돼 있어 다른 곳에서는 못 쓴다. 서버에서 막으려면 검색을 서버로 옮겨야 한다) */
  let isPro = false;
  void fetchMyPlan().then((p) => {
    if (destroyed) return;
    isPro = p === 'pro';
    renderTool();
  });

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
      'title="' + (isPro ? '영역 검색 — 지도를 꾹 누른 채 영역을 그려도 돼요 (오늘 ' + left + '번 남음)' : '영역 검색은 PRO 전용이에요') + '">' +
      ICON_AREA + '<span>영역 검색</span>' + (isPro ? '' : '<i class="bd-pro-chip">PRO</i>') + '</button>';
    toolsEl.querySelector('[data-tool="area"]')?.addEventListener('click', () => setArmed(!armed));
  }

  /** 무료 사용자에게 보이는 안내 — 지도 위 선택 창 자리를 쓴다 */
  function showUpsell(): void {
    popEl.innerHTML =
      '<div class="bd-area-pop-head"><b>영역 검색은 PRO 전용이에요</b><span></span>' +
      '<button type="button" class="bd-area-x" data-act="close" aria-label="닫기">' + ICON_CLOSE + '</button></div>' +
      '<p class="bd-area-upsell">지도에서 영역을 그리면 그 안의 맛집·카페·관광지를 평점순으로 모아서 보여 줘요.</p>' +
      '<div class="bd-area-upsell-actions"><button type="button" class="bd-area-go" data-act="pro">PRO 알아보기</button></div>';
    popEl.hidden = false;
    popEl.querySelector('[data-act="close"]')?.addEventListener('click', () => { popEl.hidden = true; });
    popEl.querySelector('[data-act="pro"]')?.addEventListener('click', () => navigate('pro'));
  }

  function setArmed(on: boolean): void {
    if (on && !isPro) { showUpsell(); return; }
    armed = on;
    // 지도 끌기는 끄지 않는다(끄면 휠 확대·축소도 막힌다) — 누르기는 아래 onDown이 먼저 받는다
    mapDiv.classList.toggle('bd-area-armed', on);
    renderTool();
  }

  /* ── 그리기 — 브라우저 포인터 이벤트 + 화면→지도 좌표(mapPixel) ── */
  const projector = createProjector(g, map);
  /** 꾹 누르기로 시작한 그리기 동안만 지도 끌기를 잠깐 끈다(버튼을 누른 채라 구글이 끌기로 받아 버리므로) */
  let dragLocked = false;

  function beginDraw(clientX: number, clientY: number): boolean {
    if (!isPro) return false;
    const ll = projector.toLatLng(clientX, clientY);
    if (!ll) return false;
    clearArea();
    drawing = [[ll.lat(), ll.lng()]];
    liveLine = new g.maps.Polyline({
      path: [ll], strokeColor: '#0B2A5C', strokeOpacity: 0.85, strokeWeight: 2, clickable: false, map, zIndex: 70,
    });
    mapDiv.classList.add('bd-area-drawing');
    return true;
  }

  const onDown = (e: PointerEvent | MouseEvent) => {
    if ((e as MouseEvent).button !== 0 || isPenActive() || isOverlayUi(e.target)) return;
    if (armed) {
      // [영역 검색]을 누른 뒤 — 바로 그린다. 지도·핀으로 보내지 않는다
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      if (!drawing) beginDraw(e.clientX, e.clientY);
      return;
    }
    // 무료 사용자는 꾹 누르기를 영역 그리기로 쓰지 않는다(지도는 평소처럼 움직이고, 안내 창도 띄우지 않는다)
    if (!isPro || drawing || pressTimer) return;
    pressStart = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (!pressStart) return;
      if (beginDraw(pressStart.x, pressStart.y)) {
        dragLocked = true;
        map.setOptions({ draggable: false });
      }
    }, LONG_PRESS_MS);
  };
  const onMove = (e: PointerEvent | MouseEvent) => {
    if (drawing) {
      const ll = projector.toLatLng(e.clientX, e.clientY);
      if (ll) { drawing.push([ll.lat(), ll.lng()]); liveLine?.getPath().push(ll); }
      return;
    }
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
  const swallowClick = (e: Event) => {
    if (armed || drawing) { e.stopPropagation(); }
  };
  mapDiv.addEventListener('pointerdown', onDown, true);
  mapDiv.addEventListener('mousedown', onDown, true);
  mapDiv.addEventListener('click', swallowClick, true);
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('mouseup', onUp, true);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (drawing) { liveLine?.setMap(null); liveLine = null; drawing = null; restoreDrag(); }
    else if (armed) setArmed(false);
    else if (!popEl.hidden) clearArea();
  };
  document.addEventListener('keydown', onKey);

  function restoreDrag(): void {
    mapDiv.classList.remove('bd-area-drawing');
    if (dragLocked) { dragLocked = false; map.setOptions({ draggable: true }); }
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
    if (!area || loading || !isPro) return;
    if (remainingToday(kv(), userId, todayIso()) <= 0) { showPop(); return; }
    const { center, radius } = coveringCircle(area);
    label = name;
    loading = true;
    error = '';
    results = [];
    added.clear();
    closeDetail();
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

  /* ── 상세 — 지도 왼쪽에 크게 뜨는 패널(목록 칸 안에 펼치면 좁아서 잘렸다) ──
   * 사진·한국어 소개·리뷰·구글 지도 링크·[+ 담기]. 주소·전화·영업시간은 뺐다(사용자 결정).
   * 상세는 처음 열 때 한 번 받고 이 기기에 남는다(exploreApi 캐시). */
  let openId: string | null = null;
  const details = new Map<string, ExploreDetail | 'loading' | 'error'>();
  const detailEl = document.createElement('aside');
  detailEl.className = 'bd-area-sheet';
  detailEl.hidden = true;
  mapDiv.appendChild(detailEl);
  // 패널은 지도 안에 떠 있어서, 그대로 두면 패널 위 휠·끌기를 지도가 가져가 확대·이동해 버린다 →
  // 패널 안에서 일어난 입력은 지도로 올려 보내지 않는다(패널 안 스크롤이 된다)
  for (const type of ['wheel', 'pointerdown', 'mousedown', 'touchstart', 'dblclick', 'contextmenu']) {
    detailEl.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
  }
  // 마우스로 끌어서 내리기 — 리뷰처럼 긴 내용을 휠 없이도 볼 수 있게(링크·버튼 위에서는 평소대로 누름)
  let dragScroll: { y: number; top: number; el: HTMLElement; moved: boolean } | null = null;
  detailEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('a, button')) return;
    const body = detailEl.querySelector('.bd-area-sheet-body') as HTMLElement | null;
    if (!body || !body.contains(e.target as Node)) return;
    dragScroll = { y: e.clientY, top: body.scrollTop, el: body, moved: false };
  });
  const onDragMove = (e: PointerEvent) => {
    if (!dragScroll) return;
    const dy = e.clientY - dragScroll.y;
    if (!dragScroll.moved && Math.abs(dy) < 4) return;
    dragScroll.moved = true;
    dragScroll.el.classList.add('is-dragging');
    dragScroll.el.scrollTop = dragScroll.top - dy;
  };
  const onDragEnd = () => {
    dragScroll?.el.classList.remove('is-dragging');
    dragScroll = null;
  };
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);

  function addBtnHtml(p: ExplorePlace, big = false): string {
    const st = added.get(p.id);
    const done = st === 'added' || st === 'dup';
    const text = st === 'added' ? '담음' : st === 'dup' ? '이미 있음' : st === 'fail' ? '다시' : big ? '+ 체크인에 담기' : '+';
    return '<button type="button" class="' + (big ? 'bd-area-add-big' : 'bd-area-add') + (done ? ' done' : '') + '" data-add="' + escapeHtml(p.id) + '"' +
      (done ? ' disabled' : '') + ' aria-label="' + escapeHtml(p.name) + ' 체크인에 담기">' + text + '</button>';
  }

  function bindAddButtons(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) => {
      b.addEventListener('click', async () => {
        const p = results.find((x) => x.id === b.dataset.add);
        if (!p) return;
        b.disabled = true;
        b.textContent = '…';
        added.set(p.id, await onAdd(p));
        renderPanel();
        if (openId === p.id) renderDetail();
      });
    });
  }

  async function loadDetail(p: ExplorePlace): Promise<void> {
    if (details.has(p.id) && details.get(p.id) !== 'error') return;
    details.set(p.id, 'loading');
    try {
      details.set(p.id, await fetchDetail(p.id));
    } catch (e) {
      console.warn('[area] 상세 실패:', e);
      details.set(p.id, 'error');
    }
    if (!destroyed && openId === p.id) renderDetail();
  }

  function toggleDetail(p: ExplorePlace): void {
    openId = openId === p.id ? null : p.id;
    renderPanel();
    if (!openId) { closeDetail(); return; }
    renderDetail();
    void loadDetail(p);
    // 패널이 지도 왼쪽을 가리므로, 장소가 패널 오른쪽 보이는 곳 가운데에 오게 옮긴다
    map.panTo({ lat: p.lat, lng: p.lng });
    const w = detailEl.getBoundingClientRect().width;
    if (w && typeof map.panBy === 'function') map.panBy(-Math.round(w / 2), 0);
  }

  function closeDetail(): void {
    openId = null;
    detailEl.hidden = true;
    detailEl.innerHTML = '';
    panelEl.querySelectorAll('.bd-area-item.open').forEach((li) => li.classList.remove('open'));
  }

  function renderDetail(): void {
    const p = results.find((x) => x.id === openId);
    if (!p) { closeDetail(); return; }
    const list = sorted();
    const i = list.findIndex((x) => x.id === p.id);
    const color = rankColor(Math.max(0, i), list.length);
    const d = details.get(p.id);
    const ready = d && d !== 'loading' && d !== 'error' ? d : null;
    const photos = ready ? ready.photos.map((x) => x.url) : [];
    if (!photos.length && p.photo) photos.push(p.photo);
    // 리뷰는 한국어를 먼저, 최대 3개
    const reviews = ready ? [...ready.reviews].sort((a, b) => Number(/[가-힣]/.test(b.text)) - Number(/[가-힣]/.test(a.text))).slice(0, 3) : [];
    detailEl.style.setProperty('--rank', color);
    detailEl.innerHTML =
      '<button type="button" class="bd-area-x bd-area-sheet-x" data-act="close-detail" aria-label="상세 닫기">' + ICON_CLOSE + '</button>' +
      (photos.length
        ? '<div class="bd-area-sheet-photos">' +
          '<div class="bd-area-sheet-hero" style="background-image:url(\'' + escapeHtml(photos[0]) + '\')"></div>' +
          (photos.length > 1 ? '<div class="bd-area-sheet-thumbs">' + photos.slice(1, 4).map((u) => '<div style="background-image:url(\'' + escapeHtml(u) + '\')"></div>').join('') + '</div>' : '') +
          '</div>'
        : '') +
      '<div class="bd-area-sheet-body">' +
      (i >= 0 ? '<span class="bd-area-sheet-rank">' + (i < TOP_RANKS ? crownInline(i) : '') + (i + 1) + '위</span>' : '') +
      '<h3>' + escapeHtml(p.name) + '</h3>' +
      '<p class="bd-area-sheet-meta"><b>' + (p.rating != null ? '★ ' + p.rating.toFixed(1) : '평점 없음') + '</b>' +
      (p.ratingCount ? ' · 리뷰 ' + p.ratingCount.toLocaleString('ko-KR') : '') + ' · ' + escapeHtml(p.typeLabel ?? CAT_LABEL[p.cat]) +
      (p.openNow === true ? ' · <span class="bd-area-open">영업 중</span>' : p.openNow === false ? ' · <span class="bd-area-closed">영업 종료</span>' : '') + '</p>' +
      (d === 'loading' || !d ? '<p class="bd-area-muted">정보를 불러오는 중…</p>'
        : d === 'error' ? '<p class="bd-area-muted">상세 정보를 불러오지 못했어요.</p>'
        : '<p class="bd-area-sheet-summary">' + (ready!.summary ? escapeHtml(ready!.summary) : '<span class="bd-area-muted">구글에 등록된 소개글이 없어요. 아래 리뷰를 참고해 주세요.</span>') + '</p>' +
          (reviews.length
            ? '<h4>리뷰</h4>' + reviews.map((r) =>
              '<blockquote class="bd-area-review"><span>' + (r.rating != null ? '★' + r.rating + ' · ' : '') + escapeHtml(r.author) + (r.when ? ' · ' + escapeHtml(r.when) : '') + '</span>' + escapeHtml(r.text) + '</blockquote>').join('')
            : '') +
          '<div class="bd-area-links">' +
          (ready!.mapsUrl ? '<a href="' + escapeHtml(ready!.mapsUrl) + '" target="_blank" rel="noopener">구글 지도에서 보기</a>' : '') +
          (ready!.website ? '<a href="' + escapeHtml(ready!.website) + '" target="_blank" rel="noopener">웹사이트</a>' : '') +
          '</div>') +
      '</div>' +
      '<div class="bd-area-sheet-foot">' + addBtnHtml(p, true) + '</div>';
    detailEl.hidden = false;
    detailEl.querySelector('[data-act="close-detail"]')?.addEventListener('click', () => { closeDetail(); renderPanel(); });
    bindAddButtons(detailEl);
  }

  function renderPanel(): void {
    if (!panelHost) return;
    const list = sorted();
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
          const color = rankColor(i, list.length);
          const top = i < TOP_RANKS;
          // 두 번째 줄 — 무엇을 하는 곳인지(한국어 업종) · 영업 여부. 거리·가격대는 뺐다(사용자 결정)
          const kind = escapeHtml(p.typeLabel ?? CAT_LABEL[p.cat]);
          const openTxt = p.openNow === true ? '<span class="bd-area-open">영업 중</span>' : p.openNow === false ? '<span class="bd-area-closed">영업 종료</span>' : '';
          return '<li class="bd-area-item' + (top ? ' top' : '') + (hoverId === p.id ? ' hover' : '') + (openId === p.id ? ' open' : '') + '" data-id="' + escapeHtml(p.id) + '"' +
            ' style="--rank:' + color + ';--rank-bg:' + tint(color, 0.12) + ';--rank-bg2:' + tint(color, 0.22) + '">' +
            '<span class="bd-area-num">' + String(i + 1) + (i < TOP_RANKS ? crown(i) : '') + '</span>' +
            '<div class="bd-area-info"><b><span class="bd-area-name">' + escapeHtml(p.name) + '</span>' + (top ? '<i class="bd-area-rankchip">' + (i + 1) + '위</i>' : '') + '</b>' +
            '<small class="bd-area-rating">' + (p.rating != null ? '★ ' + p.rating.toFixed(1) + (p.ratingCount ? ' · 리뷰 ' + p.ratingCount.toLocaleString('ko-KR') : '') : '평점 없음') + '</small>' +
            '<small>' + kind + (openTxt ? ' · ' + openTxt : '') + '</small></div>' +
            addBtnHtml(p) +
            '</li>';
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
        if ((e.target as HTMLElement).closest('button, a')) return;
        const p = results.find((x) => x.id === li.dataset.id);
        if (p) toggleDetail(p);
      });
    });
    bindAddButtons(panelEl);
    drawPins(list);
  }

  function pinIcon(n: number, total: number, on: boolean): any {
    const top = n <= TOP_RANKS;
    const size = (top ? 30 : 22) + (on ? 6 : 0);
    const c1 = rankColor(n - 1, total);
    const c2 = rankColor(Math.min(total - 1, n - 1 + 0.6), total);
    const ring = top ? '<circle cx="20" cy="20" r="19" fill="#FFFFFF"/><circle cx="20" cy="20" r="17.5" fill="none" stroke="' + c1 + '" stroke-width="2"/>' : '<circle cx="20" cy="20" r="18" fill="#FFFFFF"/>';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 40 40">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs>' +
      ring + '<circle cx="20" cy="20" r="' + (top ? 14 : 15) + '" fill="url(#g)"/>' +
      '<text x="20" y="21" text-anchor="middle" dominant-baseline="central" font-family="-apple-system,Segoe UI,sans-serif" font-size="' + (n > 9 ? 13 : 15) + '" font-weight="800" fill="#fff">' + n + '</text></svg>';
    return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new g.maps.Size(size, size), anchor: new g.maps.Point(size / 2, size / 2) };
  }

  function drawPins(list: ExplorePlace[]): void {
    pins.forEach((m) => m.setMap(null));
    pins = list.map((p, i) => {
      const m = new g.maps.Marker({ position: { lat: p.lat, lng: p.lng }, map, icon: pinIcon(i + 1, list.length, hoverId === p.id), zIndex: 1300 + (list.length - i) + (hoverId === p.id ? 100 : 0), title: p.name });
      m.addListener('mouseover', () => setHover(p.id, true));
      m.addListener('mouseout', () => setHover(null, true));
      m.addListener('click', () => toggleDetail(p));
      (m as any).__areaId = p.id;
      return m;
    });
  }

  function setHover(id: string | null, fromMap: boolean): void {
    if (hoverId === id) return;
    hoverId = id;
    pins.forEach((m, i) => {
      const on = (m as any).__areaId === id;
      m.setIcon(pinIcon(i + 1, pins.length, on));
      m.setZIndex(1300 + (pins.length - i) + (on ? 100 : 0));
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
    closeDetail();
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
      mapDiv.removeEventListener('pointerdown', onDown, true);
      mapDiv.removeEventListener('mousedown', onDown, true);
      mapDiv.removeEventListener('click', swallowClick, true);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('mouseup', onUp, true);
      document.removeEventListener('keydown', onKey);
      restoreDrag();
      mapDiv.classList.remove('bd-area-armed');
      projector.destroy();
      popEl.remove();
      panelEl.remove();
      detailEl.remove();
      document.removeEventListener('pointermove', onDragMove);
      document.removeEventListener('pointerup', onDragEnd);
      toolsEl.innerHTML = '';
    },
  };
}
