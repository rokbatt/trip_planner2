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
  DOCS_DATA_EVENT,
  DOCS_LOCK_EVENT,
  getLoadErrorCount,
  getUnlockedUserId,
  isStorageReady,
  isValidPin,
  setUnlockedUserId,
  verifyPin,
  loadDocUsers,
  loadNotes,
  loadPersonalDocuments,
  loadSharedDocuments,
  DOC_CATEGORY_LABEL,
  NOTE_CATEGORY_LABEL,
  normalizeDocCategory,
  normalizeNoteCategory,
} from '../docs/docsStore';
import { escapeHtml } from '../docs/docsIcons';
import { requestAssistantAnswer, requestDocDigest, fetchMyPlanInfo, planRecheckDue } from './assistantClient';
import type { AssistantSource, Plan, WebSource } from './assistantClient';
import { safeHttpUrl } from '../utils/html';
import type { TripDocUser, TripDocument } from '../types/database';
import './assistant.css';
import { clearTripDigests, lookupDigest, storeDigest } from './digestCache';
import { composeFileDocDigest, needsSourceRefresh } from './docSource';
import { personalNotice, planPersonalVault } from './personalVault';
import type { PersonalState } from './personalVault';
import { store } from '../store';
import { goPro } from '../pay/proEntry';

const IC_SPARKLE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>';
const IC_SEND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';

const PROMPT_CHIPS = ['체크인 시간이 몇 시야?', '항공편 예약번호 알려줘', '숙소 주소가 어디야?', '수하물 규정이 어떻게 돼?'];

interface ChatTurn {
  role: 'user' | 'ai';
  text: string;
  sources?: string[];
  /** PRO 웹 검색 답변이 참고한 웹 페이지 */
  webSources?: WebSource[];
  web?: boolean;
  error?: boolean;
}

/* ── PRO: 웹 검색 포함 ──
 * 문서·메모에 없는 일반 정보(운영 시간·입장료·교통 등)를 웹에서 찾아 함께 답한다. 유료(PRO) 사용자만 —
 * 무료 사용자는 스위치가 잠겨 보이고 눌러도 안내만 나온다. 서버(api/ai.ts handleDocQAWeb)가 다시 확인한다.
 */
let myPlan: Plan | null = null;
/** 이용권의 PRO 웹 검색 남은 수(null = 제한 없음·모름) — 안내 문구용, 실제 차감은 서버 */
let webLeft: number | null = null;

let planAt = 0;
function refreshPlan(): void {
  planAt = Date.now();
  void fetchMyPlanInfo().then((p) => { myPlan = p.plan; webLeft = p.webLeft; updateFormState(); });
}
let planAsked = false;
let webOn = false;

let rootEl: HTMLElement | null = null;
let currentTripId = '';
let turns: ChatTurn[] = [];
let sources: AssistantSource[] = [];
let sourcesReady = false;
let sourcesFailedCount = 0;
let sourcesPromise: Promise<void> | null = null;
/** 개인 문서 보관함 상태와, 읽지 못해 건너뛴 파일 문서 수(안내용) */
let personalState: PersonalState = 'none';
let personalSkippedFiles = 0;
/** 이 계정에 연결된 내 보관함들 — 잠겨 있을 때 여기서 바로 PIN을 풀 수 있다(다른 사람 보관함은 다루지 않는다) */
let myVaults: TripDocUser[] = [];
/** 패널 안 PIN 입력 상태. 대화가 갱신돼 알림이 다시 그려져도 입력하던 내용이 사라지지 않게 모듈에 둔다 */
let unlockOpen = false;
let unlockVaultId: string | null = null;
let unlockPin = '';
let unlockError = '';
let unlockBusy = false;
/** 지금 자료에 개인 문서가 들어 있는지 — 다시 잠글 때 대화를 비울지 정한다 */
let includedPersonal = false;
/** 가장 최근에 시작한 불러오기 번호 — PIN을 풀거나 잠그는 사이에 시작한 옛 불러오기 결과가 덮어쓰지 못하게 */
let loadSeq = 0;
let sending = false;
/** 문서·메모를 고쳤다는 신호를 받았다 — 다음에 열거나 질문할 때 자료를 새로 불러온다 */
let sourcesStale = false;
let lastLoadedAt = 0;
/** 신호가 없어도 이 시간이 지나면 다시 불러온다 — 다른 멤버가 고친 건 이 탭이 신호를 받지 못한다 */
const SOURCES_MAX_AGE_MS = 60_000;

export function renderAssistantPanel(container: HTMLElement, tripId: string): void {
  if (tripId !== currentTripId) {
    currentTripId = tripId;
    turns = [];
    sources = [];
    sourcesReady = false;
    sourcesFailedCount = 0;
    sourcesPromise = null;
    personalState = 'none';
    personalSkippedFiles = 0;
    myVaults = [];
    unlockOpen = false;
    unlockVaultId = null;
    unlockPin = '';
    unlockError = '';
    unlockBusy = false;
    includedPersonal = false;
    loadSeq++;
    sending = false;
    sourcesStale = false;
    lastLoadedAt = 0;
  }
  rootEl = container;
  mountShell();
  renderList();
  updateFormState();
  // 처음이거나, 무료로 알고 있는데 시간이 지났으면 다시 확인한다(결제 화면에서 이용권을 사고 돌아온 경우)
  if (!planAsked || planRecheckDue(myPlan, planAt)) {
    planAsked = true;
    refreshPlan();
  }

  if (!sourcesReady && !sourcesPromise) {
    sourcesPromise = loadSources(tripId);
  } else if (sourcesReady && isRefreshDue()) {
    // 이미 보여주던 자료는 그대로 두고 뒤에서 새로 불러온다(읽는 중 화면으로 되돌리지 않는다)
    sourcesPromise = loadSources(tripId);
  }
}

function isRefreshDue(): boolean {
  return needsSourceRefresh({ stale: sourcesStale, lastLoadedAt, now: Date.now(), maxAgeMs: SOURCES_MAX_AGE_MS });
}

export function teardownAssistantPanel(): void {
  rootEl = null;
}

/* ══════════════ 자료 수집 ══════════════ */

async function loadSources(tripId: string): Promise<void> {
  const seq = ++loadSeq;
  // 시작할 때 내린다 — 불러오는 동안 또 고치면 신호가 다시 올라서 다음에 한 번 더 불러온다
  sourcesStale = false;
  try {
    if (!isStorageReady()) {
      sources = [];
      return;
    }

    const errorsBefore = getLoadErrorCount();
    const [shared, notes, vaults] = await Promise.all([loadSharedDocuments(tripId), loadNotes(tripId), loadDocUsers(tripId)]);

    // 개인 문서: 이 탭에서 PIN을 풀었고 내 계정에 연결된 보관함이면 전부, 연결이 비었거나 다른 계정이면 파일 없는 문서만
    // (파일 문서는 서버가 본인 여부를 확인하므로 읽을 수 없다). PIN을 풀기 전에는 개인 문서를 조회하지 않는다.
    const plan = planPersonalVault({
      unlockedId: getUnlockedUserId(tripId),
      vaults,
      myUserId: store.get('user')?.id ?? null,
    });
    let personal: Awaited<ReturnType<typeof loadPersonalDocuments>> = [];
    let skippedFiles = 0;
    if (plan.vaultId) {
      const all = await loadPersonalDocuments(tripId, plan.vaultId);
      if (plan.state === 'ready') {
        personal = all;
      } else {
        personal = all.filter((d) => !d.file_path);
        skippedFiles = all.length - personal.length;
      }
    }
    // 로더는 실패해도 빈 목록을 주므로, 실패 횟수가 늘었으면 그 결과를 믿지 않는다(아래 catch가 이전 자료를 지킨다).
    // 비싼 문서 요약 호출 전에 확인한다.
    if (getLoadErrorCount() !== errorsBefore) throw new Error('문서·메모를 불러오지 못했어요');
    const docs = [...shared, ...personal];

    // 한꺼번에 보내지 않고 2개씩 — 문서가 많으면 질문 한 번에 Gemini 분당 한도(무료 등급 10회)를 넘었다.
    // 문서 요약은 서버에 캐싱되므로 이렇게 느려지는 건 문서를 처음 읽을 때뿐이다.
    const stats = { tab: 0, server: 0, fresh: 0, failed: 0 };
    const resolved = await mapWithLimit(docs, 2, async (doc) => ({ doc, source: await resolveDocSource(tripId, doc, stats) }));
    if (seq !== loadSeq) return; // 그 사이 잠금이 바뀌어 새로 불러오는 중이다 — 이 결과는 버린다

    const docSources = resolved.filter((r) => r.source).map((r) => r.source!);
    sourcesFailedCount = stats.failed;
    personalState = plan.state;
    personalSkippedFiles = skippedFiles;
    const myId = store.get('user')?.id ?? null;
    myVaults = myId ? vaults.filter((v) => v.user_id === myId) : [];
    includedPersonal = personal.length > 0;
    // 진단용 — "매번 다시 읽는다"로 보일 때 실제로 어디서 왔는지 바로 보이게
    console.log(
      '[Assistant] 문서 요약: 이 탭에 저장된 것 ' + stats.tab + ' · 서버에 저장된 것 ' + stats.server +
      ' · 새로 읽음(AI) ' + stats.fresh + ' · 실패 ' + stats.failed + ' · 개인 문서 ' + plan.state
    );

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
    if (seq !== loadSeq) return;
    console.error('[Assistant] 자료 불러오기 실패:', (e as Error).message);
    // 새로고침이 실패했을 때 잘 쓰고 있던 자료를 비우지 않는다 — 처음 불러오는 중일 때만 비운다
    if (!sourcesReady) sources = [];
    // 다음에 열거나 질문할 때 다시 시도한다(실패한 결과를 "최신"으로 60초 동안 믿지 않게)
    sourcesStale = true;
  } finally {
    if (seq === loadSeq) {
      lastLoadedAt = Date.now();
      sourcesReady = true;
      renderList();
      updateFormState();
    }
  }
}

/** DOCUMENTS에서 PIN을 풀거나 다시 잠갔을 때 — 개인 문서를 바로 반영한다(새로고침 불필요) */
function handleLockChange(e: Event): void {
  const detail = (e as CustomEvent<{ tripId: string; unlocked: boolean }>).detail;
  if (!detail || !currentTripId || detail.tripId !== currentTripId) return;

  if (!detail.unlocked) {
    // 다시 잠그면 개인 문서 내용이 대화에 남지 않게 한다
    if (includedPersonal) turns = [];
    clearTripDigests(sessionStorage, currentTripId);
  }
  sourcesReady = false;
  sourcesPromise = null;
  if (rootEl) {
    sourcesPromise = loadSources(currentTripId);
    renderList();
    updateFormState();
  }
  // 패널이 닫혀 있으면 다음에 열 때 renderAssistantPanel이 새로 불러온다
}

window.addEventListener(DOCS_LOCK_EVENT, handleLockChange);

/** 문서·메모를 만들거나 고치거나 지웠다 — 자료가 낡았다고 표시만 해 둔다(열거나 질문할 때 새로 불러온다) */
window.addEventListener(DOCS_DATA_EVENT, () => { sourcesStale = true; });

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

/** 문서 하나를 질문에 쓸 수 있는 자료로 바꾼다 — 파일이 없으면 저장된 필드를 그대로 쓴다.
 *  파일이 있으면 ① 이 탭에 저장된 요약(새로고침해도 유지) → ② 서버(저장된 요약이 있으면 그걸 주고,
 *  없을 때만 AI가 파일을 읽는다) 순서로 찾는다. 그래서 AI가 읽는 건 문서당 처음 한 번뿐이다. */
export async function resolveDocSource(
  tripId: string,
  doc: TripDocument,
  stats: { tab: number; server: number; fresh: number; failed: number }
): Promise<AssistantSource | null> {
  const category = DOC_CATEGORY_LABEL[normalizeDocCategory(doc.category)];

  if (!doc.file_path) {
    const parts = [doc.description, doc.reference_code ? '예약번호 ' + doc.reference_code : null].filter(
      (v): v is string => !!v && v.trim().length > 0
    );
    if (parts.length === 0) return null;
    return { title: doc.title, category, kind: 'document', digest: parts.join(' · ') };
  }

  // 파일 요약만이 아니라 사용자가 직접 고쳐 쓴 세부내용·예약번호도 함께 준다(docSource.ts)
  const toSource = (facts: string[]): AssistantSource | null => {
    const digest = composeFileDocDigest(doc, facts);
    return digest ? { title: doc.title, category, kind: 'document', digest } : null;
  };

  // 요약은 파일에서 뽑은 것이라 파일이 바뀔 때만 다시 만든다 — 설명·예약번호만 고친 것으로 다시 읽지 않는다
  // (파일을 바꾸면 업로드 경로가 새로 생긴다)
  const fileVersion = doc.file_path;
  const local = lookupDigest(sessionStorage, tripId, doc.id, fileVersion, Date.now());
  if (local.hit) {
    if (local.facts === null) {
      stats.failed++;
      return toSource([]);
    }
    stats.tab++;
    return toSource(local.facts);
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
    if (result.cached) stats.server++;
    else stats.fresh++;
    const facts = result.readable ? result.facts : [];
    storeDigest(sessionStorage, tripId, doc.id, fileVersion, facts, Date.now());
    return toSource(facts);
  } catch (e) {
    console.error('[Assistant] 문서 분석 실패(' + doc.title + '):', (e as Error).message);
    stats.failed++;
    // 실패도 잠깐 기억한다 — 한도 초과일 때 새로고침마다 다시 몰리지 않게(10분 뒤 재시도)
    storeDigest(sessionStorage, tripId, doc.id, fileVersion, null, Date.now());
    return toSource([]);
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
    if (!sourcesReady && sourcesPromise) {
      await sourcesPromise;
    } else if (isRefreshDue()) {
      // 문서·메모를 고친 뒤라면 답하기 전에 최신 내용으로 — 옛 요약으로 답하지 않게
      sourcesPromise = loadSources(currentTripId);
      await sourcesPromise;
    }
    const useWeb = webOn && myPlan === 'pro';
    const result = await requestAssistantAnswer(currentTripId, question, sources, useWeb);
    turns.push({ role: 'ai', text: result.answer, sources: result.usedTitles, webSources: result.webSources, web: result.web });
    if (useWeb && webLeft !== null) refreshPlan(); // 남은 웹 검색 수를 서버 값으로 다시
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
    '  <div class="ws-ai-notice" id="ws-ai-notice"></div>',
    '  <div class="ws-ai-disclaimer" id="ws-ai-disclaimer">AI가 문서·메모 내용을 바탕으로 정리한 답변이에요. 중요한 내용은 원본으로 다시 확인하세요.</div>',
    '  <div class="ws-ai-web" id="ws-ai-web-row">',
    '    <button type="button" class="ws-ai-web-toggle" id="ws-ai-web" role="switch" aria-checked="false">',
    '      <span class="ws-ai-web-knob" aria-hidden="true"></span><span class="ws-ai-web-label">웹 검색 포함</span><span class="ws-ai-pro">PRO</span>',
    '    </button>',
    '    <span class="ws-ai-web-hint" id="ws-ai-web-hint"></span>',
    '  </div>',
    '  <form class="ws-ai-input-form" id="ws-ai-form">',
    '    <input class="ws-ai-input" id="ws-ai-input" type="text" autocomplete="off" />',
    '    <button type="submit" class="ws-ai-send-btn" id="ws-ai-send">' + IC_SEND + '</button>',
    '  </form>',
    '</div>',
  ].join('\n');

  rootEl.querySelector('#ws-ai-web')?.addEventListener('click', () => {
    if (myPlan !== 'pro') {
      // 무료로 확인됐으면 바로 요금제·결제 화면으로(2026-11-25 사용자 결정). 아직 확인 중이면 PRO일 수 있으니 기다리게 한다
      const hint = rootEl?.querySelector('#ws-ai-web-hint') as HTMLElement | null;
      if (hint) hint.textContent = '확인 중이에요…';
      // 누르는 순간 요금제를 한 번 더 확인한다 — 방금 이용권을 샀는데 옛 값으로 결제 화면에 또 보내지 않게
      void fetchMyPlanInfo().then((p) => {
        myPlan = p.plan; webLeft = p.webLeft; planAt = Date.now();
        if (p.plan === 'pro') { webOn = true; updateFormState(); return; }
        if (hint) hint.textContent = '';
        goPro('web');
      });
      return;
    }
    webOn = !webOn;
    updateFormState();
  });

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
  const webBtn = rootEl.querySelector('#ws-ai-web') as HTMLButtonElement | null;
  if (webBtn) {
    const on = webOn && myPlan === 'pro';
    webBtn.classList.toggle('is-on', on);
    webBtn.classList.toggle('is-locked', myPlan !== 'pro');
    webBtn.setAttribute('aria-checked', String(on));
    const hint = rootEl.querySelector('#ws-ai-web-hint') as HTMLElement | null;
    if (hint && myPlan === 'pro') hint.textContent = on ? '문서 + 웹에서 찾아 답해요 (하루 20번' + (webLeft !== null ? ' · 이용권 남은 ' + webLeft + '번' : '') + ')' : '';
  }
  if (disclaimerEl) disclaimerEl.classList.toggle('is-visible', turns.length > 0);
}

function renderList(): void {
  const listEl = rootEl?.querySelector('#ws-ai-list') as HTMLElement | null;
  if (!listEl) return;

  listEl.innerHTML =
    turns.length === 0 ? emptyStateHtml() : turns.map(turnHtml).join('') + (sending ? typingIndicatorHtml() : '');

  if (turns.length === 0) bindEmptyState(listEl);
  listEl.scrollTop = listEl.scrollHeight;
  renderNotice();
}

/** 개인 문서가 포함되지 않은 이유를 대화 위에 계속 보여준다(대화가 있어도 보이게) */
function renderNotice(): void {
  const el = rootEl?.querySelector('#ws-ai-notice') as HTMLElement | null;
  if (!el) return;
  const text = sourcesReady ? personalNotice(personalState, personalSkippedFiles) : null;
  if (!text) {
    el.classList.remove('is-visible');
    el.innerHTML = '';
    return;
  }
  el.classList.add('is-visible');

  // 잠겨 있으면 DOCUMENTS로 보내지 않고 여기서 바로 PIN을 받는다
  const canUnlock = personalState === 'locked' && myVaults.length > 0;
  if (!canUnlock) {
    el.innerHTML = '<span class="ws-ai-notice-text">' + escapeHtml(text) + '</span><button type="button" class="ws-ai-notice-btn" id="ws-ai-notice-go">DOCUMENTS로 가기</button>';
    el.querySelector('#ws-ai-notice-go')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('mongsil:navigateGate', { detail: { tripId: currentTripId, gate: 'docs' } }));
    });
    return;
  }

  const vaultId = unlockVaultId && myVaults.some((v) => v.id === unlockVaultId) ? unlockVaultId : myVaults[0].id;
  const who = myVaults.length > 1
    ? '<select class="ws-ai-unlock-who" id="ws-ai-unlock-who" aria-label="보관함 선택">' +
      myVaults.map((v) => '<option value="' + v.id + '"' + (v.id === vaultId ? ' selected' : '') + '>' + escapeHtml(v.name) + '</option>').join('') +
      '</select>'
    : '<span class="ws-ai-unlock-name">' + escapeHtml(myVaults[0].name) + '</span>';

  el.innerHTML = [
    '<span class="ws-ai-notice-text">' + escapeHtml(text) + '</span>',
    '<button type="button" class="ws-ai-notice-btn" id="ws-ai-unlock-toggle" aria-expanded="' + unlockOpen + '">' + (unlockOpen ? '닫기' : '잠금 풀기') + '</button>',
    unlockOpen
      ? '<form class="ws-ai-unlock" id="ws-ai-unlock-form" novalidate>' + who +
        '<input class="ws-ai-unlock-pin" id="ws-ai-unlock-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="PIN 4자리" aria-label="PIN" value="' + escapeHtml(unlockPin) + '"' + (unlockBusy ? ' disabled' : '') + ' />' +
        '<button type="submit" class="ws-ai-unlock-submit" id="ws-ai-unlock-submit"' + (unlockBusy ? ' disabled' : '') + '>확인</button></form>' +
        (unlockError ? '<div class="ws-ai-unlock-error" role="alert">' + escapeHtml(unlockError) + '</div>' : '')
      : '',
  ].join('');

  el.querySelector('#ws-ai-unlock-toggle')?.addEventListener('click', () => {
    unlockOpen = !unlockOpen;
    unlockPin = '';
    unlockError = '';
    renderNotice();
    if (unlockOpen) (el.querySelector('#ws-ai-unlock-pin') as HTMLInputElement | null)?.focus();
  });
  if (!unlockOpen) return;

  const pinEl = el.querySelector('#ws-ai-unlock-pin') as HTMLInputElement;
  const whoEl = el.querySelector('#ws-ai-unlock-who') as HTMLSelectElement | null;
  pinEl.addEventListener('input', () => {
    pinEl.value = pinEl.value.replace(/\D/g, '').slice(0, 4);
    unlockPin = pinEl.value;
    if (unlockError) {
      unlockError = '';
      el.querySelector('.ws-ai-unlock-error')?.remove();
    }
  });
  whoEl?.addEventListener('change', () => {
    unlockVaultId = whoEl.value;
    unlockPin = '';
    unlockError = '';
    pinEl.value = '';
    el.querySelector('.ws-ai-unlock-error')?.remove();
    pinEl.focus();
  });
  el.querySelector('#ws-ai-unlock-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitUnlock(whoEl?.value ?? vaultId);
  });
}

/** 패널 안에서 PIN 확인 — 맞으면 잠금 해제 이벤트가 나가고, 그걸 받은 handleLockChange가 개인 문서를 새로 불러온다 */
async function submitUnlock(vaultId: string): Promise<void> {
  if (unlockBusy) return;
  const vault = myVaults.find((v) => v.id === vaultId);
  if (!vault) return;
  if (!isValidPin(unlockPin)) {
    unlockError = 'PIN 4자리를 입력해주세요.';
    renderNotice();
    (rootEl?.querySelector('#ws-ai-unlock-pin') as HTMLInputElement | null)?.focus();
    return;
  }

  unlockBusy = true;
  renderNotice();
  const tripId = currentTripId;
  const ok = await verifyPin(vault, unlockPin);
  unlockBusy = false;
  if (tripId !== currentTripId) return; // 확인하는 사이 다른 여행으로 바뀌었다

  if (!ok) {
    unlockPin = '';
    unlockError = 'PIN이 일치하지 않아요.';
    renderNotice();
    (rootEl?.querySelector('#ws-ai-unlock-pin') as HTMLInputElement | null)?.focus();
    return;
  }
  unlockOpen = false;
  unlockPin = '';
  unlockError = '';
  setUnlockedUserId(tripId, vault.id);
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
  const webHtml =
    t.webSources && t.webSources.length > 0
      ? '<div class="ws-ai-websrc"><span class="ws-ai-websrc-label">웹 출처</span>' +
        t.webSources
          .map((w) => {
            const u = safeHttpUrl(w.uri);
            return u ? '<a class="ws-ai-websrc-link" href="' + escapeHtml(u) + '" target="_blank" rel="noopener">' + escapeHtml(w.title || u) + '</a>' : '';
          })
          .join('') +
        '</div>'
      : t.web ? '<div class="ws-ai-websrc"><span class="ws-ai-websrc-label">웹 검색 포함 답변</span></div>' : '';

  return [
    '<div class="ws-ai-turn ai' + (t.error ? ' is-error' : '') + '">',
    '  <div class="ws-ai-msg-icon">' + IC_SPARKLE + '</div>',
    '  <div class="ws-ai-bubble-col">',
    '    <div class="ws-ai-bubble">' + escapeHtml(t.text) + '</div>',
    sourcesHtml,
    webHtml,
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
