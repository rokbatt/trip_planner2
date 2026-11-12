/**
 * Assistant 패널 — 워크스페이스 우측 Drawer의 "Assistant" 탭(모든 게이트에서 열 수 있음).
 * DOCUMENTS에 올려둔 문서(항공권·숙소 예약증 등)와 NOTES에 적어둔 메모를 바탕으로 질문에
 * 답한다. 예전엔 이 탭이 동선 추천 데모(하드코딩)였는데, 이 모듈이 그 자리를 실제 기능으로
 * 대체한다(workspace.ts의 buildAiDemoContent 자리).
 *
 * 데이터는 두 갈래다 — 가져오는 방식이 서로 다르기 때문:
 *   - DOCUMENTS: 파일이 있는 문서는 서버(doc-digest)가 Gemini로 핵심 사실만 뽑아 캐싱해서
 *     돌려준다(문서당 세션 중 1회 호출). 파일 없이 메타데이터만 있는 문서는 그 필드를 그대로
 *     사실로 쓴다 — 호출이 필요 없다.
 *   - NOTES: 이미 텍스트라 그대로 자료로 쓴다(호출 없음).
 * 공용 문서 전부 + "지금 이 브라우저에서 PIN으로 잠금을 푼" 개인 문서만 포함한다
 * (docsStore.getUnlockedUserId) — 다른 멤버의 개인 문서는 애초에 조회하지 않는다
 * (docs.ts의 PERSONAL 잠금 원칙과 동일).
 *
 * 원칙 3-1 — 답변은 전부 "문서/메모 내용을 바탕으로 AI가 정리한 것"이다. 실제로 참고한
 * 자료 제목을 답변 아래 칩으로 보여줘서 원본을 다시 확인할 수 있게 한다.
 */

import {
  getUnlockedUserId,
  isStorageReady,
  loadNotes,
  loadPersonalDocuments,
  loadSharedDocuments,
  DOC_CATEGORY_LABEL,
  NOTE_CATEGORY_LABEL,
  normalizeDocCategory,
  normalizeNoteCategory,
} from '../docs/docsStore';
import { escapeHtml } from '../docs/docsIcons';
import { requestAssistantAnswer, requestDocDigest } from './assistantClient';
import type { AssistantSource } from './assistantClient';
import type { TripDocument } from '../types/database';
import './assistant.css';

const IC_SPARKLE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>';
const IC_SEND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';

const PROMPT_CHIPS = ['체크인 시간이 몇 시야?', '항공편 예약번호 알려줘', '숙소 주소가 어디야?', '수하물 규정이 어떻게 돼?'];

interface ChatTurn {
  role: 'user' | 'ai';
  text: string;
  sources?: string[];
  error?: boolean;
}

let rootEl: HTMLElement | null = null;
let currentTripId = '';
let turns: ChatTurn[] = [];
let sources: AssistantSource[] = [];
let sourcesReady = false;
let sourcesFailedCount = 0;
let sourcesPromise: Promise<void> | null = null;
let sending = false;

export function renderAssistantPanel(container: HTMLElement, tripId: string): void {
  if (tripId !== currentTripId) {
    currentTripId = tripId;
    turns = [];
    sources = [];
    sourcesReady = false;
    sourcesFailedCount = 0;
    sourcesPromise = null;
    sending = false;
  }
  rootEl = container;
  mountShell();
  renderList();
  updateFormState();

  if (!sourcesReady && !sourcesPromise) {
    sourcesPromise = loadSources(tripId);
  }
}

export function teardownAssistantPanel(): void {
  rootEl = null;
}

/* ══════════════ 자료 수집 ══════════════ */

async function loadSources(tripId: string): Promise<void> {
  try {
    if (!isStorageReady()) {
      sources = [];
      return;
    }

    const [shared, notes] = await Promise.all([loadSharedDocuments(tripId), loadNotes(tripId)]);
    const unlockedUserId = getUnlockedUserId(tripId);
    const personal = unlockedUserId ? await loadPersonalDocuments(tripId, unlockedUserId) : [];
    const docs = [...shared, ...personal];

    // 한꺼번에 보내지 않고 2개씩 — 문서가 많으면 질문 한 번에 Gemini 분당 한도(무료 등급 10회)를 넘었다.
    // 문서 요약은 서버에 캐싱되므로 이렇게 느려지는 건 문서를 처음 읽을 때뿐이다.
    const resolved = await mapWithLimit(docs, 2, async (doc) => ({ doc, source: await resolveDocSource(doc) }));
    const docSources = resolved.filter((r) => r.source).map((r) => r.source!);
    sourcesFailedCount = resolved.filter((r) => !r.source && r.doc.file_path).length;

    const noteSources: AssistantSource[] = [];
    for (const note of notes) {
      const body = (note.body || '').trim();
      if (!body) continue; // 제목뿐인 메모는 질문에 답할 근거가 안 됨
      noteSources.push({
        title: note.title,
        category: NOTE_CATEGORY_LABEL[normalizeNoteCategory(note.category)],
        kind: 'note',
        digest: body,
      });
    }

    sources = [...docSources, ...noteSources];
  } catch (e) {
    console.error('[Assistant] 자료 불러오기 실패:', (e as Error).message);
    sources = [];
  } finally {
    sourcesReady = true;
    renderList();
    updateFormState();
  }
}

/** 순서를 지키며 최대 limit개씩만 동시에 처리한다 */
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** 문서 하나를 질문에 쓸 수 있는 자료로 바꾼다 — 파일이 없으면 저장된 필드를 그대로,
 *  있으면 서버에 digest를 요청한다(문서당 캐싱되므로 세션당 1회뿐) */
async function resolveDocSource(doc: TripDocument): Promise<AssistantSource | null> {
  const category = DOC_CATEGORY_LABEL[normalizeDocCategory(doc.category)];

  if (!doc.file_path) {
    const parts = [doc.description, doc.reference_code ? '예약번호 ' + doc.reference_code : null].filter(
      (v): v is string => !!v && v.trim().length > 0
    );
    if (parts.length === 0) return null;
    return { title: doc.title, category, kind: 'document', digest: parts.join(' · ') };
  }

  try {
    const result = await requestDocDigest({
      documentId: doc.id,
      title: doc.title,
      category,
      filePath: doc.file_path,
      fileType: doc.file_type ?? 'application/octet-stream',
      updatedAt: doc.updated_at,
    });
    if (!result.readable || result.facts.length === 0) return null;
    return { title: doc.title, category, kind: 'document', digest: result.facts.join('\n') };
  } catch (e) {
    console.error('[Assistant] 문서 분석 실패(' + doc.title + '):', (e as Error).message);
    return null;
  }
}

/* ══════════════ 질문/답변 ══════════════ */

async function ask(question: string): Promise<void> {
  if (sending) return;
  turns.push({ role: 'user', text: question });
  sending = true;
  renderList();
  updateFormState();

  try {
    if (!sourcesReady && sourcesPromise) await sourcesPromise;
    const result = await requestAssistantAnswer(currentTripId, question, sources);
    turns.push({ role: 'ai', text: result.answer, sources: result.usedTitles });
  } catch (e) {
    turns.push({ role: 'ai', text: '답변을 가져오지 못했어요: ' + (e as Error).message, error: true });
  } finally {
    sending = false;
    renderList();
    updateFormState();
  }
}

/* ══════════════ 렌더 ══════════════ */

function mountShell(): void {
  if (!rootEl) return;
  rootEl.innerHTML = [
    '<div class="ws-ai-chat">',
    '  <div class="ws-ai-chat-list" id="ws-ai-list"></div>',
    '  <div class="ws-ai-disclaimer" id="ws-ai-disclaimer">AI가 문서·메모 내용을 바탕으로 정리한 답변이에요. 중요한 내용은 원본으로 다시 확인하세요.</div>',
    '  <form class="ws-ai-input-form" id="ws-ai-form">',
    '    <input class="ws-ai-input" id="ws-ai-input" type="text" autocomplete="off" />',
    '    <button type="submit" class="ws-ai-send-btn" id="ws-ai-send">' + IC_SEND + '</button>',
    '  </form>',
    '</div>',
  ].join('\n');

  const form = rootEl.querySelector('#ws-ai-form') as HTMLFormElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = rootEl?.querySelector('#ws-ai-input') as HTMLInputElement | null;
    if (!input) return;
    const q = input.value.trim();
    if (!q || sending) return;
    input.value = '';
    void ask(q);
  });
}

function updateFormState(): void {
  if (!rootEl) return;
  const input = rootEl.querySelector('#ws-ai-input') as HTMLInputElement | null;
  const sendBtn = rootEl.querySelector('#ws-ai-send') as HTMLButtonElement | null;
  const disclaimerEl = rootEl.querySelector('#ws-ai-disclaimer') as HTMLElement | null;
  if (input) {
    input.disabled = sending;
    input.placeholder = sourcesReady ? '궁금한 걸 물어보세요' : '문서를 읽는 중…';
  }
  if (sendBtn) sendBtn.disabled = sending;
  if (disclaimerEl) disclaimerEl.classList.toggle('is-visible', turns.length > 0);
}

function renderList(): void {
  const listEl = rootEl?.querySelector('#ws-ai-list') as HTMLElement | null;
  if (!listEl) return;

  listEl.innerHTML =
    turns.length === 0 ? emptyStateHtml() : turns.map(turnHtml).join('') + (sending ? typingIndicatorHtml() : '');

  if (turns.length === 0) bindEmptyState(listEl);
  listEl.scrollTop = listEl.scrollHeight;
}

function sourceSummaryLabel(): string {
  const docCount = sources.filter((s) => s.kind === 'document').length;
  const noteCount = sources.filter((s) => s.kind === 'note').length;
  const parts: string[] = [];
  if (docCount > 0) parts.push('문서 ' + docCount + '개');
  if (noteCount > 0) parts.push('메모 ' + noteCount + '개');
  return parts.join(', ');
}

function emptyStateHtml(): string {
  if (!sourcesReady) {
    return [
      '<div class="ws-ai-empty">',
      '  <div class="ws-ai-empty-icon">' + IC_SPARKLE + '</div>',
      '  <div class="ws-ai-empty-title">문서를 읽는 중이에요…</div>',
      '</div>',
    ].join('');
  }

  if (sources.length === 0) {
    return [
      '<div class="ws-ai-empty">',
      '  <div class="ws-ai-empty-icon">' + IC_SPARKLE + '</div>',
      '  <div class="ws-ai-empty-title">아직 참고할 문서가 없어요</div>',
      '  <div class="ws-ai-empty-hint">DOCUMENTS에 항공권·숙소 예약증을 올리면 그 내용을 바탕으로 답해드려요.</div>',
      '  <button type="button" class="ws-ai-goto-docs" id="ws-ai-goto-docs">DOCUMENTS로 가기</button>',
      '</div>',
    ].join('');
  }

  return [
    '<div class="ws-ai-empty">',
    '  <div class="ws-ai-empty-icon">' + IC_SPARKLE + '</div>',
    '  <div class="ws-ai-empty-title">' + escapeHtml(sourceSummaryLabel()) + ' 확인했어요</div>',
    '  <div class="ws-ai-empty-hint">궁금한 걸 물어보세요.</div>',
    sourcesFailedCount > 0
      ? '  <div class="ws-ai-empty-note">' + sourcesFailedCount + '개 문서는 읽지 못했어요</div>'
      : '',
    '  <div class="ws-ai-prompts">' +
      PROMPT_CHIPS.map((p) => '<button type="button" class="ws-ai-prompt-chip">' + escapeHtml(p) + '</button>').join('') +
      '</div>',
    '</div>',
  ].join('');
}

function bindEmptyState(listEl: HTMLElement): void {
  listEl.querySelector('#ws-ai-goto-docs')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('mongsil:navigateGate', { detail: { tripId: currentTripId, gate: 'docs' } }));
  });
  listEl.querySelectorAll('.ws-ai-prompt-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const text = chip.textContent ?? '';
      if (text) void ask(text);
    });
  });
}

function turnHtml(t: ChatTurn): string {
  if (t.role === 'user') {
    return '<div class="ws-ai-turn user"><div class="ws-ai-bubble">' + escapeHtml(t.text) + '</div></div>';
  }

  const sourcesHtml =
    t.sources && t.sources.length > 0
      ? '<div class="ws-ai-sources">' +
        t.sources.map((s) => '<span class="ws-ai-source-chip">' + escapeHtml(s) + '</span>').join('') +
        '</div>'
      : '';

  return [
    '<div class="ws-ai-turn ai' + (t.error ? ' is-error' : '') + '">',
    '  <div class="ws-ai-msg-icon">' + IC_SPARKLE + '</div>',
    '  <div class="ws-ai-bubble-col">',
    '    <div class="ws-ai-bubble">' + escapeHtml(t.text) + '</div>',
    sourcesHtml,
    '  </div>',
    '</div>',
  ].join('');
}

function typingIndicatorHtml(): string {
  return [
    '<div class="ws-ai-turn ai">',
    '  <div class="ws-ai-msg-icon">' + IC_SPARKLE + '</div>',
    '  <div class="ws-ai-bubble ws-ai-typing"><span></span><span></span><span></span></div>',
    '</div>',
  ].join('');
}
