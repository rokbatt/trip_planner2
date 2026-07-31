/**
 * LINKS 게이트 — 채팅에 공유된 링크를 자동 분류해 모아 보여주는 탭.
 * 카테고리별로 화면을 나눠 담던 이전 버전은 빈 섹터가 많아 공간을 많이 잡아먹는다는
 * 피드백으로, 전체를 한 목록(2열)에 최신순으로 나열하고 검색/카테고리 칩으로 좁혀보는
 * 방식으로 바꿨다. 저장(제목/썸네일 가져오기 + 자동분류)은 addLink.ts가 보낸 사람 쪽에서
 * 1회만 하고, 여기서는 trip_links를 읽고 realtime으로 반영 + 삭제만 담당한다(직접 추가
 * UI는 없음 — 채팅이 유일한 입력 경로).
 */
import { supabase } from '../supabase';
import { LINK_CATEGORIES } from '../trips/addLink';
import type { LinkCategory } from '../trips/addLink';
import type { TripLink } from '../types/database';
import type { RealtimeChannel } from '@supabase/supabase-js';
import './links.css';

const IC_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const IC_BED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8M2 20v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3M2 20h20M6 10V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"/></svg>';
const IC_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21C12 21 19 14.5 19 9.5C19 5.9 15.9 3 12 3C8.1 3 5 5.9 5 9.5C5 14.5 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.2"/></svg>';
const IC_FORK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v6a2 2 0 0 0 4 0V3M9 11v10M17 3c-1.5 1-2 3-2 5s1 3 2 3 2-1 2-3-.5-4-2-5zM17 11v10"/></svg>';
const IC_TICKET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.5a1.5 1.5 0 0 0 0 3V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a1.5 1.5 0 0 0 0-3V9z"/></svg>';
const IC_PLAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5v-7z" fill="currentColor" stroke="none"/></svg>';
const IC_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>';
const IC_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
const IC_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>';
const IC_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';

const CATEGORY_META: Record<LinkCategory, { label: string; icon: string }> = {
  STAY: { label: '숙소', icon: IC_BED },
  PLACE: { label: '장소', icon: IC_PIN },
  FOOD: { label: '음식', icon: IC_FORK },
  ACTIVITY: { label: '액티비티', icon: IC_TICKET },
  VIDEO: { label: '영상', icon: IC_PLAY },
  ARTICLE: { label: '아티클', icon: IC_DOC },
  OTHER: { label: '기타', icon: IC_DOTS },
};

type CategoryFilter = LinkCategory | 'ALL';

let channel: RealtimeChannel | null = null;
let listEl: HTMLElement | null = null;
let chipsEl: HTMLElement | null = null;
let links: TripLink[] = [];
let searchQuery = '';
let activeCategory: CategoryFilter = 'ALL';

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

function normalizeCategory(raw: string): LinkCategory {
  return (LINK_CATEGORIES as string[]).includes(raw) ? (raw as LinkCategory) : 'OTHER';
}

function matchesFilter(link: TripLink): boolean {
  if (activeCategory !== 'ALL' && normalizeCategory(link.category) !== activeCategory) return false;
  if (!searchQuery) return true;
  const haystack = [link.title, link.site_name, hostnameOf(link.url), link.message, link.display_name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(searchQuery);
}

function cardHtml(link: TripLink): string {
  const category = normalizeCategory(link.category);
  const initial = (link.display_name || '?').charAt(0);
  const avatar = link.avatar_url
    ? '<img src="' + link.avatar_url + '" alt="" referrerpolicy="no-referrer" />'
    : escapeHtml(initial);
  const title = (link.title || '').trim() || hostnameOf(link.url);
  const domain = (link.site_name || '').trim() || hostnameOf(link.url);

  const media = link.image_url
    ? '<div class="lk-card-media"><img src="' + escapeHtml(link.image_url) + '" alt="" loading="lazy" /></div>'
    : '<div class="lk-card-media lk-card-media-fallback">' + CATEGORY_META[category].icon + '</div>';

  return [
    '<div class="lk-card" data-link-id="' + link.id + '" data-url="' + escapeHtml(link.url) + '">',
    media,
    '  <div class="lk-card-body">',
    '    <div class="lk-card-title">' + escapeHtml(title) + '</div>',
    '    <div class="lk-card-domain-row">',
    '      <span class="lk-card-category-tag">' + CATEGORY_META[category].icon + escapeHtml(CATEGORY_META[category].label) + '</span>',
    '      <span class="lk-card-domain">' + escapeHtml(domain) + '</span>',
    '    </div>',
    '    <div class="lk-card-meta">',
    '      <span class="lk-card-avatar">' + avatar + '</span>',
    '      <span class="lk-card-sender">' + escapeHtml(link.display_name || '익명') + '</span>',
    '      <span class="lk-card-time">' + formatDateTime(link.created_at) + '</span>',
    '    </div>',
    '  </div>',
    '  <button type="button" class="lk-card-remove" data-link-id="' + link.id + '" aria-label="이 링크 삭제" title="삭제">' + IC_TRASH + '</button>',
    '</div>',
  ].join('');
}

function renderChips(): void {
  if (!chipsEl) return;
  const chips: Array<{ key: CategoryFilter; label: string; icon: string | null }> = [
    { key: 'ALL', label: '전체', icon: null },
    ...LINK_CATEGORIES.map((cat) => ({ key: cat as CategoryFilter, label: CATEGORY_META[cat].label, icon: CATEGORY_META[cat].icon })),
  ];
  chipsEl.innerHTML = chips
    .map((c) => {
      const count = c.key === 'ALL' ? links.length : links.filter((l) => normalizeCategory(l.category) === c.key).length;
      const active = c.key === activeCategory ? ' is-active' : '';
      return (
        '<button type="button" class="lk-chip' + active + '" data-category="' + c.key + '">' +
        (c.icon ?? '') + '<span>' + c.label + '</span><span class="lk-chip-count">' + count + '</span>' +
        '</button>'
      );
    })
    .join('');

  chipsEl.querySelectorAll('.lk-chip').forEach((el) => {
    el.addEventListener('click', () => {
      activeCategory = (el as HTMLElement).dataset.category as CategoryFilter;
      renderAll();
    });
  });
}

function renderList(): void {
  if (!listEl) return;
  if (links.length === 0) {
    listEl.innerHTML = [
      '<div class="lk-empty">',
      '  <div class="lk-empty-icon">' + IC_LINK + '</div>',
      '  <div class="lk-empty-text">아직 공유된 링크가 없어요</div>',
      '  <div class="lk-empty-hint">채팅에 링크를 보내면 여기 자동으로 분류돼서 모여요</div>',
      '</div>',
    ].join('');
    return;
  }

  const filtered = links.filter(matchesFilter);
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="lk-empty"><div class="lk-empty-text">조건에 맞는 링크가 없어요</div></div>';
    return;
  }

  listEl.innerHTML = filtered.map(cardHtml).join('');
  bindCards();
}

function renderAll(): void {
  renderChips();
  renderList();
}

function bindCards(): void {
  if (!listEl) return;
  listEl.querySelectorAll('.lk-card').forEach((el) => {
    const card = el as HTMLElement;
    const linkId = card.dataset.linkId!;
    const url = card.dataset.url!;

    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.lk-card-remove')) return;
      window.open(url, '_blank', 'noopener,noreferrer');
    });

    card.querySelector('.lk-card-remove')?.addEventListener('click', (e) => {
      e.stopPropagation();
      void deleteLink(linkId);
    });
  });
}

async function deleteLink(linkId: string): Promise<void> {
  if (!window.confirm('이 링크를 삭제할까요?')) return;
  links = links.filter((l) => l.id !== linkId);
  renderAll();
  const { error } = await supabase.from('trip_links').delete().eq('id', linkId);
  if (error) console.error('링크 삭제 실패:', error.message);
}

export function teardownLinks(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  listEl = null;
  chipsEl = null;
  links = [];
  searchQuery = '';
  activeCategory = 'ALL';
}

export async function renderLinksContent(container: HTMLElement, tripId: string): Promise<void> {
  teardownLinks();

  container.innerHTML = [
    '<div class="lk-wrap">',
    '  <div class="lk-toolbar">',
    '    <div class="lk-search">',
    '      ' + IC_SEARCH,
    '      <input type="text" id="lk-search-input" placeholder="제목, 사이트, 보낸 사람으로 검색" autocomplete="off" />',
    '    </div>',
    '    <div class="lk-chips" id="lk-chips"></div>',
    '  </div>',
    '  <div class="lk-list" id="lk-list"><div class="lk-loading">불러오는 중...</div></div>',
    '</div>',
  ].join('');
  listEl = container.querySelector('#lk-list') as HTMLElement;
  chipsEl = container.querySelector('#lk-chips') as HTMLElement;

  const searchInput = container.querySelector('#lk-search-input') as HTMLInputElement;
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    renderList();
  });

  const { data, error } = await supabase
    .from('trip_links')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    // trip_links 테이블이 아직 마이그레이션 전이어도(3-2 graceful degradation) 빈 목록으로 처리
    console.error('Trip links load error:', error.message);
  }
  links = data ?? [];
  renderAll();

  channel = supabase
    .channel('trip-links:' + tripId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'trip_links', filter: 'trip_id=eq.' + tripId },
      (payload) => {
        const link = payload.new as TripLink;
        if (links.some((l) => l.id === link.id)) return;
        links.unshift(link);
        renderAll();
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'trip_links', filter: 'trip_id=eq.' + tripId },
      (payload) => {
        const oldRow = payload.old as { id: string };
        if (!links.some((l) => l.id === oldRow.id)) return;
        links = links.filter((l) => l.id !== oldRow.id);
        renderAll();
      }
    )
    .subscribe();
}
