/**
 * LINKS 게이트 — 채팅에 공유된 링크를 자동 분류해 모아 보여주는 탭.
 * 카테고리별로 화면을 나눠 담던 이전 버전은 빈 섹터가 많아 공간을 많이 잡아먹는다는
 * 피드백으로, 전체를 한 목록(2열)에 최신순으로 나열하고 검색/카테고리 칩으로 좁혀보는
 * 방식으로 바꿨다. 저장(제목/썸네일 가져오기 + 자동분류)은 addLink.ts가 보낸 사람 쪽에서
 * 1회만 하고, 여기서는 trip_links를 읽고 realtime으로 반영 + 삭제만 담당한다(직접 추가
 * UI는 없음 — 채팅이 유일한 입력 경로).
 *
 * "그룹 모으기": category(자동분류, 고정 7종)와는 완전히 별개인 사용자 정의 정리축.
 * 여행지별/자유 주제별로 원하는 이름의 그룹을 만들고 링크를 여러 그룹에 동시에 담을 수
 * 있다(다대다) — 나중에 다시 찾아보거나 다른 멤버와 공유할 목적. trip_link_groups +
 * trip_link_group_links(중간 테이블) 스키마는 supabase/trip_link_groups.sql 참고.
 *
 * "노트 작성": 링크마다 짧은 텍스트 메모를 직접 입력하게 했던 첫 시도는 철회했다 —
 * 실제로 필요한 건 블로그를 읽고 든 생각을 제대로 적을 공간이라, 이미 있는
 * DOCUMENTS & NOTES 게이트(trip_notes)로 바로 연결한다. 이 링크의 제목/URL을 채운
 * 새 노트를 만들고 NOTES 탭으로 이동시켜, 거기서 본문을 마저 쓰게 한다.
 */
import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import { createNote } from '../docs/docsStore';
import { LINK_CATEGORIES } from '../trips/addLink';
import type { LinkCategory } from '../trips/addLink';
import type { TripLink, TripLinkGroup } from '../types/database';
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
const IC_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M12 11v4M10 13h4"/></svg>';
const IC_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const IC_PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

const CATEGORY_META: Record<LinkCategory, { label: string; icon: string }> = {
  STAY: { label: '숙소', icon: IC_BED },
  PLACE: { label: '관광지', icon: IC_PIN },
  FOOD: { label: '음식', icon: IC_FORK },
  ACTIVITY: { label: '액티비티', icon: IC_TICKET },
  VIDEO: { label: '영상', icon: IC_PLAY },
  ARTICLE: { label: '블로그', icon: IC_DOC },
  OTHER: { label: '기타', icon: IC_DOTS },
};

type CategoryFilter = LinkCategory | 'ALL';

let channel: RealtimeChannel | null = null;
let groupsChannel: RealtimeChannel | null = null;
let listEl: HTMLElement | null = null;
let chipsEl: HTMLElement | null = null;
let groupChipsEl: HTMLElement | null = null;
let currentTripId: string | null = null;
let links: TripLink[] = [];
let groups: TripLinkGroup[] = [];
/** linkId -> 그 링크가 속한 groupId 집합. 다대다라 배열 대신 Map<Set>으로 관리 */
let groupMemberships: Map<string, Set<string>> = new Map();
let destinations: Array<{ id: string; name: string }> = [];
let searchQuery = '';
let activeCategory: CategoryFilter = 'ALL';
let activeGroupFilter: string | 'ALL' = 'ALL';
let openCategoryMenuId: string | null = null;
let openGroupMenuId: string | null = null;
let outsideClickHandler: ((e: MouseEvent) => void) | null = null;

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

/** 서버 미리보기가 제목을 못 가져온 경우(구버전에 저장된 링크 포함)를 위한 최종 폴백 —
 * 아고다/부킹 같은 예약 사이트는 URL 경로에 이미 실제 이름을 슬러그로 담고 있다
 * (예: /eastin-grand-hotel-sathorn/hotel/...). 대시가 가장 많은 세그먼트를 이름으로
 * 보고 단어별로 대문자화한다. api/cache-photo.ts의 titleFromUrlSlug와 같은 로직 —
 * 서버는 새 링크 저장 시점에만 실행되므로, 이미 title 없이 저장된 카드도 화면에서
 * 바로 보이도록 클라이언트에도 동일한 폴백을 둔다. */
function titleFromUrlSlug(url: string): string | null {
  try {
    const segments = new URL(url).pathname
      .split('/')
      .filter(Boolean)
      .map((s) => s.replace(/\.[a-z0-9]+$/i, ''));
    if (segments.length === 0) return null;

    const best = segments.reduce((a, b) => (b.split('-').length > a.split('-').length ? b : a));
    const words = best.split(/[-_]+/).filter(Boolean);
    if (words.length < 2) return null;

    return words
      .map((w) => (/^[a-z0-9]+$/i.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(' ');
  } catch {
    return null;
  }
}

function displayTitle(link: TripLink): string {
  return (link.title || '').trim() || titleFromUrlSlug(link.url) || hostnameOf(link.url);
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
  if (activeGroupFilter !== 'ALL' && !groupMemberships.get(link.id)?.has(activeGroupFilter)) return false;
  if (!searchQuery) return true;
  const haystack = [displayTitle(link), link.site_name, hostnameOf(link.url), link.message, link.display_name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(searchQuery);
}

function groupMenuHtml(link: TripLink): string {
  const memberIds = groupMemberships.get(link.id) ?? new Set<string>();
  const open = openGroupMenuId === link.id;
  const items = groups
    .map((g) => {
      const selected = memberIds.has(g.id);
      return (
        '<button type="button" class="lk-group-menu-item' + (selected ? ' is-selected' : '') + '" data-toggle-group="' + g.id + '">' +
        '<span class="lk-group-menu-check">' + (selected ? IC_CHECK : '') + '</span>' +
        '<span class="lk-group-menu-name">' + escapeHtml(g.name) + '</span>' +
        '</button>'
      );
    })
    .join('');
  const destOptions = destinations.map((d) => '<option value="' + d.id + '">' + escapeHtml(d.name) + '</option>').join('');

  return [
    '<div class="lk-group-menu' + (open ? ' is-open' : '') + '" data-group-menu>',
    items,
    groups.length > 0 ? '<div class="lk-group-menu-divider"></div>' : '',
    '<div class="lk-group-menu-create">',
    '  <input type="text" class="lk-group-create-name" placeholder="새 그룹 이름" maxlength="40" autocomplete="off" />',
    destinations.length > 0
      ? '  <select class="lk-group-create-dest"><option value="">여행지 연결 안 함</option>' + destOptions + '</select>'
      : '',
    '  <button type="button" class="lk-group-create-submit" data-create-group>만들기</button>',
    '</div>',
    '</div>',
  ].join('');
}

function cardHtml(link: TripLink): string {
  const category = normalizeCategory(link.category);
  const initial = (link.display_name || '?').charAt(0);
  const avatar = link.avatar_url
    ? '<img src="' + link.avatar_url + '" alt="" referrerpolicy="no-referrer" />'
    : escapeHtml(initial);
  const title = displayTitle(link);
  const domain = (link.site_name || '').trim() || hostnameOf(link.url);

  const media = link.image_url
    ? '<div class="lk-card-media"><img src="' + escapeHtml(link.image_url) + '" alt="" loading="lazy" /></div>'
    : '<div class="lk-card-media lk-card-media-fallback">' + CATEGORY_META[category].icon + '</div>';

  const catMenuOpen = openCategoryMenuId === link.id;
  const categoryMenu = [
    '<div class="lk-cat-menu' + (catMenuOpen ? ' is-open' : '') + '" data-cat-menu="' + link.id + '">',
    LINK_CATEGORIES.map(
      (cat) =>
        '<button type="button" class="lk-cat-menu-item' + (cat === category ? ' is-current' : '') + '" data-set-category="' + cat + '">' +
        CATEGORY_META[cat].icon + '<span>' + escapeHtml(CATEGORY_META[cat].label) + '</span></button>'
    ).join(''),
    '</div>',
  ].join('');

  const memberGroupIds = groupMemberships.get(link.id) ?? new Set<string>();
  const memberGroups = groups.filter((g) => memberGroupIds.has(g.id));
  const groupChipsRow =
    memberGroups.length > 0
      ? '<div class="lk-card-groups">' + memberGroups.map((g) => '<span class="lk-card-group-chip">' + escapeHtml(g.name) + '</span>').join('') + '</div>'
      : '';

  return [
    '<div class="lk-card" data-link-id="' + link.id + '" data-url="' + escapeHtml(link.url) + '">',
    media,
    '  <div class="lk-card-body">',
    '    <div class="lk-card-title">' + escapeHtml(title) + '</div>',
    '    <div class="lk-card-domain-row">',
    '      <div class="lk-cat-picker">',
    '        <button type="button" class="lk-card-category-tag" data-cat-toggle>' + CATEGORY_META[category].icon + escapeHtml(CATEGORY_META[category].label) + '</button>',
    categoryMenu,
    '      </div>',
    '      <span class="lk-card-domain">' + escapeHtml(domain) + '</span>',
    '    </div>',
    groupChipsRow,
    '    <div class="lk-card-meta">',
    '      <span class="lk-card-avatar">' + avatar + '</span>',
    '      <span class="lk-card-sender">' + escapeHtml(link.display_name || '익명') + '</span>',
    '      <span class="lk-card-time">' + formatDateTime(link.created_at) + '</span>',
    '    </div>',
    '  </div>',
    '  <div class="lk-card-actions' + (openGroupMenuId === link.id ? ' is-pinned' : '') + '">',
    '    <button type="button" class="lk-card-note-btn" data-write-note aria-label="노트 작성" title="이 링크로 노트 작성">' + IC_PENCIL + '</button>',
    '    <div class="lk-group-picker">',
    '      <button type="button" class="lk-card-group-btn" data-group-toggle aria-label="그룹에 담기" title="그룹에 담기">' + IC_FOLDER + '</button>',
    groupMenuHtml(link),
    '    </div>',
    '    <button type="button" class="lk-card-remove" data-link-id="' + link.id + '" aria-label="이 링크 삭제" title="삭제">' + IC_TRASH + '</button>',
    '  </div>',
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

/** 그룹이 하나도 없으면 빈 필터 줄을 보여줄 필요가 없어 아예 비워둔다 — 그룹은
 * 카드의 "그룹에 담기"에서 만들게 되므로, 첫 그룹이 생기기 전까진 조용히 숨어있는다. */
function renderGroupChips(): void {
  if (!groupChipsEl) return;
  if (groups.length === 0) {
    groupChipsEl.innerHTML = '';
    return;
  }

  const chips: Array<{ key: string; label: string; removable: boolean }> = [
    { key: 'ALL', label: '전체 그룹', removable: false },
    ...groups.map((g) => ({ key: g.id, label: g.name, removable: true })),
  ];
  groupChipsEl.innerHTML = chips
    .map((c) => {
      const count = c.key === 'ALL' ? links.length : links.filter((l) => groupMemberships.get(l.id)?.has(c.key)).length;
      const active = c.key === activeGroupFilter ? ' is-active' : '';
      return (
        '<div class="lk-chip lk-group-chip' + active + '" data-group-filter="' + c.key + '">' +
        IC_FOLDER + '<span>' + escapeHtml(c.label) + '</span><span class="lk-chip-count">' + count + '</span>' +
        (c.removable ? '<button type="button" class="lk-group-chip-delete" data-delete-group="' + c.key + '" aria-label="그룹 삭제" title="그룹 삭제">×</button>' : '') +
        '</div>'
      );
    })
    .join('');

  groupChipsEl.querySelectorAll('[data-group-filter]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.lk-group-chip-delete')) return;
      activeGroupFilter = (el as HTMLElement).dataset.groupFilter as string;
      renderAll();
    });
  });
  groupChipsEl.querySelectorAll('.lk-group-chip-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      void deleteGroup((btn as HTMLElement).dataset.deleteGroup!);
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
  renderGroupChips();
  renderList();
}

function closeCategoryMenu(): void {
  if (openCategoryMenuId === null) return;
  openCategoryMenuId = null;
  listEl?.querySelectorAll('.lk-cat-menu.is-open').forEach((m) => m.classList.remove('is-open'));
}

function closeGroupMenu(): void {
  if (openGroupMenuId === null) return;
  openGroupMenuId = null;
  listEl?.querySelectorAll('.lk-group-menu.is-open').forEach((m) => m.classList.remove('is-open'));
  listEl?.querySelectorAll('.lk-card-actions.is-pinned').forEach((a) => a.classList.remove('is-pinned'));
}

function bindCards(): void {
  if (!listEl) return;
  listEl.querySelectorAll('.lk-card').forEach((el) => {
    const card = el as HTMLElement;
    const linkId = card.dataset.linkId!;
    const url = card.dataset.url!;

    card.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.lk-card-actions')) return;
      if (target.closest('.lk-cat-picker')) return;
      window.open(url, '_blank', 'noopener,noreferrer');
    });

    card.querySelector('.lk-card-remove')?.addEventListener('click', (e) => {
      e.stopPropagation();
      void deleteLink(linkId);
    });

    card.querySelector('[data-cat-toggle]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = openCategoryMenuId === linkId;
      closeCategoryMenu();
      if (!wasOpen) {
        openCategoryMenuId = linkId;
        card.querySelector('.lk-cat-menu')?.classList.add('is-open');
      }
    });

    card.querySelectorAll('.lk-cat-menu-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newCategory = (btn as HTMLElement).dataset.setCategory as LinkCategory;
        closeCategoryMenu();
        void updateLinkCategory(linkId, newCategory);
      });
    });

    card.querySelector('[data-group-toggle]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = openGroupMenuId === linkId;
      closeGroupMenu();
      if (!wasOpen) {
        openGroupMenuId = linkId;
        card.querySelector('.lk-group-menu')?.classList.add('is-open');
        card.querySelector('.lk-card-actions')?.classList.add('is-pinned');
      }
    });

    card.querySelectorAll('.lk-group-menu-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const groupId = (btn as HTMLElement).dataset.toggleGroup!;
        const isMember = groupMemberships.get(linkId)?.has(groupId) ?? false;
        void toggleLinkGroup(linkId, groupId, isMember);
      });
    });

    card.querySelector('[data-create-group]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const nameInput = card.querySelector('.lk-group-create-name') as HTMLInputElement | null;
      const destSelect = card.querySelector('.lk-group-create-dest') as HTMLSelectElement | null;
      const name = nameInput?.value.trim() ?? '';
      if (!name) {
        nameInput?.focus();
        return;
      }
      void createGroupAndAssign(linkId, name, destSelect?.value || null);
    });

    card.querySelector('[data-write-note]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      void writeNoteForLink(linkId);
    });
  });
}

async function updateLinkCategory(linkId: string, category: LinkCategory): Promise<void> {
  const link = links.find((l) => l.id === linkId);
  if (!link || normalizeCategory(link.category) === category) return;
  const previousCategory = link.category;
  link.category = category;
  renderAll();
  const { error } = await supabase.from('trip_links').update({ category }).eq('id', linkId);
  if (error) {
    console.error('링크 카테고리 변경 실패:', error.message);
    link.category = previousCategory;
    renderAll();
  }
}

/** 링크의 제목/URL을 채운 새 노트를 만들고 NOTES 탭으로 이동한다 — 이 링크를 읽고 든
 * 생각을 짧은 메모가 아니라 제대로 된 공간(trip_notes)에 적게 하려는 것. 새 노트는
 * created_at 최신순 목록의 맨 위에 바로 보이므로, 이동 후 사용자가 그걸 열어 본문을
 * 마저 쓰면 된다(에디터를 자동으로 열어주는 딥링크는 아직 없음). */
async function writeNoteForLink(linkId: string): Promise<void> {
  if (!currentTripId) return;
  const link = links.find((l) => l.id === linkId);
  if (!link) return;
  const note = await createNote(currentTripId, {
    title: displayTitle(link),
    body: link.url,
    category: 'OTHER',
    dayStart: null,
    dayEnd: null,
    region: null,
  });
  if (!note) {
    console.error('노트 생성 실패');
    return;
  }
  navigate('trip/' + currentTripId + '/notes');
}

/** 그룹 담기/빼기 — 링크 하나가 여러 그룹에 동시에 속할 수 있어 중간 테이블 행을
 * insert/delete한다. 실패하면 로컬 상태를 되돌린다(낙관적 업데이트). */
async function toggleLinkGroup(linkId: string, groupId: string, isMember: boolean): Promise<void> {
  const current = groupMemberships.get(linkId) ?? new Set<string>();
  const next = new Set(current);
  if (isMember) next.delete(groupId);
  else next.add(groupId);
  groupMemberships.set(linkId, next);
  renderAll();

  const { error } = isMember
    ? await supabase.from('trip_link_group_links').delete().eq('group_id', groupId).eq('link_id', linkId)
    : await supabase.from('trip_link_group_links').insert({ group_id: groupId, link_id: linkId });

  if (error) {
    console.error('그룹 담기 상태 변경 실패:', error.message);
    const reverted = new Set(groupMemberships.get(linkId) ?? new Set<string>());
    if (isMember) reverted.add(groupId);
    else reverted.delete(groupId);
    groupMemberships.set(linkId, reverted);
    renderAll();
  }
}

/** "+ 새 그룹" — 그룹을 만들자마자 지금 보고 있던 링크를 바로 담아준다(따로 또
 * 담는 걸 누르게 하지 않음). destinationId는 선택사항. */
async function createGroupAndAssign(linkId: string, name: string, destinationId: string | null): Promise<void> {
  if (!currentTripId) return;
  const user = store.get('user');
  const { data, error } = await supabase
    .from('trip_link_groups')
    .insert({ trip_id: currentTripId, name, destination_id: destinationId, created_by: user?.id ?? null })
    .select()
    .single();
  if (error || !data) {
    console.error('그룹 생성 실패:', error?.message);
    return;
  }
  if (!groups.some((g) => g.id === data.id)) groups.push(data);
  await toggleLinkGroup(linkId, data.id, false);
}

async function deleteGroup(groupId: string): Promise<void> {
  if (!window.confirm('이 그룹을 삭제할까요? (그룹에 담긴 링크 자체는 삭제되지 않아요)')) return;
  groups = groups.filter((g) => g.id !== groupId);
  groupMemberships.forEach((set) => set.delete(groupId));
  if (activeGroupFilter === groupId) activeGroupFilter = 'ALL';
  renderAll();
  const { error } = await supabase.from('trip_link_groups').delete().eq('id', groupId);
  if (error) console.error('그룹 삭제 실패:', error.message);
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
  if (groupsChannel) {
    supabase.removeChannel(groupsChannel);
    groupsChannel = null;
  }
  if (outsideClickHandler) {
    document.removeEventListener('click', outsideClickHandler);
    outsideClickHandler = null;
  }
  listEl = null;
  chipsEl = null;
  groupChipsEl = null;
  currentTripId = null;
  links = [];
  groups = [];
  groupMemberships = new Map();
  destinations = [];
  searchQuery = '';
  activeCategory = 'ALL';
  activeGroupFilter = 'ALL';
  openCategoryMenuId = null;
  openGroupMenuId = null;
}

export async function renderLinksContent(container: HTMLElement, tripId: string): Promise<void> {
  teardownLinks();
  currentTripId = tripId;

  container.innerHTML = [
    '<div class="lk-wrap">',
    '  <div class="lk-toolbar">',
    '    <div class="lk-search">',
    '      ' + IC_SEARCH,
    '      <input type="text" id="lk-search-input" placeholder="제목, 사이트, 메모, 보낸 사람으로 검색" autocomplete="off" />',
    '    </div>',
    '    <div class="lk-chips" id="lk-chips"></div>',
    '    <div class="lk-chips" id="lk-group-chips"></div>',
    '  </div>',
    '  <div class="lk-list" id="lk-list"><div class="lk-loading">불러오는 중...</div></div>',
    '</div>',
  ].join('');
  listEl = container.querySelector('#lk-list') as HTMLElement;
  chipsEl = container.querySelector('#lk-chips') as HTMLElement;
  groupChipsEl = container.querySelector('#lk-group-chips') as HTMLElement;

  outsideClickHandler = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.lk-cat-picker')) closeCategoryMenu();
    if (!target.closest('.lk-group-picker')) closeGroupMenu();
  };
  document.addEventListener('click', outsideClickHandler);

  const searchInput = container.querySelector('#lk-search-input') as HTMLInputElement;
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    renderList();
  });

  const [linksRes, groupsRes, destRes] = await Promise.all([
    supabase.from('trip_links').select('*').eq('trip_id', tripId).order('created_at', { ascending: false }).limit(500),
    supabase.from('trip_link_groups').select('*').eq('trip_id', tripId).order('created_at', { ascending: true }),
    supabase.from('trip_destinations').select('id, name').eq('trip_id', tripId).order('sort_order', { ascending: true }),
  ]);

  // trip_links/trip_link_groups 테이블이 아직 마이그레이션 전이어도(3-2 graceful degradation) 빈 목록으로 처리
  if (linksRes.error) console.error('Trip links load error:', linksRes.error.message);
  if (groupsRes.error) console.error('Trip link groups load error:', groupsRes.error.message);
  if (destRes.error) console.error('Trip destinations load error:', destRes.error.message);

  links = linksRes.data ?? [];
  groups = groupsRes.data ?? [];
  destinations = destRes.data ?? [];

  groupMemberships = new Map();
  if (groups.length > 0) {
    const { data: memberRows, error: memberError } = await supabase
      .from('trip_link_group_links')
      .select('group_id, link_id')
      .in('group_id', groups.map((g) => g.id));
    if (memberError) console.error('Trip link group memberships load error:', memberError.message);
    (memberRows ?? []).forEach((m) => {
      const set = groupMemberships.get(m.link_id) ?? new Set<string>();
      set.add(m.group_id);
      groupMemberships.set(m.link_id, set);
    });
  }

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
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'trip_links', filter: 'trip_id=eq.' + tripId },
      (payload) => {
        const updated = payload.new as TripLink;
        const idx = links.findIndex((l) => l.id === updated.id);
        if (idx === -1) return;
        links[idx] = updated;
        renderAll();
      }
    )
    .subscribe();

  groupsChannel = supabase
    .channel('trip-link-groups:' + tripId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'trip_link_groups', filter: 'trip_id=eq.' + tripId },
      (payload) => {
        const g = payload.new as TripLinkGroup;
        if (groups.some((x) => x.id === g.id)) return;
        groups.push(g);
        renderAll();
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'trip_link_groups', filter: 'trip_id=eq.' + tripId },
      (payload) => {
        const oldRow = payload.old as { id: string };
        if (!groups.some((x) => x.id === oldRow.id)) return;
        groups = groups.filter((x) => x.id !== oldRow.id);
        groupMemberships.forEach((set) => set.delete(oldRow.id));
        if (activeGroupFilter === oldRow.id) activeGroupFilter = 'ALL';
        renderAll();
      }
    )
    // trip_link_group_links엔 trip_id 컬럼이 없어 서버 필터가 불가능 — 우리 그룹 목록에
    // 있는 group_id인지 클라이언트에서 한 번 더 걸러낸다(다른 트립 이벤트 무시).
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'trip_link_group_links' },
      (payload) => {
        const row = payload.new as { group_id: string; link_id: string };
        if (!groups.some((g) => g.id === row.group_id)) return;
        const set = groupMemberships.get(row.link_id) ?? new Set<string>();
        if (set.has(row.group_id)) return;
        set.add(row.group_id);
        groupMemberships.set(row.link_id, set);
        renderAll();
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'trip_link_group_links' },
      (payload) => {
        const row = payload.old as { group_id: string; link_id: string };
        const set = groupMemberships.get(row.link_id);
        if (!set || !set.has(row.group_id)) return;
        set.delete(row.group_id);
        renderAll();
      }
    )
    .subscribe();
}
