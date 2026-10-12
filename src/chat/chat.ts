import { supabase } from '../supabase';
import { store } from '../store';
import type { ChatMessage } from '../types/database';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { saveTripLinkFromChatMessage, hostnameOf } from '../trips/addLink';
import './chat.css';

/* ── 모듈 내부 상태 (워크스페이스 페이지 하나당 하나의 채팅 세션) ── */
let currentTripId: string | null = null;
let channel: RealtimeChannel | null = null;
let messages: ChatMessage[] = [];

/** 패널 리스너에 전달되는 이벤트 — 수정/삭제도 실시간으로 반영하기 위해 종류를 구분한다 */
type ChatEvent =
  | { type: 'insert'; message: ChatMessage }
  | { type: 'update'; message: ChatMessage }
  | { type: 'delete'; id: string };

let panelListeners: Array<(evt: ChatEvent) => void> = [];
let badgeListener: ((msg: ChatMessage) => void) | null = null;

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ── 채팅에 링크가 오면 "이동할까요?" 토스트를 띄우는 기능 ──
 * 별도 브로드캐스트 채널 없이 이미 구독 중인 chat_messages INSERT 이벤트를 그대로 활용한다.
 * 투표 요청(hotelVote.ts)과 달리 응답을 집계할 필요가 없어(각자 이동 여부만 결정) 훨씬 단순하다. */
const URL_RE = /https?:\/\/[^\s<>"']+/i;
let linkToastLayer: HTMLElement | null = null;

function extractFirstUrl(text: string): string | null {
  const m = text.match(URL_RE);
  return m ? m[0] : null;
}

function ensureLinkToastLayer(): HTMLElement {
  if (linkToastLayer && document.body.contains(linkToastLayer)) return linkToastLayer;
  linkToastLayer = document.createElement('div');
  linkToastLayer.className = 'clt-toast-layer';
  document.body.appendChild(linkToastLayer);
  return linkToastLayer;
}

function showLinkShareToast(msg: ChatMessage, url: string): void {
  const layer = ensureLinkToastLayer();
  const card = document.createElement('div');
  card.className = 'clt-toast';
  card.innerHTML = [
    '<div class="clt-toast-icon">',
    '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    '</div>',
    '<div class="clt-toast-body">',
    '  <div class="clt-toast-title">' + escapeHtml(msg.display_name || '익명') + '님이 링크를 보냈어요</div>',
    '  <div class="clt-toast-url">' + escapeHtml(url) + '</div>',
    '  <div class="clt-toast-actions">',
    '    <button type="button" class="clt-toast-btn clt-toast-go">이동하기</button>',
    '    <button type="button" class="clt-toast-btn clt-toast-dismiss">닫기</button>',
    '  </div>',
    '</div>',
  ].join('');
  layer.appendChild(card);

  const remove = () => card.remove();
  const autoRemove = setTimeout(remove, 20000);

  card.querySelector('.clt-toast-dismiss')?.addEventListener('click', () => {
    clearTimeout(autoRemove);
    remove();
  });
  card.querySelector('.clt-toast-go')?.addEventListener('click', () => {
    clearTimeout(autoRemove);
    remove();
    window.open(url, '_blank', 'noopener,noreferrer');
  });
}

function readStorageKey(tripId: string): string {
  return 'mongsil_chat_read_' + tripId;
}

export function getLastReadAt(tripId: string): string {
  return localStorage.getItem(readStorageKey(tripId)) || new Date(0).toISOString();
}

export function markAsRead(tripId: string): void {
  localStorage.setItem(readStorageKey(tripId), new Date().toISOString());
}

/** 트립 채팅 초기화: 히스토리 로드 + 실시간 구독 (트립 전환 시에만 재구독) */
export async function initChat(tripId: string): Promise<void> {
  if (currentTripId === tripId && channel) return;

  teardownChat();
  currentTripId = tripId;

  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    console.error('Chat history load error:', error.message);
  }
  messages = data ?? [];

  channel = supabase
    .channel('chat:' + tripId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: 'trip_id=eq.' + tripId },
      (payload) => {
        const msg = payload.new as ChatMessage;
        // 중복 방지 (낙관적 렌더링을 하지 않으므로 실질적으로 발생 안 하지만 안전장치)
        if (messages.some((m) => m.id === msg.id)) return;
        messages.push(msg);
        panelListeners.forEach((fn) => fn({ type: 'insert', message: msg }));
        if (badgeListener) badgeListener(msg);

        // 다른 멤버가 보낸 메시지에 링크가 있으면, 채팅 패널을 열어보지 않아도
        // 바로 "이동할까요?" 토스트로 물어본다.
        const user = store.get('user');
        if (msg.user_id !== user?.id) {
          const url = extractFirstUrl(msg.message);
          if (url) showLinkShareToast(msg, url);
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: 'trip_id=eq.' + tripId },
      (payload) => {
        const msg = payload.new as ChatMessage;
        const idx = messages.findIndex((m) => m.id === msg.id);
        if (idx === -1) return;
        messages[idx] = msg;
        panelListeners.forEach((fn) => fn({ type: 'update', message: msg }));
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'chat_messages', filter: 'trip_id=eq.' + tripId },
      (payload) => {
        const deletedId = (payload.old as { id: string }).id;
        messages = messages.filter((m) => m.id !== deletedId);
        panelListeners.forEach((fn) => fn({ type: 'delete', id: deletedId }));
      }
    )
    .subscribe();
}

export function teardownChat(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  panelListeners = [];
  badgeListener = null;
  messages = [];
  currentTripId = null;
  linkToastLayer?.remove();
  linkToastLayer = null;
}

export function getMessages(): ChatMessage[] {
  return messages;
}

export function countUnreadSince(tripId: string, userId: string | undefined): number {
  const lastRead = getLastReadAt(tripId);
  return messages.filter((m) => m.created_at > lastRead && m.user_id !== userId).length;
}

/** 배지 갱신용 리스너 — 워크스페이스당 하나만 유지 (덮어쓰기) */
export function setBadgeListener(fn: (msg: ChatMessage) => void): void {
  badgeListener = fn;
}

/** 패널이 열려있는 동안만 유지되는 리스너. 반환값 호출로 해제 */
function onNewMessage(fn: (evt: ChatEvent) => void): () => void {
  panelListeners.push(fn);
  return () => {
    panelListeners = panelListeners.filter((l) => l !== fn);
  };
}

export async function sendMessage(tripId: string, text: string): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const user = store.get('user');
  if (!user) return false;

  const meta = user.user_metadata ?? {};
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      trip_id: tripId,
      user_id: user.id,
      display_name: meta.full_name ?? meta.name ?? user.email ?? '익명',
      avatar_url: meta.avatar_url ?? meta.picture ?? null,
      message: trimmed,
    })
    .select()
    .single();

  if (error) {
    console.error('Chat send error:', error.message);
    return false;
  }

  // 메시지에 링크가 있으면 "보낸 사람"의 클라이언트에서 딱 한 번만 LINKS 탭에 저장한다.
  // 접속 중인 모든 멤버가 각자 realtime 이벤트를 받고 저장하면 중복 저장되므로,
  // 받는 쪽이 아니라 보내는 쪽에서 저장하는 게 맞다.
  const url = extractFirstUrl(trimmed);
  if (url) saveTripLinkFromChatMessage(data, url).catch(() => {});

  return true;
}

/** 본인 메시지만 수정 가능(RLS로도 강제됨). 낙관적 반영 없이 realtime UPDATE로 화면에 반영된다. */
export async function updateMessage(messageId: string, text: string): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const { error } = await supabase
    .from('chat_messages')
    .update({ message: trimmed, edited_at: new Date().toISOString() })
    .eq('id', messageId);

  if (error) {
    console.error('Chat edit error:', error.message);
    return false;
  }
  return true;
}

/** 본인 메시지만 삭제 가능(RLS로도 강제됨). realtime DELETE로 모든 멤버 화면에서 사라진다. */
export async function deleteMessage(messageId: string): Promise<boolean> {
  const { error } = await supabase.from('chat_messages').delete().eq('id', messageId);
  if (error) {
    console.error('Chat delete error:', error.message);
    return false;
  }
  return true;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return ampm + ' ' + h12 + ':' + m;
}

const EDIT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
const DELETE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
const LINK_ARROW_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M7 7h10v10"/></svg>';

/** 메시지 안의 URL을 찾아 쪼개기 위한 전역 정규식 — 캡처 그룹을 두면 split() 결과에
 * 구분자(URL)도 배열에 포함된다. URL_RE(첫 링크 감지용)와 별개로 둔다. */
const URL_RE_SPLIT = /(https?:\/\/[^\s<>"']+)/gi;

/** 긴 URL을 그대로 보여주면 채팅창이 가로로 넓어지므로, 파비콘+도메인만 보이는
 * 작은 칩으로 대체한다(실제 파비콘 — shortlist/board의 숙소 사이트 카드와 같은 방식). */
function linkChipHtml(url: string): string {
  const domain = hostnameOf(url);
  return [
    '<a class="chat-link-chip" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">',
    '  <img class="chat-link-chip-icon" src="https://www.google.com/s2/favicons?domain=' + escapeHtml(domain) + '&sz=64" alt="" />',
    '  <span class="chat-link-chip-domain">' + escapeHtml(domain) + '</span>',
    '  <span class="chat-link-chip-arrow">' + LINK_ARROW_ICON + '</span>',
    '</a>',
  ].join('');
}

/** 메시지 본문 안의 URL만 링크 칩으로 바꾸고 나머지 텍스트는 그대로 이스케이프해서 합친다.
 * URL_RE_SPLIT이 이미 공백/따옴표/꺾쇠괄호를 제외하고 매칭하므로 href에 별도 인코딩이 필요 없다. */
function renderMessageBody(text: string): string {
  return text
    .split(URL_RE_SPLIT)
    .map((part, i) => (i % 2 === 1 ? linkChipHtml(part) : escapeHtml(part)))
    .join('');
}

function bubbleHtml(msg: ChatMessage, isMe: boolean): string {
  const initial = (msg.display_name || '?').charAt(0);
  const avatar = msg.avatar_url
    ? '<img src="' + msg.avatar_url + '" alt="" referrerpolicy="no-referrer" />'
    : escapeHtml(initial);
  const editedLabel = msg.edited_at ? ' <span class="chat-edited">(수정됨)</span>' : '';
  const body = renderMessageBody(msg.message);

  if (isMe) {
    return [
      '<div class="chat-row me" data-message-id="' + msg.id + '">',
      '  <div class="chat-actions">',
      '    <button type="button" class="chat-action-btn chat-edit-btn" title="수정" aria-label="메시지 수정">' + EDIT_ICON + '</button>',
      '    <button type="button" class="chat-action-btn chat-delete-btn" title="삭제" aria-label="메시지 삭제">' + DELETE_ICON + '</button>',
      '  </div>',
      '  <div class="chat-bubble-wrap">',
      '    <div class="chat-bubble me">' + body + '</div>',
      '    <span class="chat-time">' + formatTime(msg.created_at) + editedLabel + '</span>',
      '  </div>',
      '</div>',
    ].join('');
  }

  return [
    '<div class="chat-row them" data-message-id="' + msg.id + '">',
    '  <div class="chat-avatar">' + avatar + '</div>',
    '  <div class="chat-bubble-col">',
    '    <span class="chat-sender">' + escapeHtml(msg.display_name || '익명') + '</span>',
    '    <div class="chat-bubble-wrap">',
    '      <div class="chat-bubble them">' + body + '</div>',
    '      <span class="chat-time">' + formatTime(msg.created_at) + editedLabel + '</span>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('');
}

/** "me" 메시지를 수정 모드로 그릴 때 쓰는 인라인 폼 — 값은 렌더 후 JS로 채운다(속성 이스케이프 회피) */
function editFormHtml(msg: ChatMessage): string {
  return [
    '<div class="chat-row me editing" data-message-id="' + msg.id + '">',
    '  <form class="chat-edit-form" data-edit-id="' + msg.id + '">',
    '    <input class="chat-edit-input" type="text" autocomplete="off" />',
    '    <button type="submit" class="chat-edit-save" title="저장" aria-label="저장">' + CHECK_ICON + '</button>',
    '    <button type="button" class="chat-edit-cancel" title="취소" aria-label="취소">' + CLOSE_ICON + '</button>',
    '  </form>',
    '</div>',
  ].join('');
}

/**
 * 채팅 패널 UI를 container에 그린다.
 * 반환값: 패널이 닫힐 때 반드시 호출해야 하는 정리(cleanup) 함수
 */
export function renderChatPanelUI(container: HTMLElement, tripId: string): () => void {
  const user = store.get('user');
  const myId = user?.id;
  let editingId: string | null = null;

  container.innerHTML = [
    '<div class="chat-list" id="chat-list"></div>',
    '<form class="chat-input-form" id="chat-input-form">',
    '  <input class="chat-input" id="chat-input" type="text" placeholder="메시지를 입력하세요..." autocomplete="off" />',
    '  <button type="submit" class="chat-send-btn" id="chat-send-btn">',
    '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
    '  </button>',
    '</form>',
  ].join('');

  const listEl = container.querySelector('#chat-list') as HTMLElement;

  function rowHtml(m: ChatMessage): string {
    return m.id === editingId ? editFormHtml(m) : bubbleHtml(m, m.user_id === myId);
  }

  function startEdit(id: string): void {
    editingId = id;
    renderAll();
  }

  function stopEdit(): void {
    editingId = null;
    renderAll();
  }

  async function submitEdit(id: string, input: HTMLInputElement, saveBtn: HTMLButtonElement): Promise<void> {
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    saveBtn.disabled = true;
    const success = await updateMessage(id, text);
    if (!success) {
      input.disabled = false;
      saveBtn.disabled = false;
      return;
    }
    // editingId는 유지한 채 대기 — realtime UPDATE 이벤트가 도착하면 자동으로 편집모드가 풀린다
  }

  async function requestDelete(id: string, btn: HTMLButtonElement): Promise<void> {
    if (!window.confirm('메시지를 삭제할까요?')) return;
    btn.disabled = true;
    const success = await deleteMessage(id);
    if (!success) btn.disabled = false;
    // 성공 시엔 realtime DELETE 이벤트가 도착하면서 화면에서 사라진다
  }

  /** root(전체 목록 또는 새로 삽입/교체된 행 하나) 안의 수정/삭제 버튼과 편집 폼에 이벤트를 건다 */
  function bindActionsWithin(root: ParentNode): void {
    root.querySelectorAll('.chat-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).closest('.chat-row')?.getAttribute('data-message-id');
        if (id) startEdit(id);
      });
    });
    root.querySelectorAll('.chat-delete-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).closest('.chat-row')?.getAttribute('data-message-id');
        if (id) requestDelete(id, btn as HTMLButtonElement);
      });
    });
    root.querySelectorAll('.chat-edit-form').forEach((form) => {
      const id = (form as HTMLElement).dataset.editId;
      const input = form.querySelector('.chat-edit-input') as HTMLInputElement | null;
      const saveBtn = form.querySelector('.chat-edit-save') as HTMLButtonElement | null;
      const cancelBtn = form.querySelector('.chat-edit-cancel') as HTMLButtonElement | null;
      if (!id || !input || !saveBtn || !cancelBtn) return;

      const msg = messages.find((m) => m.id === id);
      input.value = msg?.message ?? '';
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitEdit(id, input, saveBtn);
      });
      cancelBtn.addEventListener('click', () => stopEdit());
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') stopEdit();
      });
    });
  }

  function renderAll(): void {
    if (messages.length === 0) {
      listEl.innerHTML = '<div class="chat-empty">아직 메시지가 없어요.<br>첫 메시지를 보내보세요!</div>';
      return;
    }
    listEl.innerHTML = messages.map(rowHtml).join('');
    listEl.scrollTop = listEl.scrollHeight;
    bindActionsWithin(listEl);
  }

  renderAll();

  const unsubscribe = onNewMessage((evt) => {
    if (evt.type === 'insert') {
      const msg = evt.message;
      if (messages.length <= 1) {
        renderAll();
        return;
      }
      const wasNearBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 80;
      const div = document.createElement('div');
      div.innerHTML = rowHtml(msg);
      const rowEl = div.firstElementChild as HTMLElement;
      listEl.appendChild(rowEl);
      bindActionsWithin(rowEl);
      if (wasNearBottom) listEl.scrollTop = listEl.scrollHeight;
      return;
    }

    if (evt.type === 'update') {
      if (editingId === evt.message.id) editingId = null; // 저장 성공 → 편집모드 종료
      const existing = listEl.querySelector('[data-message-id="' + evt.message.id + '"]');
      if (!existing) return;
      const div = document.createElement('div');
      div.innerHTML = rowHtml(evt.message);
      const rowEl = div.firstElementChild as HTMLElement;
      existing.replaceWith(rowEl);
      bindActionsWithin(rowEl);
      return;
    }

    // evt.type === 'delete'
    if (editingId === evt.id) editingId = null;
    listEl.querySelector('[data-message-id="' + evt.id + '"]')?.remove();
    if (messages.length === 0) renderAll();
  });

  const form = container.querySelector('#chat-input-form') as HTMLFormElement;
  const input = container.querySelector('#chat-input') as HTMLInputElement;
  const sendBtn = container.querySelector('#chat-send-btn') as HTMLButtonElement;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    sendBtn.disabled = true;
    const success = await sendMessage(tripId, text);
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
    if (success) input.value = '';
  });

  return unsubscribe;
}
