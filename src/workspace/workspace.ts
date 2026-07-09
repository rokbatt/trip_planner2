import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import type { Database } from '../types/database';
import './workspace.css';

type Trip = Database['public']['Tables']['trips']['Row'];

/* ── SVG 아이콘 ── */
const IC = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  ideas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>',
  shortlist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20l-7-7h4V4h6v9h4z"/></svg>',
  route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7z"/><path d="M9 4v13M15 7v13"/></svg>',
  timeline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M16 2v4M8 2v4"/></svg>',
  checklist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  expense: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  invite: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
  placeholder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg>',
};

interface NavItem {
  key: string;
  label: string;
  icon: string;
  step?: string;
}

const MAIN_NAV: NavItem[] = [
  { key: 'ideas',     label: 'IDEAS',     icon: IC.ideas,     step: '01' },
  { key: 'shortlist', label: 'SHORTLIST', icon: IC.shortlist, step: '02' },
  { key: 'route',     label: 'ROUTE',     icon: IC.route,     step: '03' },
  { key: 'timeline',  label: 'TIMELINE',  icon: IC.timeline,  step: '04' },
];

const SUB_NAV: NavItem[] = [
  { key: 'checklist', label: 'Checklist', icon: IC.checklist },
  { key: 'expense',   label: 'Expense',   icon: IC.expense },
  { key: 'links',     label: 'Links',     icon: IC.link },
];

const GATE_TITLES: Record<string, string> = {
  ideas: 'BRAINSTORM BOARD',
  shortlist: 'CANDIDATE POOL',
  route: 'ROUTE & MAP',
  timeline: 'TIMELINE',
  checklist: 'CHECKLIST',
  expense: 'EXPENSE',
  links: 'LINKS',
};

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function getTrip(tripId: string): Promise<Trip | null> {
  const cached = store.get('currentTrip');
  if (cached && cached.id === tripId) return cached;

  const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).single();
  if (error) {
    console.error('Trip load error:', error.message);
    return null;
  }
  store.set('currentTrip', data);
  return data;
}

function formatTripMeta(trip: Trip): string {
  const parts: string[] = [];
  if (trip.destinations && trip.destinations.length > 0) {
    parts.push(trip.destinations.join(', '));
  }
  if (trip.start_date && trip.end_date) {
    const fmt = (d: string) => {
      const dt = new Date(d);
      return (dt.getMonth() + 1) + '.' + String(dt.getDate()).padStart(2, '0');
    };
    parts.push(fmt(trip.start_date) + ' - ' + fmt(trip.end_date));
  }
  return parts.join(' | ') || 'No details';
}

/** 워크스페이스 셸 렌더 */
export async function renderWorkspace(tripId: string, subPath?: string): Promise<HTMLElement> {
  const page = document.createElement('div');
  page.className = 'ws-page';

  const activeGate = subPath || 'ideas';

  // 로딩 상태
  page.innerHTML = [
    '<div class="ws-sidebar" id="ws-sidebar"></div>',
    '<div class="ws-mobile-overlay" id="ws-overlay"></div>',
    '<div class="ws-main">',
    '  <div class="ws-content-header" id="ws-header"></div>',
    '  <div class="ws-content-body" id="ws-body">',
    '    <div class="ws-placeholder">불러오는 중...</div>',
    '  </div>',
    '</div>',
  ].join('\n');

  const trip = await getTrip(tripId);
  if (!trip) {
    page.innerHTML = '<div class="ws-placeholder">여행 정보를 찾을 수 없어요</div>';
    return page;
  }

  // 사이드바
  const sidebar = page.querySelector('#ws-sidebar') as HTMLElement;
  sidebar.innerHTML = buildSidebar(trip, activeGate);

  // 콘텐츠 헤더
  const header = page.querySelector('#ws-header') as HTMLElement;
  header.innerHTML = buildContentHeader(trip, activeGate);

  // 콘텐츠 바디
  const body = page.querySelector('#ws-body') as HTMLElement;
  await renderGate(body, tripId, activeGate);

  // 이벤트 바인딩
  bindEvents(page, tripId, activeGate);

  return page;
}

function buildSidebar(trip: Trip, activeGate: string): string {
  const mainItems = MAIN_NAV.map((item) => {
    const isActive = item.key === activeGate ? ' active' : '';
    return [
      '<button class="ws-nav-item' + isActive + '" data-gate="' + item.key + '">',
      '  <span class="ws-nav-step">' + (item.step || '') + '</span>',
      '  ' + item.icon,
      '  <span class="ws-nav-label">' + item.label + '</span>',
      '</button>',
    ].join('');
  }).join('\n');

  const subItems = SUB_NAV.map((item) => {
    const isActive = item.key === activeGate ? ' active' : '';
    return [
      '<button class="ws-nav-item' + isActive + '" data-gate="' + item.key + '">',
      '  ' + item.icon,
      '  <span class="ws-nav-label">' + item.label + '</span>',
      '</button>',
    ].join('');
  }).join('\n');

  return [
    '<div class="ws-sidebar-header">',
    '  <button class="ws-sidebar-back" id="ws-back">',
    '    ' + IC.back,
    '    <span class="ws-sidebar-back-label">몽실이</span>',
    '  </button>',
    '  <button class="ws-sidebar-toggle" id="ws-toggle">' + IC.collapse + '</button>',
    '</div>',
    '<div class="ws-trip-info">',
    '  <div class="ws-trip-name">' + escapeHtml(trip.name) + '</div>',
    '  <div class="ws-trip-meta">' + escapeHtml(formatTripMeta(trip)) + '</div>',
    '</div>',
    '<div class="ws-nav">',
    mainItems,
    '<div class="ws-nav-divider"></div>',
    subItems,
    '</div>',
    '<div class="ws-sidebar-footer">',
    '  <button class="ws-invite-btn" id="ws-invite">' + IC.invite + ' 멤버 초대</button>',
    '</div>',
  ].join('\n');
}

function buildContentHeader(trip: Trip, activeGate: string): string {
  const title = escapeHtml(trip.name);
  const subtitle = GATE_TITLES[activeGate] || activeGate.toUpperCase();

  return [
    '<button class="ws-mobile-menu" id="ws-mobile-menu">' + IC.menu + '</button>',
    '<div>',
    '  <div class="ws-content-title">' + title + '</div>',
    '  <div class="ws-content-subtitle">' + subtitle + '</div>',
    '</div>',
  ].join('\n');
}

async function renderGate(body: HTMLElement, tripId: string, gate: string): Promise<void> {
  if (gate === 'ideas') {
    // 기존 board.ts의 보드 콘텐츠를 여기에 렌더
    const { renderBoardContent } = await import('../board/board');
    await renderBoardContent(body, tripId);
  } else {
    // 미구현 게이트 — 플레이스홀더
    const title = GATE_TITLES[gate] || gate;
    body.innerHTML = [
      '<div class="ws-placeholder">',
      '  <div class="ws-placeholder-icon">' + IC.placeholder + '</div>',
      '  <div class="ws-placeholder-text">' + escapeHtml(title) + '</div>',
      '  <div class="ws-placeholder-hint">이 기능은 다음 단계에서 구현 예정이에요</div>',
      '</div>',
    ].join('\n');
  }
}

function bindEvents(page: HTMLElement, tripId: string, _activeGate: string): void {
  // 뒤로가기 (대시보드)
  page.querySelector('#ws-back')?.addEventListener('click', () => navigate('trips'));

  // 사이드바 접기/펴기
  const sidebar = page.querySelector('#ws-sidebar') as HTMLElement;
  page.querySelector('#ws-toggle')?.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });

  // 모바일 메뉴 토글
  const overlay = page.querySelector('#ws-overlay') as HTMLElement;
  page.querySelector('#ws-mobile-menu')?.addEventListener('click', () => {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('visible');
  });
  overlay?.addEventListener('click', () => {
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('visible');
  });

  // 네비 아이템 클릭 → 게이트 전환
  page.querySelectorAll('.ws-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const gate = (btn as HTMLElement).dataset.gate;
      if (!gate) return;

      // 모바일 사이드바 닫기
      sidebar.classList.remove('mobile-open');
      overlay?.classList.remove('visible');

      navigate('trip/' + tripId + '/' + gate);
    });
  });

  // 멤버 초대
  page.querySelector('#ws-invite')?.addEventListener('click', () => {
    const trip = store.get('currentTrip');
    if (trip && trip.invite_code) {
      const url = window.location.origin + '/#join/' + trip.invite_code;
      navigator.clipboard.writeText(url).then(
        () => alert('초대 링크가 복사되었어요!\n\n' + url),
        () => alert('초대 코드: ' + trip.invite_code)
      );
    } else {
      alert('초대 코드를 찾을 수 없어요.');
    }
  });
}
