import { supabase } from '../supabase';
import { store } from '../store';
import type { Database } from '../types/database';
import './board.css';

type Place = Database['public']['Tables']['places']['Row'];

interface MoodConfig {
  key: string;
  label: string;
  emptyHint: string;
  placeholder: string;
}

const MOODS: MoodConfig[] = [
  { key: '가고싶어', label: 'VISIT',    emptyHint: '📍 장소 이름을 입력하세요',   placeholder: '장소 이름 · 링크를 붙여넣으세요' },
  { key: '먹고싶어', label: 'FOOD',     emptyHint: '🍜 맛집 이름을 입력하세요',   placeholder: '맛집 이름 · 링크를 붙여넣으세요' },
  { key: '하고싶어', label: 'ACTIVITY', emptyHint: '🎤 통화 중 나온 아이디어를 기록하세요', placeholder: '하고 싶은 것을 적어보세요' },
  { key: '후보',     label: 'MAYBE',   emptyHint: '💬 메모나 링크를 남겨보세요', placeholder: '메모 · Google Maps 링크' },
];

const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>';

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

async function addIdea(tripId: string, mood: string, text: string): Promise<Place | null> {
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
      sort_order: Date.now(),
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

async function movePlace(placeId: string, newMood: string): Promise<boolean> {
  const { error } = await supabase.from('places').update({ mood: newMood }).eq('id', placeId);
  if (error) {
    console.error('Card move error:', error.message);
    return false;
  }
  return true;
}

/** 카드 선택 시 워크스페이스 셸(AI 패널)에 알림 */
function dispatchSelectCard(root: HTMLElement, name: string): void {
  root.dispatchEvent(
    new CustomEvent('mongsil:selectCard', { detail: { name }, bubbles: true })
  );
}

/** Workspace 안에서 호출되는 보드 콘텐츠 렌더 */
export async function renderBoardContent(container: HTMLElement, tripId: string): Promise<void> {
  container.innerHTML = '<div class="bd-board" id="bd-board"><div class="bd-loading">보드를 불러오는 중...</div></div>';

  const places = await loadPlaces(tripId);
  const boardEl = container.querySelector('#bd-board') as HTMLElement;
  boardEl.innerHTML = '';

  MOODS.forEach((mood) => {
    boardEl.appendChild(createColumn(tripId, mood, places.filter((p) => p.mood === mood.key)));
  });
}

function createColumn(tripId: string, mood: MoodConfig, places: Place[]): HTMLElement {
  const col = document.createElement('div');
  col.className = 'bd-col';
  col.dataset.mood = mood.key;

  col.innerHTML = [
    '<div class="bd-col-header">',
    '  <span class="bd-col-step">' + mood.label + '</span>',
    '  <span class="bd-col-count" id="count-' + mood.key + '">' + places.length + '</span>',
    '</div>',
    '<div class="bd-col-list" id="list-' + mood.key + '"></div>',
    '<form class="bd-add-form" id="form-' + mood.key + '">',
    '  <input class="bd-add-input" id="input-' + mood.key + '" type="text" placeholder="' + mood.placeholder + '" />',
    '  <button type="submit" class="bd-add-btn">' + ICON_PLUS + '</button>',
    '</form>',
  ].join('\n');

  const listEl = col.querySelector('#list-' + cssEscape(mood.key)) as HTMLElement;

  if (places.length === 0) {
    listEl.innerHTML = buildEmptyState(mood);
  } else {
    places.forEach((place) => listEl.appendChild(createCard(place)));
  }

  col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
  col.addEventListener('dragleave', () => { col.classList.remove('drag-over'); });
  col.addEventListener('drop', async (e) => {
    e.preventDefault();
    col.classList.remove('drag-over');
    const placeId = e.dataTransfer?.getData('text/place-id');
    const fromMood = e.dataTransfer?.getData('text/from-mood');
    if (!placeId || fromMood === mood.key) return;

    const success = await movePlace(placeId, mood.key);
    if (success) {
      const cardEl = document.querySelector('[data-place-id="' + placeId + '"]') as HTMLElement | null;
      if (cardEl) {
        removeEmptyState(listEl);
        listEl.appendChild(cardEl);
        triggerLightSweep(cardEl);
        updateEmptyState(listEl, mood);

        const fromList = document.querySelector('#list-' + cssEscape(fromMood ?? ''));
        const fromMoodConfig = MOODS.find((m) => m.key === fromMood);
        if (fromList && fromMoodConfig) updateEmptyState(fromList as HTMLElement, fromMoodConfig);

        updateCount(mood.key);
        if (fromMood) updateCount(fromMood);
      }
    }
  });

  const form = col.querySelector('#form-' + cssEscape(mood.key)) as HTMLFormElement;
  const input = col.querySelector('#input-' + cssEscape(mood.key)) as HTMLInputElement;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    const newPlace = await addIdea(tripId, mood.key, text);
    input.disabled = false;
    if (newPlace) {
      removeEmptyState(listEl);
      const cardEl = createCard(newPlace);
      listEl.appendChild(cardEl);
      triggerLightSweep(cardEl);
      input.value = '';
      updateCount(mood.key);
    }
  });

  return col;
}

function buildEmptyState(mood: MoodConfig): string {
  return [
    '<div class="bd-col-empty">',
    '  <div class="bd-col-empty-hint">' + mood.emptyHint + '</div>',
    '</div>',
  ].join('');
}

function createCard(place: Place): HTMLElement {
  const card = document.createElement('div');
  card.className = 'bd-card';
  card.draggable = true;
  card.dataset.placeId = place.id;

  card.innerHTML = [
    '<span class="bd-card-text">' + escapeHtml(place.name) + '</span>',
    '<button class="bd-card-delete" id="del-' + place.id + '">' + ICON_TRASH + '</button>',
  ].join('');

  // 카드 클릭 → AI 패널에 선택 알림 (삭제 버튼 클릭은 제외)
  card.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.bd-card-delete')) return;
    dispatchSelectCard(card, place.name);
  });

  card.addEventListener('dragstart', (e) => {
    card.classList.add('dragging');
    e.dataTransfer?.setData('text/place-id', place.id);
    e.dataTransfer?.setData('text/from-mood', place.mood ?? '');
  });
  card.addEventListener('dragend', () => { card.classList.remove('dragging'); });

  const deleteBtn = card.querySelector('#del-' + cssEscape(place.id)) as HTMLButtonElement;
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
    const listEl = card.parentElement;
    const moodKey = place.mood ?? '';
    const moodConfig = MOODS.find((m) => m.key === moodKey);
    const success = await deleteIdea(place.id);
    if (success) {
      card.remove();
      updateCount(moodKey);
      if (listEl && moodConfig) updateEmptyState(listEl, moodConfig);
    } else {
      deleteBtn.disabled = false;
      confirming = false;
      deleteBtn.classList.remove('confirm');
      deleteBtn.innerHTML = ICON_TRASH;
    }
  });

  return card;
}

/** 드롭/추가 직후 카드 표면에 빛이 스치는 모션 */
function triggerLightSweep(cardEl: HTMLElement): void {
  cardEl.classList.remove('sweep');
  // 리플로우 강제 후 클래스 재적용 (연속 트리거 대비)
  void cardEl.offsetWidth;
  cardEl.classList.add('sweep');
  setTimeout(() => cardEl.classList.remove('sweep'), 650);
}

function updateCount(moodKey: string): void {
  const listEl = document.querySelector('#list-' + cssEscape(moodKey));
  const countEl = document.querySelector('#count-' + cssEscape(moodKey));
  if (listEl && countEl) {
    countEl.textContent = String(listEl.querySelectorAll('.bd-card').length);
  }
}

function removeEmptyState(listEl: HTMLElement): void {
  const empty = listEl.querySelector('.bd-col-empty');
  if (empty) empty.remove();
}

function updateEmptyState(listEl: HTMLElement, mood: MoodConfig): void {
  const hasCards = listEl.querySelectorAll('.bd-card').length > 0;
  const hasEmpty = listEl.querySelector('.bd-col-empty');
  if (!hasCards && !hasEmpty) {
    listEl.innerHTML = buildEmptyState(mood);
  }
}

function cssEscape(str: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(str);
  return str.replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
}
