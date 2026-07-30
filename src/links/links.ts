/**
 * LINKS 게이트 — 채팅에 공유된 링크를 자동으로 모아 보여주는 탭.
 * 저장은 chat.ts(sendMessage)가 보낸 사람 쪽에서 1회만 하고, 여기서는 trip_links를
 * 읽고 realtime으로 새 항목만 반영한다(직접 추가 UI는 없음 — 채팅이 유일한 입력 경로).
 */
import { supabase } from '../supabase';
import type { TripLink } from '../types/database';
import type { RealtimeChannel } from '@supabase/supabase-js';
import './links.css';

let channel: RealtimeChannel | null = null;
let listEl: HTMLElement | null = null;
let links: TripLink[] = [];

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return (d.getMonth() + 1) + '.' + String(d.getDate()).padStart(2, '0') + ' ' + ampm + ' ' + h12 + ':' + m;
}

function cardHtml(link: TripLink): string {
  const initial = (link.display_name || '?').charAt(0);
  const avatar = link.avatar_url
    ? '<img src="' + link.avatar_url + '" alt="" referrerpolicy="no-referrer" />'
    : escapeHtml(initial);
  const message = (link.message || '').trim();
  const showMessage = message && message !== link.url;

  return [
    '<a class="lk-card" href="' + escapeHtml(link.url) + '" target="_blank" rel="noopener noreferrer">',
    '  <div class="lk-card-icon">',
    '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    '  </div>',
    '  <div class="lk-card-body">',
    '    <div class="lk-card-domain">' + escapeHtml(hostnameOf(link.url)) + '</div>',
    showMessage ? '    <div class="lk-card-message">' + escapeHtml(message) + '</div>' : '',
    '    <div class="lk-card-meta">',
    '      <span class="lk-card-avatar">' + avatar + '</span>',
    '      <span class="lk-card-sender">' + escapeHtml(link.display_name || '익명') + '</span>',
    '      <span class="lk-card-time">' + formatDateTime(link.created_at) + '</span>',
    '    </div>',
    '  </div>',
    '  <div class="lk-card-go">',
    '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>',
    '  </div>',
    '</a>',
  ].join('');
}

function renderList(): void {
  if (!listEl) return;
  if (links.length === 0) {
    listEl.innerHTML = [
      '<div class="lk-empty">',
      '  <div class="lk-empty-icon">',
      '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
      '  </div>',
      '  <div class="lk-empty-text">아직 공유된 링크가 없어요</div>',
      '  <div class="lk-empty-hint">채팅에 링크를 보내면 여기 자동으로 모여요</div>',
      '</div>',
    ].join('');
    return;
  }
  listEl.innerHTML = links.map(cardHtml).join('');
}

export function teardownLinks(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  listEl = null;
  links = [];
}

export async function renderLinksContent(container: HTMLElement, tripId: string): Promise<void> {
  teardownLinks();

  container.innerHTML = [
    '<div class="lk-wrap">',
    '  <div class="lk-list" id="lk-list"><div class="lk-loading">불러오는 중...</div></div>',
    '</div>',
  ].join('');
  listEl = container.querySelector('#lk-list') as HTMLElement;

  const { data, error } = await supabase
    .from('trip_links')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    // trip_links 테이블이 아직 마이그레이션 전이어도(3-2 graceful degradation) 빈 목록으로 처리
    console.error('Trip links load error:', error.message);
  }
  links = data ?? [];
  renderList();

  channel = supabase
    .channel('trip-links:' + tripId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'trip_links', filter: 'trip_id=eq.' + tripId },
      (payload) => {
        const link = payload.new as TripLink;
        if (links.some((l) => l.id === link.id)) return;
        links.unshift(link);
        renderList();
      }
    )
    .subscribe();
}
