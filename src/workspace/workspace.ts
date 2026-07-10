import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import { initChat, teardownChat, setBadgeListener, countUnreadSince, markAsRead, renderChatPanelUI } from '../chat/chat';
import { initComments, teardownComments, renderCommentsUI } from '../comments/comments';
import type { Database } from '../types/database';
import type { ChatMessage } from '../types/database';
import './workspace.css';

type Trip = Database['public']['Tables']['trips']['Row'];

/* ── 도시 → IATA 공항코드 ── */
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
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  panelClose: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  mapPin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21C12 21 19 14.5 19 9.5C19 5.9 15.9 3 12 3C8.1 3 5 5.9 5 9.5C5 14.5 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.2"/></svg>',
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

type PanelTab = 'chat' | 'ai' | 'detail';

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
    '    <div class="ws-panel" id="ws-panel"></div>',
    '    <button class="ws-drawer-fab" id="ws-drawer-fab">',
    '      ' + IC.chat,
    '      <span class="ws-drawer-badge" id="rail-badge">0</span>',
    '    </button>',
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

  const body = page.querySelector('#ws-body') as HTMLElement;
  await renderGate(body, tripId, activeGate);

  bindEvents(page, tripId);
  await bindChat(page, tripId);

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

/** 우측 슬라이드 패널 (Drawer) — Collaborate / Assistant 세그먼트 컨트롤 */
function buildPanelShell(): string {
  return [
    '<div class="ws-panel-inner">',
    '  <div class="ws-panel-header">',
    '    <div class="ws-segmented">',
    '      <button class="ws-segment active" id="tab-chat" data-tab="chat">Collaborate</button>',
    '      <button class="ws-segment" id="tab-ai" data-tab="ai">Assistant</button>',
    '    </div>',
    '    <button class="ws-panel-close" id="ws-panel-close">' + IC.panelClose + '</button>',
    '  </div>',
    '  <div class="ws-panel-body" id="ws-panel-body"></div>',
    '</div>',
  ].join('\n');
}

function buildAiDemoContent(): string {
  return [
    '<div class="ws-ai-demo">',
    '  <div class="ws-ai-demo-badge">DEMO</div>',
    '  <div class="ws-ai-msg">',
    '    <div class="ws-ai-msg-icon">' + IC.sparkle + '</div>',
    '    <div class="ws-ai-msg-text">현재 보드 기준으로 최적 동선을 제안할게요.</div>',
    '  </div>',
    '  <div class="ws-ai-card">',
    '    <div class="ws-ai-card-title">11/03 (Day 2) 추천 코스</div>',
    '    <div class="ws-ai-card-route">',
    '      ' + IC.mapPin + '<span>이치란 → Central Park → MoMA → Chelsea Market → 브루클린 브릿지</span>',
    '    </div>',
    '    <div class="ws-ai-card-stats">',
    '      <div class="ws-ai-stat"><span class="ws-ai-stat-label">예상 이동시간</span><span class="ws-ai-stat-value">42분</span></div>',
    '      <div class="ws-ai-stat"><span class="ws-ai-stat-label">예상 비용</span><span class="ws-ai-stat-value">$85</span></div>',
    '      <div class="ws-ai-stat"><span class="ws-ai-stat-label">혼잡도</span><span class="ws-ai-stat-value">보통</span></div>',
    '    </div>',
    '    <button class="ws-ai-map-btn" id="ws-ai-map-btn">지도에서 보기</button>',
    '  </div>',
    '  <div class="ws-ai-prompts">',
    '    <button class="ws-ai-prompt-chip">3일차 일정 다시 짜줘</button>',
    '    <button class="ws-ai-prompt-chip">비오면 대체 일정 추천</button>',
    '    <button class="ws-ai-prompt-chip">예산 줄여줘</button>',
    '    <button class="ws-ai-prompt-chip">웨이팅 적은 순으로 정렬</button>',
    '    <button class="ws-ai-prompt-chip">동선 최적화</button>',
    '  </div>',
    '  <div class="ws-ai-demo-hint">실제 AI 연동(Gemini/Claude)은 다음 단계에서 진행돼요</div>',
    '</div>',
  ].join('\n');
}

/** 'ideas' 게이트를 벗어날 때 realtime 채널을 정리하기 위한 참조 */
let boardModuleRef: { teardownBoard: () => void } | null = null;

async function renderGate(body: HTMLElement, tripId: string, gate: string): Promise<void> {
  if (gate !== 'ideas' && boardModuleRef) {
    boardModuleRef.teardownBoard();
    boardModuleRef = null;
  }

  if (gate === 'ideas') {
    const mod = await import('../board/board');
    boardModuleRef = mod;
    await mod.renderBoardContent(body, tripId);
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
  page.querySelector('#ws-back')?.addEventListener('click', () => {
    teardownChat();
    boardModuleRef?.teardownBoard();
    boardModuleRef = null;
    navigate('trips');
  });

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
}

/** 채팅 초기화 + 우측 레일/패널 인터랙션 바인딩 */
async function bindChat(page: HTMLElement, tripId: string): Promise<void> {
  const layout = page.querySelector('.ws-content-row') as HTMLElement;
  const panelEl = page.querySelector('#ws-panel') as HTMLElement;
  const fab = page.querySelector('#ws-drawer-fab') as HTMLButtonElement;
  const badgeEl = page.querySelector('#rail-badge') as HTMLElement;

  let panelOpen = false;
  let activeTab: PanelTab = 'chat';
  let lastNonDetailTab: PanelTab = 'chat';
  let chatUnsub: (() => void) | null = null;

  function updateBadge(count: number): void {
    badgeEl.textContent = String(count);
    badgeEl.classList.toggle('visible', count > 0);
  }

  function closeDrawer(): void {
    panelOpen = false;
    layout.classList.remove('panel-open');
    panelEl.innerHTML = '';
    fab.classList.remove('hidden');
    if (chatUnsub) {
      chatUnsub();
      chatUnsub = null;
    }
    teardownComments();
  }

  function renderPanelBody(): void {
    const bodyEl = panelEl.querySelector('#ws-panel-body') as HTMLElement;
    if (!bodyEl) return;

    if (chatUnsub) {
      chatUnsub();
      chatUnsub = null;
    }

    if (activeTab === 'chat') {
      chatUnsub = renderChatPanelUI(bodyEl, tripId);
      markAsRead(tripId);
      updateBadge(0);
    } else {
      bodyEl.innerHTML = buildAiDemoContent();
      bodyEl.querySelector('#ws-ai-map-btn')?.addEventListener('click', () => {
        alert('지도 연동은 다음 단계에서 구현 예정이에요 (데모)');
      });
      bodyEl.querySelectorAll('.ws-ai-prompt-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          alert('AI 어시스턴트 연동은 다음 단계에서 구현 예정이에요 (데모)');
        });
      });
    }
  }

  function openDrawer(tab: PanelTab): void {
    panelOpen = true;
    activeTab = tab;
    lastNonDetailTab = tab;
    layout.classList.add('panel-open');
    fab.classList.add('hidden');
    panelEl.innerHTML = buildPanelShell();

    panelEl.querySelectorAll('.ws-segment').forEach((btn) => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
      btn.addEventListener('click', () => {
        const t = (btn as HTMLElement).dataset.tab as PanelTab;
        activeTab = t;
        lastNonDetailTab = t;
        panelEl.querySelectorAll('.ws-segment').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderPanelBody();
      });
    });
    panelEl.querySelector('#ws-panel-close')?.addEventListener('click', closeDrawer);

    renderPanelBody();
  }

  /** 카드 클릭 시 우측 Drawer에 상세 정보 표시 */
  async function openDetailPanel(place: any): Promise<void> {
    const wasOpen = panelOpen;
    panelOpen = true;
    activeTab = 'detail';
    layout.classList.add('panel-open');
    fab.classList.add('hidden');
    if (chatUnsub) {
      chatUnsub();
      chatUnsub = null;
    }
    teardownComments(); // 이전에 열려있던 다른 장소의 댓글 구독 정리

    panelEl.innerHTML = buildDetailPanelShell(place);

    panelEl.querySelector('#detail-back')?.addEventListener('click', () => {
      if (wasOpen) {
        openDrawer(lastNonDetailTab);
      } else {
        closeDrawer();
      }
    });
    panelEl.querySelector('#detail-close')?.addEventListener('click', closeDrawer);

    bindDetailNoteSave(place.id);
    bindDetailNameSave(place.id);
    bindDetailGatePicker(place, tripId, (updatedPlace) => openDetailPanel(updatedPlace));

    const commentsBody = panelEl.querySelector('#detail-comments-body') as HTMLElement | null;
    if (commentsBody) {
      await initComments(place.id);
      renderCommentsUI(commentsBody, place.id);
    }
  }

  page.addEventListener('mongsil:openPlaceDetail', ((e: CustomEvent<{ place: any }>) => {
    openDetailPanel(e.detail.place);
  }) as EventListener);

  fab.addEventListener('click', () => {
    if (panelOpen) {
      closeDrawer();
    } else {
      openDrawer(activeTab === 'detail' ? lastNonDetailTab : activeTab);
    }
  });

  // 채팅 실시간 초기화 + 안읽은 배지 관리
  await initChat(tripId);
  const myId = store.get('user')?.id;
  updateBadge(countUnreadSince(tripId, myId));

  setBadgeListener((msg: ChatMessage) => {
    if (msg.user_id === myId) return;
    const chatVisible = panelOpen && activeTab === 'chat';
    if (chatVisible) {
      markAsRead(tripId);
    } else {
      updateBadge(countUnreadSince(tripId, myId));
    }
  });
}

/** Drawer의 게이트 선택 버튼에 쓰는 최소 게이트 정보 (board.ts의 GATES와 동일한 mood 값) */
const DETAIL_GATES: Array<{ key: string; label: string }> = [
  { key: '가고싶어', label: 'VISIT' },
  { key: '먹고싶어', label: 'FOOD' },
  { key: '하고싶어', label: 'ACTIVITY' },
  { key: '숙소', label: 'STAY' },
];

/** 카드 상세 Drawer 콘텐츠 */
function buildDetailPanelShell(place: any): string {
  const photo = place.photo_url
    ? '<div class="ws-detail-photo" style="background-image:url(\'' + place.photo_url + '\')"></div>'
    : '';
  const rating = typeof place.google_rating === 'number'
    ? '<span class="ws-detail-rating">★ ' + place.google_rating.toFixed(1) + '</span>'
    : '';
  const category = place.category
    ? '<span class="ws-chip">' + escapeHtml(place.category) + '</span>'
    : '';
  const address = place.address
    ? '<div class="ws-detail-section"><span class="ws-detail-label">주소</span><div class="ws-detail-text">' + escapeHtml(place.address) + '</div></div>'
    : '';
  const hours = buildOpeningHoursHtml(place.opening_hours);

  const gateButtons = DETAIL_GATES.map((g) => {
    const isActive = g.key === place.mood;
    return '<button type="button" class="ws-gate-pick' + (isActive ? ' active' : '') + '" data-gate="' + g.key + '">' + g.label + '</button>';
  }).join('');

  return [
    '<div class="ws-panel-header">',
    '  <button class="ws-detail-back" id="detail-back">' + IC.back + '</button>',
    '  <span class="ws-detail-header-title">장소 상세</span>',
    '  <button class="ws-panel-close" id="detail-close">' + IC.panelClose + '</button>',
    '</div>',
    '<div class="ws-panel-body ws-detail-body" id="ws-panel-body">',
         photo,
    '  <div class="ws-detail-content">',
    '    <div class="ws-detail-title-row">',
    '      <input type="text" class="ws-detail-name-input" id="detail-name" value="' + escapeHtml(place.name) + '" />',
           rating,
    '    </div>',
    '    <span class="ws-detail-save-hint" id="detail-name-hint"></span>',
         category,
         address,
         hours,
    '    <div class="ws-detail-section">',
    '      <span class="ws-detail-label">게이트 이동</span>',
    '      <div class="ws-gate-picker">' + gateButtons + '</div>',
    '    </div>',
    '    <div class="ws-detail-section">',
    '      <span class="ws-detail-label">메모</span>',
    '      <textarea class="ws-detail-notes" id="detail-notes" placeholder="메모를 남겨보세요...">' + escapeHtml(place.notes || '') + '</textarea>',
    '      <span class="ws-detail-save-hint" id="detail-save-hint"></span>',
    '    </div>',
    '    <div class="ws-detail-section">',
    '      <span class="ws-detail-label">댓글</span>',
    '      <div id="detail-comments-body"></div>',
    '    </div>',
    '    <div class="ws-detail-section">',
    '      <span class="ws-detail-label">' + IC.sparkle + ' AI 요약</span>',
    '      <div class="ws-detail-placeholder">AI 요약은 다음 단계에서 연결돼요</div>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

function buildOpeningHoursHtml(hours: unknown): string {
  if (!Array.isArray(hours) || hours.length === 0) return '';
  const lines = hours.map((h) => '<div class="ws-hours-line">' + escapeHtml(String(h)) + '</div>').join('');
  return '<div class="ws-detail-section"><span class="ws-detail-label">영업시간</span>' + lines + '</div>';
}

/** 장소 이름 입력을 디바운스 후 자동 저장 */
function bindDetailNameSave(placeId: string): void {
  const input = document.getElementById('detail-name') as HTMLInputElement | null;
  const hint = document.getElementById('detail-name-hint') as HTMLElement | null;
  if (!input) return;

  let timer: ReturnType<typeof setTimeout> | null = null;
  input.addEventListener('input', () => {
    if (hint) hint.textContent = '저장 중...';
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const value = input.value.trim();
      if (!value) return;
      const { error } = await supabase.from('places').update({ name: value }).eq('id', placeId);
      if (hint) hint.textContent = error ? '저장 실패' : '저장됨';
      setTimeout(() => { if (hint) hint.textContent = ''; }, 1500);
    }, 600);
  });
}

/** Drawer 안의 게이트 이동 버튼 — 클릭하면 바로 mood 변경 */
function bindDetailGatePicker(place: any, tripId: string, onMoved: (updatedPlace: any) => void): void {
  const buttons = document.querySelectorAll('.ws-gate-pick');
  buttons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetGate = (btn as HTMLElement).dataset.gate;
      if (!targetGate || targetGate === place.mood) return;

      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const { error } = await supabase.from('places').update({ mood: targetGate }).eq('id', place.id);
      if (error) {
        console.error('게이트 이동 실패:', error.message);
        return;
      }

      const updatedPlace = { ...place, mood: targetGate };
      onMoved(updatedPlace);

      // 보드 화면이 열려있으면 그쪽도 즉시 갱신되도록 알림
      window.dispatchEvent(new CustomEvent('mongsil:placeGateChanged', { detail: { tripId, place: updatedPlace } }));
    });
  });
}

/** 메모 입력을 디바운스 후 자동 저장 */
function bindDetailNoteSave(placeId: string): void {
  const textarea = document.getElementById('detail-notes') as HTMLTextAreaElement | null;
  const hint = document.getElementById('detail-save-hint') as HTMLElement | null;
  if (!textarea) return;

  let timer: ReturnType<typeof setTimeout> | null = null;
  textarea.addEventListener('input', () => {
    if (hint) hint.textContent = '저장 중...';
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const { error } = await supabase.from('places').update({ notes: textarea.value }).eq('id', placeId);
      if (hint) hint.textContent = error ? '저장 실패' : '저장됨';
      setTimeout(() => { if (hint) hint.textContent = ''; }, 1500);
    }, 600);
  });
}
