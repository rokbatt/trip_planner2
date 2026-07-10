import { supabase } from '../supabase';
import { store } from '../store';
import type { Database } from '../types/database';
import type { RealtimeChannel } from '@supabase/supabase-js';
import './board.css';

type Place = Database['public']['Tables']['places']['Row'];
type PlaceInsert = Database['public']['Tables']['places']['Insert'];

interface GateConfig {
  key: string;      // mood 값 (DB 저장값)
  step: string;     // GATE 01 등
  label: string;
  icon: string;
}

/* ── Google Maps JS API 최소 타입 (window.google 스코프 안에서만 사용) ── */
interface GMapsPlaceResult {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  rating?: number;
  types?: string[];
  geometry?: { location?: { lat(): number; lng(): number } };
  photos?: Array<{ getUrl(opts?: { maxWidth?: number; maxHeight?: number }): string }>;
  opening_hours?: { weekday_text?: string[] };
}
interface GMapsAutocomplete {
  addListener(event: string, handler: () => void): void;
  getPlace(): GMapsPlaceResult;
}
declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (input: HTMLInputElement, opts?: Record<string, unknown>) => GMapsAutocomplete;
        };
      };
    };
  }
}

/** DOM 요소에 원본 Place 데이터를 그대로 매달아 둠 — 이동/복원/실시간 반영 시 데이터 유실 방지 */
interface PlaceEl extends HTMLElement {
  placeData?: Place;
}

const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21C12 21 19 14.5 19 9.5C19 5.9 15.9 3 12 3C8.1 3 5 5.9 5 9.5C5 14.5 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.2"/></svg>';
const ICON_FORK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v6a2 2 0 0 0 4 0V3M9 11v10M17 3c-1.5 1-2 3-2 5s1 3 2 3 2-1 2-3-0.5-4-2-5zM17 11v10"/></svg>';
const ICON_TICKET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.5a1.5 1.5 0 0 0 0 3V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a1.5 1.5 0 0 0 0-3V9z"/></svg>';
const ICON_STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.8 6.3.6-4.8 4.2 1.4 6.2L12 16.9l-5.5 2.9 1.4-6.2-4.8-4.2 6.3-.6z"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>';
const ICON_PLANE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12L22 5L15 22L11 14L2 12Z"/></svg>';
const ICON_SCAN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18"/></svg>';
const ICON_STAR_FILL = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.7 1.5 6.8L12 17.1l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const ICON_COMMENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-4.7 7.6 8.5 8.5 0 0 1-8.6-.4L3 20l1.3-4.3A8.5 8.5 0 1 1 21 11.5z"/></svg>';
const ICON_MOVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg>';

const GATES: GateConfig[] = [
  { key: '가고싶어', step: 'GATE 01', label: 'VISIT',    icon: ICON_PIN },
  { key: '먹고싶어', step: 'GATE 02', label: 'FOOD',     icon: ICON_FORK },
  { key: '하고싶어', step: 'GATE 03', label: 'ACTIVITY', icon: ICON_TICKET },
  { key: '후보',     step: 'GATE 04', label: 'MAYBE',    icon: ICON_STAR },
];

/* ── Google Place types → 한글 카테고리 라벨 ── */
const CATEGORY_LABELS: Record<string, string> = {
  restaurant: '맛집', food: '맛집', cafe: '카페', bakery: '베이커리', bar: '바',
  night_club: '나이트클럽', tourist_attraction: '관광명소', museum: '박물관',
  art_gallery: '미술관', park: '공원', lodging: '숙소', shopping_mall: '쇼핑',
  store: '쇼핑', amusement_park: '테마파크', zoo: '동물원', aquarium: '아쿠아리움',
  church: '종교시설', hindu_temple: '종교시설', mosque: '종교시설', synagogue: '종교시설',
  train_station: '교통', subway_station: '교통', airport: '공항', spa: '스파',
  movie_theater: '영화관', stadium: '경기장', casino: '카지노',
};
const IGNORED_TYPES = new Set(['point_of_interest', 'establishment', 'premise']);

function deriveCategory(types: string[] | undefined): string | null {
  if (!types) return null;
  for (const t of types) {
    if (CATEGORY_LABELS[t]) return CATEGORY_LABELS[t];
  }
  const fallback = types.find((t) => !IGNORED_TYPES.has(t));
  return fallback ? fallback.replace(/_/g, ' ') : null;
}

/* ── 규칙 기반 분류 (진짜 AI 아님) ──
 * 키워드 매칭 점수로 게이트를 추천. 향후 Gemini 연동 시 이 함수만 교체하면 됨. */
interface Suggestion { gate: string; label: string; confidence: number; }

const KEYWORD_RULES: Array<{ gate: string; words: string[] }> = [
  { gate: '먹고싶어', words: ['맛집', '식당', '카페', '라멘', '스시', '고기', '디저트', '빵집', '브런치', '이자카야', '음식', '먹'] },
  { gate: '가고싶어', words: ['야경', '전망', '박물관', '미술관', '공원', '타워', '신사', '절', '사원', '전망대', '해변', '다리', '브릿지', '성당'] },
  { gate: '하고싶어', words: ['체험', '액티비티', '투어', '클래스', '공연', '쇼핑', '테마파크', '놀이', '스파', '마사지', '클럽'] },
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

/* ── 트립 멤버 이름 매핑 (카드 작성자 표시용) ── */
let memberNames = new Map<string, string>();

async function loadMemberNames(tripId: string): Promise<void> {
  const { data, error } = await supabase
    .from('trip_members')
    .select('user_id, display_name')
    .eq('trip_id', tripId);

  memberNames = new Map();
  if (!error && data) {
    data.forEach((m) => {
      if (m.display_name) memberNames.set(m.user_id, m.display_name);
    });
  }
}

function authorLabel(userId: string | null): string {
  if (!userId) return '익명';
  const me = store.get('user');
  if (me && me.id === userId) return '나';
  return memberNames.get(userId) ?? '익명';
}

/* ── Realtime 채널 (게이트 전환 시 workspace.ts에서 teardownBoard 호출) ── */
let realtimeChannel: RealtimeChannel | null = null;
let securityEl: HTMLElement | null = null;

export function teardownBoard(): void {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  pendingDeletes.forEach((p) => clearTimeout(p.timer));
  pendingDeletes.clear();
  securityEl = null;
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

/** 텍스트만 있는 아이디어 추가 (Autocomplete로 선택하지 않은 경우) */
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

/** Google Place 데이터를 포함한 리치 아이디어 추가 */
async function addRichIdea(tripId: string, mood: string | null, place: GMapsPlaceResult): Promise<Place | null> {
  const user = store.get('user');
  const payload: PlaceInsert = {
    trip_id: tripId,
    name: place.name || '이름 없음',
    mood,
    status: 'idea',
    is_idea: true,
    added_by: user?.id ?? null,
    sort_order: Math.floor(Date.now() / 1000),
    address: place.formatted_address ?? null,
    lat: place.geometry?.location ? place.geometry.location.lat() : null,
    lng: place.geometry?.location ? place.geometry.location.lng() : null,
    google_place_id: place.place_id ?? null,
    google_rating: place.rating ?? null,
    category: deriveCategory(place.types),
    opening_hours: place.opening_hours?.weekday_text ?? null,
    photo_url: place.photos && place.photos[0] ? place.photos[0].getUrl({ maxWidth: 480, maxHeight: 360 }) : null,
  };

  const { data, error } = await supabase.from('places').insert(payload).select().single();

  if (error) {
    console.error('Rich idea add error:', error.message);
    return null;
  }
  return data;
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

/* ── Google Maps 로드 대기 ── */
function waitForGoogleMaps(timeoutMs = 6000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (window.google?.maps?.places) {
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 150);
    };
    check();
  });
}

/** ─────────────────────────────────────────────
 *  메인 렌더: Inbox(체크인 카운터) + 중앙 사이니지 + 4게이트
 *  ───────────────────────────────────────────── */
export async function renderBoardContent(container: HTMLElement, tripId: string): Promise<void> {
  teardownBoard();

  container.innerHTML = [
    '<div class="bd-layout" id="bd-layout">',
    '  <div class="bd-loading">보드를 불러오는 중...</div>',
    '</div>',
    '<div class="bd-toast-container" id="bd-toast-container"></div>',
  ].join('');

  const [places] = await Promise.all([loadPlaces(tripId), loadMemberNames(tripId)]);
  const layout = container.querySelector('#bd-layout') as HTMLElement;

  const inboxItems = places.filter((p) => p.mood === null);
  layout.innerHTML = '';
  layout.appendChild(buildInbox(tripId, inboxItems));
  const security = buildSecuritySignage();
  securityEl = security;
  layout.appendChild(security);
  layout.appendChild(buildGates(places));

  subscribeRealtime(tripId);
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

        const targetListEl = document.getElementById(zoneListId(row.mood));
        if (!targetListEl) return;

        const el = document.querySelector('[data-place-id="' + row.id + '"]') as HTMLElement | null;
        if (el) {
          const currentZoneEl = el.closest('[data-zone]') as HTMLElement | null;
          if (currentZoneEl === targetListEl) return; // 무드 변경 없음 (다음 단계에서 이름/상세 수정 대응 예정)
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
    '  <input class="bd-inbox-input" id="bd-inbox-input" type="text" placeholder="장소 · 링크 · 메모를 입력하세요" autocomplete="off" />',
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
  requestAnimationFrame(() => input.focus());

  // Google Places Autocomplete 바인딩 (선택 시 리치 데이터로 즉시 체크인)
  let justPickedPlace = false;
  waitForGoogleMaps().then((ready) => {
    if (!ready || !window.google?.maps?.places) return;
    const autocomplete = new window.google.maps.places.Autocomplete(input, {
      fields: ['place_id', 'name', 'formatted_address', 'geometry', 'rating', 'types', 'photos', 'opening_hours'],
      types: ['establishment'],
    });
    autocomplete.addListener('place_changed', async () => {
      const place = autocomplete.getPlace();
      if (!place || (!place.place_id && !place.name)) return;

      justPickedPlace = true;
      input.disabled = true;
      const newPlace = await addRichIdea(tripId, null, place);
      input.disabled = false;
      input.value = '';
      input.focus();

      if (newPlace) {
        markRecentlyMutated(newPlace.id);
        removeEmptyState(listEl);
        const el = createTicket(newPlace);
        listEl.appendChild(el);
        triggerLightSweep(el);
        updateZoneCount(listEl);
      }
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (justPickedPlace) {
      justPickedPlace = false;
      return;
    }
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    const newPlace = await addIdea(tripId, null, text);
    input.disabled = false;
    input.focus();
    if (newPlace) {
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

function buildInboxEmpty(): string {
  return [
    '<div class="bd-empty">',
    '  <div class="bd-empty-hint">📍 장소 이름을 입력하면 자동완성돼요</div>',
    '  <div class="bd-empty-hint">🔗 Google Maps 링크를 붙여넣으세요</div>',
    '  <div class="bd-empty-hint">🎤 통화 중 나온 아이디어를 기록하세요</div>',
    '</div>',
  ].join('');
}

/* ── 티켓 스텁 (Inbox 아이템) — Place 데이터가 있으면 작은 썸네일/평점만 살짝 ── */
function createTicket(place: Place): HTMLElement {
  const ticket = document.createElement('div') as PlaceEl;
  ticket.className = 'bd-ticket';
  ticket.draggable = true;
  ticket.dataset.placeId = place.id;
  ticket.placeData = place;

  const suggestion = classify(place.name);
  const hasPhoto = !!place.photo_url;

  ticket.innerHTML = [
    '<div class="bd-ticket-main">',
    hasPhoto
      ? '<div class="bd-ticket-thumb" style="background-image:url(\'' + place.photo_url + '\')"></div>'
      : ICON_PLANE,
    '<span class="bd-ticket-text">' + escapeHtml(place.name) + '</span>',
    place.google_rating
      ? '<span class="bd-ticket-rating">' + ICON_STAR_FILL + place.google_rating.toFixed(1) + '</span>'
      : '',
    '<button class="bd-ticket-delete" id="tdel-' + place.id + '">' + ICON_TRASH + '</button>',
    '</div>',
    suggestion ? buildSuggestionChip(suggestion) : '',
  ].join('');

  if (suggestion) {
    bindSuggestionChip(ticket, suggestion);
  }

  bindItemBehavior(ticket);
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

function bindSuggestionChip(ticket: PlaceEl, s: Suggestion): void {
  const applyBtn = ticket.querySelector('.bd-suggest-apply') as HTMLButtonElement | null;
  const dismissBtn = ticket.querySelector('.bd-suggest-dismiss') as HTMLButtonElement | null;

  applyBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    applyBtn.disabled = true;

    await runSecurityScan();

    const place = ticket.placeData;
    if (!place) {
      applyBtn.disabled = false;
      return;
    }

    markRecentlyMutated(place.id);
    const success = await movePlace(place.id, s.gate);
    if (!success) {
      applyBtn.disabled = false;
      return;
    }
    const targetList = document.getElementById('glist-' + s.gate);
    const inboxList = ticket.closest('[data-zone]') as HTMLElement | null;
    ticket.remove();
    if (inboxList) {
      updateZoneCount(inboxList);
      ensureEmptyState(inboxList);
    }
    if (targetList) {
      removeEmptyState(targetList);
      const newCard = createBoardingCard({ ...place, mood: s.gate });
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

/* ── 우측: 4개 게이트 ── */
function buildGates(allPlaces: Place[]): HTMLElement {
  const gates = document.createElement('div');
  gates.className = 'bd-gates';

  GATES.forEach((gate) => {
    const items = allPlaces.filter((p) => p.mood === gate.key);
    gates.appendChild(createGateColumn(gate, items));
  });

  return gates;
}

function createGateColumn(gate: GateConfig, items: Place[]): HTMLElement {
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

/* ── 게이트 카드 (보딩패스 스타일) — Place 데이터가 있으면 리치 카드 ── */
function createBoardingCard(place: Place): HTMLElement {
  const card = document.createElement('div') as PlaceEl;
  const isRich = !!place.google_place_id;
  card.className = 'bd-card' + (isRich ? ' bd-card-rich' : '');
  card.draggable = true;
  card.dataset.placeId = place.id;
  card.placeData = place;

  if (isRich) {
    card.innerHTML = [
      place.photo_url ? '<div class="bd-card-thumb" style="background-image:url(\'' + place.photo_url + '\')"></div>' : '',
      '<div class="bd-card-body">',
      '  <div class="bd-card-top-row">',
      '    <span class="bd-card-name">' + escapeHtml(place.name) + '</span>',
      place.google_rating
        ? '    <span class="bd-card-rating">' + ICON_STAR_FILL + place.google_rating.toFixed(1) + '</span>'
        : '',
      '  </div>',
      place.category ? '  <div class="bd-card-category">' + escapeHtml(place.category) + '</div>' : '',
      '  <div class="bd-card-ai-line">🕐 추천 방문 · 오전 11시 (placeholder)</div>',
      '  <div class="bd-card-footer">',
      '    <span class="bd-card-author">' + escapeHtml(authorLabel(place.added_by)) + '</span>',
      '  </div>',
      '</div>',
      buildCardActions(place.id),
    ].join('');
  } else {
    card.innerHTML = [
      '<span class="bd-card-text">' + escapeHtml(place.name) + '</span>',
      buildCardActions(place.id),
    ].join('');
  }

  bindItemBehavior(card);
  return card;
}

function buildCardActions(id: string): string {
  return [
    '<div class="bd-card-actions">',
    '  <button class="bd-card-action" id="edit-' + id + '" title="편집">' + ICON_EDIT + '</button>',
    '  <button class="bd-card-action" id="comment-' + id + '" title="댓글">' + ICON_COMMENT + '</button>',
    '  <button class="bd-card-action" id="move-' + id + '" title="이동">' + ICON_MOVE + '</button>',
    '  <button class="bd-card-action bd-card-action-delete" id="cdel-' + id + '" title="삭제">' + ICON_TRASH + '</button>',
    '</div>',
  ].join('');
}

/** 티켓/카드 공통 동작: 드래그 시작/끝, 삭제 2단계 확인 + Undo, 편집/댓글/이동 스텁 */
function bindItemBehavior(el: PlaceEl): void {
  const id = el.placeData?.id ?? '';

  el.addEventListener('dragstart', (e) => {
    el.classList.add('dragging');
    const zone = el.closest('[data-zone]') as HTMLElement | null;
    e.dataTransfer?.setData('text/place-id', id);
    e.dataTransfer?.setData('text/from-zone', zone?.dataset.zone ?? '');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));

  // Step C(Drawer/재정렬)에서 실제 기능 연결 예정 — 지금은 스텁
  el.querySelector('.bd-card-action:not(.bd-card-action-delete)')?.parentElement
    ?.querySelectorAll('.bd-card-action:not(.bd-card-action-delete)')
    .forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showStubToast('이 기능은 다음 단계에서 연결돼요');
      });
    });

  const deleteBtn = el.querySelector('.bd-ticket-delete, .bd-card-action-delete') as HTMLButtonElement;
  let confirming = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirming) {
      confirming = true;
      deleteBtn.classList.add('confirm');
      const label = deleteBtn.classList.contains('bd-card-action') ? '?' : '삭제?';
      deleteBtn.innerHTML = label;
      confirmTimer = setTimeout(() => {
        confirming = false;
        deleteBtn.classList.remove('confirm');
        deleteBtn.innerHTML = ICON_TRASH;
      }, 2500);
      return;
    }
    if (confirmTimer) clearTimeout(confirmTimer);

    const listEl = el.closest('[data-zone]') as HTMLElement | null;
    const place = el.placeData;
    if (!place) return;
    scheduleDelete(place, el, listEl);
  });
}

function showStubToast(message: string): void {
  const toastContainer = document.getElementById('bd-toast-container');
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = 'bd-toast bd-toast-stub';
  toast.innerHTML = '<span class="bd-toast-text">' + escapeHtml(message) + '</span>';
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => dismissToast(toast), 1800);
}

/** 삭제 예약: 즉시 화면에서 치우고 5초 Undo 토스트, 시간 지나면 실제 DB 삭제 */
function scheduleDelete(place: Place, el: HTMLElement, listEl: HTMLElement | null): void {
  el.remove();
  if (listEl) {
    updateZoneCount(listEl);
    ensureEmptyState(listEl);
  }

  const toastContainer = document.getElementById('bd-toast-container');
  if (!toastContainer) {
    markRecentlyMutated(place.id);
    deleteIdeaNow(place.id);
    return;
  }

  const toast = document.createElement('div');
  toast.className = 'bd-toast';
  toast.innerHTML = [
    '<span class="bd-toast-text">"' + escapeHtml(place.name) + '" 삭제됨</span>',
    '<button class="bd-toast-undo" type="button">실행취소</button>',
  ].join('');
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  const timer = setTimeout(() => {
    pendingDeletes.delete(place.id);
    markRecentlyMutated(place.id);
    deleteIdeaNow(place.id);
    dismissToast(toast);
  }, 5000);

  pendingDeletes.set(place.id, { timer, toastEl: toast });

  const undoBtn = toast.querySelector('.bd-toast-undo') as HTMLButtonElement;
  undoBtn.addEventListener('click', () => {
    const pending = pendingDeletes.get(place.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingDeletes.delete(place.id);
    dismissToast(toast);

    if (listEl) {
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

/** 드롭존 공통 이벤트: dragover 하이라이트 + drop 시 zone 이동 처리 (게이트 진입 시 Security Check 스캔) */
function attachDropzone(listEl: HTMLElement): void {
  listEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    listEl.classList.add('drag-over');
  });
  listEl.addEventListener('dragleave', () => listEl.classList.remove('drag-over'));
  listEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    listEl.classList.remove('drag-over');

    const placeId = e.dataTransfer?.getData('text/place-id');
    const fromZone = e.dataTransfer?.getData('text/from-zone') ?? '';
    const toZone = listEl.dataset.zone ?? '';
    if (!placeId || fromZone === toZone) return;

    const el = document.querySelector('[data-place-id="' + placeId + '"]') as PlaceEl | null;
    if (!el || !el.placeData) return;
    const place = el.placeData;

    // 게이트로 들어가는 이동일 때만 Security Check 스캔
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

    removeEmptyState(listEl);
    const movedPlace = { ...place, mood: zoneToMood(toZone) };
    const newEl = toZone === '' ? createTicket(movedPlace) : createBoardingCard(movedPlace);
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
