import { supabase } from '../supabase';
import { store } from '../store';
import type { Database } from '../types/database';
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
const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>';
const ICON_PLANE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12L22 5L15 22L11 14L2 12Z"/></svg>';
const ICON_SCAN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18"/></svg>';

const GATES: GateConfig[] = [
  { key: '가고싶어', step: 'GATE 01', label: 'VISIT',    icon: ICON_PIN },
  { key: '먹고싶어', step: 'GATE 02', label: 'FOOD',     icon: ICON_FORK },
  { key: '하고싶어', step: 'GATE 03', label: 'ACTIVITY', icon: ICON_TICKET },
  { key: '후보',     step: 'GATE 04', label: 'MAYBE',    icon: ICON_STAR },
];

/** 문자열 zone key ↔ DB mood 값 변환. 인박스는 '' 로 표현, DB에는 null 저장 */
function zoneToMood(zone: string): string | null {
  return zone === '' ? null : zone;
}
function moodToZone(mood: string | null): string {
  return mood ?? '';
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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

async function deleteIdea(placeId: string): Promise<boolean> {
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

/** ─────────────────────────────────────────────
 *  메인 렌더: Inbox(체크인 카운터) + 중앙 사이니지 + 4게이트
 *  ───────────────────────────────────────────── */
export async function renderBoardContent(container: HTMLElement, tripId: string): Promise<void> {
  container.innerHTML = [
    '<div class="bd-layout" id="bd-layout">',
    '  <div class="bd-loading">보드를 불러오는 중...</div>',
    '</div>',
  ].join('');

  const places = await loadPlaces(tripId);
  const layout = container.querySelector('#bd-layout') as HTMLElement;

  const inboxItems = places.filter((p) => p.mood === null);
  layout.innerHTML = '';
  layout.appendChild(buildInbox(tripId, inboxItems));
  layout.appendChild(buildSecuritySignage());
  layout.appendChild(buildGates(tripId, places));
}

/* ── 좌측: 체크인 카운터 (Inbox) ── */
function buildInbox(tripId: string, items: Place[]): HTMLElement {
  const inbox = document.createElement('aside');
  inbox.className = 'bd-inbox';

  inbox.innerHTML = [
    '<div class="bd-inbox-header">',
    '  <div class="bd-inbox-eyebrow">CHECK-IN COUNTER</div>',
    '  <div class="bd-inbox-title">아이디어 체크인</div>',
    '  <div class="bd-inbox-desc">생각나는 대로 적어보세요. 게이트로 드래그하면 정리돼요.</div>',
    '</div>',
    '<form class="bd-inbox-form" id="bd-inbox-form">',
    '  <input class="bd-inbox-input" id="bd-inbox-input" type="text" placeholder="장소 · 링크 · 메모를 입력하세요" />',
    '  <button type="submit" class="bd-inbox-btn">' + ICON_PLUS + '<span>체크인</span></button>',
    '</form>',
    '<div class="bd-inbox-list-header">',
    '  <span>대기 중</span>',
    '  <span class="bd-inbox-count" id="inbox-count">' + items.length + '</span>',
    '</div>',
    '<div class="bd-inbox-list bd-dropzone" id="inbox-list" data-zone=""></div>',
  ].join('\n');

  const listEl = inbox.querySelector('#inbox-list') as HTMLElement;
  if (items.length === 0) {
    listEl.innerHTML = buildInboxEmpty();
  } else {
    items.forEach((item) => listEl.appendChild(createTicket(item.id, item.name)));
  }

  attachDropzone(listEl);

  const form = inbox.querySelector('#bd-inbox-form') as HTMLFormElement;
  const input = inbox.querySelector('#bd-inbox-input') as HTMLInputElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    const newPlace = await addIdea(tripId, null, text);
    input.disabled = false;
    input.focus();
    if (newPlace) {
      removeEmptyState(listEl);
      const el = createTicket(newPlace.id, newPlace.name);
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
    '  <div class="bd-empty-hint">📍 장소 이름을 입력하세요</div>',
    '  <div class="bd-empty-hint">🔗 Google Maps 링크를 붙여넣으세요</div>',
    '  <div class="bd-empty-hint">🎤 통화 중 나온 아이디어를 기록하세요</div>',
    '</div>',
  ].join('');
}

/* ── 티켓 스텁 (Inbox 아이템) ── */
function createTicket(id: string, name: string): HTMLElement {
  const ticket = document.createElement('div');
  ticket.className = 'bd-ticket';
  ticket.draggable = true;
  ticket.dataset.placeId = id;

  ticket.innerHTML = [
    ICON_PLANE,
    '<span class="bd-ticket-text">' + escapeHtml(name) + '</span>',
    '<button class="bd-ticket-delete" id="tdel-' + id + '">' + ICON_TRASH + '</button>',
  ].join('');

  bindItemBehavior(ticket, id, name);
  return ticket;
}

/* ── 중앙: 보안 검색대 사이니지 (장식 + 정직한 안내) ── */
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
function buildGates(tripId: string, allPlaces: Place[]): HTMLElement {
  const gates = document.createElement('div');
  gates.className = 'bd-gates';

  GATES.forEach((gate) => {
    const items = allPlaces.filter((p) => p.mood === gate.key);
    gates.appendChild(createGateColumn(tripId, gate, items));
  });

  return gates;
}

function createGateColumn(tripId: string, gate: GateConfig, items: Place[]): HTMLElement {
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
    '<form class="bd-gate-form" id="gform-' + gate.key + '">',
    '  <input class="bd-gate-input" id="ginput-' + gate.key + '" type="text" placeholder="바로 추가" />',
    '  <button type="submit" class="bd-gate-add">' + ICON_PLUS + '</button>',
    '</form>',
  ].join('\n');

  const listEl = col.querySelector('.bd-gate-list') as HTMLElement;
  if (items.length === 0) {
    listEl.innerHTML = '<div class="bd-empty bd-empty-sm"><div class="bd-empty-hint">아이디어를 여기로 드래그하세요</div></div>';
  } else {
    items.forEach((item) => listEl.appendChild(createBoardingCard(item.id, item.name)));
  }

  attachDropzone(listEl);

  const form = col.querySelector('.bd-gate-form') as HTMLFormElement;
  const input = col.querySelector('.bd-gate-input') as HTMLInputElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    const newPlace = await addIdea(tripId, gate.key, text);
    input.disabled = false;
    if (newPlace) {
      removeEmptyState(listEl);
      const el = createBoardingCard(newPlace.id, newPlace.name);
      listEl.appendChild(el);
      triggerLightSweep(el);
      input.value = '';
      updateZoneCount(listEl);
    }
  });

  return col;
}

/* ── 게이트 카드 (보딩패스 스타일) ── */
function createBoardingCard(id: string, name: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'bd-card';
  card.draggable = true;
  card.dataset.placeId = id;

  card.innerHTML = [
    '<span class="bd-card-text">' + escapeHtml(name) + '</span>',
    '<button class="bd-card-delete" id="cdel-' + id + '">' + ICON_TRASH + '</button>',
  ].join('');

  bindItemBehavior(card, id, name);
  return card;
}

/** 티켓/카드 공통 동작: 드래그 시작/끝, 삭제 2단계 확인 */
function bindItemBehavior(el: HTMLElement, id: string, _name: string): void {
  el.addEventListener('dragstart', (e) => {
    el.classList.add('dragging');
    const zone = el.closest('[data-zone]') as HTMLElement | null;
    e.dataTransfer?.setData('text/place-id', id);
    e.dataTransfer?.setData('text/from-zone', zone?.dataset.zone ?? '');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));

  const deleteBtn = el.querySelector('.bd-ticket-delete, .bd-card-delete') as HTMLButtonElement;
  let confirming = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  deleteBtn.addEventListener('click', async (e) => {
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
    deleteBtn.disabled = true;
    const listEl = el.closest('[data-zone]') as HTMLElement | null;
    const success = await deleteIdea(id);
    if (success) {
      el.remove();
      if (listEl) {
        updateZoneCount(listEl);
        ensureEmptyState(listEl);
      }
    } else {
      deleteBtn.disabled = false;
      confirming = false;
      deleteBtn.classList.remove('confirm');
      deleteBtn.innerHTML = ICON_TRASH;
    }
  });
}

/** 드롭존 공통 이벤트: dragover 하이라이트 + drop 시 zone 이동 처리 */
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

    const el = document.querySelector('[data-place-id="' + placeId + '"]') as HTMLElement | null;
    if (!el) return;
    const name = el.querySelector('.bd-ticket-text, .bd-card-text')?.textContent ?? '';

    const success = await movePlace(placeId, zoneToMood(toZone));
    if (!success) return;

    const sourceZoneEl = el.closest('[data-zone]') as HTMLElement | null;
    el.remove();
    if (sourceZoneEl) {
      updateZoneCount(sourceZoneEl);
      ensureEmptyState(sourceZoneEl);
    }

    removeEmptyState(listEl);
    const newEl = toZone === '' ? createTicket(placeId, name) : createBoardingCard(placeId, name);
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
