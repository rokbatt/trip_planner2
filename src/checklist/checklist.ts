/**
 * CHECKLIST 게이트(PC) — 출발 전부터 여행 중까지 함께 챙길 일을 한 화면에서.
 *
 * 데이터는 새로 만들지 않는다. MOBILE(MORE 탭)·TIMELINE(장소 상세)이 이미 쓰는 트립 공유 목록
 * `trip_checklist`를 그대로 쓰고(I/O는 전부 mobile/checklist.ts), 분류·중요도·담당자·마감일·메모·
 * 연결 문서만 컬럼으로 덧붙였다(supabase/trip_checklist_v2.sql). 그래서 여기서 체크하면 폰에서도
 * 바로 지워지고, 폰에서 넣은 항목도 여기 그대로 보인다.
 *
 * 화면: 왼쪽(넓게) 체크리스트 / 오른쪽(보조) 준비 현황·스마트 추천·완료한 항목·꼭 확인할 것.
 * 추천 규칙은 checklistModel.ts — 실제로 저장된 여행 데이터가 있을 때만 추천한다(원칙 3-1).
 */

import { supabase } from '../supabase';
import { store } from '../store';
import type { Trip, TripChecklistItem, TripDestination, TripDocument } from '../types/database';
import {
  addChecklistItemDetailed,
  deleteChecklistItem,
  isChecklistExtendedReady,
  loadChecklist,
  probeChecklistExtended,
  saveChecklistOrder,
  setChecklistChecked,
  subscribeChecklistScoped,
  updateChecklistItem,
} from '../mobile/checklist';
import type { ChecklistDraft } from '../mobile/checklist';
import { bindLongPressReorder, moveItem } from '../mobile/reorder';
import { loadDestinations } from '../trips/destinations';
import { DOC_CATEGORY_LABEL, loadSharedDocuments, normalizeDocCategory, requestDocFocus } from '../docs/docsStore';
import { escapeHtml, formatDayTime } from '../docs/docsIcons';
import {
  CK_CATEGORIES,
  CK_CATEGORY_LABEL,
  CK_PRIORITIES,
  CK_PRIORITY_LABEL,
  SORT_LABEL,
  SOURCE_LABEL,
  buildMustChecks,
  buildSmartSuggestions,
  categoryOf,
  countryOfDestination,
  dueInfo,
  isDone,
  isSuggestionTaken,
  matchesAssignee,
  priorityOf,
  progressByCategory,
  progressOf,
  recentlyDone,
  relatedDocCategory,
  reorderChanges,
  sortItems,
  todayIso,
  tripCountdown,
} from './checklistModel';
import type { CkCategory, CkPriority, SortMode, Suggestion, TripFacts } from './checklistModel';
import './checklist.css';

/* ══════════════ 아이콘 ══════════════ */

const svg = (d: string, w = 1.6) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';

const CAT_ICON: Record<CkCategory, string> = {
  ESSENTIAL: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M9 16.5h6"/>'),
  GEAR: svg('<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 12.5h18"/>'),
  HEALTH: svg('<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z"/><path d="M12 9v6M9 12h6"/>'),
  BOOKING: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="M9 14.5l2 2 4-4"/>'),
  TIP: svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>'),
};

const IC = {
  plus: svg('<path d="M12 5v14M5 12h14"/>', 2),
  check: svg('<path d="M20 6L9 17l-5-5"/>', 2.4),
  grip: svg('<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>', 1.4),
  doc: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"/><path d="M14 3v5h5"/>'),
  memo: svg('<path d="M4 6h16M4 12h16M4 18h10"/>'),
  close: svg('<path d="M18 6L6 18M6 6l12 12"/>', 1.8),
  sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z"/>', 1.4),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>'),
  pin: svg('<path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.2"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>', 1.8),
};

/* ══════════════ 모듈 상태 ══════════════ */

interface Member {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

type StatusFilter = 'ALL' | 'DONE';

let rootEl: HTMLElement | null = null;
let scrollerEl: HTMLElement | null = null;
let currentTripId = '';
let trip: Trip | null = null;
let items: TripChecklistItem[] = [];
let members: Member[] = [];
let myMemberId: string | null = null;
let sharedDocs: TripDocument[] = [];
let facts: TripFacts | null = null;

let activeCategory: CkCategory | 'ALL' = 'ALL';
let assigneeFilter = 'ALL';
let statusFilter: StatusFilter = 'ALL';
let sortMode: SortMode = 'manual';
let expandedId: string | null = null;
let showAllSuggestions = false;
let dismissed = new Set<string>();
let quickDraft = '';

let unsubRealtime: (() => void) | null = null;
let unbindReorder: (() => void) | null = null;
let dragging = false;
let reloadAfterDrag = false;
/** 게이트를 떠난 뒤 늦게 끝난 비동기 로드가 화면을 덮어쓰지 않게 */
let renderToken = 0;
let sheetLayer: HTMLElement | null = null;
let sheetKeyHandler: ((e: KeyboardEvent) => void) | null = null;

const TICKETED_CATEGORIES = ['테마파크', '박물관', '미술관'];

/* ══════════════ 진입 / 정리 ══════════════ */

export function teardownChecklist(): void {
  renderToken += 1;
  unsubRealtime?.();
  unsubRealtime = null;
  unbindReorder?.();
  unbindReorder = null;
  closeSheet();
  rootEl = null;
  scrollerEl = null;
  currentTripId = '';
  trip = null;
  items = [];
  members = [];
  myMemberId = null;
  sharedDocs = [];
  facts = null;
  activeCategory = 'ALL';
  assigneeFilter = 'ALL';
  statusFilter = 'ALL';
  expandedId = null;
  showAllSuggestions = false;
  quickDraft = '';
  dragging = false;
  reloadAfterDrag = false;
}

export async function renderChecklistContent(container: HTMLElement, tripId: string): Promise<void> {
  teardownChecklist();
  const token = renderToken;
  currentTripId = tripId;
  scrollerEl = container;
  sortMode = loadSortMode(tripId);
  dismissed = loadDismissed(tripId);
  container.innerHTML = '<div class="ck-wrap"><div class="ck-loading">체크리스트를 불러오는 중…</div></div>';

  trip = store.get('currentTrip');
  if (!trip || trip.id !== tripId) {
    const { data } = await supabase.from('trips').select('*').eq('id', tripId).single();
    trip = (data as Trip | null) ?? null;
  }

  const [list, mem, docs] = await Promise.all([loadChecklist(tripId), loadMembers(tripId), loadSharedDocuments(tripId)]);
  if (token !== renderToken) return;

  if (list === null) {
    container.innerHTML = [
      '<div class="ck-wrap"><div class="ck-unavailable">',
      '  <div class="ck-unavailable-title">체크리스트를 불러오지 못했어요</div>',
      '  <div class="ck-unavailable-hint">잠시 후 다시 시도해 주세요. 계속 안 되면 체크리스트 저장소(trip_checklist)가 준비됐는지 확인이 필요해요.</div>',
      '  <button type="button" class="ck-btn-ghost" id="ck-retry">다시 시도</button>',
      '</div></div>',
    ].join('');
    container.querySelector('#ck-retry')?.addEventListener('click', () => { void renderChecklistContent(container, tripId); });
    return;
  }

  items = list;
  members = mem;
  sharedDocs = docs;
  const userId = store.get('user')?.id ?? null;
  myMemberId = members.find((m) => m.user_id === userId)?.id ?? null;
  await probeChecklistExtended(tripId);
  facts = await loadFacts(trip, tripId, docs);
  if (token !== renderToken) return;

  container.innerHTML = shellHtml();
  rootEl = container.querySelector('.ck-wrap') as HTMLElement;
  bindShell();
  renderAll();

  unsubRealtime = subscribeChecklistScoped(tripId, 'pc', () => { void reload(); });
}

async function reload(): Promise<void> {
  if (dragging) {
    reloadAfterDrag = true;
    return;
  }
  const token = renderToken;
  const list = await loadChecklist(currentTripId);
  if (token !== renderToken || !list) return;
  items = list;
  if (expandedId && !items.some((i) => i.id === expandedId)) expandedId = null;
  renderAll();
}

/* ══════════════ 데이터 — 멤버 · 추천 근거 ══════════════ */

async function loadMembers(tripId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from('trip_members')
    .select('id, user_id, display_name, avatar_url')
    .eq('trip_id', tripId)
    .order('joined_at', { ascending: true });
  if (error) {
    console.error('[Checklist] 멤버 로드 실패:', error.message);
    return [];
  }
  return (data ?? []) as Member[];
}

/** 추천 근거 — 이 트립에 실제로 저장된 값만 모은다. 하나가 실패해도 나머지 추천은 그대로 */
async function loadFacts(t: Trip | null, tripId: string, docs: TripDocument[]): Promise<TripFacts> {
  const result: TripFacts = {
    destinationNames: [],
    countries: [],
    hasUnknownDestination: false,
    flight: null,
    stays: [],
    ticketedStops: [],
    docCategories: [...new Set(docs.map((d) => normalizeDocCategory(d.category)))],
  };
  if (!t) return result;

  let dests: TripDestination[] = [];
  try {
    dests = await loadDestinations(t);
  } catch (e) {
    console.error('[Checklist] 여행지 로드 실패:', e);
  }
  const sorted = [...dests].sort(
    (a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? '') || a.sort_order - b.sort_order
  );
  result.destinationNames = sorted.map((d) => (d.name ?? '').trim()).filter(Boolean);
  if (!result.destinationNames.length && t.destinations?.length) {
    result.destinationNames = t.destinations.map((d) => d.trim()).filter(Boolean);
  }
  const countries = new Set<string>();
  for (const name of result.destinationNames) {
    const c = countryOfDestination(name);
    if (c) countries.add(c);
    else result.hasUnknownDestination = true;
  }
  result.countries = [...countries];

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const flight = {
    arrivalAirport: first?.arrival_airport ?? null,
    arrivalTime: first?.arrival_time ?? null,
    departureAirport: last?.departure_airport ?? null,
    departureTime: last?.departure_time ?? null,
  };
  if (flight.arrivalAirport || flight.departureAirport) result.flight = flight;

  const [stays, ticketed] = await Promise.all([loadStayNames(t, tripId), loadTicketedStops(tripId)]);
  result.stays = stays;
  result.ticketedStops = ticketed;
  return result;
}

/** 확정한 숙소(구간별 basecamp) 이름 — 날짜순 */
async function loadStayNames(t: Trip, tripId: string): Promise<string[]> {
  const { data: segs, error } = await supabase
    .from('stay_segments')
    .select('basecamp_place_id, start_date, sort_order')
    .eq('trip_id', tripId);
  const ids: string[] = [];
  if (!error) {
    const ordered = [...(segs ?? [])].sort(
      (a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? '') || a.sort_order - b.sort_order
    );
    for (const s of ordered) if (s.basecamp_place_id && !ids.includes(s.basecamp_place_id)) ids.push(s.basecamp_place_id);
  }
  // 구간 테이블 이전에 트립에 바로 저장하던 숙소
  if (!ids.length && t.shortlist_basecamp_place_id) ids.push(t.shortlist_basecamp_place_id);
  if (!ids.length) return [];

  const { data: places } = await supabase.from('places').select('id, name').in('id', ids);
  const nameById = new Map((places ?? []).map((p) => [p.id, p.name] as const));
  return [...new Set(ids.map((id) => nameById.get(id)).filter((n): n is string => !!n))];
}

/** 일정에 담긴 장소 중 입장권이 필요할 수 있는 곳(테마파크·박물관·미술관) */
async function loadTicketedStops(tripId: string): Promise<string[]> {
  const { data: stops, error } = await supabase
    .from('route_stops')
    .select('place_id')
    .eq('trip_id', tripId)
    .not('place_id', 'is', null);
  if (error || !stops?.length) return [];
  const ids = [...new Set(stops.map((s) => s.place_id).filter((x): x is string => !!x))];
  const { data: places } = await supabase
    .from('places')
    .select('id, name, category')
    .in('id', ids)
    .in('category', TICKETED_CATEGORIES);
  return [...new Set((places ?? []).map((p) => p.name).filter(Boolean))];
}

/* ══════════════ 보기 설정 기억 (뷰어 개인 편의 — 공유 상태 아님) ══════════════ */

function loadSortMode(tripId: string): SortMode {
  try {
    const v = localStorage.getItem('mongsil:ck-sort:' + tripId);
    return v && v in SORT_LABEL ? (v as SortMode) : 'manual';
  } catch {
    return 'manual';
  }
}

function saveSortMode(): void {
  try {
    localStorage.setItem('mongsil:ck-sort:' + currentTripId, sortMode);
  } catch {
    /* 기억 못 해도 동작에는 지장 없음 */
  }
}

function loadDismissed(tripId: string): Set<string> {
  try {
    const raw = localStorage.getItem('mongsil:ck-dismissed:' + tripId);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(): void {
  try {
    localStorage.setItem('mongsil:ck-dismissed:' + currentTripId, JSON.stringify([...dismissed]));
  } catch {
    /* noop */
  }
}

/* ══════════════ 파생 값 ══════════════ */

function memberById(id: string | null): Member | null {
  return id ? members.find((m) => m.id === id) ?? null : null;
}

function memberLabel(m: Member): string {
  return (m.display_name || '멤버') + (m.id === myMemberId ? ' (나)' : '');
}

function docById(id: string | null): TripDocument | null {
  return id ? sharedDocs.find((d) => d.id === id) ?? null : null;
}

function visibleItems(): TripChecklistItem[] {
  const filtered = items.filter(
    (i) =>
      (activeCategory === 'ALL' || categoryOf(i) === activeCategory) &&
      matchesAssignee(i, assigneeFilter, myMemberId) &&
      (statusFilter === 'ALL' || isDone(i))
  );
  return sortItems(filtered, sortMode, (id) => memberById(id)?.display_name ?? null);
}

function smartSuggestions(): Suggestion[] {
  if (!facts) return [];
  return buildSmartSuggestions(facts).filter((s) => !isSuggestionTaken(s, items));
}

function mustChecks(): Suggestion[] {
  return facts ? buildMustChecks(facts) : [];
}

function canReorder(): boolean {
  return sortMode === 'manual' && statusFilter === 'ALL';
}

/* ══════════════ 셸 ══════════════ */

function shellHtml(): string {
  return [
    '<div class="ck-wrap">',
    '  <div class="ck-grid">',
    '    <div class="ck-col ck-col-left">',
    '      <section class="ck-card ck-main" aria-label="체크리스트">',
    '        <div class="ck-cats" id="ck-cats" role="tablist"></div>',
    '        <div class="ck-toolbar">',
    '          <div class="ck-toolbar-left">',
    '            <label class="ck-select-wrap"><span class="ck-select-label">담당</span><select class="ck-select" id="ck-assignee"></select></label>',
    '            <label class="ck-select-wrap"><span class="ck-select-label">정렬</span><select class="ck-select" id="ck-sort">' +
      (Object.keys(SORT_LABEL) as SortMode[]).map((k) => '<option value="' + k + '">' + SORT_LABEL[k] + '</option>').join('') +
      '</select></label>',
    '          </div>',
    '          <button type="button" class="ck-btn-primary" id="ck-add">' + IC.plus + '<span>항목 추가</span></button>',
    '        </div>',
    '        <div class="ck-filter-note" id="ck-filter-note"></div>',
    '        <div class="ck-list" id="ck-list" role="list"></div>',
    '        <div class="ck-quick">',
    '          <span class="ck-quick-icon">' + IC.plus + '</span>',
    '          <input type="text" class="ck-quick-input" id="ck-quick" maxlength="80" autocomplete="off" placeholder="새 항목 이름을 적고 Enter" />',
    '        </div>',
    '      </section>',
    '      <section class="ck-card ck-done-card" id="ck-done" aria-label="완료한 항목"></section>',
    '    </div>',
    '    <div class="ck-col ck-col-right">',
    '      <section class="ck-card ck-ready" id="ck-ready" aria-label="준비 현황"></section>',
    '      <section class="ck-card ck-suggest" id="ck-suggest" aria-label="스마트 추천"></section>',
    '      <section class="ck-card ck-must" id="ck-must" aria-label="여행 전 꼭 확인하세요"></section>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

function bindShell(): void {
  if (!rootEl) return;

  rootEl.querySelector('#ck-add')?.addEventListener('click', () => openSheet(null));

  const assigneeEl = rootEl.querySelector('#ck-assignee') as HTMLSelectElement;
  assigneeEl.addEventListener('change', () => {
    assigneeFilter = assigneeEl.value;
    renderList();
  });

  const sortEl = rootEl.querySelector('#ck-sort') as HTMLSelectElement;
  sortEl.value = sortMode;
  sortEl.addEventListener('change', () => {
    sortMode = sortEl.value as SortMode;
    saveSortMode();
    renderList();
  });

  const quick = rootEl.querySelector('#ck-quick') as HTMLInputElement;
  quick.value = quickDraft;
  quick.addEventListener('input', () => { quickDraft = quick.value; });
  quick.addEventListener('keydown', (e) => {
    // 한글 조합 중 Enter는 글자 확정용 — 여기서 저장하면 반쪽 글자가 들어간다
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const title = quick.value.trim();
    if (!title) return;
    quick.value = '';
    quickDraft = '';
    void addItem({
      ...emptyDraft(),
      title,
      category: activeCategory === 'ALL' ? null : activeCategory,
      assignee_member_id: assigneeFilter !== 'ALL' && memberById(assigneeFilter) ? assigneeFilter : null,
      assignee_all: assigneeFilter === 'SHARED',
    });
  });

  const list = rootEl.querySelector('#ck-list') as HTMLElement;
  bindListEvents(list);
  if (scrollerEl) {
    unbindReorder = bindLongPressReorder({
      thread: list,
      scroller: scrollerEl,
      rowSelector: '.ck-item',
      ignoreSelector: 'button, input, a, select, textarea',
      handleSelector: '.ck-handle',
      longPressMs: 0,
      canStart: canReorder,
      onStart: () => { dragging = true; },
      onEnd: () => {
        dragging = false;
        if (reloadAfterDrag) {
          reloadAfterDrag = false;
          void reload();
        }
      },
      onDrop: (from, to) => { void dropReorder(from, to); },
    });
  }
}

/* ══════════════ 렌더 ══════════════ */

function renderAll(): void {
  renderCategories();
  renderAssigneeOptions();
  renderList();
  renderReady();
  renderSuggestions();
  renderDone();
  renderMust();
}

function renderCategories(): void {
  const el = rootEl?.querySelector('#ck-cats');
  if (!el) return;
  const byCat = progressByCategory(items);
  const tab = (key: string, label: string, count: string, icon = '') =>
    '<button type="button" class="ck-cat' + (activeCategory === key ? ' is-active' : '') + '" data-cat="' + key + '" role="tab" aria-selected="' + (activeCategory === key) + '">' +
    icon + '<span>' + label + '</span><span class="ck-cat-count">' + count + '</span></button>';
  el.innerHTML =
    tab('ALL', '전체', String(items.length)) +
    CK_CATEGORIES.map((c) => tab(c, CK_CATEGORY_LABEL[c], byCat[c].done + '/' + byCat[c].total)).join('');
  el.querySelectorAll<HTMLElement>('.ck-cat').forEach((btn) => {
    btn.addEventListener('click', () => setCategory(btn.dataset.cat as CkCategory | 'ALL'));
  });
}

function setCategory(cat: CkCategory | 'ALL'): void {
  activeCategory = cat;
  renderCategories();
  renderList();
  renderReady();
}

function renderAssigneeOptions(): void {
  const el = rootEl?.querySelector('#ck-assignee') as HTMLSelectElement | null;
  if (!el) return;
  if (assigneeFilter !== 'ALL' && !['ME', 'SHARED', 'NONE'].includes(assigneeFilter) && !memberById(assigneeFilter)) {
    assigneeFilter = 'ALL';
  }
  const opts: Array<[string, string]> = [['ALL', '전체'], ['ME', '내 항목'], ['SHARED', '공동'], ['NONE', '미지정']];
  for (const m of members) opts.push([m.id, memberLabel(m)]);
  el.innerHTML = opts.map(([v, l]) => '<option value="' + escapeHtml(v) + '">' + escapeHtml(l) + '</option>').join('');
  el.value = assigneeFilter;
  // 추가 정보 컬럼이 없으면 담당자가 저장되지 않으므로 필터도 의미가 없다
  (el.closest('.ck-select-wrap') as HTMLElement | null)?.classList.toggle('is-hidden', !isChecklistExtendedReady());
}

function renderList(): void {
  const list = rootEl?.querySelector('#ck-list') as HTMLElement | null;
  if (!list) return;
  const visible = visibleItems();
  list.classList.toggle('is-manual', canReorder());

  const note = rootEl?.querySelector('#ck-filter-note') as HTMLElement | null;
  if (note) {
    note.innerHTML = statusFilter === 'DONE'
      ? '<span class="ck-filter-chip">완료한 항목만 보는 중<button type="button" id="ck-clear-status" aria-label="완료 필터 해제">' + IC.close + '</button></span>'
      : '';
    note.querySelector('#ck-clear-status')?.addEventListener('click', () => {
      statusFilter = 'ALL';
      renderList();
    });
  }

  if (!items.length) {
    list.innerHTML =
      '<div class="ck-empty"><div class="ck-empty-title">아직 준비 항목이 없어요</div>' +
      '<div class="ck-empty-hint">오른쪽 추천에서 담거나, 아래 입력칸에 바로 적어 보세요.</div></div>';
    return;
  }
  if (!visible.length) {
    list.innerHTML =
      '<div class="ck-empty"><div class="ck-empty-title">조건에 맞는 항목이 없어요</div>' +
      '<button type="button" class="ck-btn-ghost" id="ck-reset-filter">필터 초기화</button></div>';
    list.querySelector('#ck-reset-filter')?.addEventListener('click', () => {
      activeCategory = 'ALL';
      assigneeFilter = 'ALL';
      statusFilter = 'ALL';
      renderAll();
    });
    return;
  }
  list.innerHTML = visible.map(itemHtml).join('');
}

function itemHtml(item: TripChecklistItem): string {
  const done = isDone(item);
  const cat = categoryOf(item);
  const pr = priorityOf(item);
  const due = done ? null : dueInfo(item.due_date ?? null, todayIso());
  const doc = docById(item.linked_doc_id ?? null);
  const expanded = expandedId === item.id;

  const meta: string[] = ['<span class="ck-meta-cat">' + CK_CATEGORY_LABEL[cat] + '</span>'];
  if (due) meta.push('<span class="ck-meta-due is-' + due.tone + '">' + escapeHtml(due.label) + '</span>');
  if (item.place_name) meta.push('<span class="ck-meta-place">' + IC.pin + escapeHtml(item.place_name) + '</span>');
  if (doc) meta.push('<span class="ck-meta-doc">' + IC.doc + escapeHtml(doc.title) + '</span>');
  if (item.memo) meta.push('<span class="ck-meta-memo" title="메모">' + IC.memo + '메모</span>');
  if (done && item.checked_by_name) meta.push('<span class="ck-meta-done">' + escapeHtml(item.checked_by_name) + ' 완료</span>');

  return [
    '<div class="ck-item' + (done ? ' is-done' : '') + (expanded ? ' is-expanded' : '') + '" data-id="' + item.id + '" role="listitem">',
    '  <div class="ck-row">',
    '    <button type="button" class="ck-handle" aria-label="끌어서 순서 바꾸기" title="끌어서 순서 바꾸기">' + IC.grip + '</button>',
    '    <button type="button" class="ck-check" data-toggle="' + item.id + '" role="checkbox" aria-checked="' + done + '" aria-label="' + escapeHtml(item.title) + ' 완료">' + IC.check + '</button>',
    '    <span class="ck-row-icon cat-' + cat.toLowerCase() + '">' + CAT_ICON[cat] + '</span>',
    '    <button type="button" class="ck-row-body" data-expand="' + item.id + '" aria-expanded="' + expanded + '">',
    '      <span class="ck-row-title">' + escapeHtml(item.title) + '</span>',
    '      <span class="ck-row-meta">' + meta.join('') + '</span>',
    '    </button>',
    '    <span class="ck-badge is-' + pr.toLowerCase() + '">' + CK_PRIORITY_LABEL[pr] + '</span>',
    '    ' + assigneeHtml(item),
    '  </div>',
    expanded ? detailHtml(item) : '',
    '</div>',
  ].join('');
}

function assigneeHtml(item: TripChecklistItem): string {
  if (item.assignee_all) return '<span class="ck-assignee is-shared" title="공동 담당">공동</span>';
  const m = memberById(item.assignee_member_id ?? null);
  if (!m) return '<span class="ck-assignee is-none" title="담당자 미지정"></span>';
  const inner = m.avatar_url
    ? '<img src="' + escapeHtml(m.avatar_url) + '" alt="" referrerpolicy="no-referrer" />'
    : escapeHtml((m.display_name || '?').charAt(0));
  return '<span class="ck-assignee" title="담당: ' + escapeHtml(memberLabel(m)) + '">' + inner + '</span>';
}

function detailHtml(item: TripChecklistItem): string {
  const doc = docById(item.linked_doc_id ?? null);
  const relCat = doc ? null : relatedDocCategory(item);
  const related = relCat ? sharedDocs.filter((d) => normalizeDocCategory(d.category) === relCat) : [];
  const assignee = item.assignee_all ? '공동' : memberById(item.assignee_member_id ?? null) ? memberLabel(memberById(item.assignee_member_id ?? null)!) : '미지정';

  const rows: string[] = [];
  rows.push(detailRow('담당', escapeHtml(assignee)));
  if (item.due_date) rows.push(detailRow('마감', escapeHtml(item.due_date.replace(/-/g, '.'))));
  rows.push(detailRow(
    '상태',
    isDone(item)
      ? '완료' + (item.checked_by_name ? ' · ' + escapeHtml(item.checked_by_name) : '') + (item.checked_at ? ' · ' + escapeHtml(formatDayTime(item.checked_at)) : '')
      : '아직 완료 전'
  ));
  if (item.place_name) rows.push(detailRow('장소', escapeHtml(item.place_name)));

  let docHtml = '';
  if (doc) {
    docHtml = '<button type="button" class="ck-doc-link" data-open-doc="' + doc.id + '">' + IC.doc + '<span>' + escapeHtml(doc.title) + '</span>' + IC.chevron + '</button>';
  } else if (related.length) {
    // 연결은 사용자가 고른다 — 관련 문서가 있다는 사실만 알려주고, 체크를 대신 해주지 않는다
    docHtml =
      '<div class="ck-doc-hint">' + escapeHtml(DOC_CATEGORY_LABEL[normalizeDocCategory(relCat)]) + ' 문서 ' + related.length + '건이 있어요</div>' +
      related.slice(0, 3).map((d) => '<button type="button" class="ck-doc-link" data-open-doc="' + d.id + '">' + IC.doc + '<span>' + escapeHtml(d.title) + '</span>' + IC.chevron + '</button>').join('');
  }

  return [
    '<div class="ck-detail">',
    item.memo ? '  <p class="ck-detail-memo">' + escapeHtml(item.memo) + '</p>' : '',
    '  <dl class="ck-detail-rows">' + rows.join('') + '</dl>',
    docHtml ? '  <div class="ck-detail-docs">' + docHtml + '</div>' : '',
    '  <div class="ck-detail-actions">',
    '    <button type="button" class="ck-btn-ghost" data-edit="' + item.id + '">수정</button>',
    '    <button type="button" class="ck-btn-ghost is-danger" data-delete="' + item.id + '">삭제</button>',
    '  </div>',
    '</div>',
  ].join('');
}

function detailRow(label: string, valueHtml: string): string {
  return '<div class="ck-detail-row"><dt>' + label + '</dt><dd>' + valueHtml + '</dd></div>';
}

/** 목록 이벤트는 컨테이너 하나에 위임 — innerHTML을 갈아끼워도 다시 붙일 필요가 없다 */
function bindListEvents(list: HTMLElement): void {
  list.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const toggle = t.closest<HTMLElement>('[data-toggle]');
    if (toggle) return void toggleItem(toggle.dataset.toggle!);
    const expand = t.closest<HTMLElement>('[data-expand]');
    if (expand) {
      const id = expand.dataset.expand!;
      expandedId = expandedId === id ? null : id;
      renderList();
      return;
    }
    const edit = t.closest<HTMLElement>('[data-edit]');
    if (edit) return openSheet(items.find((i) => i.id === edit.dataset.edit) ?? null);
    const del = t.closest<HTMLElement>('[data-delete]');
    if (del) return void removeItem(del.dataset.delete!);
    const doc = t.closest<HTMLElement>('[data-open-doc]');
    if (doc) return openDocument(doc.dataset.openDoc!);
  });
}

/* ── 오른쪽: 준비 현황 ── */

function renderReady(): void {
  const el = rootEl?.querySelector('#ck-ready');
  if (!el) return;
  const p = progressOf(items);
  const byCat = progressByCategory(items);
  const today = todayIso();
  const overdue = items.filter((i) => !isDone(i) && i.due_date && dueInfo(i.due_date, today)?.tone === 'overdue').length;
  const countdown = trip ? tripCountdown(trip.start_date, trip.end_date, todayIso()) : null;
  const r = 30;
  const circ = 2 * Math.PI * r;
  const summary = !p.total
    ? ''
    : p.done === p.total
      ? '모든 준비를 마쳤어요.'
      : '남은 항목 ' + (p.total - p.done) + '개' + (overdue ? ' · 마감 지난 항목 ' + overdue + '개' : '');

  el.innerHTML = [
    '<div class="ck-ready-eyebrow"><span class="ck-card-eyebrow">TRIP READINESS</span>' +
      (countdown ? '<span class="ck-dday">' + escapeHtml(countdown) + '</span>' : '') + '</div>',
    '<div class="ck-ready-top">',
    '  <svg class="ck-ring" viewBox="0 0 72 72" aria-hidden="true">',
    '    <circle cx="36" cy="36" r="' + r + '" class="ck-ring-track"/>',
    '    <circle cx="36" cy="36" r="' + r + '" class="ck-ring-fill" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + (circ * (1 - p.pct / 100)).toFixed(1) + '"/>',
    '  </svg>',
    '  <div class="ck-ready-text">',
    '    <div class="ck-ready-pct">' + p.pct + '<span>%</span></div>',
    '    <div class="ck-ready-count">' + p.total + '개 중 ' + p.done + '개 완료</div>',
    summary ? '    <div class="ck-ready-summary' + (overdue ? ' is-warn' : '') + '">' + escapeHtml(summary) + '</div>' : '',
    '  </div>',
    '</div>',
    '<div class="ck-ready-cats">',
    CK_CATEGORIES.map((c) => {
      const cp = byCat[c];
      return (
        '<button type="button" class="ck-ready-cat' + (activeCategory === c ? ' is-active' : '') + '" data-cat="' + c + '">' +
        '<span class="ck-ready-cat-icon">' + CAT_ICON[c] + '</span>' +
        '<span class="ck-ready-cat-label">' + CK_CATEGORY_LABEL[c] + '</span>' +
        '<span class="ck-ready-cat-count">' + cp.done + '/' + cp.total + '</span>' +
        '<span class="ck-bar"><span style="width:' + cp.pct + '%"></span></span>' +
        '</button>'
      );
    }).join(''),
    '</div>',
  ].join('');
  el.querySelectorAll<HTMLElement>('.ck-ready-cat').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = btn.dataset.cat as CkCategory;
      setCategory(activeCategory === c ? 'ALL' : c);
      rootEl?.querySelector('.ck-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/* ── 오른쪽: 스마트 추천 ── */

/** 기본으로 보여줄 추천 개수 — 화면이 클수록 오른쪽 아래가 비지 않게 더 보여준다 */
function suggestionPreview(): number {
  const h = window.innerHeight;
  return h >= 980 ? 6 : h >= 840 ? 5 : 3;
}

function renderSuggestions(): void {
  const el = rootEl?.querySelector('#ck-suggest');
  if (!el) return;
  const all = smartSuggestions();
  const visible = all.filter((s) => !dismissed.has(s.key));
  const hiddenCount = all.length - visible.length;
  const shown = showAllSuggestions ? visible : visible.slice(0, suggestionPreview());
  const hasAnyFacts = !!facts && buildSmartSuggestions(facts).length > 0;

  let body: string;
  if (!hasAnyFacts) {
    body = '<div class="ck-side-empty">여행지·숙소·항공 정보를 입력하면 그에 맞는 준비 항목을 찾아 드려요.</div>';
  } else if (!visible.length) {
    body = '<div class="ck-side-empty">' + (hiddenCount ? '남은 추천을 모두 숨겼어요.' : '추천 항목을 모두 담았어요.') + '</div>';
  } else {
    body = '<div class="ck-sugg-list">' + shown.map(suggestionHtml).join('') + '</div>';
  }

  const moreBtn = visible.length > suggestionPreview()
    ? '<button type="button" class="ck-link-btn" id="ck-sugg-more">' + (showAllSuggestions ? '접기' : '전체 보기 (' + visible.length + ')') + '</button>'
    : '';
  const restoreBtn = hiddenCount && (showAllSuggestions || !visible.length)
    ? '<div class="ck-card-foot"><button type="button" class="ck-link-btn is-muted" id="ck-sugg-restore">숨긴 추천 ' + hiddenCount + '개 다시 보기</button></div>'
    : '';

  el.innerHTML = [
    '<div class="ck-sugg-head"><span class="ck-card-eyebrow">' + IC.sparkle + 'SMART SUGGESTIONS</span>' + moreBtn + '</div>',
    body,
    restoreBtn,
  ].join('');

  el.querySelectorAll<HTMLElement>('[data-sugg-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = all.find((x) => x.key === btn.dataset.suggAdd);
      if (s) void addSuggestion(s, btn);
    });
  });
  el.querySelectorAll<HTMLElement>('[data-sugg-hide]').forEach((btn) => {
    btn.addEventListener('click', () => {
      dismissed.add(btn.dataset.suggHide!);
      saveDismissed();
      renderSuggestions();
    });
  });
  el.querySelector('#ck-sugg-more')?.addEventListener('click', () => {
    showAllSuggestions = !showAllSuggestions;
    renderSuggestions();
  });
  el.querySelector('#ck-sugg-restore')?.addEventListener('click', () => {
    for (const s of all) dismissed.delete(s.key);
    saveDismissed();
    renderSuggestions();
  });
}

function suggestionHtml(s: Suggestion): string {
  return [
    '<div class="ck-sugg">',
    '  <span class="ck-sugg-icon cat-' + s.category.toLowerCase() + '">' + CAT_ICON[s.category] + '</span>',
    '  <div class="ck-sugg-text">',
    '    <div class="ck-sugg-title">' + escapeHtml(s.title) + '<span class="ck-sugg-source">' + SOURCE_LABEL[s.source] + '</span></div>',
    '    <div class="ck-sugg-reason">' + escapeHtml(s.reason) + '</div>',
    '  </div>',
    '  <div class="ck-sugg-actions">',
    '    <button type="button" class="ck-btn-small" data-sugg-add="' + s.key + '">' + IC.plus + '추가</button>',
    '    <button type="button" class="ck-icon-btn" data-sugg-hide="' + s.key + '" aria-label="이 추천 숨기기" title="숨기기">' + IC.close + '</button>',
    '  </div>',
    '</div>',
  ].join('');
}

/* ── 오른쪽: 완료한 항목 ── */

function renderDone(): void {
  const el = rootEl?.querySelector('#ck-done');
  if (!el) return;
  const recent = recentlyDone(items, 3);
  const total = items.filter(isDone).length;
  el.innerHTML = [
    '<div class="ck-card-head">',
    '  <div class="ck-card-title">완료한 항목</div>',
    total ? '  <button type="button" class="ck-link-btn" id="ck-done-all">모두 보기 (' + total + ')</button>' : '',
    '</div>',
    recent.length
      ? '<ul class="ck-done-list">' + recent.map((i) =>
          '<li class="ck-done-row"><span class="ck-done-check">' + IC.check + '</span>' +
          '<span class="ck-done-title">' + escapeHtml(i.title) + '</span>' +
          '<span class="ck-done-when">' + escapeHtml([i.checked_by_name, i.checked_at ? formatDayTime(i.checked_at) : null].filter(Boolean).join(' · ')) + '</span></li>'
        ).join('') + '</ul>'
      : '<div class="ck-side-empty">아직 완료한 항목이 없어요.</div>',
  ].join('');
  el.querySelector('#ck-done-all')?.addEventListener('click', () => {
    statusFilter = 'DONE';
    activeCategory = 'ALL';
    renderCategories();
    renderList();
    renderReady();
    rootEl?.querySelector('.ck-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/* ── 오른쪽: 여행 전 꼭 확인하세요 ── */

function renderMust(): void {
  const el = rootEl?.querySelector('#ck-must');
  if (!el) return;
  const list = mustChecks();
  const remaining = list.filter((s) => !isSuggestionTaken(s, items));
  el.innerHTML = [
    '<div class="ck-card-head">',
    '  <div class="ck-card-title">여행 전 꼭 확인하세요</div>',
    remaining.length > 1 ? '  <button type="button" class="ck-link-btn" id="ck-must-all">모두 추가</button>' : '',
    '</div>',
    '<ul class="ck-must-list">',
    list.map((s) => {
      const taken = isSuggestionTaken(s, items);
      return (
        '<li class="ck-must-row' + (taken ? ' is-taken' : '') + '" title="' + escapeHtml(s.reason) + '">' +
        '<span class="ck-must-title">' + escapeHtml(s.title) +
        (s.officialCheck ? '<span class="ck-official">공식 확인</span>' : '') + '</span>' +
        (taken
          ? '<span class="ck-must-state" aria-label="담김">' + IC.check + '</span>'
          : '<button type="button" class="ck-must-add" data-must-add="' + s.key + '" aria-label="' + escapeHtml(s.title) + ' 추가">' + IC.plus + '</button>') +
        '</li>'
      );
    }).join(''),
    '</ul>',
  ].join('');
  el.querySelectorAll<HTMLElement>('[data-must-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = list.find((x) => x.key === btn.dataset.mustAdd);
      if (s) void addSuggestion(s, btn);
    });
  });
  el.querySelector('#ck-must-all')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    void (async () => {
      for (const s of remaining) await addSuggestion(s, null, false);
      await reload();
    })();
  });
}

/* ══════════════ 동작 ══════════════ */

function emptyDraft(): ChecklistDraft {
  return {
    title: '',
    category: null,
    priority: null,
    assignee_member_id: null,
    assignee_all: false,
    due_date: null,
    memo: null,
    linked_doc_id: null,
  };
}

function nextSortOrder(): number {
  return items.reduce((m, i) => Math.max(m, i.sort_order), 0) + 1;
}

async function addItem(draft: ChecklistDraft, refresh = true): Promise<boolean> {
  const created = await addChecklistItemDetailed(currentTripId, draft, nextSortOrder());
  if (!created) {
    alert('항목을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    return false;
  }
  // 실시간 이벤트를 기다리지 않고 바로 반영(자기 쓰기 echo는 억제돼 있다)
  if (!items.some((i) => i.id === created.id)) items = [...items, created];
  if (refresh) renderAll();
  return true;
}

/** 추천을 체크리스트에 넣는다 — 해당 분류의 공용 문서가 딱 하나면 자동으로 연결 */
async function addSuggestion(s: Suggestion, btn: HTMLElement | null, refresh = true): Promise<void> {
  if (isSuggestionTaken(s, items)) return;
  if (btn) (btn as HTMLButtonElement).disabled = true;
  const docs = s.docCategory ? sharedDocs.filter((d) => normalizeDocCategory(d.category) === s.docCategory) : [];
  const ok = await addItem(
    {
      ...emptyDraft(),
      title: s.title,
      category: s.category,
      priority: s.priority,
      linked_doc_id: docs.length === 1 ? docs[0].id : null,
      suggestion_key: s.key,
    },
    refresh
  );
  if (!ok && btn) (btn as HTMLButtonElement).disabled = false;
}

async function toggleItem(id: string): Promise<void> {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  const next = !isDone(item);
  const user = store.get('user');
  const meta = user?.user_metadata ?? {};
  // 낙관적 반영 — 체크는 가장 자주 하는 동작이라 서버 왕복을 기다리지 않는다
  items = items.map((i) =>
    i.id === id
      ? {
          ...i,
          checked_at: next ? new Date().toISOString() : null,
          checked_by: next ? user?.id ?? null : null,
          checked_by_name: next ? meta.full_name || meta.name || user?.email || null : null,
        }
      : i
  );
  renderAll();
  const ok = await setChecklistChecked(id, next);
  if (!ok) {
    alert('체크 상태를 저장하지 못했어요.');
    await reload();
  }
}

async function removeItem(id: string): Promise<void> {
  const item = items.find((i) => i.id === id);
  if (!item || !confirm('“' + item.title + '” 항목을 삭제할까요?')) return;
  items = items.filter((i) => i.id !== id);
  if (expandedId === id) expandedId = null;
  renderAll();
  const ok = await deleteChecklistItem(id);
  if (!ok) {
    alert('삭제하지 못했어요.');
    await reload();
  }
}

async function dropReorder(from: number, to: number): Promise<void> {
  const before = visibleItems();
  const after = moveItem(before, from, to);
  const changes = reorderChanges(before, after);
  if (!changes.length) return;
  const byId = new Map(changes.map((c) => [c.id, c.sort_order]));
  items = items.map((i) => (byId.has(i.id) ? { ...i, sort_order: byId.get(i.id)! } : i));
  renderList();
  const ok = await saveChecklistOrder(changes);
  if (!ok) {
    alert('순서를 저장하지 못했어요.');
    await reload();
  }
}

function openDocument(docId: string): void {
  requestDocFocus(currentTripId, docId);
  window.dispatchEvent(new CustomEvent('mongsil:navigateGate', { detail: { tripId: currentTripId, gate: 'docs' } }));
}

/* ══════════════ 추가 · 수정 시트 ══════════════ */

function openSheet(item: TripChecklistItem | null): void {
  closeSheet();
  const extended = isChecklistExtendedReady();
  const draft: ChecklistDraft = item
    ? {
        title: item.title,
        category: item.category ?? null,
        priority: item.priority ?? null,
        assignee_member_id: item.assignee_member_id ?? null,
        assignee_all: item.assignee_all === true,
        due_date: item.due_date ?? null,
        memo: item.memo ?? null,
        linked_doc_id: item.linked_doc_id ?? null,
      }
    : { ...emptyDraft(), category: activeCategory === 'ALL' ? null : activeCategory };
  let pickedCategory: CkCategory = item ? categoryOf(item) : draft.category ? (draft.category as CkCategory) : 'ESSENTIAL';
  let pickedPriority: CkPriority = item ? priorityOf(item) : 'NORMAL';

  const assigneeValue = draft.assignee_all ? 'SHARED' : draft.assignee_member_id ?? '';
  const docOptions = sharedDocs
    .map((d) => '<option value="' + d.id + '"' + (d.id === draft.linked_doc_id ? ' selected' : '') + '>' +
      escapeHtml('[' + DOC_CATEGORY_LABEL[normalizeDocCategory(d.category)] + '] ' + d.title) + '</option>')
    .join('');

  const layer = document.createElement('div');
  layer.className = 'ck-sheet-layer';
  layer.innerHTML = [
    '<div class="ck-sheet-overlay" data-close></div>',
    '<div class="ck-sheet" role="dialog" aria-modal="true" aria-labelledby="ck-sheet-title">',
    '  <div class="ck-sheet-head">',
    '    <div class="ck-sheet-title" id="ck-sheet-title">' + (item ? '항목 수정' : '항목 추가') + '</div>',
    '    <button type="button" class="ck-icon-btn" data-close aria-label="닫기">' + IC.close + '</button>',
    '  </div>',
    '  <form class="ck-sheet-body" id="ck-sheet-form" novalidate>',
    '    <label class="ck-field"><span class="ck-field-label">항목 이름</span>',
    '      <input type="text" class="ck-input" id="ck-f-title" maxlength="80" required value="' + escapeHtml(draft.title) + '" placeholder="예: 여권 챙기기" /></label>',
    extended ? [
      '    <div class="ck-field"><span class="ck-field-label">카테고리</span><div class="ck-pick" id="ck-f-cat">' +
        CK_CATEGORIES.map((c) => '<button type="button" class="ck-pick-item' + (c === pickedCategory ? ' is-active' : '') + '" data-cat="' + c + '">' + CAT_ICON[c] + CK_CATEGORY_LABEL[c] + '</button>').join('') +
        '</div></div>',
      '    <div class="ck-field"><span class="ck-field-label">중요도</span><div class="ck-radio-row" id="ck-f-pri">' +
        CK_PRIORITIES.map((p) => '<button type="button" class="ck-radio is-' + p.toLowerCase() + (p === pickedPriority ? ' is-active' : '') + '" data-pri="' + p + '">' + CK_PRIORITY_LABEL[p] + '</button>').join('') +
        '</div></div>',
      '    <div class="ck-field-row">',
      '      <label class="ck-field"><span class="ck-field-label">담당자</span><select class="ck-input ck-select-input" id="ck-f-assignee">' +
        '<option value="">미지정</option><option value="SHARED"' + (assigneeValue === 'SHARED' ? ' selected' : '') + '>공동</option>' +
        members.map((m) => '<option value="' + m.id + '"' + (assigneeValue === m.id ? ' selected' : '') + '>' + escapeHtml(memberLabel(m)) + '</option>').join('') +
        '</select></label>',
      '      <label class="ck-field"><span class="ck-field-label">마감일 <em>선택</em></span><input type="date" class="ck-input" id="ck-f-due" value="' + escapeHtml(draft.due_date ?? '') + '" /></label>',
      '    </div>',
      '    <label class="ck-field"><span class="ck-field-label">메모 <em>선택</em></span><textarea class="ck-input ck-textarea" id="ck-f-memo" rows="3" maxlength="500" placeholder="필요한 내용을 적어 두세요">' + escapeHtml(draft.memo ?? '') + '</textarea></label>',
      sharedDocs.length
        ? '    <label class="ck-field"><span class="ck-field-label">연결 문서 <em>선택 · 공용 문서만</em></span><select class="ck-input ck-select-input" id="ck-f-doc"><option value="">연결 안 함</option>' + docOptions + '</select></label>'
        : '',
    ].join('\n') : '    <div class="ck-field-hint">분류·담당자·마감일은 데이터베이스 업데이트 후 저장할 수 있어요. 지금은 이름만 저장돼요.</div>',
    '  </form>',
    '  <div class="ck-sheet-foot">',
    item ? '    <button type="button" class="ck-btn-ghost is-danger" id="ck-f-delete">삭제</button>' : '',
    '    <button type="button" class="ck-btn-ghost" data-close>취소</button>',
    '    <button type="submit" form="ck-sheet-form" class="ck-btn-primary" id="ck-f-save">' + (item ? '저장' : '추가') + '</button>',
    '  </div>',
    '</div>',
  ].join('\n');
  document.body.appendChild(layer);
  sheetLayer = layer;
  requestAnimationFrame(() => layer.classList.add('is-open'));

  const titleEl = layer.querySelector('#ck-f-title') as HTMLInputElement;
  setTimeout(() => titleEl.focus(), 60);

  layer.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', closeSheet));
  sheetKeyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', sheetKeyHandler);

  layer.querySelectorAll<HTMLElement>('#ck-f-cat .ck-pick-item').forEach((b) => {
    b.addEventListener('click', () => {
      pickedCategory = b.dataset.cat as CkCategory;
      layer.querySelectorAll('#ck-f-cat .ck-pick-item').forEach((x) => x.classList.toggle('is-active', x === b));
    });
  });
  layer.querySelectorAll<HTMLElement>('#ck-f-pri .ck-radio').forEach((b) => {
    b.addEventListener('click', () => {
      pickedPriority = b.dataset.pri as CkPriority;
      layer.querySelectorAll('#ck-f-pri .ck-radio').forEach((x) => x.classList.toggle('is-active', x === b));
    });
  });

  layer.querySelector('#ck-f-delete')?.addEventListener('click', () => {
    if (!item) return;
    closeSheet();
    void removeItem(item.id);
  });

  const form = layer.querySelector('#ck-sheet-form') as HTMLFormElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = titleEl.value.trim();
    if (!title) {
      titleEl.classList.add('is-invalid');
      titleEl.focus();
      return;
    }
    const assignee = (layer.querySelector('#ck-f-assignee') as HTMLSelectElement | null)?.value ?? '';
    const next: ChecklistDraft = {
      title,
      category: extended ? pickedCategory : null,
      priority: extended ? pickedPriority : null,
      assignee_all: assignee === 'SHARED',
      assignee_member_id: assignee && assignee !== 'SHARED' ? assignee : null,
      due_date: (layer.querySelector('#ck-f-due') as HTMLInputElement | null)?.value || null,
      memo: (layer.querySelector('#ck-f-memo') as HTMLTextAreaElement | null)?.value ?? null,
      linked_doc_id: (layer.querySelector('#ck-f-doc') as HTMLSelectElement | null)?.value || (sharedDocs.length ? null : draft.linked_doc_id),
    };
    const saveBtn = layer.querySelector('#ck-f-save') as HTMLButtonElement;
    saveBtn.disabled = true;
    void (async () => {
      if (item) {
        const ok = await updateChecklistItem(item.id, next);
        if (!ok) {
          saveBtn.disabled = false;
          alert('수정 내용을 저장하지 못했어요.');
          return;
        }
        closeSheet();
        await reload();
      } else {
        const ok = await addItem(next);
        if (!ok) {
          saveBtn.disabled = false;
          return;
        }
        closeSheet();
      }
    })();
  });
}

function closeSheet(): void {
  if (sheetKeyHandler) {
    document.removeEventListener('keydown', sheetKeyHandler);
    sheetKeyHandler = null;
  }
  const layer = sheetLayer;
  sheetLayer = null;
  if (!layer) return;
  layer.classList.remove('is-open');
  setTimeout(() => layer.remove(), 200);
}
