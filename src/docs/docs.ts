/**
 * DOCUMENTS & NOTES 게이트 — 여행 문서함(개인 금고 + 공용 문서함)과 준비 메모를 한곳에.
 *
 * 화면 구성은 파일 관리자가 아니라 "여행용 문서 지갑"에 가깝게 잡았다:
 *   - 폴더를 만들지 않는다. 분류는 카테고리 칩과 개인/공용 두 갈래뿐이라 항상 1~2번 클릭이면 닿는다.
 *   - 문서를 클릭하면 페이지를 옮기지 않고 오른쪽 상세 패널이 열린다(좁은 화면에선 전체 화면).
 *   - DOCUMENTS = 원본 자료(파일), NOTES = 기억해둘 정보(텍스트) — 역할을 섞지 않는다.
 *
 * 데이터 입출력은 전부 docsStore.ts를 통한다. 개인 문서 잠금(PIN)에 대한 정직한 설명도
 * 거기 주석에 있다 — 요약하면 "멤버끼리 문서를 섞이지 않게 하는 잠금"이지 보안 인증이 아니다.
 */

import { supabase } from '../supabase';
import { store } from '../store';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Trip, TripDocUser, TripDocument } from '../types/database';
import {
  ACCEPTED_FILE_TYPES,
  DOC_CATEGORIES,
  DOC_CATEGORY_LABEL,
  MAX_FILE_BYTES,
  createDocUser,
  createDocument,
  clearUnlockedUser,
  dayDateRangeLabel,
  dayRangeLabel,
  deleteDocument,
  getLastScope,
  getLastTab,
  getUnlockedUserId,
  isStorageReady,
  isValidPin,
  loadDocUsers,
  loadPersonalDocuments,
  loadSharedDocuments,
  normalizeDocCategory,
  resetDocsStore,
  setLastScope,
  setLastTab,
  setUnlockedUserId,
  signedUrlFor,
  tripDayCount,
  updateDocument,
  uploadDocFile,
  verifyPin,
} from './docsStore';
import type { DocCategory, DocScope, DocsTab, UploadedFile } from './docsStore';
import {
  DOC_CATEGORY_ICON,
  IC,
  escapeHtml,
  fileKindLabel,
  formatDayTime,
  formatFileSize,
  isPreviewable,
} from './docsIcons';
import {
  initNotes,
  mountNotes,
  noteCount,
  notesMatchCount,
  openNoteEditor,
  refreshNotes,
  teardownNotes,
  unmountNotes,
} from './notes';
import './docs.css';

/* ══════════════ 모듈 상태 ══════════════ */

let rootEl: HTMLElement | null = null;
let currentTripId = '';
let trip: Trip | null = null;
let tab: DocsTab = 'documents';
let scope: DocScope = 'SHARED';
let searchQuery = '';

let docUsers: TripDocUser[] = [];
let unlockedUser: TripDocUser | null = null;
let sharedDocs: TripDocument[] = [];
let personalDocs: TripDocument[] = [];
let selectedDocId: string | null = null;
let docSort: 'recent' | 'oldest' = 'recent';

let channel: RealtimeChannel | null = null;
let sheetOpen = false;

/* ══════════════ 진입 / 정리 ══════════════ */

export function teardownDocs(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  teardownNotes();
  resetDocsStore();
  rootEl = null;
  currentTripId = '';
  trip = null;
  docUsers = [];
  unlockedUser = null;
  sharedDocs = [];
  personalDocs = [];
  selectedDocId = null;
  searchQuery = '';
  sheetOpen = false;
}

export async function renderDocsContent(
  container: HTMLElement,
  tripId: string,
  initialTab?: DocsTab
): Promise<void> {
  teardownDocs();
  currentTripId = tripId;
  tab = initialTab ?? getLastTab(tripId);
  scope = getLastScope(tripId);

  container.innerHTML = shellHtml();
  rootEl = container.querySelector('.dn-wrap') as HTMLElement;
  bindShell();

  trip = store.get('currentTrip');
  if (!trip || trip.id !== tripId) {
    const { data } = await supabase.from('trips').select('*').eq('id', tripId).single();
    if (data) trip = data as Trip;
  }

  docUsers = await loadDocUsers(tripId);
  restoreUnlocked();
  sharedDocs = await loadSharedDocuments(tripId);
  if (unlockedUser) personalDocs = await loadPersonalDocuments(tripId, unlockedUser.id);

  await initNotes({
    tripId,
    trip,
    getSearch: () => searchQuery,
    onDataChange: () => {
      if (tab === 'documents') renderCrossHint();
      updateTabCounts();
    },
  });

  subscribeRealtime(tripId);
  renderTab();
}

/** 이전에 이 탭에서 잠금을 풀어둔 사용자가 있으면 그대로 이어간다(탭을 닫으면 잠김) */
function restoreUnlocked(): void {
  const savedId = getUnlockedUserId(currentTripId);
  unlockedUser = savedId ? docUsers.find((u) => u.id === savedId) ?? null : null;
  if (savedId && !unlockedUser) clearUnlockedUser(currentTripId);
}

function subscribeRealtime(tripId: string): void {
  channel = supabase
    .channel('trip-documents:' + tripId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trip_documents', filter: 'trip_id=eq.' + tripId },
      (payload) => {
        const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as TripDocument;
        // 개인 문서는 잠금이 풀린 본인 것만 화면에 들인다 — 남의 개인 문서는 받아도 무시
        const isMine = row.visibility === 'PERSONAL' && unlockedUser && row.owner_id === unlockedUser.id;
        if (row.visibility !== 'SHARED' && !isMine) return;

        const list = row.visibility === 'SHARED' ? sharedDocs : personalDocs;
        if (payload.eventType === 'INSERT') {
          if (!list.some((d) => d.id === row.id)) list.unshift(row);
        } else if (payload.eventType === 'UPDATE') {
          const idx = list.findIndex((d) => d.id === row.id);
          if (idx !== -1) list[idx] = row;
        } else {
          const filtered = list.filter((d) => d.id !== row.id);
          if (row.visibility === 'SHARED') sharedDocs = filtered;
          else personalDocs = filtered;
          if (selectedDocId === row.id) selectedDocId = null;
        }
        if (tab === 'documents') renderDocuments();
        updateTabCounts();
      }
    )
    .subscribe();
}

/* ══════════════ 셸 ══════════════ */

function shellHtml(): string {
  return [
    '<div class="dn-wrap">',
    '  <div class="dn-head">',
    '    <div class="dn-tabs" role="tablist">',
    '      <button type="button" class="dn-tab" data-tab="documents" role="tab">DOCUMENTS<span class="dn-tab-count" id="dn-count-doc"></span></button>',
    '      <button type="button" class="dn-tab" data-tab="notes" role="tab">NOTES<span class="dn-tab-count" id="dn-count-note"></span></button>',
    '    </div>',
    '    <div class="dn-head-actions">',
    '      <div class="dn-search">',
    '        ' + IC.search,
    '        <input type="search" id="dn-search" placeholder="문서와 메모 검색" autocomplete="off" />',
    '      </div>',
    '      <button type="button" class="dn-btn-primary" id="dn-add">' + IC.plus + '<span id="dn-add-label">문서 추가</span></button>',
    '    </div>',
    '  </div>',
    '  <div class="dn-cross-hint" id="dn-cross-hint"></div>',
    '  <div class="dn-panel" id="dn-panel"></div>',
    '</div>',
  ].join('\n');
}

function bindShell(): void {
  if (!rootEl) return;

  rootEl.querySelectorAll('.dn-tab').forEach((el) => {
    el.addEventListener('click', () => {
      const next = (el as HTMLElement).dataset.tab as DocsTab;
      if (next === tab) return;
      tab = next;
      setLastTab(currentTripId, tab);
      renderTab();
    });
  });

  const searchEl = rootEl.querySelector('#dn-search') as HTMLInputElement;
  searchEl.addEventListener('input', () => {
    searchQuery = searchEl.value;
    if (tab === 'documents') renderDocuments();
    else refreshNotes();
    renderCrossHint();
  });

  rootEl.querySelector('#dn-add')?.addEventListener('click', () => {
    if (tab === 'notes') openNoteEditor();
    else openDocumentSheet(null);
  });
}

function renderTab(): void {
  if (!rootEl) return;
  rootEl.querySelectorAll('.dn-tab').forEach((el) => {
    el.classList.toggle('is-active', (el as HTMLElement).dataset.tab === tab);
    el.setAttribute('aria-selected', String((el as HTMLElement).dataset.tab === tab));
  });

  const addLabel = rootEl.querySelector('#dn-add-label');
  if (addLabel) addLabel.textContent = tab === 'notes' ? '새 메모' : '문서 추가';

  const panel = rootEl.querySelector('#dn-panel') as HTMLElement;
  if (tab === 'notes') {
    selectedDocId = null;
    mountNotes(panel);
    renderCrossHint();
  } else {
    unmountNotes();
    renderDocuments();
  }
  updateTabCounts();
}

function updateTabCounts(): void {
  if (!rootEl) return;
  const docEl = rootEl.querySelector('#dn-count-doc');
  const noteEl = rootEl.querySelector('#dn-count-note');
  const docTotal = sharedDocs.length + personalDocs.length;
  if (docEl) docEl.textContent = docTotal > 0 ? String(docTotal) : '';
  if (noteEl) noteEl.textContent = noteCount() > 0 ? String(noteCount()) : '';
}

/** 다른 탭에도 검색 결과가 있으면 한 줄로 알려준다 — 탭을 오가며 찾지 않아도 되도록 */
function renderCrossHint(): void {
  const hintEl = rootEl?.querySelector('#dn-cross-hint') as HTMLElement | null;
  if (!hintEl) return;
  const q = searchQuery.trim();
  if (!q) {
    hintEl.innerHTML = '';
    return;
  }
  const count = tab === 'documents' ? notesMatchCount(q) : docMatchCount(q);
  if (count === 0) {
    hintEl.innerHTML = '';
    return;
  }
  const target = tab === 'documents' ? '메모' : '문서';
  hintEl.innerHTML =
    '<button type="button" class="dn-cross-link" id="dn-cross-go">' +
    escapeHtml(target) + '에서도 ' + count + '건 찾았어요' + IC.chevron + '</button>';
  hintEl.querySelector('#dn-cross-go')?.addEventListener('click', () => {
    tab = tab === 'documents' ? 'notes' : 'documents';
    setLastTab(currentTripId, tab);
    renderTab();
  });
}

function docMatchCount(query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  return [...sharedDocs, ...personalDocs].filter((d) => matchesDoc(d, q)).length;
}

/* ══════════════ DOCUMENTS ══════════════ */

function currentDocs(): TripDocument[] {
  return scope === 'SHARED' ? sharedDocs : personalDocs;
}

function matchesDoc(doc: TripDocument, q: string): boolean {
  const haystack = [
    doc.title,
    doc.description,
    doc.reference_code,
    doc.file_name,
    DOC_CATEGORY_LABEL[normalizeDocCategory(doc.category)],
    doc.uploaded_by_name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

function visibleDocs(): TripDocument[] {
  const q = searchQuery.trim().toLowerCase();
  const list = currentDocs().filter((d) => (q ? matchesDoc(d, q) : true));
  return list.sort((a, b) =>
    docSort === 'oldest' ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)
  );
}

function renderDocuments(): void {
  const panel = rootEl?.querySelector('#dn-panel') as HTMLElement | null;
  if (!panel) return;

  panel.innerHTML = [
    '<div class="dn-docs">',
    '  <div class="dn-subbar">',
    '    <div class="dn-segment" role="tablist">',
    '      <button type="button" class="dn-segment-item' + (scope === 'PERSONAL' ? ' is-active' : '') + '" data-scope="PERSONAL">' +
      IC.lock + '<span>PERSONAL</span></button>',
    '      <button type="button" class="dn-segment-item' + (scope === 'SHARED' ? ' is-active' : '') + '" data-scope="SHARED">' +
      IC.users + '<span>SHARED</span></button>',
    '    </div>',
    '    <label class="dn-sort">',
    '      <select id="dn-doc-sort" aria-label="문서 정렬">',
    '        <option value="recent">최근순</option>',
    '        <option value="oldest">오래된순</option>',
    '      </select>',
    '    </label>',
    '  </div>',
    '  <div class="dn-doc-layout" id="dn-doc-layout">',
    '    <div class="dn-doc-main" id="dn-doc-main"></div>',
    '    <aside class="dn-detail" id="dn-detail" aria-live="polite"></aside>',
    '  </div>',
    '</div>',
  ].join('\n');

  panel.querySelectorAll('.dn-segment-item').forEach((el) => {
    el.addEventListener('click', () => {
      const next = (el as HTMLElement).dataset.scope as DocScope;
      if (next === scope) return;
      scope = next;
      setLastScope(currentTripId, scope);
      selectedDocId = null;
      renderDocuments();
    });
  });

  const sortEl = panel.querySelector('#dn-doc-sort') as HTMLSelectElement;
  sortEl.value = docSort;
  sortEl.addEventListener('change', () => {
    docSort = sortEl.value as 'recent' | 'oldest';
    renderDocMain();
  });

  renderDocMain();
  renderDetail();
}

function renderDocMain(): void {
  const mainEl = rootEl?.querySelector('#dn-doc-main') as HTMLElement | null;
  if (!mainEl) return;

  if (!isStorageReady()) {
    mainEl.innerHTML = migrationNoticeHtml();
    return;
  }

  if (scope === 'PERSONAL' && !unlockedUser) {
    mainEl.innerHTML = docUsers.length === 0 ? personalSetupHtml() : personalUnlockHtml();
    if (docUsers.length === 0) bindPersonalSetup(mainEl);
    else bindPersonalUnlock(mainEl);
    return;
  }

  const list = visibleDocs();
  const total = currentDocs().length;
  const headLabel =
    scope === 'SHARED'
      ? '공용 문서 ' + total + '개'
      : (unlockedUser?.name ?? '') + '님의 개인 문서 ' + total + '개';

  mainEl.innerHTML = [
    '<div class="dn-list-head">',
    '  <span class="dn-list-head-label">' + escapeHtml(headLabel) + '</span>',
    scope === 'PERSONAL'
      ? '  <button type="button" class="dn-btn-ghost" id="dn-lock">' + IC.unlock + '잠그기</button>'
      : '',
    '</div>',
    total === 0
      ? emptyDocsHtml()
      : list.length === 0
        ? '<div class="dn-empty"><div class="dn-empty-title">조건에 맞는 문서가 없어요</div><div class="dn-empty-hint">검색어를 바꾸거나 다른 탭을 확인해보세요</div></div>'
        : '<div class="dn-list">' + list.map(docRowHtml).join('') + '</div>',
    '<div class="dn-drop" id="dn-drop" tabindex="0" role="button">',
    '  ' + IC.upload,
    '  <div class="dn-drop-text">파일을 끌어다 놓거나 클릭해서 추가</div>',
    '  <div class="dn-drop-hint">PDF · JPG · PNG · 최대 20MB · 파일 없이 정보만 저장할 수도 있어요</div>',
    '</div>',
  ].join('\n');

  mainEl.querySelector('#dn-lock')?.addEventListener('click', () => {
    unlockedUser = null;
    personalDocs = [];
    clearUnlockedUser(currentTripId);
    selectedDocId = null;
    renderDocuments();
    updateTabCounts();
  });

  bindDocRows(mainEl);
  bindDropZone(mainEl);
  renderCrossHint();
}

function emptyDocsHtml(): string {
  const isShared = scope === 'SHARED';
  return [
    '<div class="dn-empty">',
    '  <div class="dn-empty-icon">' + IC.doc + '</div>',
    '  <div class="dn-empty-title">' + (isShared ? '아직 공용 문서가 없어요' : '아직 개인 문서가 없어요') + '</div>',
    '  <div class="dn-empty-hint">' +
      (isShared
        ? '숙소 예약증, 렌터카 예약서처럼 멤버 모두가 볼 문서를 올려두세요'
        : '항공권, 보험증서처럼 본인만 볼 문서를 올려두세요') +
      '</div>',
    '</div>',
  ].join('');
}

function migrationNoticeHtml(): string {
  return [
    '<div class="dn-notice">',
    '  <div class="dn-notice-icon">' + IC.info + '</div>',
    '  <div class="dn-notice-title">문서함을 아직 사용할 수 없어요</div>',
    '  <div class="dn-notice-text">Supabase에서 <code>supabase/trip_documents.sql</code>을 실행하면 문서와 메모가 저장돼요.</div>',
    '</div>',
  ].join('');
}

function docRowHtml(doc: TripDocument): string {
  const category = normalizeDocCategory(doc.category);
  const day = dayRangeLabel(doc.day_start, doc.day_end);
  const dateRange = dayDateRangeLabel(trip, doc.day_start, doc.day_end);

  const infoParts: string[] = [];
  if (dateRange) infoParts.push(dateRange);
  if (doc.description) infoParts.push(doc.description.split('\n')[0]);
  else if (doc.reference_code) infoParts.push('예약번호 ' + doc.reference_code);

  const uploader = doc.uploaded_by_name ? doc.uploaded_by_name + ' · ' : '';
  const badge = doc.file_path
    ? '<span class="dn-file-badge">' + escapeHtml(fileKindLabel(doc.file_name, doc.file_type)) + '</span>'
    : '<span class="dn-file-badge is-empty">정보</span>';

  return [
    '<button type="button" class="dn-row' + (doc.id === selectedDocId ? ' is-selected' : '') + '" data-doc-id="' + doc.id + '">',
    '  <span class="dn-row-icon">' + DOC_CATEGORY_ICON[category] + '</span>',
    '  <span class="dn-row-main">',
    '    <span class="dn-row-title">' + escapeHtml(doc.title) + '</span>',
    '    <span class="dn-tags">',
    '      <span class="dn-tag">' + escapeHtml(DOC_CATEGORY_LABEL[category]) + '</span>',
    day ? '      <span class="dn-tag is-day">' + escapeHtml(day) + '</span>' : '',
    '    </span>',
    infoParts.length > 0 ? '    <span class="dn-row-desc">' + escapeHtml(infoParts.join(' · ')) + '</span>' : '',
    '    <span class="dn-row-meta">업로드 ' + escapeHtml(uploader) + escapeHtml(formatDayTime(doc.created_at)) + '</span>',
    '  </span>',
    '  <span class="dn-row-right">' + badge + '<span class="dn-row-chevron">' + IC.chevron + '</span></span>',
    '</button>',
  ].join('');
}

function bindDocRows(scopeEl: HTMLElement): void {
  scopeEl.querySelectorAll('.dn-row').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.docId!;
      selectedDocId = selectedDocId === id ? null : id;
      scopeEl.querySelectorAll('.dn-row').forEach((r) => r.classList.toggle('is-selected', (r as HTMLElement).dataset.docId === selectedDocId));
      renderDetail();
    });
  });
}

function bindDropZone(scopeEl: HTMLElement): void {
  const drop = scopeEl.querySelector('#dn-drop') as HTMLElement | null;
  if (!drop) return;

  drop.addEventListener('click', () => openDocumentSheet(null));
  drop.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault();
      openDocumentSheet(null);
    }
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    const file = (e as DragEvent).dataTransfer?.files?.[0];
    if (file) openDocumentSheet(null, file);
  });
}

/* ── 상세 패널 ── */

function renderDetail(): void {
  const detailEl = rootEl?.querySelector('#dn-detail') as HTMLElement | null;
  const layoutEl = rootEl?.querySelector('#dn-doc-layout') as HTMLElement | null;
  if (!detailEl || !layoutEl) return;

  const doc = currentDocs().find((d) => d.id === selectedDocId) ?? null;
  layoutEl.classList.toggle('has-detail', !!doc);
  if (!doc) {
    detailEl.innerHTML = '';
    return;
  }

  const category = normalizeDocCategory(doc.category);
  const day = dayRangeLabel(doc.day_start, doc.day_end);
  const dateRange = dayDateRangeLabel(trip, doc.day_start, doc.day_end);

  const rows: Array<[string, string]> = [];
  rows.push(['카테고리', DOC_CATEGORY_LABEL[category]]);
  if (day) rows.push(['관련 DAY', day + (dateRange ? ' (' + dateRange + ')' : '')]);
  if (doc.reference_code) rows.push(['예약번호', doc.reference_code]);
  if (doc.file_name) {
    const size = formatFileSize(doc.file_size);
    rows.push(['파일', doc.file_name + (size ? ' · ' + size : '')]);
  }
  rows.push(['공개 범위', doc.visibility === 'SHARED' ? '공용 — 멤버 모두가 볼 수 있어요' : '개인 — 본인만 볼 수 있어요']);
  rows.push(['업로드', (doc.uploaded_by_name ? doc.uploaded_by_name + ' · ' : '') + formatDayTime(doc.created_at)]);

  detailEl.innerHTML = [
    '<div class="dn-detail-inner">',
    '  <div class="dn-detail-head">',
    '    <span class="dn-detail-icon">' + DOC_CATEGORY_ICON[category] + '</span>',
    '    <span class="dn-detail-title">' + escapeHtml(doc.title) + '</span>',
    '    <button type="button" class="dn-icon-btn" id="dn-detail-close" aria-label="닫기">' + IC.close + '</button>',
    '  </div>',
    '  <div class="dn-detail-body">',
    '    <div class="dn-preview" id="dn-preview">' + previewPlaceholderHtml(doc) + '</div>',
    doc.description
      ? '    <div class="dn-detail-desc">' + escapeHtml(doc.description) + '</div>'
      : '',
    '    <dl class="dn-detail-rows">',
    rows
      .map(([k, v]) => '<div class="dn-detail-row"><dt>' + escapeHtml(k) + '</dt><dd>' + escapeHtml(v) + '</dd></div>')
      .join(''),
    '    </dl>',
    '  </div>',
    '  <div class="dn-detail-foot">',
    doc.file_path
      ? '    <button type="button" class="dn-btn-ghost" id="dn-open">' + IC.external + '파일 열기</button>' +
        '    <button type="button" class="dn-btn-ghost" id="dn-download">' + IC.download + '다운로드</button>'
      : '',
    '    <button type="button" class="dn-btn-ghost" id="dn-edit">' + IC.edit + '수정</button>',
    '    <button type="button" class="dn-btn-ghost dn-btn-danger" id="dn-delete">' + IC.trash + '삭제</button>',
    '  </div>',
    '</div>',
  ].join('\n');

  detailEl.querySelector('#dn-detail-close')?.addEventListener('click', () => {
    selectedDocId = null;
    renderDocMain();
    renderDetail();
  });
  detailEl.querySelector('#dn-open')?.addEventListener('click', () => void openFile(doc, false));
  detailEl.querySelector('#dn-download')?.addEventListener('click', () => void openFile(doc, true));
  detailEl.querySelector('#dn-edit')?.addEventListener('click', () => openDocumentSheet(doc));
  detailEl.querySelector('#dn-delete')?.addEventListener('click', () => void removeDocument(doc));

  if (doc.file_path && isPreviewable(doc.file_type)) void loadPreview(doc);
}

function previewPlaceholderHtml(doc: TripDocument): string {
  if (!doc.file_path) {
    return '<div class="dn-preview-empty">' + IC.doc + '<span>파일 없이 정보만 저장된 문서예요</span></div>';
  }
  if (!isPreviewable(doc.file_type)) {
    return (
      '<div class="dn-preview-empty">' + IC.doc +
      '<span>' + escapeHtml(fileKindLabel(doc.file_name, doc.file_type)) + ' 파일은 미리보기를 지원하지 않아요</span></div>'
    );
  }
  return '<div class="dn-preview-loading">미리보기 불러오는 중...</div>';
}

async function loadPreview(doc: TripDocument): Promise<void> {
  const url = await signedUrlFor(doc.file_path!);
  const previewEl = rootEl?.querySelector('#dn-preview') as HTMLElement | null;
  // 발급을 기다리는 동안 다른 문서를 눌렀을 수 있다 — 지금 선택된 문서일 때만 그린다
  if (!previewEl || selectedDocId !== doc.id) return;

  if (!url) {
    previewEl.innerHTML = '<div class="dn-preview-empty">' + IC.doc + '<span>미리보기를 불러오지 못했어요</span></div>';
    return;
  }
  previewEl.innerHTML = (doc.file_type ?? '').startsWith('image/')
    ? '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(doc.title) + ' 미리보기" />'
    : '<iframe src="' + escapeHtml(url) + '#toolbar=0" title="' + escapeHtml(doc.title) + ' 미리보기"></iframe>';
}

async function openFile(doc: TripDocument, download: boolean): Promise<void> {
  if (!doc.file_path) return;
  const url = await signedUrlFor(doc.file_path, 600, download ? doc.file_name ?? undefined : undefined);
  if (!url) {
    alert('파일을 여는 데 실패했어요. 잠시 후 다시 시도해주세요.');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function removeDocument(doc: TripDocument): Promise<void> {
  if (!window.confirm('"' + doc.title + '" 문서를 삭제할까요?')) return;
  if (doc.visibility === 'SHARED') sharedDocs = sharedDocs.filter((d) => d.id !== doc.id);
  else personalDocs = personalDocs.filter((d) => d.id !== doc.id);
  selectedDocId = null;
  renderDocMain();
  renderDetail();
  updateTabCounts();
  await deleteDocument(doc);
}

/* ══════════════ PERSONAL 잠금 화면 ══════════════ */

function personalSetupHtml(): string {
  return [
    '<div class="dn-gate">',
    '  <div class="dn-gate-icon">' + IC.lock + '</div>',
    '  <div class="dn-gate-title">PERSONAL DOCUMENTS</div>',
    '  <p class="dn-gate-text">개인 문서를 따로 보관하려면 사용자 정보를 먼저 등록해주세요.<br />여행 멤버마다 각각 등록할 수 있어요.</p>',
    '  <div class="dn-gate-form">',
    '    <div class="dn-field">',
    '      <label class="dn-field-label" for="dn-new-name">사용자명</label>',
    '      <input class="dn-input" id="dn-new-name" type="text" maxlength="20" placeholder="이름을 입력하세요" />',
    '    </div>',
    '    <div class="dn-field">',
    '      <label class="dn-field-label" for="dn-new-pin">4자리 PIN</label>',
    '      <input class="dn-input dn-pin-input" id="dn-new-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="••••" />',
    '    </div>',
    '    <div class="dn-gate-error" id="dn-gate-error"></div>',
    '    <button type="button" class="dn-btn-primary dn-btn-block" id="dn-create-user">개인 문서 시작하기</button>',
    '  </div>',
    '  <p class="dn-gate-note">' + IC.info +
      '<span>PIN은 멤버끼리 개인 문서를 구분하기 위한 간단한 잠금이에요. 평문으로 저장되지 않지만, 금융 수준의 보안은 아니에요.</span></p>',
    '</div>',
  ].join('');
}

function bindPersonalSetup(scopeEl: HTMLElement): void {
  const nameEl = scopeEl.querySelector('#dn-new-name') as HTMLInputElement;
  const pinEl = scopeEl.querySelector('#dn-new-pin') as HTMLInputElement;
  const errorEl = scopeEl.querySelector('#dn-gate-error') as HTMLElement;
  const btn = scopeEl.querySelector('#dn-create-user') as HTMLButtonElement;

  pinEl.addEventListener('input', () => {
    pinEl.value = pinEl.value.replace(/\D/g, '').slice(0, 4);
  });

  const submit = async (): Promise<void> => {
    errorEl.textContent = '';
    btn.disabled = true;
    const { user, error } = await createDocUser(currentTripId, nameEl.value, pinEl.value);
    btn.disabled = false;
    if (error || !user) {
      errorEl.textContent = error ?? '사용자를 등록하지 못했어요.';
      return;
    }
    docUsers.push(user);
    unlockedUser = user;
    setUnlockedUserId(currentTripId, user.id);
    personalDocs = await loadPersonalDocuments(currentTripId, user.id);
    renderDocuments();
    updateTabCounts();
  };

  btn.addEventListener('click', () => void submit());
  pinEl.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void submit();
  });
}

function personalUnlockHtml(): string {
  return [
    '<div class="dn-gate">',
    '  <div class="dn-gate-icon">' + IC.lock + '</div>',
    '  <div class="dn-gate-title">사용자 선택</div>',
    '  <p class="dn-gate-text">본인을 선택하고 PIN을 입력하면 개인 문서가 열려요.</p>',
    '  <div class="dn-user-list" id="dn-user-list">',
    docUsers
      .map(
        (u) =>
          '<button type="button" class="dn-user-item" data-user-id="' + u.id + '">' +
          IC.user + '<span>' + escapeHtml(u.name) + '</span></button>'
      )
      .join(''),
    '  </div>',
    '  <div class="dn-gate-form is-hidden" id="dn-pin-form">',
    '    <div class="dn-field">',
    '      <label class="dn-field-label" for="dn-pin"><span id="dn-pin-who"></span>님의 PIN</label>',
    '      <input class="dn-input dn-pin-input" id="dn-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••" />',
    '    </div>',
    '    <div class="dn-gate-error" id="dn-gate-error"></div>',
    '    <button type="button" class="dn-btn-primary dn-btn-block" id="dn-unlock">확인</button>',
    '  </div>',
    '  <button type="button" class="dn-btn-ghost dn-gate-add" id="dn-add-user">' + IC.plus + '사용자 추가</button>',
    '</div>',
  ].join('');
}

function bindPersonalUnlock(scopeEl: HTMLElement): void {
  const formEl = scopeEl.querySelector('#dn-pin-form') as HTMLElement;
  const whoEl = scopeEl.querySelector('#dn-pin-who') as HTMLElement;
  const pinEl = scopeEl.querySelector('#dn-pin') as HTMLInputElement;
  const errorEl = scopeEl.querySelector('#dn-gate-error') as HTMLElement;
  const unlockBtn = scopeEl.querySelector('#dn-unlock') as HTMLButtonElement;
  let target: TripDocUser | null = null;

  pinEl.addEventListener('input', () => {
    pinEl.value = pinEl.value.replace(/\D/g, '').slice(0, 4);
    errorEl.textContent = '';
  });

  scopeEl.querySelectorAll('.dn-user-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.userId!;
      target = docUsers.find((u) => u.id === id) ?? null;
      if (!target) return;
      scopeEl.querySelectorAll('.dn-user-item').forEach((b) => b.classList.toggle('is-active', b === el));
      whoEl.textContent = target.name;
      formEl.classList.remove('is-hidden');
      errorEl.textContent = '';
      pinEl.value = '';
      pinEl.focus();
    });
  });

  const submit = async (): Promise<void> => {
    if (!target) return;
    if (!isValidPin(pinEl.value)) {
      errorEl.textContent = 'PIN 4자리를 입력해주세요.';
      return;
    }
    unlockBtn.disabled = true;
    const ok = await verifyPin(target, pinEl.value);
    unlockBtn.disabled = false;
    if (!ok) {
      errorEl.textContent = 'PIN이 일치하지 않습니다.';
      pinEl.value = '';
      pinEl.focus();
      return;
    }
    unlockedUser = target;
    setUnlockedUserId(currentTripId, target.id);
    personalDocs = await loadPersonalDocuments(currentTripId, target.id);
    renderDocuments();
    updateTabCounts();
  };

  unlockBtn.addEventListener('click', () => void submit());
  pinEl.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void submit();
  });

  scopeEl.querySelector('#dn-add-user')?.addEventListener('click', () => {
    const mainEl = rootEl?.querySelector('#dn-doc-main') as HTMLElement | null;
    if (!mainEl) return;
    mainEl.innerHTML = personalSetupHtml();
    bindPersonalSetup(mainEl);
  });
}

/* ══════════════ 문서 추가/수정 시트 ══════════════ */

function openDocumentSheet(existing: TripDocument | null, presetFile?: File): void {
  if (!rootEl || sheetOpen) return;
  if (!isStorageReady()) return;

  const dayCount = tripDayCount(trip);
  const dayOptions = (selected: number | null, placeholder: string): string =>
    ['<option value="">' + placeholder + '</option>']
      .concat(
        Array.from({ length: dayCount }, (_, i) => i + 1).map(
          (d) => '<option value="' + d + '"' + (selected === d ? ' selected' : '') + '>DAY ' + d + '</option>'
        )
      )
      .join('');

  let category: DocCategory = existing ? normalizeDocCategory(existing.category) : 'STAY';
  let visibility: DocScope = existing ? (existing.visibility as DocScope) : scope;
  let pickedFile: File | null = presetFile ?? null;
  const canPersonal = !!unlockedUser;
  if (visibility === 'PERSONAL' && !canPersonal) visibility = 'SHARED';

  const sheet = document.createElement('div');
  sheet.className = 'dn-sheet-layer';
  sheet.innerHTML = [
    '<div class="dn-sheet-overlay" id="dn-sheet-overlay"></div>',
    '<div class="dn-sheet" role="dialog" aria-modal="true" aria-label="' + (existing ? '문서 수정' : '문서 추가') + '">',
    '  <div class="dn-sheet-head">',
    '    <span class="dn-sheet-title">' + (existing ? '문서 수정' : '문서 추가') + '</span>',
    '    <button type="button" class="dn-icon-btn" id="dn-sheet-close" aria-label="닫기">' + IC.close + '</button>',
    '  </div>',
    '  <div class="dn-sheet-body">',
    '    <div class="dn-field">',
    '      <label class="dn-field-label" for="dn-doc-title">제목</label>',
    '      <input class="dn-input" id="dn-doc-title" type="text" maxlength="80" placeholder="숙소 예약 확인서" value="' +
      escapeHtml(existing?.title ?? '') + '" />',
    '    </div>',
    '    <div class="dn-field">',
    '      <span class="dn-field-label">카테고리</span>',
    '      <div class="dn-pick" id="dn-doc-cats">',
    DOC_CATEGORIES.map(
      (c) =>
        '<button type="button" class="dn-pick-item' + (c === category ? ' is-active' : '') + '" data-cat="' + c + '">' +
        DOC_CATEGORY_ICON[c] + '<span>' + DOC_CATEGORY_LABEL[c] + '</span></button>'
    ).join(''),
    '      </div>',
    '    </div>',
    '    <div class="dn-field">',
    '      <span class="dn-field-label">관련 DAY <em>선택</em></span>',
    '      <div class="dn-field-row">',
    '        <select class="dn-input dn-select" id="dn-doc-day-start">' + dayOptions(existing?.day_start ?? null, '전체 일정') + '</select>',
    '        <select class="dn-input dn-select" id="dn-doc-day-end">' + dayOptions(existing?.day_end ?? null, '종료일 없음') + '</select>',
    '      </div>',
    '    </div>',
    '    <div class="dn-field">',
    '      <label class="dn-field-label" for="dn-doc-desc">설명 <em>선택</em></label>',
    '      <textarea class="dn-input dn-textarea" id="dn-doc-desc" rows="2" placeholder="3박 · 조식 포함">' +
      escapeHtml(existing?.description ?? '') + '</textarea>',
    '    </div>',
    '    <div class="dn-field">',
    '      <label class="dn-field-label" for="dn-doc-ref">예약번호 <em>선택</em></label>',
    '      <input class="dn-input" id="dn-doc-ref" type="text" maxlength="40" placeholder="ABC123" value="' +
      escapeHtml(existing?.reference_code ?? '') + '" />',
    '    </div>',
    '    <div class="dn-field">',
    '      <span class="dn-field-label">파일 <em>선택</em></span>',
    '      <button type="button" class="dn-file-pick" id="dn-file-pick">',
    '        ' + IC.upload + '<span id="dn-file-name">' +
      escapeHtml(presetFile?.name ?? existing?.file_name ?? '파일 선택 또는 드래그 앤 드롭') + '</span>',
    '      </button>',
    '      <input type="file" id="dn-file-input" accept="' + ACCEPTED_FILE_TYPES + '" hidden />',
    '    </div>',
    '    <div class="dn-field">',
    '      <span class="dn-field-label">공개 범위</span>',
    '      <div class="dn-radio-row" id="dn-doc-scope">',
    '        <button type="button" class="dn-radio' + (visibility === 'PERSONAL' ? ' is-active' : '') + '" data-scope="PERSONAL"' +
      (canPersonal ? '' : ' disabled') + '>' + IC.lock + '<span>개인</span></button>',
    '        <button type="button" class="dn-radio' + (visibility === 'SHARED' ? ' is-active' : '') + '" data-scope="SHARED">' +
      IC.users + '<span>공용</span></button>',
    '      </div>',
    canPersonal
      ? ''
      : '      <div class="dn-field-hint">개인으로 저장하려면 PERSONAL 탭에서 잠금을 먼저 풀어주세요.</div>',
    existing && existing.visibility !== visibility
      ? '      <div class="dn-field-hint">공개 범위는 저장 후에는 바꿀 수 없어요.</div>'
      : '',
    '    </div>',
    '    <div class="dn-gate-error" id="dn-sheet-error"></div>',
    '  </div>',
    '  <div class="dn-sheet-foot">',
    '    <button type="button" class="dn-btn-primary dn-btn-block" id="dn-doc-save">저장</button>',
    '  </div>',
    '</div>',
  ].join('\n');

  rootEl.appendChild(sheet);
  sheetOpen = true;
  requestAnimationFrame(() => sheet.classList.add('is-open'));

  const titleEl = sheet.querySelector('#dn-doc-title') as HTMLInputElement;
  const descEl = sheet.querySelector('#dn-doc-desc') as HTMLTextAreaElement;
  const refEl = sheet.querySelector('#dn-doc-ref') as HTMLInputElement;
  const dayStartEl = sheet.querySelector('#dn-doc-day-start') as HTMLSelectElement;
  const dayEndEl = sheet.querySelector('#dn-doc-day-end') as HTMLSelectElement;
  const fileInput = sheet.querySelector('#dn-file-input') as HTMLInputElement;
  const fileNameEl = sheet.querySelector('#dn-file-name') as HTMLElement;
  const errorEl = sheet.querySelector('#dn-sheet-error') as HTMLElement;
  const saveEl = sheet.querySelector('#dn-doc-save') as HTMLButtonElement;
  const scopeRow = sheet.querySelector('#dn-doc-scope') as HTMLElement;

  const close = (): void => {
    sheetOpen = false;
    sheet.remove();
  };

  sheet.querySelectorAll('#dn-doc-cats .dn-pick-item').forEach((el) => {
    el.addEventListener('click', () => {
      category = (el as HTMLElement).dataset.cat as DocCategory;
      sheet.querySelectorAll('#dn-doc-cats .dn-pick-item').forEach((b) => b.classList.remove('is-active'));
      el.classList.add('is-active');
    });
  });

  // 공개 범위는 만들 때만 고른다 — 이미 저장된 문서의 범위를 바꾸면 파일 경로까지 옮겨야 해서,
  // 지금은 "삭제 후 다시 추가"로 안내하는 쪽이 정확하다
  scopeRow.querySelectorAll('.dn-radio').forEach((el) => {
    if (existing) {
      (el as HTMLButtonElement).disabled = true;
      return;
    }
    el.addEventListener('click', () => {
      visibility = (el as HTMLElement).dataset.scope as DocScope;
      scopeRow.querySelectorAll('.dn-radio').forEach((b) => b.classList.remove('is-active'));
      el.classList.add('is-active');
    });
  });

  sheet.querySelector('#dn-file-pick')?.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0] ?? null;
    if (file && file.size > MAX_FILE_BYTES) {
      errorEl.textContent = '파일은 20MB까지 올릴 수 있어요.';
      fileInput.value = '';
      return;
    }
    pickedFile = file;
    fileNameEl.textContent = file?.name ?? '파일 선택 또는 드래그 앤 드롭';
    errorEl.textContent = '';
  });

  sheet.querySelector('#dn-sheet-close')?.addEventListener('click', close);
  sheet.querySelector('#dn-sheet-overlay')?.addEventListener('click', close);

  saveEl.addEventListener('click', async () => {
    const title = titleEl.value.trim();
    if (!title) {
      titleEl.focus();
      titleEl.classList.add('is-invalid');
      return;
    }
    if (visibility === 'PERSONAL' && !unlockedUser) {
      errorEl.textContent = '개인 문서는 PERSONAL 잠금을 푼 뒤에 저장할 수 있어요.';
      return;
    }

    const dayStart = dayStartEl.value ? Number(dayStartEl.value) : null;
    const rawEnd = dayEndEl.value ? Number(dayEndEl.value) : null;
    const dayEnd = dayStart && rawEnd && rawEnd >= dayStart ? rawEnd : null;

    saveEl.disabled = true;
    saveEl.textContent = pickedFile ? '올리는 중...' : '저장 중...';

    let uploaded: UploadedFile | null = null;
    if (pickedFile) {
      const result = await uploadDocFile(currentTripId, visibility, pickedFile);
      if (result.error || !result.file) {
        errorEl.textContent = result.error ?? '파일을 올리지 못했어요.';
        saveEl.disabled = false;
        saveEl.textContent = '저장';
        return;
      }
      uploaded = result.file;
    }

    const draft = {
      title,
      category,
      description: descEl.value.trim() || null,
      referenceCode: refEl.value.trim() || null,
      dayStart,
      dayEnd,
      visibility,
      ownerId: visibility === 'PERSONAL' ? unlockedUser!.id : null,
      ...(uploaded ? { file: uploaded } : {}),
    };

    if (existing) {
      const updated = await updateDocument(existing.id, draft);
      if (updated) replaceDoc(updated);
    } else {
      const created = await createDocument(currentTripId, draft);
      if (!created) {
        errorEl.textContent = '문서를 저장하지 못했어요.';
        saveEl.disabled = false;
        saveEl.textContent = '저장';
        return;
      }
      const list = created.visibility === 'SHARED' ? sharedDocs : personalDocs;
      if (!list.some((d) => d.id === created.id)) list.unshift(created);
      // 방금 올린 문서를 바로 확인할 수 있도록 그 탭으로 옮기고 상세를 연다
      if (created.visibility !== scope) {
        scope = created.visibility as DocScope;
        setLastScope(currentTripId, scope);
      }
      selectedDocId = created.id;
    }

    close();
    renderDocuments();
    updateTabCounts();
  });

  titleEl.addEventListener('input', () => titleEl.classList.remove('is-invalid'));
  titleEl.focus();
}

function replaceDoc(updated: TripDocument): void {
  const list = updated.visibility === 'SHARED' ? sharedDocs : personalDocs;
  const idx = list.findIndex((d) => d.id === updated.id);
  if (idx !== -1) list[idx] = updated;
  selectedDocId = updated.id;
}
