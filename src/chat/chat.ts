import { supabase } from '../supabase';
import { store } from '../store';
import type { ChatMessage } from '../types/database';
import type { RealtimeChannel } from '@supabase/supabase-js';
import './chat.css';

/* ── 모듈 내부 상태 (워크스페이스 페이지 하나당 하나의 채팅 세션) ── */
let currentTripId: string | null = null;
let channel: RealtimeChannel | null = null;
let messages: ChatMessage[] = [];
let panelListeners: Array<(msg: ChatMessage) => void> = [];
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
        panelListeners.forEach((fn) => fn(msg));
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
function onNewMessage(fn: (msg: ChatMessage) => void): () => void {
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
  const { error } = await supabase.from('chat_messages').insert({
    trip_id: tripId,
    user_id: user.id,
    display_name: meta.full_name ?? meta.name ?? user.email ?? '익명',
    avatar_url: meta.avatar_url ?? meta.picture ?? null,
    message: trimmed,
  });

  if (error) {
    console.error('Chat send error:', error.message);
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

function bubbleHtml(msg: ChatMessage, isMe: boolean): string {
  const initial = (msg.display_name || '?').charAt(0);
  const avatar = msg.avatar_url
    ? '<img src="' + msg.avatar_url + '" alt="" referrerpolicy="no-referrer" />'
    : escapeHtml(initial);

  if (isMe) {
    return [
      '<div class="chat-row me">',
      '  <div class="chat-bubble-wrap">',
      '    <div class="chat-bubble me">' + escapeHtml(msg.message) + '</div>',
      '    <span class="chat-time">' + formatTime(msg.created_at) + '</span>',
      '  </div>',
      '</div>',
    ].join('');
  }

  return [
    '<div class="chat-row them">',
    '  <div class="chat-avatar">' + avatar + '</div>',
    '  <div class="chat-bubble-col">',
    '    <span class="chat-sender">' + escapeHtml(msg.display_name || '익명') + '</span>',
    '    <div class="chat-bubble-wrap">',
    '      <div class="chat-bubble them">' + escapeHtml(msg.message) + '</div>',
    '      <span class="chat-time">' + formatTime(msg.created_at) + '</span>',
    '    </div>',
    '  </div>',
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

  function renderAll(): void {
    if (messages.length === 0) {
      listEl.innerHTML = '<div class="chat-empty">아직 메시지가 없어요.<br>첫 메시지를 보내보세요!</div>';
      return;
    }
    listEl.innerHTML = messages.map((m) => bubbleHtml(m, m.user_id === myId)).join('');
    listEl.scrollTop = listEl.scrollHeight;
  }

  renderAll();

  const unsubscribe = onNewMessage((msg) => {
    if (messages.length <= 1) {
      renderAll();
      return;
    }
    const wasNearBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 80;
    const div = document.createElement('div');
    div.innerHTML = bubbleHtml(msg, msg.user_id === myId);
    listEl.appendChild(div.firstElementChild as HTMLElement);
    if (wasNearBottom) listEl.scrollTop = listEl.scrollHeight;
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
