import { supabase } from '../supabase';
import { store } from '../store';
import type { Database } from '../types/database';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { loadGoogleMapsScript, extractPlaceResult, suggestGateFromCategory, getPlacePredictions, getPlaceDetails, getCategoryLabel } from '../utils/googleMaps';
import type { GooglePlaceResult, PlacePrediction } from '../utils/googleMaps';
import './board.css';

type Place = Database['public']['Tables']['places']['Row'];

interface GateConfig {
  key: string;      // mood 값 (DB 저장값)
  step: string;     // GATE 01 등
  label: string;
  icon: string;
}

const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21C12 21 19 14.5 19 9.5C19 5.9 15.9 3 12 3C8.1 3 5 5.9 5 9.5C5 14.5 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.2"/></svg>';
const ICON_FORK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v6a2 2 0 0 0 4 0V3M9 11v10M17 3c-1.5 1-2 3-2 5s1 3 2 3 2-1 2-3-0.5-4-2-5zM17 11v10"/></svg>';
const ICON_TICKET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.5a1.5 1.5 0 0 0 0 3V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a1.5 1.5 0 0 0 0-3V9z"/></svg>';
const ICON_STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.8 6.3.6-4.8 4.2 1.4 6.2L12 16.9l-5.5 2.9 1.4-6.2-4.8-4.2 6.3-.6z"/></svg>';
const ICON_STAR_FILL = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.6 5.8 6.3.6-4.8 4.2 1.4 6.2L12 16.9l-5.5 2.9 1.4-6.2-4.8-4.2 6.3-.6z"/></svg>';
const ICON_BED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8M2 20v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3M2 20h20M6 10V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
const ICON_CLEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>';
const ICON_PLANE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12L22 5L15 22L11 14L2 12Z"/></svg>';
const ICON_SCAN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18"/></svg>';
const ICON_KEBAB = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
const ICON_MOVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg>';
const ICON_BACK_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const ICON_COMMENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';

const GATES: GateConfig[] = [
  { key: '가고싶어', step: 'GATE 01', label: 'VISIT',    icon: ICON_PIN },
  { key: '먹고싶어', step: 'GATE 02', label: 'FOOD',     icon: ICON_FORK },
  { key: '하고싶어', step: 'GATE 03', label: 'ACTIVITY', icon: ICON_TICKET },
  { key: '숙소',     step: 'GATE 04', label: 'STAY',     icon: ICON_BED },
];

/* ── 규칙 기반 분류 (진짜 AI 아님) ──
 * 키워드 매칭 점수로 게이트를 추천. 향후 Gemini 연동 시 이 함수만 교체하면 됨. */
interface Suggestion { gate: string; label: string; confidence: number; }

const KEYWORD_RULES: Array<{ gate: string; words: string[] }> = [
  { gate: '먹고싶어', words: ['맛집', '식당', '카페', '라멘', '스시', '고기', '디저트', '빵집', '브런치', '이자카야', '음식', '먹'] },
  { gate: '가고싶어', words: ['야경', '전망', '박물관', '미술관', '공원', '타워', '신사', '절', '사원', '전망대', '해변', '다리', '브릿지', '성당'] },
  { gate: '하고싶어', words: ['체험', '액티비티', '투어', '클래스', '공연', '쇼핑', '테마파크', '놀이', '스파', '마사지', '클럽'] },
  { gate: '숙소',     words: ['호텔', '숙소', '게스트하우스', '에어비앤비', '리조트', '펜션', '모텔', '호스텔', '체크인', '숙박'] },
];

function classify(text: string): Suggestion | null {
  const lower = text.toLowerCase();
  let best: { gate: string; score: number } | null = null;

  for (const rule of KEYWORD_RULES) {
    const hits = rule.words.filter((w) => lower.includes(w.toLowerCase())).length;
    if (hits === 0) continue;
    const score = Math.min(0.5 + hits * 0.25, 0.95);
    if (!best || score > best.score) best = { gate: rule.gate, score };
  }

  if (!best) return null;
  const gateConfig = GATES.find((g) => g.key === best!.gate);
  if (!gateConfig) return null;
  return { gate: best.gate, label: gateConfig.label, confidence: Math.round(best.score * 100) };
}

/** Google 카테고리가 있으면 그걸 우선, 없으면 키워드 규칙으로 폴백 */
function classifyPlace(place: Pick<Place, 'name' | 'category'>): Suggestion | null {
  if (place.category) {
    const gate = suggestGateFromCategory(place.category);
    if (gate) {
      const gateConfig = GATES.find((g) => g.key === gate);
      if (gateConfig) return { gate, label: gateConfig.label, confidence: 90 };
    }
  }
  return classify(place.name);
}

/** 문자열 zone key ↔ DB mood 값 변환. 인박스는 '' 로 표현, DB에는 null 저장 */
function zoneToMood(zone: string): string | null {
  return zone === '' ? null : zone;
}

function zoneListId(mood: string | null): string {
  return mood === null ? 'inbox-list' : 'glist-' + mood;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ── 최근 내가 직접 반영한 변경 id (realtime 에코 중복 처리 방지) ── */
const recentlyMutatedIds = new Set<string>();
function markRecentlyMutated(id: string): void {
  recentlyMutatedIds.add(id);
  setTimeout(() => recentlyMutatedIds.delete(id), 2500);
}

/* ── 삭제 대기(Undo) 상태 ── */
interface PendingDelete {
  timer: ReturnType<typeof setTimeout>;
  toastEl: HTMLElement;
}
const pendingDeletes = new Map<string, PendingDelete>();

/* ── Realtime 채널 (게이트 전환 시 workspace.ts에서 teardownBoard 호출) ── */
let realtimeChannel: RealtimeChannel | null = null;
let securityEl: HTMLElement | null = null;
let placesCache = new Map<string, Place>(); // id → 최신 place 데이터 (rebuild 용)
let boardGeneration = 0; // 렌더링마다 증가 — 오래된 렌더의 비동기 콜백을 걸러내는 용도

/* ── 커스텀 자동완성 드롭다운 상태 ── */
let acDropdownEl: HTMLElement | null = null;
let acDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let acPredictions: PlacePrediction[] = [];
let acActiveIndex = -1;
let acDocClickHandler: ((e: MouseEvent) => void) | null = null;

/* ── 같은 게이트 내 재정렬 상태 ── */
let draggingEl: HTMLElement | null = null;
let draggingFromZone = '';

export function teardownBoard(): void {
  boardGeneration++; // 진행 중인 재시도/콜백을 즉시 무효화
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  pendingDeletes.forEach((p) => clearTimeout(p.timer));
  pendingDeletes.clear();
  securityEl = null;
  placesCache = new Map();
  cleanupAutocomplete();
}

/** 자동완성 드롭다운/디바운스 타이머 정리 */
function cleanupAutocomplete(): void {
  if (acDebounceTimer) clearTimeout(acDebounceTimer);
  acDebounceTimer = null;
  closeAcDropdown();
  if (acDocClickHandler) {
    document.removeEventListener('click', acDocClickHandler);
    acDocClickHandler = null;
  }
}

function closeAcDropdown(): void {
  acDropdownEl?.remove();
  acDropdownEl = null;
  acPredictions = [];
  acActiveIndex = -1;
}

async function loadPlaces(tripId: string): Promise<Place[]> {
  const { data, error } = await supabase
    .from('places')
    .select('*')
    .eq('trip_id', tripId)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('Ideas load error:', error.message);
    return [];
  }
  return data ?? [];
}

/** 일반 텍스트 아이디어 추가 (Google 데이터 없음) */
async function addIdea(tripId: string, mood: string | null, text: string): Promise<Place | null> {
  const user = store.get('user');
  const { data, error } = await supabase
    .from('places')
    .insert({
      trip_id: tripId,
      name: text,
      mood,
      status: 'idea',
      is_idea: true,
      added_by: user?.id ?? null,
      sort_order: Math.floor(Date.now() / 1000),
    })
    .select()
    .single();

  if (error) {
    console.error('Idea add error:', error.message);
    return null;
  }
  return data;
}

/** Google Place 자동완성으로 선택된 장소를 리치 데이터와 함께 저장 */
async function addRichIdea(tripId: string, mood: string | null, g: GooglePlaceResult): Promise<Place | null> {
  const user = store.get('user');
  const { data, error } = await supabase
    .from('places')
    .insert({
      trip_id: tripId,
      name: g.name,
      mood,
      status: 'idea',
      is_idea: false,
      added_by: user?.id ?? null,
      sort_order: Math.floor(Date.now() / 1000),
      address: g.address,
      lat: g.lat,
      lng: g.lng,
      google_place_id: g.place_id,
      google_rating: g.rating,
      category: g.category,
      photo_url: g.photoUrl,
      opening_hours: g.openingHours,
    })
    .select()
    .single();

  if (error) {
    console.error('Rich idea add error:', error.message);
    return null;
  }

  // 크라우드소싱 캐싱: 다음 사용자를 위해 places_db에도 저장 (실패해도 무시)
  cacheToPlacesDb(g).catch(() => {});

  return data;
}

async function cacheToPlacesDb(g: GooglePlaceResult): Promise<void> {
  if (!g.place_id) return;
  const { data: existing } = await supabase
    .from('places_db')
    .select('id')
    .eq('google_place_id', g.place_id)
    .maybeSingle();
  if (existing) return;

  await supabase.from('places_db').insert({
    name: g.name,
    category: g.category ?? '기타',
    country: '',
    city: '',
    address: g.address,
    lat: g.lat,
    lng: g.lng,
    google_place_id: g.place_id,
    google_rating: g.rating,
    photo_url: g.photoUrl,
    source: 'google_autocomplete',
  });
}

async function deleteIdeaNow(placeId: string): Promise<boolean> {
  const { error } = await supabase.from('places').delete().eq('id', placeId);
  if (error) {
    console.error('Idea delete error:', error.message);
    return false;
  }
  return true;
}

async function movePlace(placeId: string, newMood: string | null): Promise<boolean> {
  const { error } = await supabase.from('places').update({ mood: newMood }).eq('id', placeId);
  if (error) {
    console.error('Zone move error:', error.message);
    return false;
  }
  return true;
}

/* ── Security Check 스캔 애니메이션 (게이트로 들어갈 때만) ── */
function runSecurityScan(): Promise<void> {
  if (!securityEl) return Promise.resolve();
  const el = securityEl;
  const original = el.innerHTML;
  el.classList.add('scanning');
  el.innerHTML = [
    '<div class="bd-security-icon">' + ICON_SCAN + '</div>',
    '<div class="bd-security-label">ANALYZING<br>&nbsp;</div>',
  ].join('');

  return new Promise((resolve) => {
    setTimeout(() => {
      el.classList.remove('scanning');
      el.innerHTML = original;
      resolve();
    }, 800);
  });
}

/** ─────────────────────────────────────────────
 *  메인 렌더: Inbox(체크인 카운터) + 중앙 사이니지 + 4게이트
 *  ───────────────────────────────────────────── */
export async function renderBoardContent(container: HTMLElement, tripId: string): Promise<void> {
  teardownBoard();
  const myGeneration = ++boardGeneration;

  container.innerHTML = [
    '<div class="bd-layout" id="bd-layout">',
    '  <div class="bd-loading">보드를 불러오는 중...</div>',
    '</div>',
    '<div class="bd-toast-container" id="bd-toast-container"></div>',
  ].join('');

  const places = await loadPlaces(tripId);
  if (myGeneration !== boardGeneration) return; // 그 사이 다른 렌더가 시작됨

  places.forEach((p) => placesCache.set(p.id, p));

  const layout = container.querySelector('#bd-layout') as HTMLElement;

  const inboxItems = places.filter((p) => p.mood === null);
  layout.innerHTML = '';
  layout.appendChild(buildInbox(tripId, inboxItems));
  const security = buildSecuritySignage();
  securityEl = security;
  layout.appendChild(security);
  layout.appendChild(buildGates(tripId, places));

  subscribeRealtime(tripId);

  // Google Maps는 백그라운드에서 로드 (실패해도 텍스트 입력은 그대로 동작)
  loadGoogleMapsScript()
    .then(() => {
      if (myGeneration !== boardGeneration) {
        console.log('[GoogleMaps] 로드는 됐지만 이미 다른 화면으로 이동해서 건너뜀');
        return;
      }
      console.log('[GoogleMaps] 로드 완료, 자동완성 연결 중...');
      attachAutocompleteWithRetry(tripId, myGeneration);
    })
    .catch((err) => console.error('[GoogleMaps] 로드 실패, 텍스트 입력만 사용:', err.message));
}

/* ── 실시간 동기화 ── */
function subscribeRealtime(tripId: string): void {
  realtimeChannel = supabase
    .channel('places:' + tripId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'places', filter: 'trip_id=eq.' + tripId },
      (payload) => {
        const row = payload.new as Place;
        if (recentlyMutatedIds.has(row.id)) return;
        if (document.querySelector('[data-place-id="' + row.id + '"]')) return;

        placesCache.set(row.id, row);
        const listEl = document.getElementById(zoneListId(row.mood));
        if (!listEl) return;
        removeEmptyState(listEl);
        const el = row.mood === null ? createTicket(row) : createBoardingCard(row);
        listEl.appendChild(el);
        triggerLightSweep(el);
        updateZoneCount(listEl);
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'places', filter: 'trip_id=eq.' + tripId },
      (payload) => {
        const oldRow = payload.old as { id: string };
        if (recentlyMutatedIds.has(oldRow.id)) return;
        placesCache.delete(oldRow.id);
        const el = document.querySelector('[data-place-id="' + oldRow.id + '"]') as HTMLElement | null;
        if (!el) return;
        const listEl = el.closest('[data-zone]') as HTMLElement | null;
        el.remove();
        if (listEl) {
          updateZoneCount(listEl);
          ensureEmptyState(listEl);
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'places', filter: 'trip_id=eq.' + tripId },
      (payload) => {
        const row = payload.new as Place;
        if (recentlyMutatedIds.has(row.id)) return;
        placesCache.set(row.id, row);

        const targetListEl = document.getElementById(zoneListId(row.mood));
        if (!targetListEl) return;

        const el = document.querySelector('[data-place-id="' + row.id + '"]') as HTMLElement | null;
        if (el) {
          const currentZoneEl = el.closest('[data-zone]') as HTMLElement | null;
          if (currentZoneEl === targetListEl) {
            // 무드는 그대로, 다른 사람이 순서만 바꾼 경우 — sort_order 기준으로 재배치
            const siblings = Array.from(targetListEl.querySelectorAll('.bd-ticket, .bd-card')) as HTMLElement[];
            const afterEl = siblings.find((s) => {
              const sid = s.dataset.placeId;
              if (!sid || sid === row.id) return false;
              const sp = placesCache.get(sid);
              return sp !== undefined && sp.sort_order > row.sort_order;
            });
            if (afterEl) targetListEl.insertBefore(el, afterEl);
            else targetListEl.appendChild(el);
            return;
          }
          el.remove();
          if (currentZoneEl) {
            updateZoneCount(currentZoneEl);
            ensureEmptyState(currentZoneEl);
          }
        }

        removeEmptyState(targetListEl);
        const newEl = row.mood === null ? createTicket(row) : createBoardingCard(row);
        targetListEl.appendChild(newEl);
        triggerLightSweep(newEl);
        updateZoneCount(targetListEl);
      }
    )
    .subscribe();
}

/* ── 좌측: 체크인 카운터 (Inbox) ── */
function buildInbox(tripId: string, items: Place[]): HTMLElement {
  const inbox = document.createElement('aside');
  inbox.className = 'bd-inbox';

  inbox.innerHTML = [
    '<div class="bd-inbox-header">',
    '  <div class="bd-inbox-eyebrow">CHECK-IN COUNTER</div>',
    '  <div class="bd-inbox-title">아이디어 체크인</div>',
    '</div>',
    '<div class="bd-inbox-list-header">',
    '  <span>대기 중</span>',
    '  <span class="bd-inbox-count" id="inbox-count">' + items.length + '</span>',
    '</div>',
    '<div class="bd-inbox-list bd-dropzone" id="inbox-list" data-zone=""></div>',
    '<form class="bd-inbox-form" id="bd-inbox-form">',
    '  <div class="bd-inbox-input-wrap">',
    '    <span class="bd-inbox-search-icon">' + ICON_SEARCH + '</span>',
    '    <input class="bd-inbox-input" id="bd-inbox-input" type="text" placeholder="장소 · 링크 · 메모를 입력하세요" autocomplete="off" />',
    '    <button type="button" class="bd-inbox-clear" id="bd-inbox-clear" style="display:none">' + ICON_CLEAR + '</button>',
    '  </div>',
    '  <button type="submit" class="bd-inbox-btn">' + ICON_PLUS + '</button>',
    '</form>',
  ].join('\n');

  const listEl = inbox.querySelector('#inbox-list') as HTMLElement;
  if (items.length === 0) {
    listEl.innerHTML = buildInboxEmpty();
  } else {
    items.forEach((item) => listEl.appendChild(createTicket(item)));
  }

  attachDropzone(listEl);

  const form = inbox.querySelector('#bd-inbox-form') as HTMLFormElement;
  const input = inbox.querySelector('#bd-inbox-input') as HTMLInputElement;
  const clearBtn = inbox.querySelector('#bd-inbox-clear') as HTMLButtonElement;
  requestAnimationFrame(() => input.focus());

  clearBtn.addEventListener('click', () => {
    input.value = '';
    toggleClearButton(false);
    closeAcDropdown();
    input.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    const newPlace = await addIdea(tripId, null, text);
    input.disabled = false;
    input.focus();
    if (newPlace) {
      placesCache.set(newPlace.id, newPlace);
      markRecentlyMutated(newPlace.id);
      removeEmptyState(listEl);
      const el = createTicket(newPlace);
      listEl.appendChild(el);
      triggerLightSweep(el);
      input.value = '';
      updateZoneCount(listEl);
    }
  });

  return inbox;
}

/** input이 아직 안 붙었을 짧은 타이밍 창을 대비한 재시도 래퍼 */
function attachAutocompleteWithRetry(tripId: string, myGeneration: number, attempt = 0): void {
  if (myGeneration !== boardGeneration) return;

  const input = document.getElementById('bd-inbox-input') as HTMLInputElement | null;
  if (!input) {
    if (attempt >= 10) {
      console.error('[GoogleMaps] #bd-inbox-input을 끝내 찾지 못했어요 (다른 화면으로 이동했을 가능성)');
      return;
    }
    setTimeout(() => attachAutocompleteWithRetry(tripId, myGeneration, attempt + 1), 200);
    return;
  }

  attachAutocomplete(tripId, input);
}

/** 카테고리 라벨 → 드롭다운에 보여줄 아이콘 (사진 대신, 추가 과금 없음) */
function iconForCategory(label: string | null): string {
  switch (label) {
    case '음식점': case '카페': case '베이커리': case '바':
      return ICON_FORK;
    case '숙소':
      return ICON_BED;
    case '쇼핑': case '나이트라이프': case '테마파크': case '명소':
      return ICON_TICKET;
    default:
      return ICON_PIN;
  }
}

/** Google Places 커스텀 자동완성을 Inbox 입력창에 연결 (직접 만든 드롭다운) */
function attachAutocomplete(tripId: string, input: HTMLInputElement): void {
  const g = window.google;

  if (!g?.maps?.places) {
    console.error('[GoogleMaps] window.google.maps.places가 없어요. 스크립트 로드는 됐지만 places 라이브러리 준비가 안 됨');
    return;
  }

  cleanupAutocomplete();
  console.log('[GoogleMaps] 커스텀 자동완성 연결 완료');

  input.addEventListener('input', () => {
    const query = input.value.trim();
    toggleClearButton(query.length > 0);

    if (acDebounceTimer) clearTimeout(acDebounceTimer);
    if (!query) {
      closeAcDropdown();
      return;
    }
    acDebounceTimer = setTimeout(async () => {
      const predictions = await getPlacePredictions(query);
      acPredictions = predictions;
      acActiveIndex = -1;
      if (predictions.length > 0) {
        renderAcDropdown(input, tripId);
      } else {
        closeAcDropdown();
      }
    }, 280);
  });

  input.addEventListener('keydown', (e) => {
    if (!acDropdownEl || acPredictions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acActiveIndex = Math.min(acActiveIndex + 1, acPredictions.length - 1);
      highlightAcItem();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acActiveIndex = Math.max(acActiveIndex - 1, 0);
      highlightAcItem();
    } else if (e.key === 'Enter' && acActiveIndex >= 0) {
      e.preventDefault();
      selectPrediction(acPredictions[acActiveIndex], tripId, input);
    } else if (e.key === 'Escape') {
      closeAcDropdown();
    }
  });

  acDocClickHandler = (e: MouseEvent) => {
    if (acDropdownEl && !acDropdownEl.contains(e.target as Node) && e.target !== input) {
      closeAcDropdown();
    }
  };
  document.addEventListener('click', acDocClickHandler);
}

function toggleClearButton(show: boolean): void {
  const clearBtn = document.getElementById('bd-inbox-clear') as HTMLElement | null;
  if (clearBtn) clearBtn.style.display = show ? 'flex' : 'none';
}

function renderAcDropdown(input: HTMLInputElement, tripId: string): void {
  closeAcDropdown_keepPredictions();

  const dropdown = document.createElement('div');
  dropdown.className = 'bd-ac-dropdown';
  dropdown.innerHTML = acPredictions.map((p, i) => {
    const label = getCategoryLabel(p.types);
    return [
      '<button type="button" class="bd-ac-item" data-idx="' + i + '">',
      '  <span class="bd-ac-icon">' + iconForCategory(label) + '</span>',
      '  <span class="bd-ac-text">',
      '    <span class="bd-ac-main">' + escapeHtml(p.mainText) + '</span>',
      '    <span class="bd-ac-secondary">' + escapeHtml(p.secondaryText) + '</span>',
      '  </span>',
      '</button>',
    ].join('');
  }).join('');

  document.body.appendChild(dropdown);
  acDropdownEl = dropdown;
  positionAcDropdown(dropdown, input);

  dropdown.querySelectorAll('.bd-ac-item').forEach((item) => {
    item.addEventListener('click', () => {
      const idx = Number((item as HTMLElement).dataset.idx);
      selectPrediction(acPredictions[idx], tripId, input);
    });
  });
}

/** acPredictions는 유지한 채 드롭다운 DOM만 제거 (재렌더용) */
function closeAcDropdown_keepPredictions(): void {
  acDropdownEl?.remove();
  acDropdownEl = null;
}

/** 입력창 아래 공간이 부족하면 위로 열림 (Inbox 입력창이 화면 하단에 있어서 자주 발생) */
function positionAcDropdown(dropdown: HTMLElement, input: HTMLInputElement): void {
  const rect = input.getBoundingClientRect();
  const estimatedHeight = Math.min(acPredictions.length * 56 + 16, 320);
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const openUpward = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

  dropdown.style.position = 'fixed';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.width = rect.width + 'px';

  if (openUpward) {
    dropdown.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    dropdown.style.top = 'auto';
    dropdown.classList.add('up');
  } else {
    dropdown.style.top = (rect.bottom + 8) + 'px';
    dropdown.style.bottom = 'auto';
    dropdown.classList.remove('up');
  }
}

function highlightAcItem(): void {
  if (!acDropdownEl) return;
  acDropdownEl.querySelectorAll('.bd-ac-item').forEach((el, i) => {
    el.classList.toggle('active', i === acActiveIndex);
    if (i === acActiveIndex) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  });
}

async function selectPrediction(prediction: PlacePrediction, tripId: string, input: HTMLInputElement): Promise<void> {
  closeAcDropdown();
  input.value = '';
  toggleClearButton(false);

  try {
    const details = await getPlaceDetails(prediction.placeId);
    const result = extractPlaceResult(details);
    if (!result) return;

    const listEl = document.getElementById('inbox-list');
    const newPlace = await addRichIdea(tripId, null, result);
    if (newPlace && listEl) {
      placesCache.set(newPlace.id, newPlace);
      markRecentlyMutated(newPlace.id);
      removeEmptyState(listEl);
      const el = createTicket(newPlace);
      listEl.appendChild(el);
      triggerLightSweep(el);
      updateZoneCount(listEl);
    }
  } catch (err) {
    console.error('[GoogleMaps] Place Details 실패:', (err as Error).message);
  }
  input.focus();
}

function buildInboxEmpty(): string {
  return [
    '<div class="bd-empty">',
    '  <div class="bd-empty-hint">📍 장소 이름을 입력하세요</div>',
    '  <div class="bd-empty-hint">🔗 Google Maps 링크를 붙여넣으세요</div>',
    '  <div class="bd-empty-hint">🎤 통화 중 나온 아이디어를 기록하세요</div>',
    '</div>',
  ].join('');
}

/* ── 공통: 별점 표시 ── */
function buildRatingHtml(rating: number | null): string {
  if (rating === null) return '';
  return '<span class="bd-rating">' + ICON_STAR_FILL + '<span>' + rating.toFixed(1) + '</span></span>';
}

/* ── 티켓 스텁 (Inbox 아이템) — Google 데이터 있으면 컴팩트 리치 프리뷰 ── */
function createTicket(place: Place): HTMLElement {
  const ticket = document.createElement('div');
  ticket.className = 'bd-ticket' + (place.photo_url ? ' bd-ticket-rich' : '');
  ticket.draggable = true;
  ticket.dataset.placeId = place.id;

  const suggestion = place.google_place_id ? classifyPlace(place) : classify(place.name);

  if (place.photo_url) {
    ticket.innerHTML = [
      '<div class="bd-ticket-main">',
      '  <div class="bd-ticket-thumb" style="background-image:url(\'' + place.photo_url + '\')"></div>',
      '  <div class="bd-ticket-info">',
      '    <span class="bd-ticket-text">' + escapeHtml(place.name) + '</span>',
      '    <div class="bd-ticket-meta">',
             (place.category ? '<span class="bd-chip">' + escapeHtml(place.category) + '</span>' : ''),
             buildRatingHtml(place.google_rating),
      '    </div>',
      '  </div>',
      '  <button class="bd-ticket-delete" id="tdel-' + place.id + '">' + ICON_TRASH + '</button>',
      '</div>',
      suggestion ? buildSuggestionChip(suggestion) : '',
    ].join('');
  } else {
    ticket.innerHTML = [
      '<div class="bd-ticket-main">',
      ICON_PLANE,
      '<span class="bd-ticket-text">' + escapeHtml(place.name) + '</span>',
      '<button class="bd-ticket-delete" id="tdel-' + place.id + '">' + ICON_TRASH + '</button>',
      '</div>',
      suggestion ? buildSuggestionChip(suggestion) : '',
    ].join('');
  }

  if (suggestion) {
    bindSuggestionChip(ticket, place.id, suggestion);
  }

  bindItemBehavior(ticket, place);
  return ticket;
}

function buildSuggestionChip(s: Suggestion): string {
  return [
    '<div class="bd-suggest">',
    '  <span class="bd-suggest-text">제안 · ' + s.label + ' ' + s.confidence + '%</span>',
    '  <button class="bd-suggest-apply" type="button">적용</button>',
    '  <button class="bd-suggest-dismiss" type="button">무시</button>',
    '</div>',
    '<div class="bd-suggest-note">규칙 기반 제안 · AI 연동 예정</div>',
  ].join('');
}

function bindSuggestionChip(ticket: HTMLElement, id: string, s: Suggestion): void {
  const applyBtn = ticket.querySelector('.bd-suggest-apply') as HTMLButtonElement | null;
  const dismissBtn = ticket.querySelector('.bd-suggest-dismiss') as HTMLButtonElement | null;

  applyBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    applyBtn.disabled = true;

    await runSecurityScan();

    markRecentlyMutated(id);
    const success = await movePlace(id, s.gate);
    if (!success) {
      applyBtn.disabled = false;
      return;
    }
    const place = placesCache.get(id);
    const targetList = document.getElementById('glist-' + s.gate);
    const inboxList = ticket.closest('[data-zone]') as HTMLElement | null;
    ticket.remove();
    if (inboxList) {
      updateZoneCount(inboxList);
      ensureEmptyState(inboxList);
    }
    if (targetList && place) {
      const updated = { ...place, mood: s.gate };
      placesCache.set(id, updated);
      removeEmptyState(targetList);
      const newCard = createBoardingCard(updated);
      targetList.appendChild(newCard);
      triggerLightSweep(newCard);
      updateZoneCount(targetList);
    }
  });

  dismissBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const chip = ticket.querySelector('.bd-suggest') as HTMLElement | null;
    const note = ticket.querySelector('.bd-suggest-note') as HTMLElement | null;
    chip?.remove();
    note?.remove();
  });
}

/* ── 중앙: 보안 검색대 사이니지 ── */
function buildSecuritySignage(): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'bd-security';
  strip.innerHTML = [
    '<div class="bd-security-icon">' + ICON_SCAN + '</div>',
    '<div class="bd-security-label">SECURITY<br>CHECK</div>',
    '<div class="bd-security-note">AI 자동분류<br>준비 중</div>',
  ].join('');
  return strip;
}

/* ── 우측: 4개 게이트 (가로 배열, 각 게이트 내부는 세로 스택) ── */
function buildGates(tripId: string, allPlaces: Place[]): HTMLElement {
  const gates = document.createElement('div');
  gates.className = 'bd-gates';

  GATES.forEach((gate) => {
    const items = allPlaces.filter((p) => p.mood === gate.key);
    gates.appendChild(createGateColumn(tripId, gate, items));
  });

  return gates;
}

function createGateColumn(_tripId: string, gate: GateConfig, items: Place[]): HTMLElement {
  const col = document.createElement('div');
  col.className = 'bd-gate';

  col.innerHTML = [
    '<div class="bd-gate-header">',
    '  <div class="bd-gate-step">' + gate.step + '</div>',
    '  <div class="bd-gate-label-row">',
    '    <span class="bd-gate-icon">' + gate.icon + '</span>',
    '    <span class="bd-gate-label">' + gate.label + '</span>',
    '    <span class="bd-gate-count" id="gcount-' + gate.key + '">' + items.length + '</span>',
    '  </div>',
    '</div>',
    '<div class="bd-gate-list bd-dropzone" id="glist-' + gate.key + '" data-zone="' + gate.key + '"></div>',
  ].join('\n');

  const listEl = col.querySelector('.bd-gate-list') as HTMLElement;
  if (items.length === 0) {
    listEl.innerHTML = '<div class="bd-empty bd-empty-sm"><div class="bd-empty-hint">아이디어를 여기로 드래그하세요</div></div>';
  } else {
    items.forEach((item) => listEl.appendChild(createBoardingCard(item)));
  }

  attachDropzone(listEl);

  return col;
}

/* ── 게이트 카드 (보딩패스 스타일) — Google 데이터 있으면 리치 카드 ── */
function createBoardingCard(place: Place): HTMLElement {
  const card = document.createElement('div');
  card.className = 'bd-card' + (place.photo_url ? ' bd-card-rich' : '');
  card.draggable = true;
  card.dataset.placeId = place.id;

  if (place.photo_url) {
    card.innerHTML = [
      '<div class="bd-card-photo" style="background-image:url(\'' + place.photo_url + '\')">',
      '  <button class="bd-card-kebab" id="kebab-' + place.id + '">' + ICON_KEBAB + '</button>',
      '  <div class="bd-card-kebab-menu" id="kmenu-' + place.id + '">',
      '    <div class="bd-kmenu-main">',
      '      <button class="bd-kmenu-item" data-action="edit">' + ICON_EDIT + '<span>Edit</span></button>',
      '      <button class="bd-kmenu-item" data-action="comment">' + ICON_COMMENT + '<span>Comment</span></button>',
      '      <button class="bd-kmenu-item" data-action="move">' + ICON_MOVE + '<span>Move</span></button>',
      '      <div class="bd-kmenu-divider"></div>',
      '      <button class="bd-kmenu-item danger" data-action="delete">' + ICON_TRASH + '<span>Delete</span></button>',
      '    </div>',
      '    <div class="bd-kmenu-move" id="kmove-' + place.id + '">',
             GATES.filter((g) => g.key !== place.mood).map((g) =>
               '<button class="bd-kmenu-item" data-move-gate="' + g.key + '">' + g.icon + '<span>' + g.label + '</span></button>'
             ).join(''),
      '      <div class="bd-kmenu-divider"></div>',
      '      <button class="bd-kmenu-item" data-move-back="1">' + ICON_BACK_ARROW + '<span>뒤로</span></button>',
      '    </div>',
      '  </div>',
      '</div>',
      '<div class="bd-card-body">',
      '  <div class="bd-card-title-row">',
      '    <span class="bd-card-name">' + escapeHtml(place.name) + '</span>',
           buildRatingHtml(place.google_rating),
      '  </div>',
           (place.category ? '<span class="bd-chip">' + escapeHtml(place.category) + '</span>' : ''),
           (place.address ? '<div class="bd-card-address">' + escapeHtml(place.address) + '</div>' : ''),
      '</div>',
    ].join('');
  } else {
    card.innerHTML = [
      '<span class="bd-card-text">' + escapeHtml(place.name) + '</span>',
      '<button class="bd-card-delete" id="cdel-' + place.id + '">' + ICON_TRASH + '</button>',
    ].join('');
  }

  bindItemBehavior(card, place);

  if (place.photo_url) {
    bindKebabMenu(card, place);
  }

  return card;
}

function bindKebabMenu(card: HTMLElement, place: Place): void {
  const kebabBtn = card.querySelector('.bd-card-kebab') as HTMLButtonElement | null;
  const menu = card.querySelector('.bd-card-kebab-menu') as HTMLElement | null;
  const mainView = card.querySelector('.bd-kmenu-main') as HTMLElement | null;
  const moveView = card.querySelector('.bd-kmenu-move') as HTMLElement | null;
  if (!kebabBtn || !menu || !mainView || !moveView) return;

  function closeMenu(): void {
    menu?.classList.remove('open');
    if (mainView && moveView) {
      mainView.style.display = 'block';
      moveView.style.display = 'none';
    }
  }

  kebabBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.bd-card-kebab-menu.open').forEach((m) => {
      if (m !== menu) m.classList.remove('open');
    });
    menu.classList.toggle('open');
  });

  document.addEventListener('click', closeMenu);
  menu.addEventListener('click', (e) => e.stopPropagation());

  mainView.querySelectorAll('.bd-kmenu-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = (item as HTMLElement).dataset.action;

      if (action === 'delete') {
        closeMenu();
        const listEl = card.closest('[data-zone]') as HTMLElement | null;
        scheduleDelete(place.id, place.name, card, listEl);
      } else if (action === 'edit' || action === 'comment') {
        closeMenu();
        const focusSection = action === 'comment' ? 'comments' : 'name';
        card.dispatchEvent(
          new CustomEvent('mongsil:openPlaceDetail', { detail: { place, focus: focusSection }, bubbles: true })
        );
      } else if (action === 'move') {
        mainView.style.display = 'none';
        moveView.style.display = 'block';
      }
    });
  });

  moveView.querySelectorAll('[data-move-gate]').forEach((item) => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      closeMenu();
      const targetGate = (item as HTMLElement).dataset.moveGate;
      if (!targetGate) return;
      await moveCardToGate(place, targetGate);
    });
  });

  moveView.querySelector('[data-move-back]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    mainView.style.display = 'block';
    moveView.style.display = 'none';
  });
}

/** 케밥 메뉴의 Move에서 게이트를 직접 선택했을 때 — 드래그와 동일한 절차(스캔→이동) */
async function moveCardToGate(place: Place, targetGate: string): Promise<void> {
  const el = document.querySelector('[data-place-id="' + place.id + '"]') as HTMLElement | null;
  const targetList = document.getElementById('glist-' + targetGate);
  if (!el || !targetList) return;

  await runSecurityScan();

  markRecentlyMutated(place.id);
  const success = await movePlace(place.id, targetGate);
  if (!success) return;

  const sourceZoneEl = el.closest('[data-zone]') as HTMLElement | null;
  el.remove();
  if (sourceZoneEl) {
    updateZoneCount(sourceZoneEl);
    ensureEmptyState(sourceZoneEl);
  }

  const updatedPlace = { ...place, mood: targetGate };
  placesCache.set(place.id, updatedPlace);

  removeEmptyState(targetList);
  const newEl = createBoardingCard(updatedPlace);
  targetList.appendChild(newEl);
  triggerLightSweep(newEl);
  updateZoneCount(targetList);
}

/** 티켓/카드 공통 동작: 클릭(상세 Drawer), 드래그 시작/끝, 삭제 2단계 확인 + Undo */
function bindItemBehavior(el: HTMLElement, place: Place): void {
  const id = place.id;

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.bd-ticket-delete, .bd-card-delete, .bd-card-kebab, .bd-card-kebab-menu, .bd-suggest')) return;
    el.dispatchEvent(new CustomEvent('mongsil:openPlaceDetail', { detail: { place }, bubbles: true }));
  });

  el.addEventListener('dragstart', (e) => {
    el.classList.add('dragging');
    const zone = el.closest('[data-zone]') as HTMLElement | null;
    draggingEl = el;
    draggingFromZone = zone?.dataset.zone ?? '';
    e.dataTransfer?.setData('text/place-id', id);
    e.dataTransfer?.setData('text/from-zone', draggingFromZone);
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    draggingEl = null;
    draggingFromZone = '';
  });

  // 리치 카드는 kebab 메뉴에 delete가 있으므로 별도 trash 버튼 바인딩 skip
  const deleteBtn = el.querySelector('.bd-ticket-delete, .bd-card-delete') as HTMLButtonElement | null;
  if (!deleteBtn) return;

  let confirming = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirming) {
      confirming = true;
      deleteBtn.classList.add('confirm');
      deleteBtn.innerHTML = '삭제?';
      confirmTimer = setTimeout(() => {
        confirming = false;
        deleteBtn.classList.remove('confirm');
        deleteBtn.innerHTML = ICON_TRASH;
      }, 2500);
      return;
    }
    if (confirmTimer) clearTimeout(confirmTimer);

    const listEl = el.closest('[data-zone]') as HTMLElement | null;
    scheduleDelete(id, place.name, el, listEl);
  });
}

/** 삭제 예약: 즉시 화면에서 치우고 5초 Undo 토스트, 시간 지나면 실제 DB 삭제 */
function scheduleDelete(id: string, name: string, el: HTMLElement, listEl: HTMLElement | null): void {
  el.remove();
  if (listEl) {
    updateZoneCount(listEl);
    ensureEmptyState(listEl);
  }

  const toastContainer = document.getElementById('bd-toast-container');
  if (!toastContainer) {
    markRecentlyMutated(id);
    deleteIdeaNow(id);
    return;
  }

  const toast = document.createElement('div');
  toast.className = 'bd-toast';
  toast.innerHTML = [
    '<span class="bd-toast-text">"' + escapeHtml(name) + '" 삭제됨</span>',
    '<button class="bd-toast-undo" type="button">실행취소</button>',
  ].join('');
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  const timer = setTimeout(() => {
    pendingDeletes.delete(id);
    markRecentlyMutated(id);
    deleteIdeaNow(id);
    placesCache.delete(id);
    dismissToast(toast);
  }, 5000);

  pendingDeletes.set(id, { timer, toastEl: toast });

  const undoBtn = toast.querySelector('.bd-toast-undo') as HTMLButtonElement;
  undoBtn.addEventListener('click', () => {
    const pending = pendingDeletes.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingDeletes.delete(id);
    dismissToast(toast);

    const place = placesCache.get(id);
    if (listEl && place) {
      removeEmptyState(listEl);
      const restored = listEl.dataset.zone === '' ? createTicket(place) : createBoardingCard(place);
      listEl.appendChild(restored);
      triggerLightSweep(restored);
      updateZoneCount(listEl);
    }
  });
}

function dismissToast(toast: HTMLElement): void {
  toast.classList.remove('show');
  setTimeout(() => toast.remove(), 220);
}

/** 드래그 중인 요소를 커서 Y좌표 기준으로 어디에 끼워넣을지 계산 (자기 자신 제외) */
function getDragAfterElement(container: HTMLElement, y: number): HTMLElement | null {
  const items = Array.from(
    container.querySelectorAll(':scope > .bd-ticket:not(.dragging), :scope > .bd-card:not(.dragging)')
  ) as HTMLElement[];

  let closest: { offset: number; el: HTMLElement | null } = { offset: -Infinity, el: null };
  for (const child of items) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, el: child };
    }
  }
  return closest.el;
}

/** 같은 게이트 내 재정렬을 마친 뒤 DOM 순서를 sort_order로 반영 */
async function persistOrder(listEl: HTMLElement): Promise<void> {
  const items = Array.from(listEl.querySelectorAll('.bd-ticket, .bd-card')) as HTMLElement[];
  await Promise.all(
    items.map((el, idx) => {
      const id = el.dataset.placeId;
      if (!id) return Promise.resolve();
      markRecentlyMutated(id);
      const place = placesCache.get(id);
      if (place) placesCache.set(id, { ...place, sort_order: idx });
      return supabase.from('places').update({ sort_order: idx }).eq('id', id);
    })
  );
}

/** 드롭존 공통 이벤트: dragover 하이라이트 + drop 시 zone 이동/재정렬 처리 (게이트 진입 시 Security Check 스캔) */
function attachDropzone(listEl: HTMLElement): void {
  listEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    listEl.classList.add('drag-over');

    // 드래그 시작한 게이트와 같은 게이트 위라면 실시간으로 위치 재배치
    if (draggingEl && draggingFromZone === (listEl.dataset.zone ?? '')) {
      removeEmptyState(listEl);
      const afterEl = getDragAfterElement(listEl, e.clientY);
      if (afterEl) {
        listEl.insertBefore(draggingEl, afterEl);
      } else {
        listEl.appendChild(draggingEl);
      }
    }
  });
  listEl.addEventListener('dragleave', () => listEl.classList.remove('drag-over'));
  listEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    listEl.classList.remove('drag-over');

    const placeId = e.dataTransfer?.getData('text/place-id');
    const fromZone = e.dataTransfer?.getData('text/from-zone') ?? '';
    const toZone = listEl.dataset.zone ?? '';
    if (!placeId) return;

    if (fromZone === toZone) {
      // 같은 게이트 내 재정렬 — dragover에서 이미 위치가 옮겨져 있으므로 순서만 저장
      await persistOrder(listEl);
      return;
    }

    const el = document.querySelector('[data-place-id="' + placeId + '"]') as HTMLElement | null;
    if (!el) return;
    const place = placesCache.get(placeId);
    if (!place) return;

    if (toZone !== '') {
      await runSecurityScan();
    }

    markRecentlyMutated(placeId);
    const success = await movePlace(placeId, zoneToMood(toZone));
    if (!success) return;

    const currentEl = document.querySelector('[data-place-id="' + placeId + '"]') as HTMLElement | null;
    if (!currentEl) return;
    const sourceZoneEl = currentEl.closest('[data-zone]') as HTMLElement | null;
    currentEl.remove();
    if (sourceZoneEl) {
      updateZoneCount(sourceZoneEl);
      ensureEmptyState(sourceZoneEl);
    }

    const updatedPlace = { ...place, mood: zoneToMood(toZone) };
    placesCache.set(placeId, updatedPlace);

    removeEmptyState(listEl);
    const newEl = toZone === '' ? createTicket(updatedPlace) : createBoardingCard(updatedPlace);
    listEl.appendChild(newEl);
    triggerLightSweep(newEl);
    updateZoneCount(listEl);
  });
}

function triggerLightSweep(el: HTMLElement): void {
  el.classList.remove('sweep');
  void el.offsetWidth;
  el.classList.add('sweep');
  setTimeout(() => el.classList.remove('sweep'), 650);
}

function updateZoneCount(listEl: HTMLElement): void {
  const zone = listEl.dataset.zone ?? '';
  const count = listEl.querySelectorAll('.bd-ticket, .bd-card').length;
  const countEl = zone === ''
    ? document.getElementById('inbox-count')
    : document.getElementById('gcount-' + zone);
  if (countEl) countEl.textContent = String(count);
}

function removeEmptyState(listEl: HTMLElement): void {
  const empty = listEl.querySelector('.bd-empty');
  if (empty) empty.remove();
}

function ensureEmptyState(listEl: HTMLElement): void {
  const hasItems = listEl.querySelectorAll('.bd-ticket, .bd-card').length > 0;
  const hasEmpty = listEl.querySelector('.bd-empty');
  if (hasItems || hasEmpty) return;

  const zone = listEl.dataset.zone ?? '';
  listEl.innerHTML = zone === ''
    ? buildInboxEmpty()
    : '<div class="bd-empty bd-empty-sm"><div class="bd-empty-hint">아이디어를 여기로 드래그하세요</div></div>';
}
