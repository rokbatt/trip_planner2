import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import type { Database } from '../types/database';
import './workspace.css';

type Trip = Database['public']['Tables']['trips']['Row'];

/* ── 도시 → IATA 공항코드 (trip-list.ts와 동일 매핑) ── */
const AIRPORT_CODE: Record<string, string> = {
  '서울': 'ICN', '인천': 'ICN', '뉴욕': 'JFK', '방콕': 'BKK', '도쿄': 'NRT',
  '오사카': 'KIX', '파리': 'CDG', '런던': 'LHR', '로마': 'FCO', '바르셀로나': 'BCN',
  '싱가포르': 'SIN', '홍콩': 'HKG', '타이베이': 'TPE', '하노이': 'HAN',
  '다낭': 'DAD', '나트랑': 'CXR', '발리': 'DPS', '푸켓': 'HKT', '오키나와': 'OKA',
  '시드니': 'SYD', '두바이': 'DXB', '로스앤젤레스': 'LAX', '샌프란시스코': 'SFO',
  '미국': 'JFK', '베트남': 'HAN', '태국': 'BKK', '일본': 'NRT', '유럽': 'CDG',
};

function toAirportCode(city: string): string {
  const cleaned = city.trim();
  if (AIRPORT_CODE[cleaned]) return AIRPORT_CODE[cleaned];
  return cleaned.slice(0, 3).toUpperCase();
}

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
  routeArrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>',
  panelClose: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
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

function formatDateShort(d: string): string {
  const dt = new Date(d);
  return (dt.getMonth() + 1) + '.' + String(dt.getDate()).padStart(2, '0');
}

/** 워크스페이스 셸 렌더 */
export async function renderWorkspace(tripId: string, subPath?: string): Promise<HTMLElement> {
  const page = document.createElement('div');
  page.className = 'ws-page';

  const activeGate = subPath || 'ideas';

  page.innerHTML = [
    '<div class="ws-sidebar" id="ws-sidebar"></div>',
    '<div class="ws-mobile-overlay" id="ws-overlay"></div>',
    '<div class="ws-main">',
    '  <div class="ws-content-header" id="ws-header"></div>',
    '  <div class="ws-content-row">',
    '    <div class="ws-content-body" id="ws-body">',
    '      <div class="ws-placeholder">불러오는 중...</div>',
    '    </div>',
    '    <aside class="ws-ai-panel" id="ws-ai-panel"></aside>',
    '  </div>',
    '</div>',
  ].join('\n');

  const trip = await getTrip(tripId);
  if (!trip) {
    page.innerHTML = '<div class="ws-placeholder">여행 정보를 찾을 수 없어요</div>';
    return page;
  }

  const sidebar = page.querySelector('#ws-sidebar') as HTMLElement;
  sidebar.innerHTML = buildSidebar(trip, activeGate);

  const header = page.querySelector('#ws-header') as HTMLElement;
  header.innerHTML = buildContentHeader(trip, activeGate);

  const aiPanel = page.querySelector('#ws-ai-panel') as HTMLElement;
  aiPanel.innerHTML = buildAiPanel();

  const body = page.querySelector('#ws-body') as HTMLElement;
  await renderGate(body, tripId, activeGate);

  bindEvents(page, tripId);

  return page;
}

function buildSidebar(trip: Trip, activeGate: string): string {
  const mainItems = MAIN_NAV.map((item, i) => {
    const isActive = item.key === activeGate ? ' active' : '';
    const isLast = i === MAIN_NAV.length - 1 ? ' last' : '';
    return [
      '<button class="ws-nav-item ws-nav-gate' + isActive + isLast + '" data-gate="' + item.key + '">',
      '  <span class="ws-nav-marker"><span class="ws-nav-marker-num">' + item.step + '</span></span>',
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
    '  <div class="ws-trip-eyebrow">TRIP WORKSPACE</div>',
    '</div>',
    '<div class="ws-nav">',
    '  <div class="ws-nav-group">',
    mainItems,
    '  </div>',
    '  <div class="ws-nav-divider"></div>',
    subItems,
    '</div>',
    '<div class="ws-sidebar-footer">',
    '  <button class="ws-invite-btn" id="ws-invite">' + IC.invite + ' 멤버 초대</button>',
    '</div>',
  ].join('\n');
}

function buildContentHeader(trip: Trip, activeGate: string): string {
  const destCity = trip.destinations && trip.destinations[0] ? trip.destinations[0] : trip.name;
  const destCode = toAirportCode(destCity);
  const dateRange = trip.start_date && trip.end_date
    ? formatDateShort(trip.start_date) + ' – ' + formatDateShort(trip.end_date)
    : 'DATE TBD';
  const gateLabel = GATE_TITLES[activeGate] || activeGate.toUpperCase();

  return [
    '<button class="ws-mobile-menu" id="ws-mobile-menu">' + IC.menu + '</button>',
    '<div class="ws-header-info">',
    '  <div class="ws-header-eyebrow">' + gateLabel + '</div>',
    '  <div class="ws-header-route">',
    '    <span>ICN</span>' + IC.routeArrow + '<span>' + escapeHtml(destCode) + '</span>',
    '  </div>',
    '  <div class="ws-header-meta">' + escapeHtml(destCity) + ' &middot; ' + escapeHtml(dateRange) + '</div>',
    '</div>',
  ].join('\n');
}

function buildAiPanel(): string {
  return [
    '<div class="ws-ai-panel-inner">',
    '  <div class="ws-ai-panel-header">',
    '    <span class="ws-ai-panel-title">' + IC.sparkle + ' AI 인사이트</span>',
    '    <button class="ws-ai-panel-close" id="ws-ai-close">' + IC.panelClose + '</button>',
    '  </div>',
    '  <div class="ws-ai-panel-body" id="ws-ai-body">',
    '    <div class="ws-ai-empty">',
    '      <div class="ws-ai-empty-text">카드를 선택하면</div>',
    '      <div class="ws-ai-empty-text">추천 정보가 여기에 표시돼요</div>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

async function renderGate(body: HTMLElement, tripId: string, gate: string): Promise<void> {
  if (gate === 'ideas') {
    const { renderBoardContent } = await import('../board/board');
    await renderBoardContent(body, tripId);
  } else {
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

function bindEvents(page: HTMLElement, tripId: string): void {
  page.querySelector('#ws-back')?.addEventListener('click', () => navigate('trips'));

  const sidebar = page.querySelector('#ws-sidebar') as HTMLElement;
  page.querySelector('#ws-toggle')?.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });

  const overlay = page.querySelector('#ws-overlay') as HTMLElement;
  page.querySelector('#ws-mobile-menu')?.addEventListener('click', () => {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('visible');
  });
  overlay?.addEventListener('click', () => {
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('visible');
  });

  page.querySelectorAll('.ws-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const gate = (btn as HTMLElement).dataset.gate;
      if (!gate) return;
      sidebar.classList.remove('mobile-open');
      overlay?.classList.remove('visible');
      navigate('trip/' + tripId + '/' + gate);
    });
  });

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

  // AI 패널 열기/닫기
  const aiPanel = page.querySelector('#ws-ai-panel') as HTMLElement;
  page.querySelector('#ws-ai-close')?.addEventListener('click', () => {
    aiPanel.classList.remove('open');
  });

  // 보드 카드 선택 이벤트 수신 (board.ts에서 dispatch)
  page.addEventListener('mongsil:selectCard', ((e: CustomEvent<{ name: string }>) => {
    const aiBody = page.querySelector('#ws-ai-body') as HTMLElement;
    aiBody.innerHTML = [
      '<div class="ws-ai-selected">',
      '  <div class="ws-ai-selected-label">선택한 카드</div>',
      '  <div class="ws-ai-selected-name">' + escapeHtml(e.detail.name) + '</div>',
      '</div>',
      '<div class="ws-ai-coming-soon">',
      '  ' + IC.sparkle,
      '  <div class="ws-ai-coming-soon-text">AI 추천 정보는 곧 연결돼요</div>',
      '  <div class="ws-ai-coming-soon-hint">방문 시간 · 대기시간 · 예상 가격 등을 준비 중이에요</div>',
      '</div>',
    ].join('\n');
    aiPanel.classList.add('open');
  }) as EventListener);
}
