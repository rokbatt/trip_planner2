import { supabase } from '../supabase';
import { store } from '../store';
import type { PlaceComment } from '../types/database';
import type { RealtimeChannel } from '@supabase/supabase-js';
import './comments.css';

let currentPlaceId: string | null = null;
let channel: RealtimeChannel | null = null;
let comments: PlaceComment[] = [];
let listeners: Array<(c: PlaceComment) => void> = [];

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** place가 바뀔 때마다 새로 초기화 (이전 place 구독은 반드시 teardown 후 호출) */
export async function initComments(placeId: string): Promise<void> {
  if (currentPlaceId === placeId && channel) return;
  teardownComments();
  currentPlaceId = placeId;

  const { data, error } = await supabase
    .from('place_comments')
    .select('*')
    .eq('place_id', placeId)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) console.error('Comments load error:', error.message);
  comments = data ?? [];

  channel = supabase
    .channel('place_comments:' + placeId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'place_comments', filter: 'place_id=eq.' + placeId },
      (payload) => {
        const c = payload.new as PlaceComment;
        if (comments.some((x) => x.id === c.id)) return;
        comments.push(c);
        listeners.forEach((fn) => fn(c));
      }
    )
    .subscribe();
}

export function teardownComments(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  listeners = [];
  comments = [];
  currentPlaceId = null;
}

export async function sendComment(placeId: string, text: string): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const user = store.get('user');
  if (!user) return false;

  const meta = user.user_metadata ?? {};
  const { error } = await supabase.from('place_comments').insert({
    place_id: placeId,
    user_id: user.id,
    display_name: meta.full_name ?? meta.name ?? user.email ?? '익명',
    avatar_url: meta.avatar_url ?? meta.picture ?? null,
    comment: trimmed,
  });

  if (error) {
    console.error('Comment send error:', error.message);
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

function commentHtml(c: PlaceComment, isMe: boolean): string {
  const initial = (c.display_name || '?').charAt(0);
  const avatar = c.avatar_url
    ? '<img src="' + c.avatar_url + '" alt="" referrerpolicy="no-referrer" />'
    : escapeHtml(initial);

  return [
    '<div class="pc-item">',
    '  <div class="pc-avatar' + (isMe ? ' me' : '') + '">' + avatar + '</div>',
    '  <div class="pc-body">',
    '    <div class="pc-meta"><span class="pc-name">' + escapeHtml(c.display_name || '익명') + '</span><span class="pc-time">' + formatTime(c.created_at) + '</span></div>',
    '    <div class="pc-text">' + escapeHtml(c.comment) + '</div>',
    '  </div>',
    '</div>',
  ].join('');
}

/**
 * 댓글 UI를 container에 그린다.
 * 반환값: 컴포넌트가 사라질 때 호출해야 하는 정리 함수
 */
export function renderCommentsUI(container: HTMLElement, placeId: string): () => void {
  const myId = store.get('user')?.id;

  container.innerHTML = [
    '<div class="pc-list" id="pc-list"></div>',
    '<form class="pc-form" id="pc-form">',
    '  <input class="pc-input" id="pc-input" type="text" placeholder="댓글을 남겨보세요..." autocomplete="off" />',
    '  <button type="submit" class="pc-send" id="pc-send">',
    '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
    '  </button>',
    '</form>',
  ].join('');

  const listEl = container.querySelector('#pc-list') as HTMLElement;

  function renderAll(): void {
    if (comments.length === 0) {
      listEl.innerHTML = '<div class="pc-empty">아직 댓글이 없어요</div>';
      return;
    }
    listEl.innerHTML = comments.map((c) => commentHtml(c, c.user_id === myId)).join('');
    listEl.scrollTop = listEl.scrollHeight;
  }
  renderAll();

  const unsubscribe = ((): (() => void) => {
    const fn = () => renderAll();
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  })();

  const form = container.querySelector('#pc-form') as HTMLFormElement;
  const input = container.querySelector('#pc-input') as HTMLInputElement;
  const sendBtn = container.querySelector('#pc-send') as HTMLButtonElement;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    sendBtn.disabled = true;
    const success = await sendComment(placeId, text);
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
    if (success) input.value = '';
  });

  return unsubscribe;
}
