/**
 * NOTES — 여행 준비 중 떠오르는 정보를 바로 적어두는 곳.
 *
 * CHECKLIST(trip_checklist, 모바일 MORE 탭)와 역할이 다르다:
 *   CHECKLIST = 여행 중 "해야 하는 행동"
 *   NOTES     = 여행 준비 중 "저장해두는 정보/생각"
 * 그래서 여기 체크는 "완료"가 아니라 "확인함" 표시고, 화면 문구도 그렇게만 쓴다.
 *
 * 이 모듈은 게이트가 마운트될 때 한 번 데이터를 읽고 realtime을 구독한다(탭이 DOCUMENTS로
 * 가 있어도 유지) — 검색창에서 "메모에도 N건" 같은 교차 안내를 즉시 보여주기 위해서다.
 */

import { supabase } from '../supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Trip, TripNote } from '../types/database';
import {
  NOTE_CATEGORIES,
  NOTE_CATEGORY_LABEL,
  createNote,
  deleteNote,
  loadNotes,
  normalizeNoteCategory,
  setNoteChecked,
  setNotePinned,
  updateNote,
  dayRangeLabel,
} from './docsStore';
import type { DayOption, NoteCategory } from './docsStore';
import { IC, NOTE_CATEGORY_ICON, escapeHtml, formatDay } from './docsIcons';

interface NotesHost {
  tripId: string;
  trip: Trip | null;
  dayOptions: DayOption[];
  getSearch: () => string;
  onDataChange: () => void;
}

type NoteSort = 'recent' | 'oldest' | 'unchecked';

let host: NotesHost | null = null;
let channel: RealtimeChannel | null = null;
let notes: TripNote[] = [];
let rootEl: HTMLElement | null = null;
let activeCategory: NoteCategory | 'ALL' = 'ALL';
let sortMode: NoteSort = 'recent';
let editingId: string | null = null;
let sheetOpen = false;

/* ══════════════ 데이터 ══════════════ */

export async function initNotes(next: NotesHost): Promise<void> {
  host = next;
  notes = await loadNotes(next.tripId);
  host.onDataChange();
  renderIfMounted();

  channel = supabase
    .channel('trip-notes:' + next.tripId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trip_notes', filter: 'trip_id=eq.' + next.tripId },
      (payload) => {
        if (payload.eventType === 'INSERT') {
          const row = payload.new as TripNote;
          if (!notes.some((n) => n.id === row.id)) notes.unshift(row);
        } else if (payload.eventType === 'UPDATE') {
          const row = payload.new as TripNote;
          const idx = notes.findIndex((n) => n.id === row.id);
          if (idx !== -1) notes[idx] = row;
        } else if (payload.eventType === 'DELETE') {
          const old = payload.old as { id: string };
          notes = notes.filter((n) => n.id !== old.id);
        }
        host?.onDataChange();
        renderIfMounted();
      }
    )
    .subscribe();
}

export function teardownNotes(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  host = null;
  notes = [];
  rootEl = null;
  activeCategory = 'ALL';
  sortMode = 'recent';
  editingId = null;
  sheetOpen = false;
}

export function noteCount(): number {
  return notes.length;
}

/** 검색어에 걸리는 메모 수 — DOCUMENTS 탭에서 "메모에도 N건" 안내에 쓴다 */
export function notesMatchCount(query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  return notes.filter((n) => matchesQuery(n, q)).length;
}

function matchesQuery(note: TripNote, q: string): boolean {
  const haystack = [
    note.title,
    note.body,
    NOTE_CATEGORY_LABEL[normalizeNoteCategory(note.category)],
    note.created_by_name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

function visibleNotes(): TripNote[] {
  const q = (host?.getSearch() ?? '').trim().toLowerCase();
  const filtered = notes.filter((n) => {
    if (activeCategory !== 'ALL' && normalizeNoteCategory(n.category) !== activeCategory) return false;
    if (q && !matchesQuery(n, q)) return false;
    return true;
  });

  return filtered.sort((a, b) => {
    if (sortMode === 'unchecked') {
      const aDone = a.checked_at ? 1 : 0;
      const bDone = b.checked_at ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
    }
    if (sortMode === 'oldest') return a.created_at.localeCompare(b.created_at);
    return b.created_at.localeCompare(a.created_at);
  });
}

/* ══════════════ 렌더 ══════════════ */

export function mountNotes(container: HTMLElement): void {
  container.innerHTML = [
    '<div class="dn-notes">',
    '  <div class="dn-subbar">',
    '    <div class="dn-chips" id="dn-note-chips"></div>',
    '    <label class="dn-sort">',
    '      <select id="dn-note-sort" aria-label="메모 정렬">',
    '        <option value="recent">최근순</option>',
    '        <option value="oldest">오래된순</option>',
    '        <option value="unchecked">미확인 먼저</option>',
    '      </select>',
    '    </label>',
    '  </div>',
    '  <div class="dn-note-body" id="dn-note-body"></div>',
    '</div>',
  ].join('\n');

  rootEl = container.querySelector('.dn-notes') as HTMLElement;
  const sortEl = rootEl.querySelector('#dn-note-sort') as HTMLSelectElement;
  sortEl.value = sortMode;
  sortEl.addEventListener('change', () => {
    sortMode = sortEl.value as NoteSort;
    renderIfMounted();
  });

  render();
}

export function unmountNotes(): void {
  rootEl = null;
}

export function refreshNotes(): void {
  renderIfMounted();
}

function renderIfMounted(): void {
  if (rootEl && document.body.contains(rootEl)) render();
}

function render(): void {
  if (!rootEl) return;
  renderChips();
  renderList();
}

function renderChips(): void {
  const chipsEl = rootEl?.querySelector('#dn-note-chips') as HTMLElement | null;
  if (!chipsEl) return;

  // 비어 있는 카테고리 칩은 그리지 않는다 — 쓰지도 않는 분류가 화면을 채우지 않도록
  const used = NOTE_CATEGORIES.filter((c) => notes.some((n) => normalizeNoteCategory(n.category) === c));
  const chips: Array<{ key: NoteCategory | 'ALL'; label: string; count: number }> = [
    { key: 'ALL', label: '전체', count: notes.length },
    ...used.map((c) => ({
      key: c as NoteCategory | 'ALL',
      label: NOTE_CATEGORY_LABEL[c],
      count: notes.filter((n) => normalizeNoteCategory(n.category) === c).length,
    })),
  ];
  if (activeCategory !== 'ALL' && !used.includes(activeCategory)) activeCategory = 'ALL';

  chipsEl.innerHTML = chips
    .map(
      (c) =>
        '<button type="button" class="dn-chip' + (c.key === activeCategory ? ' is-active' : '') + '" data-cat="' + c.key + '">' +
        escapeHtml(c.label) + '<span class="dn-chip-count">' + c.count + '</span></button>'
    )
    .join('');

  chipsEl.querySelectorAll('.dn-chip').forEach((el) => {
    el.addEventListener('click', () => {
      activeCategory = (el as HTMLElement).dataset.cat as NoteCategory | 'ALL';
      render();
    });
  });
}

function renderList(): void {
  const bodyEl = rootEl?.querySelector('#dn-note-body') as HTMLElement | null;
  if (!bodyEl) return;

  if (notes.length === 0) {
    bodyEl.innerHTML = emptyHtml(
      '아직 저장한 메모가 없어요',
      '수하물 규정, 체크인 시간처럼 나중에 다시 확인할 정보를 적어두세요'
    );
    return;
  }

  const list = visibleNotes();
  if (list.length === 0) {
    bodyEl.innerHTML = emptyHtml('조건에 맞는 메모가 없어요', '검색어나 카테고리를 바꿔보세요');
    return;
  }

  const pinned = list.filter((n) => n.pinned_at);
  const rest = list.filter((n) => !n.pinned_at);

  const sections: string[] = [];
  if (pinned.length > 0) {
    sections.push(
      '<div class="dn-section">',
      '  <div class="dn-section-title">' + IC.pin + '<span>PINNED</span></div>',
      '  <div class="dn-pin-grid">' + pinned.map(pinnedCardHtml).join('') + '</div>',
      '</div>'
    );
  }
  if (rest.length > 0) {
    sections.push(
      '<div class="dn-section">',
      pinned.length > 0 ? '  <div class="dn-section-title"><span>ALL NOTES</span></div>' : '',
      '  <div class="dn-list">' + rest.map(noteRowHtml).join('') + '</div>',
      '</div>'
    );
  }

  bodyEl.innerHTML = sections.join('\n');
  bindRows(bodyEl);
}

function emptyHtml(title: string, hint: string): string {
  return [
    '<div class="dn-empty">',
    '  <div class="dn-empty-icon">' + IC.note + '</div>',
    '  <div class="dn-empty-title">' + escapeHtml(title) + '</div>',
    '  <div class="dn-empty-hint">' + escapeHtml(hint) + '</div>',
    '</div>',
  ].join('');
}

function metaLine(note: TripNote): string {
  const parts = [NOTE_CATEGORY_LABEL[normalizeNoteCategory(note.category)]];
  const day = dayRangeLabel(note.day_start, note.day_end);
  if (day) parts.push(day);
  if (note.created_by_name) parts.push(note.created_by_name);
  parts.push(formatDay(note.created_at));
  return parts.map((p) => escapeHtml(p)).join('<span class="dn-dot">·</span>');
}

function pinnedCardHtml(note: TripNote): string {
  const body = (note.body || '').trim();
  return [
    '<div class="dn-pin-card" data-note-id="' + note.id + '">',
    '  <div class="dn-pin-card-head">',
    '    <span class="dn-pin-card-title">' + escapeHtml(note.title) + '</span>',
    '    <button type="button" class="dn-pin-btn is-on" data-pin="' + note.id + '" aria-label="고정 해제">' + IC.pin + '</button>',
    '  </div>',
    body ? '  <div class="dn-pin-card-body">' + escapeHtml(body) + '</div>' : '',
    '  <div class="dn-pin-card-meta">' + metaLine(note) + '</div>',
    '</div>',
  ].join('');
}

function noteRowHtml(note: TripNote): string {
  const checked = !!note.checked_at;
  const body = (note.body || '').trim();
  const category = normalizeNoteCategory(note.category);
  return [
    '<div class="dn-note-row' + (checked ? ' is-checked' : '') + '" data-note-id="' + note.id + '">',
    '  <button type="button" class="dn-check" data-check="' + note.id + '" role="checkbox" aria-checked="' + checked + '"',
    '          aria-label="' + (checked ? '확인 완료 해제' : '확인 완료로 표시') + '">' + IC.check + '</button>',
    '  <span class="dn-row-icon">' + NOTE_CATEGORY_ICON[category] + '</span>',
    '  <div class="dn-row-main">',
    '    <div class="dn-row-title">' + escapeHtml(note.title) + '</div>',
    body ? '    <div class="dn-row-desc">' + escapeHtml(body) + '</div>' : '',
    '    <div class="dn-row-meta">' + metaLine(note) + '</div>',
    '  </div>',
    '  <div class="dn-row-actions">',
    '    <button type="button" class="dn-icon-btn" data-pin="' + note.id + '" aria-label="상단 고정">' + IC.pin + '</button>',
    '    <button type="button" class="dn-icon-btn" data-edit="' + note.id + '" aria-label="메모 편집">' + IC.edit + '</button>',
    '    <button type="button" class="dn-icon-btn dn-icon-danger" data-del="' + note.id + '" aria-label="메모 삭제">' + IC.trash + '</button>',
    '  </div>',
    '</div>',
  ].join('');
}

function bindRows(scope: HTMLElement): void {
  scope.querySelectorAll('[data-check]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      void toggleChecked((el as HTMLElement).dataset.check!);
    });
  });
  scope.querySelectorAll('[data-pin]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      void togglePinned((el as HTMLElement).dataset.pin!);
    });
  });
  scope.querySelectorAll('[data-edit]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openNoteEditor((el as HTMLElement).dataset.edit!);
    });
  });
  scope.querySelectorAll('[data-del]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      void removeNote((el as HTMLElement).dataset.del!);
    });
  });
  scope.querySelectorAll('.dn-note-row, .dn-pin-card').forEach((el) => {
    el.addEventListener('click', () => openNoteEditor((el as HTMLElement).dataset.noteId!));
  });
}

/* ══════════════ 변경 ══════════════ */

async function toggleChecked(id: string): Promise<void> {
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  const next = !note.checked_at;
  note.checked_at = next ? new Date().toISOString() : null; // 낙관적 반영
  render();
  const ok = await setNoteChecked(id, next);
  if (!ok) {
    note.checked_at = next ? null : new Date().toISOString();
    render();
  }
}

async function togglePinned(id: string): Promise<void> {
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  const next = !note.pinned_at;
  const previous = note.pinned_at;
  note.pinned_at = next ? new Date().toISOString() : null;
  render();
  const ok = await setNotePinned(id, next);
  if (!ok) {
    note.pinned_at = previous;
    render();
  }
}

async function removeNote(id: string): Promise<void> {
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  if (!window.confirm('"' + note.title + '" 메모를 삭제할까요?')) return;
  notes = notes.filter((n) => n.id !== id);
  host?.onDataChange();
  render();
  await deleteNote(id);
}

/* ══════════════ 편집 시트 ══════════════ */

export function openNoteEditor(id?: string): void {
  if (!rootEl || sheetOpen) return;
  editingId = id ?? null;
  const note = id ? notes.find((n) => n.id === id) ?? null : null;
  const options = host?.dayOptions ?? [];

  const noteDayOptionsHtml = (selected: number | null, placeholder: string): string =>
    ['<option value="">' + placeholder + '</option>']
      .concat(
        options.map(
          (o) => '<option value="' + o.day + '"' + (selected === o.day ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>'
        )
      )
      .join('');

  const currentCategory: NoteCategory = note ? normalizeNoteCategory(note.category) : 'PACKING';

  const sheet = document.createElement('div');
  sheet.className = 'dn-sheet-layer';
  sheet.innerHTML = [
    '<div class="dn-sheet-overlay" id="dn-note-sheet-overlay"></div>',
    '<div class="dn-sheet" role="dialog" aria-modal="true" aria-label="' + (note ? '메모 편집' : '새 메모') + '">',
    '  <div class="dn-sheet-head">',
    '    <span class="dn-sheet-title">' + (note ? '메모 편집' : '새 메모') + '</span>',
    '    <button type="button" class="dn-icon-btn" id="dn-note-sheet-close" aria-label="닫기">' + IC.close + '</button>',
    '  </div>',
    '  <div class="dn-sheet-body">',
    '    <div class="dn-field">',
    '      <span class="dn-field-label">카테고리</span>',
    '      <div class="dn-pick" id="dn-note-cats">',
    NOTE_CATEGORIES.map(
      (c) =>
        '<button type="button" class="dn-pick-item' + (c === currentCategory ? ' is-active' : '') + '" data-cat="' + c + '">' +
        NOTE_CATEGORY_ICON[c] + '<span>' + NOTE_CATEGORY_LABEL[c] + '</span></button>'
    ).join(''),
    '      </div>',
    '    </div>',
    '    <div class="dn-field">',
    '      <label class="dn-field-label" for="dn-note-title">제목</label>',
    '      <input class="dn-input" id="dn-note-title" type="text" maxlength="80" placeholder="캐리어 무게 확인" value="' +
      escapeHtml(note?.title ?? '') + '" />',
    '    </div>',
    '    <div class="dn-field">',
    '      <label class="dn-field-label" for="dn-note-text">내용</label>',
    '      <textarea class="dn-input dn-textarea" id="dn-note-text" rows="5" placeholder="위탁 23kg / 기내 7kg — 출발 전 다시 확인">' +
      escapeHtml(note?.body ?? '') + '</textarea>',
    '    </div>',
    '    <div class="dn-field">',
    '      <span class="dn-field-label">관련 DAY <em>선택</em></span>',
    '      <div class="dn-field-row">',
    '        <select class="dn-input dn-select" id="dn-note-day-start">' + noteDayOptionsHtml(note?.day_start ?? null, '지정 안 함') + '</select>',
    '        <select class="dn-input dn-select" id="dn-note-day-end">' + noteDayOptionsHtml(note?.day_end ?? null, '종료일 없음') + '</select>',
    '      </div>',
    '    </div>',
    '  </div>',
    '  <div class="dn-sheet-foot">',
    note ? '    <button type="button" class="dn-btn-ghost dn-btn-danger" id="dn-note-delete">삭제</button>' : '',
    '    <button type="button" class="dn-btn-primary" id="dn-note-save">저장</button>',
    '  </div>',
    '</div>',
  ].join('\n');

  rootEl.appendChild(sheet);
  sheetOpen = true;
  requestAnimationFrame(() => sheet.classList.add('is-open'));

  let category: NoteCategory = currentCategory;
  const titleEl = sheet.querySelector('#dn-note-title') as HTMLInputElement;
  const textEl = sheet.querySelector('#dn-note-text') as HTMLTextAreaElement;
  const dayStartEl = sheet.querySelector('#dn-note-day-start') as HTMLSelectElement;
  const dayEndEl = sheet.querySelector('#dn-note-day-end') as HTMLSelectElement;
  const saveEl = sheet.querySelector('#dn-note-save') as HTMLButtonElement;

  const close = (): void => {
    sheetOpen = false;
    editingId = null;
    sheet.remove();
  };

  sheet.querySelectorAll('#dn-note-cats .dn-pick-item').forEach((el) => {
    el.addEventListener('click', () => {
      category = (el as HTMLElement).dataset.cat as NoteCategory;
      sheet.querySelectorAll('#dn-note-cats .dn-pick-item').forEach((b) => b.classList.remove('is-active'));
      el.classList.add('is-active');
    });
  });

  sheet.querySelector('#dn-note-sheet-close')?.addEventListener('click', close);
  sheet.querySelector('#dn-note-sheet-overlay')?.addEventListener('click', close);
  sheet.querySelector('#dn-note-delete')?.addEventListener('click', async () => {
    const id = editingId;
    close();
    if (id) await removeNote(id);
  });

  saveEl.addEventListener('click', async () => {
    const title = titleEl.value.trim();
    if (!title) {
      titleEl.focus();
      titleEl.classList.add('is-invalid');
      return;
    }
    const dayStart = dayStartEl.value ? Number(dayStartEl.value) : null;
    const rawEnd = dayEndEl.value ? Number(dayEndEl.value) : null;
    const dayEnd = dayStart && rawEnd && rawEnd >= dayStart ? rawEnd : null;

    saveEl.disabled = true;
    const draft = { title, body: textEl.value.trim() || null, category, dayStart, dayEnd };

    if (editingId) {
      const updated = await updateNote(editingId, draft);
      if (updated) {
        const idx = notes.findIndex((n) => n.id === updated.id);
        if (idx !== -1) notes[idx] = updated;
      }
    } else {
      const created = await createNote(host!.tripId, draft);
      if (created && !notes.some((n) => n.id === created.id)) notes.unshift(created);
    }

    host?.onDataChange();
    close();
    render();
  });

  titleEl.addEventListener('input', () => titleEl.classList.remove('is-invalid'));
  titleEl.focus();
}
