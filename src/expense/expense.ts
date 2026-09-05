/**
 * EXPENSE 게이트 — 여행 예산·지출을 멤버들과 함께 계획하고, 여행 중엔 휴대폰으로
 * 기록해가는 탭.
 *
 * 내부 탭 5개(참고 레퍼런스의 상단 탭 구조를 그대로 따름 — 색상은 기존 "Airport Lounge
 * Premium Light" 컨셉 그대로 유지):
 *  - 예산 요약(overview)  : 통계 3카드 + 카테고리별 예산 카드 그리드 + 최근 지출 미리보기
 *                            (오른쪽 사이드바: 빠른 지출 추가 + 정산 현황 위젯)
 *  - 지출 내역(list)      : 전체 필터(상태/구분/카테고리/정렬) + 검색 + 날짜별 목록
 *  - 정산(settlement)     : 멤버별 차액 + 최소 송금 제안 + 공유하기
 *  - 동행(companions)     : 멤버별 지출 카드(낸 돈/부담액/차액/건수)
 *  - 설정(settings)       : 총 예산 / 카테고리별 예산 편집
 *
 * 재렌더 전략: 실시간 이벤트(다른 멤버의 지출/예산 변경)가 올 때마다 탭 전체를 다시
 * 그리면, 사이드바 "빠른 지출 추가" 폼이나 설정 탭의 입력 중인 값이 날아간다. 그래서
 * 데이터가 바뀌면 활성 탭의 "데이터 표시 영역"만 갱신하고, 입력 폼이 있는 영역(빠른
 * 추가 폼, 설정 탭)은 탭을 새로 열 때만 다시 마운트한다(refreshActiveTabData 참고).
 *
 * 원칙:
 *  - 집계·차트는 전부 원화(amount_krw) 기준. 현지 통화 입력은 저장 시점 환율로 환산해
 *    환율·출처(fx_rate/fx_source)를 함께 저장하고, 참고용 환율이면 화면에 그렇다고 표시(3-1)
 *  - 환율은 기존 /api/exchange-rate 프록시 재사용 + 세션 캐시 (3-2)
 *  - 다른 멤버의 추가/수정이 realtime으로 즉시 반영 (links.ts와 같은 패턴)
 *  - 정산은 "결제 완료(is_paid) + 공동 지출(split_mode=SHARED)" 항목만 반영
 */
import { supabase } from '../supabase';
import { store } from '../store';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Database, TripExpense, TripExpenseBudget } from '../types/database';
// 돈에 관한 숫자(집계·정산·환율 변환)는 MOBILE 지갑과 공유한다 — 같은 트립인데 PC와 폰의
// 정산 결과가 다르면 그 자체가 버그이므로 계산은 expenseModel 하나만 쓴다(Claude.md 5-3).
import {
  EXPENSE_CATEGORIES,
  CATEGORY_META,
  SPLIT_MODE_LABEL,
  CURRENCIES,
  BUDGET_TOTAL_KEY,
  fmtKRW,
  symbolOf,
  fmtAmount,
  krwOf,
  modeOf,
  memberName as memberNameOf,
  totalsByCategory as totalsByCategoryOf,
  getTotalBudget as getTotalBudgetOf,
  getCategoryBudgetSum as getCategoryBudgetSumOf,
  sumPaid as sumPaidOf,
  sumPaidByMode as sumPaidByModeOf,
  unconvertedCount as unconvertedCountOf,
  computeSettlement as computeSettlementOf,
  settlementSummaryText as settlementSummaryTextOf,
  buildPersonalBreakdownText as buildPersonalBreakdownTextOf,
  buildExpensePayload as buildExpensePayloadOf,
  fetchRate as fetchRateOf,
} from './expenseModel';
import type { ExpenseCategory, SplitMode, MemberLite, ExpenseCtx, SettleRow } from './expenseModel';

export { EXPENSE_CATEGORIES };
export type { ExpenseCategory };

type TripExpenseInsert = Database['public']['Tables']['trip_expenses']['Insert'];
import './expense.css';

/* ── UI 전용 아이콘 (카테고리 아이콘은 expenseModel의 CATEGORY_META에 있다) ── */
const IC_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
const IC_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const IC_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>';
const IC_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
const IC_WALLET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z"/><path d="M18 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2"/><circle cx="16.5" cy="13.5" r="1" fill="currentColor" stroke="none"/></svg>';
const IC_SWAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h13M14 3l4 4-4 4M20 17H7M10 13l-4 4 4 4"/></svg>';
const IC_RECEIPT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12v19l-3-2-3 2-3-2-3 2V2z"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4"/></svg>';
const IC_CAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13.5" r="3.2"/></svg>';
const IC_LIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>';
const IC_CHEV_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const IC_CHEV_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
const IC_CHEV_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
const IC_CHEV_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>';
const IC_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
const IC_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>';

const TIPS = [
  '정산은 "결제 완료" + "공동 지출" 항목만 반영돼요.',
  '카테고리 카드의 ⋯ 메뉴에서 예산을 바로 수정할 수 있어요.',
  '환율은 저장 시점 기준이라 실제 결제 금액과 소폭 다를 수 있어요.',
];

type TabKey = 'overview' | 'list' | 'settlement' | 'companions' | 'settings';
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: '예산 요약' },
  { key: 'list', label: '지출 내역' },
  { key: 'settlement', label: '정산' },
  { key: 'companions', label: '동행' },
  { key: 'settings', label: '설정' },
];

type StatusFilter = 'ALL' | 'PLANNED' | 'PAID';
type SplitModeFilter = 'ALL' | SplitMode;
type CategoryFilter = ExpenseCategory | 'ALL';
type SortMode = 'created_desc' | 'amount_desc';
type CategoryViewMode = 'budget' | 'usage';

/* ── 모듈 상태 ── */
let rootEl: HTMLElement | null = null;
let currentTripId = '';
let headcount = 1;
let members: MemberLite[] = [];
let expenses: TripExpense[] = [];
let budgets = new Map<string, number | null>();
let channel: RealtimeChannel | null = null;

let activeTab: TabKey = 'overview';
let categoryViewMode: CategoryViewMode = 'budget';
let openCategoryMenu: ExpenseCategory | null = null;
let tipIndex = 0;
let outsideClickHandler: ((e: MouseEvent) => void) | null = null;

/* 지출 내역 탭 필터 */
let statusFilter: StatusFilter = 'ALL';
let splitModeFilter: SplitModeFilter = 'ALL';
let categoryFilter: CategoryFilter = 'ALL';
let sortMode: SortMode = 'created_desc';
let searchQuery = '';
let listPageSize = 20;

let editingBudgetCategory: string | null = null; // 카테고리 그리드에서 인라인 편집 중인 카테고리(또는 'TOTAL')
let expandedBatchGroups = new Set<string>(); // 펼쳐진 개인 지출 배치 묶음(그룹 키)
let copyPopoverOpen = false; // "현재 사용" 카드의 복사 대상 선택 팝오버
let copySelectedMemberIds = new Set<string>(); // 복사 대상으로 고른 멤버(다중 선택)
let copySelectionTouched = false; // 한 번이라도 사용자가 선택을 건드렸는지 — 안 건드렸으면 팝오버를 열 때 전체 선택으로 기본값 채움
let lastUsedCurrency = 'KRW';
let quickAddMode: 'direct' | 'receipt' | 'sms' = 'direct';

/* 환율 캐시 — 같은 세션에서 통화당 1회만 조회 */
const fxCache = new Map<string, { rate: number | null; source: string }>();

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ── 계산은 expenseModel에 위임한다 ──
 * 모듈 상태(expenses/members/budgets/headcount)를 컨텍스트로 묶어 넘기기만 하고,
 * 아래 래퍼들은 기존 호출부가 그대로 동작하도록 이름을 유지한다. */
function ctx(): ExpenseCtx {
  return { tripId: currentTripId, members, expenses, budgets, headcount };
}

function memberName(userId: string | null): string { return memberNameOf(ctx(), userId); }
function totalsByCategory(): Map<ExpenseCategory, number> { return totalsByCategoryOf(ctx()); }
function getTotalBudget(): number | null { return getTotalBudgetOf(ctx()); }
function getCategoryBudgetSum(): number { return getCategoryBudgetSumOf(ctx()); }
function sumPaid(): number { return sumPaidOf(ctx()); }
function sumPaidByMode(mode: SplitMode): number { return sumPaidByModeOf(ctx(), mode); }
function unconvertedCount(): number { return unconvertedCountOf(ctx()); }
function computeSettlement(): { rows: SettleRow[]; transfers: Array<{ from: string; to: string; amount: number }>; skipped: number } {
  return computeSettlementOf(ctx());
}
function settlementSummaryText(): string { return settlementSummaryTextOf(ctx()); }
function buildPersonalBreakdownText(selectedUserIds?: string[]): string {
  return buildPersonalBreakdownTextOf(ctx(), selectedUserIds, tripPeriodLabel());
}

/** 트립의 시작~종료일을 "12.18 – 12.20" 형태로 — 복사한 텍스트만 따로 떼어봐도
 *  어느 여행 건인지 알 수 있게 제목 아래 붙인다. 날짜가 없으면 줄 자체를 생략(3-1). */
function tripPeriodLabel(): string | null {
  const trip = store.get('currentTrip');
  if (!trip?.start_date || !trip?.end_date) return null;
  const fmt = (d: string) => {
    const dt = new Date(d + 'T00:00:00');
    return (dt.getMonth() + 1) + '.' + String(dt.getDate()).padStart(2, '0');
  };
  return fmt(trip.start_date) + ' – ' + fmt(trip.end_date);
}
function fetchRate(currency: string): Promise<{ rate: number | null; source: string }> { return fetchRateOf(currency); }
function buildExpensePayload(fields: {
  category: string; title: string; amount: number; currency: string; expenseDate: string | null;
  isPaid: boolean; splitMode: SplitMode; payer: string | null; split: Set<string>; memo: string | null;
}): Promise<TripExpenseInsert> {
  return buildExpensePayloadOf(ctx(), fields);
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function fmtDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return (d.getMonth() + 1) + '.' + String(d.getDate()).padStart(2, '0') + ' (' + WEEKDAYS[d.getDay()] + ')';
}

function avatarHtml(userId: string | null, size: 'sm' | 'md' | 'lg' = 'md', fallbackName?: string | null, fallbackAvatar?: string | null): string {
  const m = userId ? members.find((mm) => mm.user_id === userId) : null;
  const name = m?.display_name || fallbackName || '?';
  const url = m?.avatar_url || fallbackAvatar || null;
  const inner = url
    ? '<img src="' + escapeHtml(url) + '" alt="" referrerpolicy="no-referrer" />'
    : escapeHtml(name.charAt(0));
  return '<span class="ex-avatar ex-avatar-' + size + '" title="' + escapeHtml(name) + '">' + inner + '</span>';
}

function shareSettlement(): void {
  const text = settlementSummaryText();
  navigator.clipboard.writeText(text).then(
    () => alert('정산 내역을 복사했어요. 채팅에 붙여넣어 공유해보세요!\n\n' + text),
    () => alert(text)
  );
}

/** "현재 사용" 카드의 복사 버튼 — 멤버별 실제 부담액(개인 지출 + 공동 지출 n분의 1)을
 *  지출명·메모까지 포함한 텍스트로 클립보드에 복사한다(ChatGPT 등 AI에 붙여넣어 예산
 *  효율을 분석하기 좋게). 버튼을 누르면 바로 복사하지 않고, 누구 것을 복사할지 다중
 *  선택하는 팝오버가 먼저 뜬다(전원 복사만 지원하던 이전 버전을 대체). */
function copyPopoverHtml(): string {
  if (members.length === 0) {
    return '<div class="ex-copy-popover-empty">멤버가 없어요</div>';
  }
  const allSelected = members.every((m) => copySelectedMemberIds.has(m.user_id));
  const chips = members.map((m) => {
    const active = copySelectedMemberIds.has(m.user_id);
    return '<button type="button" class="ex-copy-chip' + (active ? ' is-active' : '') + '" data-uid="' + m.user_id + '">' + avatarHtml(m.user_id, 'sm') + '<span>' + escapeHtml(m.display_name || '멤버') + '</span></button>';
  }).join('');
  const disabled = copySelectedMemberIds.size === 0;
  return [
    '<div class="ex-copy-popover-title">누구 걸 복사할까요?</div>',
    '<div class="ex-copy-popover-members">' + chips + '</div>',
    '<button type="button" class="ex-copy-popover-selectall" id="ex-copy-selectall">' + (allSelected ? '전체 해제' : '전체 선택') + '</button>',
    '<button type="button" class="al-btn-primary ex-copy-popover-confirm" id="ex-copy-confirm"' + (disabled ? ' disabled' : '') + '>' + IC_COPY + ' 복사하기</button>',
  ].join('');
}

function renderCopyPopover(): void {
  const el = rootEl?.querySelector('#ex-copy-popover') as HTMLElement | null;
  if (!el) return;
  el.classList.toggle('is-open', copyPopoverOpen);
  el.innerHTML = copyPopoverOpen ? copyPopoverHtml() : '';
  if (copyPopoverOpen) bindCopyPopover();
}

function toggleCopyPopover(): void {
  copyPopoverOpen = !copyPopoverOpen;
  // 처음 열 때는(사용자가 아직 한 번도 건드린 적 없으면) 전원 선택을 기본값으로 채워둔다
  if (copyPopoverOpen && !copySelectionTouched) {
    members.forEach((m) => copySelectedMemberIds.add(m.user_id));
  }
  renderCopyPopover();
}

function bindCopyPopover(): void {
  rootEl?.querySelectorAll('.ex-copy-chip').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const uid = (btn as HTMLElement).dataset.uid!;
      copySelectionTouched = true;
      if (copySelectedMemberIds.has(uid)) copySelectedMemberIds.delete(uid);
      else copySelectedMemberIds.add(uid);
      renderCopyPopover();
    });
  });
  rootEl?.querySelector('#ex-copy-selectall')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    copySelectionTouched = true;
    const allSelected = members.every((m) => copySelectedMemberIds.has(m.user_id));
    if (allSelected) copySelectedMemberIds.clear();
    else members.forEach((m) => copySelectedMemberIds.add(m.user_id));
    renderCopyPopover();
  });
  rootEl?.querySelector('#ex-copy-confirm')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (copySelectedMemberIds.size === 0) return;
    copyPersonalBreakdown(Array.from(copySelectedMemberIds));
    copyPopoverOpen = false;
    renderCopyPopover();
  });
}

function copyPersonalBreakdown(selectedUserIds: string[]): void {
  const text = buildPersonalBreakdownText(selectedUserIds);
  const btn = rootEl?.querySelector('#ex-copy-breakdown') as HTMLButtonElement | null;
  navigator.clipboard.writeText(text).then(
    () => {
      if (!btn) return;
      const original = btn.innerHTML;
      btn.innerHTML = IC_CHECK;
      btn.classList.add('is-copied');
      setTimeout(() => {
        btn.innerHTML = original;
        btn.classList.remove('is-copied');
      }, 1500);
    },
    () => {
      window.prompt('복사에 실패했어요 — 아래 내용을 직접 복사하세요', text);
    }
  );
}

/* ══════════════════════ 탭 네비게이션 ══════════════════════ */

function tabsHtml(): string {
  return TABS.map((t) =>
    '<button type="button" class="ex-tab' + (activeTab === t.key ? ' is-active' : '') + '" data-tab="' + t.key + '">' + t.label + '</button>'
  ).join('');
}

function switchTab(tab: TabKey): void {
  activeTab = tab;
  openCategoryMenu = null;
  const tabsEl = rootEl?.querySelector('#ex-tabs');
  if (tabsEl) tabsEl.innerHTML = tabsHtml();
  bindTabsNav();
  mountTab();
}

function bindTabsNav(): void {
  rootEl?.querySelectorAll('.ex-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = (btn as HTMLElement).dataset.tab as TabKey;
      if (tab !== activeTab) switchTab(tab);
    });
  });
}

/** 탭 전체를 새로 마운트(탭 전환 시). 데이터만 바뀐 경우엔 refreshActiveTabData를 대신 사용. */
function mountTab(): void {
  const panel = rootEl?.querySelector('#ex-tabpanel') as HTMLElement | null;
  if (!panel) return;
  if (activeTab === 'overview') mountOverviewTab(panel);
  else if (activeTab === 'list') mountListTab(panel);
  else if (activeTab === 'settlement') mountSettlementTab(panel);
  else if (activeTab === 'companions') mountCompanionsTab(panel);
  else mountSettingsTab(panel);
}

/** 실시간 데이터 변경 시 호출 — 입력 폼이 있는 영역(빠른 추가/설정)은 건드리지 않고,
 *  순수 데이터 표시 영역만 갱신해서 사용자가 입력 중인 값이 날아가지 않게 한다. */
function refreshActiveTabData(): void {
  if (activeTab === 'overview') renderOverviewData();
  else if (activeTab === 'list') mountListTab(rootEl!.querySelector('#ex-tabpanel') as HTMLElement);
  else if (activeTab === 'settlement') mountSettlementTab(rootEl!.querySelector('#ex-tabpanel') as HTMLElement);
  else if (activeTab === 'companions') mountCompanionsTab(rootEl!.querySelector('#ex-tabpanel') as HTMLElement);
  // settings 탭은 새로고침하지 않음(입력 중인 예산 값 보호) — 다음에 탭을 열 때 최신값으로 마운트됨
}

/* ══════════════════════ 예산 요약 탭 ══════════════════════ */

function mountOverviewTab(panel: HTMLElement): void {
  panel.innerHTML = [
    '<div class="ex-overview-layout">',
    '  <div class="ex-overview-main">',
    '    <div id="ex-stats"></div>',
    '    <div class="ex-card al-glass ex-category-card">',
    '      <div class="ex-section-header">',
    '        <span class="ex-card-title al-sign-label">카테고리별 예산</span>',
    '        <div class="ex-viewmode-toggle">',
    '          <button type="button" class="ex-viewmode-btn' + (categoryViewMode === 'budget' ? ' is-active' : '') + '" data-view="budget">예산 기준</button>',
    '          <button type="button" class="ex-viewmode-btn' + (categoryViewMode === 'usage' ? ' is-active' : '') + '" data-view="usage">사용 기준</button>',
    '        </div>',
    '      </div>',
    '      <div class="ex-catgrid" id="ex-catgrid"></div>',
    '    </div>',
    '    <div class="ex-card al-glass ex-recent-card">',
    '      <div class="ex-section-header">',
    '        <span class="ex-card-title al-sign-label">최근 지출</span>',
    '        <button type="button" class="ex-more-link" id="ex-recent-more">더보기</button>',
    '      </div>',
    '      <div id="ex-recent"></div>',
    '    </div>',
    '  </div>',
    '  <div class="ex-overview-sidebar">',
    '    <div class="ex-card al-glass ex-quickadd-card" id="ex-quickadd"></div>',
    '    <div class="ex-card al-glass ex-settlewidget-card" id="ex-settlewidget"></div>',
    '  </div>',
    '</div>',
  ].join('\n');

  panel.querySelector('#ex-recent-more')?.addEventListener('click', () => switchTab('list'));
  panel.querySelectorAll('.ex-viewmode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      categoryViewMode = (btn as HTMLElement).dataset.view as CategoryViewMode;
      renderOverviewData();
    });
  });

  mountQuickAdd(panel.querySelector('#ex-quickadd') as HTMLElement);
  renderOverviewData();
}

function statsHtml(): string {
  const totalBudget = getTotalBudget();
  const usage = sumPaid();
  const remaining = totalBudget != null ? totalBudget - usage : null;
  const pct = totalBudget != null && totalBudget > 0 ? Math.round((usage / totalBudget) * 100) : null;
  const over = remaining != null && remaining < 0;
  const people = Math.max(1, headcount);
  const sharedUsage = sumPaidByMode('SHARED');
  const personalUsage = sumPaidByMode('PERSONAL');
  // 개인 지출은 그 사람 혼자 부담하는 돈이라 나눠 가질 대상이 아님 — 1인당 부담액은
  // "다 같이 나눠 낼 돈"인 공동 지출만 인원수로 나눈다(전체 사용액을 그냥 나누면 안 됨)
  const perPerson = sharedUsage / people;
  const sharedPct = usage > 0 ? Math.round((sharedUsage / usage) * 100) : 0;
  const personalPct = usage > 0 ? 100 - sharedPct : 0;

  const gauge = totalBudget != null && totalBudget > 0
    ? [
        '<div class="ex-gauge" role="img" aria-label="예산 대비 ' + (pct ?? 0) + '% 사용">',
        '  <div class="ex-gauge-fill' + (over ? ' is-over' : '') + '" style="width:' + Math.min(100, pct ?? 0) + '%"></div>',
        '</div>',
        '<div class="ex-gauge-caption"><strong>' + (pct ?? 0) + '%</strong> 사용</div>',
      ].join('')
    : '<div class="ex-gauge-caption ex-gauge-caption-empty">설정 탭에서 총 예산을 입력해보세요</div>';

  const unconverted = unconvertedCount();
  const unconvertedNote = unconverted > 0
    ? '<div class="ex-summary-note">환율을 가져오지 못해 합계에서 빠진 항목 ' + unconverted + '건</div>'
    : '';

  return [
    '<div class="ex-stat-row">',
    '  <div class="ex-stat-card al-glass">',
    '    <div class="ex-stat-card-top"><span class="ex-stat-label">총 예산</span><button type="button" class="ex-stat-edit-link" id="ex-edit-total">예산 수정</button></div>',
    '    <div class="ex-stat-value">' + (totalBudget != null ? fmtKRW(totalBudget) : '<span class="ex-stat-empty">미설정</span>') + '</div>',
    gauge,
    (remaining != null ? '<div class="ex-stat-foot' + (over ? ' is-over' : '') + '">' + (over ? '예산 초과 ' : '남은 예산 ') + fmtKRW(Math.abs(remaining)) + '</div>' : ''),
    '  </div>',
    '  <div class="ex-stat-card al-glass ex-stat-card-usage">',
    '    <div class="ex-stat-card-top"><span class="ex-stat-label">현재 사용</span>',
    '      <button type="button" class="ex-stat-copy-btn" id="ex-copy-breakdown" title="개인별 지출 내역 텍스트로 복사(AI 분석용)">' + IC_COPY + '</button>',
    '    </div>',
    '    <div class="ex-copy-popover' + (copyPopoverOpen ? ' is-open' : '') + '" id="ex-copy-popover">' + (copyPopoverOpen ? copyPopoverHtml() : '') + '</div>',
    '    <div class="ex-stat-value">' + fmtKRW(usage) + '</div>',
    '    <div class="ex-usage-split">',
    '      <div class="ex-usage-split-bar"><span style="width:' + sharedPct + '%;background:var(--al-action)"></span><span style="width:' + personalPct + '%;background:var(--al-text-tertiary)"></span></div>',
    '      <div class="ex-usage-split-row"><span class="ex-usage-dot" style="background:var(--al-action)"></span>공동 지출 ' + fmtKRW(sharedUsage) + ' <em>(' + sharedPct + '%)</em></div>',
    '      <div class="ex-usage-split-row"><span class="ex-usage-dot" style="background:var(--al-text-tertiary)"></span>개인 지출 ' + fmtKRW(personalUsage) + ' <em>(' + personalPct + '%)</em></div>',
    '    </div>',
    unconvertedNote,
    '  </div>',
    '  <div class="ex-stat-card al-glass">',
    '    <div class="ex-stat-card-top"><span class="ex-stat-label">1인당 예상 부담액</span>' + IC_WALLET + '</div>',
    '    <div class="ex-stat-value">' + fmtKRW(perPerson) + '</div>',
    '    <div class="ex-stat-foot">' + people + '명 평균 · 공동 지출 기준</div>',
    '    <button type="button" class="ex-more-link" id="ex-perperson-detail">상세 보기</button>',
    '  </div>',
    '</div>',
  ].join('\n');
}

function categoryCardHtml(cat: ExpenseCategory): string {
  const meta = CATEGORY_META[cat];
  const totals = totalsByCategory();
  const spent = totals.get(cat) ?? 0;
  const budget = budgets.get(cat) ?? null;
  const totalSpent = Array.from(totals.values()).reduce((a, b) => a + b, 0);

  let pct: number;
  let subText: string;
  let overBudget = false;
  if (categoryViewMode === 'budget') {
    pct = budget != null && budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
    subText = budget != null ? fmtKRW(spent) + ' / ' + fmtKRW(budget) : '예산 미설정';
    overBudget = budget != null && budget > 0 && spent > budget;
  } else {
    pct = totalSpent > 0 ? (spent / totalSpent) * 100 : 0;
    subText = '전체의 ' + Math.round(pct) + '%';
  }

  const menuOpen = openCategoryMenu === cat;
  const editing = editingBudgetCategory === cat;

  const menu = [
    '<div class="ex-catcard-menu' + (menuOpen ? ' is-open' : '') + '">',
    '  <button type="button" class="ex-catcard-menu-item" data-action="editBudget" data-cat="' + cat + '">예산 수정</button>',
    '  <button type="button" class="ex-catcard-menu-item" data-action="viewList" data-cat="' + cat + '">지출 내역 보기</button>',
    '</div>',
  ].join('');

  const body = editing
    ? '<div class="ex-catcard-edit"><input type="number" inputmode="numeric" class="ex-catcard-edit-input" data-cat="' + cat + '" value="' + (budget ?? '') + '" placeholder="예산(원)" /><button type="button" class="ex-catcard-edit-save" data-cat="' + cat + '">저장</button></div>'
    : [
        '<div class="ex-catcard-amount">' + fmtKRW(spent) + '</div>',
        '<div class="ex-catcard-sub">' + escapeHtml(subText) + (overBudget ? '<span class="ex-cat-over">초과</span>' : '') + '</div>',
        '<div class="ex-catcard-bar"><div class="ex-catcard-bar-fill' + (overBudget ? ' is-over' : '') + '" style="width:' + pct + '%;background:' + meta.color + '"></div></div>',
      ].join('\n');

  return [
    '<div class="ex-catcard' + (categoryFilter === cat ? ' is-active' : '') + '" data-cat="' + cat + '">',
    '  <div class="ex-catcard-top">',
    '    <span class="ex-catcard-icon" style="color:' + meta.color + '">' + meta.icon + '</span>',
    '    <span class="ex-catcard-label">' + meta.label + '</span>',
    '    <button type="button" class="ex-catcard-menu-btn" data-cat="' + cat + '">' + IC_DOTS + '</button>',
    menu,
    '  </div>',
    body,
    '</div>',
  ].join('');
}

function renderOverviewData(): void {
  if (!rootEl) return;
  const statsEl = rootEl.querySelector('#ex-stats');
  const catgridEl = rootEl.querySelector('#ex-catgrid');
  const recentEl = rootEl.querySelector('#ex-recent');
  const settleWidgetEl = rootEl.querySelector('#ex-settlewidget');
  if (statsEl) statsEl.innerHTML = statsHtml();
  if (catgridEl) catgridEl.innerHTML = EXPENSE_CATEGORIES.map(categoryCardHtml).join('');
  if (recentEl) recentEl.innerHTML = recentListHtml();
  if (settleWidgetEl) settleWidgetEl.innerHTML = settleWidgetHtml();
  bindOverviewData();
}

function recentListHtml(): string {
  if (expenses.length === 0) {
    return [
      '<div class="ex-empty ex-empty-compact">',
      '  <div class="ex-empty-icon">' + IC_WALLET + '</div>',
      '  <div class="ex-empty-text">아직 입력한 지출이 없어요</div>',
      '  <div class="ex-empty-hint">오른쪽 "빠른 지출 추가"로 첫 지출을 기록해보세요</div>',
      '</div>',
    ].join('');
  }
  const sorted = [...expenses].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const groups = groupExpenseRows(sorted).slice(0, 5);
  return '<div class="ex-list">' + groups.map(expenseGroupRowHtml).join('') + '</div>';
}

function settleWidgetHtml(): string {
  const { rows, transfers } = computeSettlement();
  const hasPaid = expenses.some((e) => e.is_paid && modeOf(e) === 'SHARED');
  const top = rows
    .filter((r) => members.some((m) => m.user_id === r.userId) && Math.abs(r.balance) > 0.5)
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    .slice(0, 4);

  const body = !hasPaid
    ? '<div class="ex-settle-empty">공동 지출을 결제 완료로 표시하면<br/>정산 현황이 여기 표시돼요.</div>'
    : top.length === 0
      ? '<div class="ex-settle-done">모두 정산이 맞아요 ✓</div>'
      : top.map((r) => {
          const cls = r.balance > 0 ? ' is-plus' : ' is-minus';
          const text = (r.balance > 0 ? '+' : '−') + fmtKRW(Math.abs(r.balance));
          return '<div class="ex-settlewidget-row">' + avatarHtml(r.userId, 'sm') + '<span class="ex-settlewidget-name">' + escapeHtml(memberName(r.userId)) + '</span><span class="ex-settlewidget-balance' + cls + '">' + text + '</span></div>';
        }).join('');

  const tip = TIPS[tipIndex % TIPS.length];

  return [
    '<div class="ex-section-header">',
    '  <span class="ex-card-title al-sign-label">정산 현황</span>',
    '  <button type="button" class="ex-more-link" id="ex-settle-detail">자세히 보기</button>',
    '</div>',
    '<div class="ex-settlewidget-body">' + body + '</div>',
    (transfers.length > 0 ? '<button type="button" class="al-btn-primary ex-settle-cta" id="ex-settle-cta">' + IC_SWAP + ' 정산하기</button>' : ''),
    '<div class="ex-tip-row">',
    '  <button type="button" class="ex-tip-nav" id="ex-tip-prev" aria-label="이전 팁">' + IC_CHEV_L + '</button>',
    '  <div class="ex-tip-text">' + IC_LIGHT + '<span>' + escapeHtml(tip) + '</span></div>',
    '  <button type="button" class="ex-tip-nav" id="ex-tip-next" aria-label="다음 팁">' + IC_CHEV_R + '</button>',
    '</div>',
    '<div class="ex-tip-dots">' + (tipIndex % TIPS.length + 1) + ' / ' + TIPS.length + '</div>',
  ].join('\n');
}

function bindOverviewData(): void {
  if (!rootEl) return;

  rootEl.querySelector('#ex-edit-total')?.addEventListener('click', () => switchTab('settings'));
  rootEl.querySelector('#ex-copy-breakdown')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleCopyPopover();
  });
  if (copyPopoverOpen) bindCopyPopover();
  rootEl.querySelector('#ex-perperson-detail')?.addEventListener('click', () => switchTab('settlement'));
  rootEl.querySelector('#ex-settle-detail')?.addEventListener('click', () => switchTab('settlement'));
  rootEl.querySelector('#ex-settle-cta')?.addEventListener('click', shareSettlement);
  rootEl.querySelector('#ex-tip-prev')?.addEventListener('click', () => {
    tipIndex = (tipIndex - 1 + TIPS.length) % TIPS.length;
    const w = rootEl?.querySelector('#ex-settlewidget');
    if (w) w.innerHTML = settleWidgetHtml();
    bindOverviewData();
  });
  rootEl.querySelector('#ex-tip-next')?.addEventListener('click', () => {
    tipIndex = (tipIndex + 1) % TIPS.length;
    const w = rootEl?.querySelector('#ex-settlewidget');
    if (w) w.innerHTML = settleWidgetHtml();
    bindOverviewData();
  });

  // 카테고리 카드 — 메뉴, 인라인 예산 편집, 클릭 시 지출내역 탭으로 필터 이동
  rootEl.querySelectorAll('.ex-catcard-menu-btn').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const cat = (btn as HTMLElement).dataset.cat as ExpenseCategory;
      openCategoryMenu = openCategoryMenu === cat ? null : cat;
      const catgridEl = rootEl?.querySelector('#ex-catgrid');
      if (catgridEl) catgridEl.innerHTML = EXPENSE_CATEGORIES.map(categoryCardHtml).join('');
      bindOverviewData();
    });
  });
  rootEl.querySelectorAll('.ex-catcard-menu-item').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const action = (btn as HTMLElement).dataset.action;
      const cat = (btn as HTMLElement).dataset.cat as ExpenseCategory;
      openCategoryMenu = null;
      if (action === 'editBudget') {
        editingBudgetCategory = cat;
        const catgridEl = rootEl?.querySelector('#ex-catgrid');
        if (catgridEl) catgridEl.innerHTML = EXPENSE_CATEGORIES.map(categoryCardHtml).join('');
        bindOverviewData();
        (rootEl?.querySelector('.ex-catcard-edit-input[data-cat="' + cat + '"]') as HTMLInputElement | null)?.focus();
      } else if (action === 'viewList') {
        categoryFilter = cat;
        switchTab('list');
      }
    });
  });
  rootEl.querySelectorAll('.ex-catcard').forEach((card) => {
    card.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('.ex-catcard-top') || (ev.target as HTMLElement).closest('.ex-catcard-edit')) return;
      const cat = (card as HTMLElement).dataset.cat as ExpenseCategory;
      categoryFilter = cat;
      switchTab('list');
    });
  });
  const commitCatBudget = async (cat: string, raw: string): Promise<void> => {
    const value = raw.trim() === '' ? null : Math.max(0, Math.round(Number(raw)));
    if (value != null && !Number.isFinite(value)) return;
    editingBudgetCategory = null;
    budgets.set(cat, value);
    renderOverviewData();
    const { error } = await supabase
      .from('trip_expense_budgets')
      .upsert({ trip_id: currentTripId, category: cat, amount_krw: value, updated_at: new Date().toISOString() }, { onConflict: 'trip_id,category' });
    if (error) console.error('예산 저장 실패:', error.message);
  };
  rootEl.querySelectorAll('.ex-catcard-edit-input').forEach((el) => {
    const input = el as HTMLInputElement;
    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') void commitCatBudget(input.dataset.cat!, input.value);
      if ((ev as KeyboardEvent).key === 'Escape') { editingBudgetCategory = null; renderOverviewData(); }
    });
  });
  rootEl.querySelectorAll('.ex-catcard-edit-save').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const cat = (btn as HTMLElement).dataset.cat!;
      const input = rootEl?.querySelector('.ex-catcard-edit-input[data-cat="' + cat + '"]') as HTMLInputElement | null;
      if (input) void commitCatBudget(cat, input.value);
    });
  });

  // 최근 지출 항목 클릭 → 수정 (그룹 요약 행은 펼침 토글이므로 제외)
  rootEl.querySelectorAll('#ex-recent .ex-item[data-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const id = (row as HTMLElement).dataset.id!;
      const e = expenses.find((x) => x.id === id);
      if (e) openSheet(e);
    });
  });
  bindGroupToggles(rootEl.querySelector('#ex-recent') as HTMLElement, renderOverviewData);
}

/* ══════════════════════ 빠른 지출 추가 (사이드바, 데스크톱 전용) ══════════════════════ */

function quickAddModeTabsHtml(): string {
  const modes: Array<{ key: typeof quickAddMode; label: string; icon: string }> = [
    { key: 'direct', label: '직접 입력', icon: '' },
    { key: 'receipt', label: '영수증', icon: IC_RECEIPT },
    { key: 'sms', label: '문자·이미지', icon: IC_CAMERA },
  ];
  return modes.map((m) =>
    '<button type="button" class="ex-qa-mode' + (quickAddMode === m.key ? ' is-active' : '') + '" data-mode="' + m.key + '">' + m.icon + '<span>' + m.label + '</span></button>'
  ).join('');
}

function quickAddFormHtml(): string {
  const me = store.get('user');
  const payer = me?.id ?? (members[0]?.user_id ?? null);

  const catOptions = EXPENSE_CATEGORIES.map((cat) => '<option value="' + cat + '">' + CATEGORY_META[cat].label + '</option>').join('');
  const currencyOptions = CURRENCIES.map((c) => '<option value="' + c.code + '"' + (c.code === lastUsedCurrency ? ' selected' : '') + '>' + c.code + '</option>').join('');
  const payerChips = members.map((m) =>
    '<button type="button" class="ex-qa-member' + (m.user_id === payer ? ' is-active' : '') + '" data-uid="' + m.user_id + '">' + avatarHtml(m.user_id, 'sm') + '<span>' + escapeHtml(m.display_name || '멤버') + '</span></button>'
  ).join('');
  const splitChips = members.map((m) =>
    '<button type="button" class="ex-qa-member is-active" data-uid="' + m.user_id + '">' + avatarHtml(m.user_id, 'sm') + '<span>' + escapeHtml(m.display_name || '멤버') + '</span></button>'
  ).join('');

  return [
    '<div class="ex-qa-field"><span class="ex-qa-label">카테고리</span>',
    '  <select class="ex-qa-input" id="qa-category"><option value="">선택하세요</option>' + catOptions + '</select>',
    '</div>',
    '<div class="ex-qa-row">',
    '  <div class="ex-qa-field ex-qa-amount"><span class="ex-qa-label">금액</span><input type="number" inputmode="decimal" class="ex-qa-input" id="qa-amount" placeholder="0" min="0" step="any" /></div>',
    '  <div class="ex-qa-field ex-qa-currency"><span class="ex-qa-label">통화</span><select class="ex-qa-input" id="qa-currency">' + currencyOptions + '</select></div>',
    '  <div class="ex-qa-field ex-qa-date"><span class="ex-qa-label">날짜</span><input type="date" class="ex-qa-input" id="qa-date" value="' + new Date().toISOString().slice(0, 10) + '" /></div>',
    '</div>',
    '<div class="ex-fx-hint" id="qa-fxhint"></div>',
    '<div class="ex-qa-field"><span class="ex-qa-label">구분</span>',
    '  <div class="ex-splitmode-toggle" id="qa-splitmode">',
    '    <button type="button" class="ex-splitmode-btn is-active" data-mode="SHARED">공동 지출</button>',
    '    <button type="button" class="ex-splitmode-btn" data-mode="PERSONAL">개인 지출</button>',
    '  </div>',
    '</div>',
    '<div class="ex-qa-field"><span class="ex-qa-label">결제한 사람</span><div class="ex-qa-members" id="qa-payer">' + payerChips + '</div></div>',
    '<div class="ex-qa-field" id="qa-split-wrap"><span class="ex-qa-label">나눠 낼 사람</span><div class="ex-qa-members" id="qa-split">' + splitChips + '</div></div>',
    '<div class="ex-qa-row">',
    '  <label class="ex-qa-paid-row"><span class="ex-qa-label">결제 완료</span><button type="button" class="ex-paid-toggle is-on" id="qa-paid" role="switch" aria-checked="true"><span class="ex-paid-knob"></span></button></label>',
    '</div>',
    '<div class="ex-qa-field"><span class="ex-qa-label">내용</span><input type="text" class="ex-qa-input" id="qa-title" placeholder="예: 왓아룬 보트투어" maxlength="80" /></div>',
    '<div class="ex-qa-field"><span class="ex-qa-label">메모 <em>(선택)</em></span><input type="text" class="ex-qa-input" id="qa-memo" placeholder="예: 4인 기준" maxlength="120" /></div>',
    '<div class="ex-qa-actions">',
    '  <button type="button" class="ex-qa-reset" id="qa-reset">초기화</button>',
    '  <button type="button" class="al-btn-primary ex-qa-save" id="qa-save">저장</button>',
    '</div>',
    '<div class="ex-qa-flash" id="qa-flash"></div>',
  ].join('\n');
}

function mountQuickAdd(container: HTMLElement): void {
  container.innerHTML = [
    '<div class="ex-section-header"><span class="ex-card-title al-sign-label">빠른 지출 추가</span></div>',
    '<div class="ex-qa-modes">' + quickAddModeTabsHtml() + '</div>',
    '<div class="ex-qa-body" id="qa-body"></div>',
  ].join('\n');

  container.querySelectorAll('.ex-qa-mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      quickAddMode = (btn as HTMLElement).dataset.mode as typeof quickAddMode;
      container.querySelectorAll('.ex-qa-mode').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderQuickAddBody(container);
    });
  });

  renderQuickAddBody(container);
}

function renderQuickAddBody(container: HTMLElement): void {
  const bodyEl = container.querySelector('#qa-body') as HTMLElement;
  if (!bodyEl) return;

  if (quickAddMode !== 'direct') {
    const icon = quickAddMode === 'receipt' ? IC_RECEIPT : IC_CAMERA;
    bodyEl.innerHTML = [
      '<div class="ex-qa-soon">',
      '  <div class="ex-qa-soon-icon">' + icon + '</div>',
      '  <div class="ex-qa-soon-text">' + (quickAddMode === 'receipt' ? '영수증 촬영으로 자동 입력' : '문자·이미지로 자동 입력') + '</div>',
      '  <div class="ex-qa-soon-hint">다음 단계에서 지원 예정이에요</div>',
      '</div>',
    ].join('\n');
    return;
  }

  bodyEl.innerHTML = quickAddFormHtml();

  let splitMode: SplitMode = 'SHARED';
  const defaultPayer = store.get('user')?.id ?? (members[0]?.user_id ?? null);
  const payerSet = new Set<string>(defaultPayer ? [defaultPayer] : []);
  let isPaid = true;
  const split = new Set<string>(members.map((m) => m.user_id));

  const currencySel = bodyEl.querySelector('#qa-currency') as HTMLSelectElement;
  const fxHint = bodyEl.querySelector('#qa-fxhint') as HTMLElement;
  const updateFxHint = async (): Promise<void> => {
    const cur = currencySel.value;
    if (cur === 'KRW') { fxHint.textContent = ''; return; }
    fxHint.textContent = '환율 확인 중...';
    const { rate, source } = await fetchRate(cur);
    if (currencySel.value !== cur) return;
    fxHint.textContent = rate == null
      ? '환율을 가져오지 못했어요 — 원화 환산 없이 저장돼요'
      : '1 ' + cur + ' ≈ ' + fmtKRW(rate) + (source === 'fallback' ? ' (참고용 환율)' : '');
  };
  void updateFxHint();
  currencySel.addEventListener('change', () => void updateFxHint());

  const splitWrap = bodyEl.querySelector('#qa-split-wrap') as HTMLElement;
  const updateSplitVisibility = (): void => {
    splitWrap.style.display = splitMode === 'SHARED' ? '' : 'none';
  };
  updateSplitVisibility();

  const setPayerActive = (): void => {
    bodyEl.querySelectorAll('#qa-payer .ex-qa-member').forEach((b) => {
      b.classList.toggle('is-active', payerSet.has((b as HTMLElement).dataset.uid!));
    });
  };

  bodyEl.querySelectorAll('#qa-splitmode .ex-splitmode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      splitMode = (btn as HTMLElement).dataset.mode as SplitMode;
      bodyEl.querySelectorAll('#qa-splitmode .ex-splitmode-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      updateSplitVisibility();
      // 공동 지출로 돌아가면 실제로 결제한 한 사람만 남기고 정리(개인 지출에서 여러 명을 골랐을 수 있음)
      if (splitMode === 'SHARED' && payerSet.size > 1) {
        const keep = payerSet.values().next().value as string;
        payerSet.clear();
        payerSet.add(keep);
        setPayerActive();
      }
    });
  });

  // 결제한 사람 — 공동 지출은 실제로 결제한 한 명만(라디오), 개인 지출은 "각자 결제"를
  // 한 번에 배치 입력할 수 있게 여러 명 선택 가능(체크박스). 예: 개인 항공권처럼 나눠 낼
  // 필요는 없지만 인원수만큼 따로따로 입력하기 귀찮은 경우를 위함
  bodyEl.querySelectorAll('#qa-payer .ex-qa-member').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid = (btn as HTMLElement).dataset.uid!;
      if (splitMode === 'PERSONAL') {
        if (payerSet.has(uid)) {
          if (payerSet.size <= 1) return; // 최소 1명은 남겨야 함
          payerSet.delete(uid);
        } else {
          payerSet.add(uid);
        }
      } else {
        payerSet.clear();
        payerSet.add(uid);
      }
      setPayerActive();
    });
  });

  bodyEl.querySelectorAll('#qa-split .ex-qa-member').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid = (btn as HTMLElement).dataset.uid!;
      if (split.has(uid)) {
        if (split.size <= 1) return;
        split.delete(uid);
        btn.classList.remove('is-active');
      } else {
        split.add(uid);
        btn.classList.add('is-active');
      }
    });
  });

  const paidToggle = bodyEl.querySelector('#qa-paid') as HTMLButtonElement;
  paidToggle.addEventListener('click', () => {
    isPaid = !isPaid;
    paidToggle.classList.toggle('is-on', isPaid);
    paidToggle.setAttribute('aria-checked', String(isPaid));
  });

  const resetForm = (): void => {
    (bodyEl.querySelector('#qa-title') as HTMLInputElement).value = '';
    (bodyEl.querySelector('#qa-amount') as HTMLInputElement).value = '';
    (bodyEl.querySelector('#qa-memo') as HTMLInputElement).value = '';
  };
  bodyEl.querySelector('#qa-reset')?.addEventListener('click', resetForm);

  const flashEl = bodyEl.querySelector('#qa-flash') as HTMLElement;
  const saveBtn = bodyEl.querySelector('#qa-save') as HTMLButtonElement;
  saveBtn.addEventListener('click', async () => {
    const category = (bodyEl.querySelector('#qa-category') as HTMLSelectElement).value;
    const title = (bodyEl.querySelector('#qa-title') as HTMLInputElement).value.trim();
    const amount = Number((bodyEl.querySelector('#qa-amount') as HTMLInputElement).value);
    const currency = currencySel.value;
    const dateVal = (bodyEl.querySelector('#qa-date') as HTMLInputElement).value || null;
    const memo = (bodyEl.querySelector('#qa-memo') as HTMLInputElement).value.trim() || null;

    if (!category) { alert('카테고리를 선택해주세요.'); return; }
    if (!title) { alert('내용을 입력해주세요.'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { alert('금액을 입력해주세요.'); return; }
    if (payerSet.size === 0) { alert('결제한 사람을 선택해주세요.'); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';
    lastUsedCurrency = currency;

    const payerIds = Array.from(payerSet);

    if (splitMode === 'PERSONAL' && payerIds.length > 1) {
      // 개인 지출을 여러 명 배치 입력 — 선택한 인원 수만큼 각자의 개인 지출로 나눠서 저장
      // (같은 금액을 n빵하는 게 아니라, 각자 같은 금액을 따로 결제한 것으로 기록)
      const payloads = await Promise.all(
        payerIds.map((uid) => buildExpensePayload({ category, title, amount, currency, expenseDate: dateVal, isPaid, splitMode, payer: uid, split: new Set([uid]), memo }))
      );
      const { data, error } = await supabase.from('trip_expenses').insert(payloads).select();
      saveBtn.disabled = false;
      saveBtn.textContent = '저장';
      if (error) {
        console.error('지출 추가 실패:', error.message);
        alert('저장에 실패했어요. supabase/trip_expenses.sql 마이그레이션이 실행됐는지 확인해주세요.');
        return;
      }
      if (data) expenses.push(...(data as TripExpense[]));
      resetForm();
      flashEl.textContent = payloads.length + '건 저장했어요';
    } else {
      const payload = await buildExpensePayload({ category, title, amount, currency, expenseDate: dateVal, isPaid, splitMode, payer: payerIds[0] ?? null, split, memo });
      const { data, error } = await supabase.from('trip_expenses').insert(payload).select().single();
      saveBtn.disabled = false;
      saveBtn.textContent = '저장';
      if (error) {
        console.error('지출 추가 실패:', error.message);
        alert('저장에 실패했어요. supabase/trip_expenses.sql 마이그레이션이 실행됐는지 확인해주세요.');
        return;
      }
      if (data) expenses.push(data as TripExpense);
      resetForm();
      flashEl.textContent = '저장했어요';
    }
    setTimeout(() => { flashEl.textContent = ''; }, 1500);
    renderOverviewData();
  });
}

/* ══════════════════════ 지출 내역 탭 ══════════════════════ */

function matchesFilter(e: TripExpense): boolean {
  if (statusFilter === 'PLANNED' && e.is_paid) return false;
  if (statusFilter === 'PAID' && !e.is_paid) return false;
  if (splitModeFilter !== 'ALL' && modeOf(e) !== splitModeFilter) return false;
  if (categoryFilter !== 'ALL' && e.category !== categoryFilter) return false;
  if (searchQuery) {
    const haystack = [e.title, e.memo, memberName(e.paid_by)].filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(searchQuery)) return false;
  }
  return true;
}

function expenseRowHtml(e: TripExpense): string {
  const cat = (EXPENSE_CATEGORIES as readonly string[]).includes(e.category) ? (e.category as ExpenseCategory) : 'ETC';
  const meta = CATEGORY_META[cat];
  const krw = krwOf(e);
  const mode = modeOf(e);

  let amountPart: string;
  if (e.currency === 'KRW') {
    amountPart = '<span class="ex-item-amount">' + fmtKRW(e.amount) + '</span>';
  } else {
    const sub = krw != null
      ? '<span class="ex-item-krw"' + (e.fx_source === 'fallback' ? ' title="참고용 환율로 환산된 금액이에요"' : '') + '>≈ ' + fmtKRW(krw) + (e.fx_source === 'fallback' ? '*' : '') + '</span>'
      : '<span class="ex-item-krw is-na">환산 불가</span>';
    amountPart = '<span class="ex-item-amount">' + escapeHtml(fmtAmount(e.amount, e.currency)) + '</span>' + sub;
  }

  const statusBadge = e.is_paid
    ? '<span class="ex-stamp is-paid">PAID</span>'
    : '<span class="ex-stamp">예정</span>';
  const modeBadge = '<span class="ex-mode-badge ex-mode-' + mode.toLowerCase() + '">' + SPLIT_MODE_LABEL[mode] + '</span>';

  const memo = e.memo ? '<span class="ex-item-memo">' + escapeHtml(e.memo) + '</span>' : '';

  return [
    '<div class="ex-item" data-id="' + e.id + '">',
    '  <span class="ex-item-cat" style="color:' + meta.color + '" title="' + meta.label + '">' + meta.icon + '</span>',
    '  <div class="ex-item-main">',
    '    <div class="ex-item-title-row"><span class="ex-item-title">' + escapeHtml(e.title) + '</span>' + statusBadge + modeBadge + '</div>',
    '    <div class="ex-item-meta">' + avatarHtml(e.paid_by, 'sm', e.paid_by_name, e.paid_by_avatar) + '<span>' + escapeHtml(e.paid_by ? memberName(e.paid_by) : (e.paid_by_name || '결제 미지정')) + '</span>' + memo + '</div>',
    '  </div>',
    '  <div class="ex-item-right">' + amountPart + '</div>',
    '</div>',
  ].join('');
}

/** 개인 지출을 여러 명 배치로 등록하면 같은 제목·금액의 행이 인원수만큼 생기는데,
 *  화면에는 "N명"으로 묶어 한 줄로 보여주고 펼치면 개별 항목이 나오게 한다.
 *  공동 지출은 원래 결제자가 한 명뿐이라 그룹화 대상이 아니다(항목별 고유 키 부여). */
function batchGroupKey(e: TripExpense): string {
  return [e.title, e.amount, e.currency, e.category, e.expense_date ?? '', e.is_paid ? '1' : '0'].join('|');
}

function groupExpenseRows(items: TripExpense[]): TripExpense[][] {
  const map = new Map<string, TripExpense[]>();
  const order: string[] = [];
  for (const e of items) {
    const key = modeOf(e) === 'PERSONAL' ? 'batch:' + batchGroupKey(e) : 'single:' + e.id;
    if (!map.has(key)) { map.set(key, []); order.push(key); }
    map.get(key)!.push(e);
  }
  return order.map((k) => map.get(k)!);
}

function avatarStackHtml(userIds: Array<string | null>, max = 4): string {
  const shown = userIds.slice(0, max);
  const overflow = userIds.length - shown.length;
  const itemsHtml = shown.map((uid) => '<span class="ex-avatar-stack-item">' + avatarHtml(uid, 'sm') + '</span>').join('');
  const overflowHtml = overflow > 0 ? '<span class="ex-avatar-stack-item ex-avatar-stack-overflow"><span class="ex-avatar ex-avatar-sm">+' + overflow + '</span></span>' : '';
  return '<span class="ex-avatar-stack">' + itemsHtml + overflowHtml + '</span>';
}

/** group.length === 1이면 평범한 단일 행, 2개 이상이면 "N명" 요약 행 + 펼침 토글 */
function expenseGroupRowHtml(group: TripExpense[]): string {
  if (group.length === 1) return expenseRowHtml(group[0]);

  const first = group[0];
  const cat = (EXPENSE_CATEGORIES as readonly string[]).includes(first.category) ? (first.category as ExpenseCategory) : 'ETC';
  const meta = CATEGORY_META[cat];
  const key = batchGroupKey(first);
  const expanded = expandedBatchGroups.has(key);
  const krwList = group.map(krwOf);
  const anyMissing = krwList.some((v) => v == null);
  const totalKrw = krwList.reduce((acc: number, v) => acc + (v ?? 0), 0);

  let amountPart: string;
  if (first.currency === 'KRW') {
    amountPart = '<span class="ex-item-amount">' + fmtKRW(first.amount) + '</span><span class="ex-item-krw">1인당 · 총 ' + fmtKRW(totalKrw) + '</span>';
  } else {
    const totalText = anyMissing ? '환산 불가' : '≈ ' + fmtKRW(totalKrw);
    amountPart = '<span class="ex-item-amount">' + escapeHtml(fmtAmount(first.amount, first.currency)) + '</span><span class="ex-item-krw">1인당 · 총 ' + totalText + '</span>';
  }

  const statusBadge = first.is_paid ? '<span class="ex-stamp is-paid">PAID</span>' : '<span class="ex-stamp">예정</span>';
  const modeBadge = '<span class="ex-mode-badge ex-mode-personal">' + SPLIT_MODE_LABEL.PERSONAL + '</span>';
  const memo = first.memo ? '<span class="ex-item-memo">' + escapeHtml(first.memo) + '</span>' : '';

  const header = [
    '<div class="ex-item ex-item-groupheader" data-groupkey="' + escapeHtml(key) + '">',
    '  <span class="ex-item-cat" style="color:' + meta.color + '" title="' + meta.label + '">' + meta.icon + '</span>',
    '  <div class="ex-item-main">',
    '    <div class="ex-item-title-row"><span class="ex-item-title">' + escapeHtml(first.title) + '</span>' + statusBadge + modeBadge + '</div>',
    '    <div class="ex-item-meta">' + avatarStackHtml(group.map((g) => g.paid_by)) + '<span>' + group.length + '명</span>' + memo + '</div>',
    '  </div>',
    '  <div class="ex-item-right">' + amountPart + '</div>',
    '  <span class="ex-item-expand-icon">' + (expanded ? IC_CHEV_UP : IC_CHEV_DOWN) + '</span>',
    '</div>',
  ].join('');

  const childrenHtml = expanded
    ? '<div class="ex-item-group-children">' + group.map(expenseRowHtml).join('') + '</div>'
    : '';

  return header + childrenHtml;
}

/** 그룹 요약 행(펼침 토글) 클릭 바인딩 — 개별 항목 클릭(수정 열기)과는 분리되어 있음 */
function bindGroupToggles(container: ParentNode, onToggle: () => void): void {
  container.querySelectorAll('.ex-item-groupheader[data-groupkey]').forEach((row) => {
    row.addEventListener('click', () => {
      const key = (row as HTMLElement).dataset.groupkey!;
      if (expandedBatchGroups.has(key)) expandedBatchGroups.delete(key);
      else expandedBatchGroups.add(key);
      onToggle();
    });
  });
}

function sortExpenses(items: TripExpense[]): TripExpense[] {
  const arr = [...items];
  if (sortMode === 'amount_desc') arr.sort((a, b) => (krwOf(b) ?? 0) - (krwOf(a) ?? 0));
  else arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return arr;
}

function listFilterBarHtml(): string {
  const statusOptions = [
    { v: 'ALL', l: '전체' }, { v: 'PLANNED', l: '예정' }, { v: 'PAID', l: '결제 완료' },
  ].map((o) => '<option value="' + o.v + '"' + (statusFilter === o.v ? ' selected' : '') + '>' + o.l + '</option>').join('');

  const splitOptions = [
    { v: 'ALL', l: '전체 구분' }, { v: 'SHARED', l: '공동 지출' }, { v: 'PERSONAL', l: '개인 지출' },
  ].map((o) => '<option value="' + o.v + '"' + (splitModeFilter === o.v ? ' selected' : '') + '>' + o.l + '</option>').join('');

  const catOptions = '<option value="ALL"' + (categoryFilter === 'ALL' ? ' selected' : '') + '>전체 카테고리</option>' +
    EXPENSE_CATEGORIES.map((cat) => '<option value="' + cat + '"' + (categoryFilter === cat ? ' selected' : '') + '>' + CATEGORY_META[cat].label + '</option>').join('');

  const sortOptions = [
    { v: 'created_desc', l: '최신순' }, { v: 'amount_desc', l: '금액순' },
  ].map((o) => '<option value="' + o.v + '"' + (sortMode === o.v ? ' selected' : '') + '>' + o.l + '</option>').join('');

  return [
    '<div class="ex-filterbar">',
    '  <select class="ex-filter-select" id="lf-status">' + statusOptions + '</select>',
    '  <select class="ex-filter-select" id="lf-splitmode">' + splitOptions + '</select>',
    '  <select class="ex-filter-select" id="lf-category">' + catOptions + '</select>',
    '  <select class="ex-filter-select" id="lf-sort">' + sortOptions + '</select>',
    '  <div class="ex-filter-search"><input type="text" id="lf-search" placeholder="내용, 메모, 결제자 검색" value="' + escapeHtml(searchQuery) + '" /></div>',
    '</div>',
  ].join('\n');
}

function listBodyHtml(): string {
  const filtered = sortExpenses(expenses.filter(matchesFilter));

  if (expenses.length === 0) {
    return [
      '<div class="ex-empty">',
      '  <div class="ex-empty-icon">' + IC_WALLET + '</div>',
      '  <div class="ex-empty-text">아직 입력한 지출이 없어요</div>',
      '  <div class="ex-empty-hint">항공권·숙소처럼 확정된 비용부터 담아보세요. 여행 중엔 휴대폰으로 바로 기록할 수 있어요.</div>',
      '</div>',
    ].join('');
  }
  if (filtered.length === 0) {
    return '<div class="ex-empty"><div class="ex-empty-text">조건에 맞는 지출이 없어요</div></div>';
  }

  const shown = filtered.slice(0, listPageSize);
  const groups = new Map<string, TripExpense[]>();
  for (const e of shown) {
    const key = e.expense_date ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  const keys = sortMode === 'amount_desc'
    ? Array.from(groups.keys()) // 금액순 정렬일 땐 이미 정렬된 순서를 그대로 유지(날짜로 재정렬하지 않음)
    : Array.from(groups.keys()).sort((a, b) => {
        if (a === '') return 1;
        if (b === '') return -1;
        return b.localeCompare(a);
      });

  const groupsHtml = keys.map((key) => {
    const items = groups.get(key)!;
    const groupSum = items.reduce((acc, e) => acc + (krwOf(e) ?? 0), 0);
    return [
      '<div class="ex-group">',
      '  <div class="ex-group-header"><span class="ex-group-date">' + (key ? fmtDateLabel(key) : '날짜 미정') + '</span><span class="ex-group-sum">' + fmtKRW(groupSum) + '</span></div>',
      groupExpenseRows(items).map(expenseGroupRowHtml).join(''),
      '</div>',
    ].join('\n');
  }).join('\n');

  const moreBtn = filtered.length > shown.length
    ? '<button type="button" class="ex-loadmore" id="ex-loadmore">더보기 (' + (filtered.length - shown.length) + '건 남음)</button>'
    : '';

  return '<div class="ex-list">' + groupsHtml + '</div>' + moreBtn;
}

function mountListTab(panel: HTMLElement): void {
  panel.innerHTML = [
    '<div class="ex-list-section">',
    listFilterBarHtml(),
    '  <div id="ex-list-body">' + listBodyHtml() + '</div>',
    '</div>',
  ].join('\n');
  bindListTab(panel);
}

function refreshListBody(panel: HTMLElement): void {
  const bodyEl = panel.querySelector('#ex-list-body');
  if (bodyEl) bodyEl.innerHTML = listBodyHtml();
  bindListBody(panel);
}

function bindListTab(panel: HTMLElement): void {
  (panel.querySelector('#lf-status') as HTMLSelectElement)?.addEventListener('change', (ev) => {
    statusFilter = (ev.target as HTMLSelectElement).value as StatusFilter;
    listPageSize = 20;
    refreshListBody(panel);
  });
  (panel.querySelector('#lf-splitmode') as HTMLSelectElement)?.addEventListener('change', (ev) => {
    splitModeFilter = (ev.target as HTMLSelectElement).value as SplitModeFilter;
    listPageSize = 20;
    refreshListBody(panel);
  });
  (panel.querySelector('#lf-category') as HTMLSelectElement)?.addEventListener('change', (ev) => {
    categoryFilter = (ev.target as HTMLSelectElement).value as CategoryFilter;
    listPageSize = 20;
    refreshListBody(panel);
  });
  (panel.querySelector('#lf-sort') as HTMLSelectElement)?.addEventListener('change', (ev) => {
    sortMode = (ev.target as HTMLSelectElement).value as SortMode;
    refreshListBody(panel);
  });
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  (panel.querySelector('#lf-search') as HTMLInputElement)?.addEventListener('input', (ev) => {
    const value = (ev.target as HTMLInputElement).value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = value.trim().toLowerCase();
      listPageSize = 20;
      refreshListBody(panel);
    }, 200);
  });
  bindListBody(panel);
}

function bindListBody(panel: HTMLElement): void {
  panel.querySelector('#ex-loadmore')?.addEventListener('click', () => {
    listPageSize += 20;
    refreshListBody(panel);
  });
  // 그룹 요약 행은 펼침 토글이므로, 개별 항목 클릭(수정 열기)에서는 제외
  panel.querySelectorAll('.ex-item[data-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const id = (row as HTMLElement).dataset.id!;
      const e = expenses.find((x) => x.id === id);
      if (e) openSheet(e);
    });
  });
  bindGroupToggles(panel, () => refreshListBody(panel));
}

/* ══════════════════════ 정산 탭 ══════════════════════ */

function mountSettlementTab(panel: HTMLElement): void {
  const { rows, transfers, skipped } = computeSettlement();
  const hasPaid = expenses.some((e) => e.is_paid && modeOf(e) === 'SHARED');

  let body: string;
  if (!hasPaid) {
    body = '<div class="ex-settle-empty">결제 완료로 표시한 공동 지출부터 정산에 반영돼요.<br/>여행 중 휴대폰으로 기록하면서 바로 정산해보세요.</div>';
  } else {
    const memberRows = rows.filter((r) => members.some((m) => m.user_id === r.userId)).map((r) => {
      const balCls = r.balance > 0.5 ? ' is-plus' : r.balance < -0.5 ? ' is-minus' : '';
      const balText = Math.abs(r.balance) < 0.5 ? '정산 완료' : (r.balance > 0 ? '+' : '−') + fmtKRW(Math.abs(r.balance));
      return [
        '<div class="ex-settle-row">',
        avatarHtml(r.userId, 'md'),
        '  <div class="ex-settle-info">',
        '    <span class="ex-settle-name">' + escapeHtml(memberName(r.userId)) + '</span>',
        '    <span class="ex-settle-detail">낸 돈 ' + fmtKRW(r.paidSum) + ' · 부담 ' + fmtKRW(r.shareSum) + '</span>',
        '  </div>',
        '  <span class="ex-settle-balance' + balCls + '">' + balText + '</span>',
        '</div>',
      ].join('');
    }).join('');

    const transferRows = transfers.length > 0
      ? '<div class="ex-settle-transfers"><div class="ex-settle-transfers-title">' + IC_SWAP + ' 이렇게 보내면 정산 끝</div>' +
        transfers.map((t) =>
          '<div class="ex-transfer"><span class="ex-transfer-from">' + escapeHtml(memberName(t.from)) + '</span><span class="ex-transfer-arrow">→</span><span class="ex-transfer-to">' + escapeHtml(memberName(t.to)) + '</span><span class="ex-transfer-amount">' + fmtKRW(t.amount) + '</span></div>'
        ).join('') +
        '<button type="button" class="al-btn-primary ex-settle-cta" id="ex-settle-share">' + IC_SWAP + ' 정산 내역 공유하기</button>' +
        '</div>'
      : '<div class="ex-settle-done">모두 정산이 맞아요 ✓</div>';

    const skippedNote = skipped > 0
      ? '<div class="ex-settle-note">결제 멤버가 없거나 환산 불가라 정산에서 빠진 항목 ' + skipped + '건</div>'
      : '';

    body = memberRows + transferRows + skippedNote;
  }

  panel.innerHTML = [
    '<div class="ex-card al-glass ex-settle-full">',
    body,
    '</div>',
  ].join('\n');

  panel.querySelector('#ex-settle-share')?.addEventListener('click', shareSettlement);
}

/* ══════════════════════ 동행 탭 ══════════════════════ */

function mountCompanionsTab(panel: HTMLElement): void {
  const { rows } = computeSettlement();
  const cards = members.map((m) => {
    const r = rows.find((x) => x.userId === m.user_id) ?? { paidSum: 0, shareSum: 0, balance: 0, paidCount: 0 };
    const balCls = r.balance > 0.5 ? ' is-plus' : r.balance < -0.5 ? ' is-minus' : '';
    const balText = Math.abs(r.balance) < 0.5 ? '정산 완료' : (r.balance > 0 ? '+' : '−') + fmtKRW(Math.abs(r.balance));
    return [
      '<div class="ex-comp-card al-glass" data-uid="' + m.user_id + '">',
      '  ' + avatarHtml(m.user_id, 'lg'),
      '  <div class="ex-comp-name">' + escapeHtml(m.display_name || '멤버') + '</div>',
      '  <div class="ex-comp-stats">',
      '    <div class="ex-comp-stat"><span class="ex-comp-stat-label">낸 돈</span><span class="ex-comp-stat-value">' + fmtKRW(r.paidSum) + '</span></div>',
      '    <div class="ex-comp-stat"><span class="ex-comp-stat-label">부담액</span><span class="ex-comp-stat-value">' + fmtKRW(r.shareSum) + '</span></div>',
      '  </div>',
      '  <div class="ex-comp-balance' + balCls + '">' + balText + '</div>',
      '  <div class="ex-comp-count">결제 ' + r.paidCount + '건</div>',
      '</div>',
    ].join('\n');
  }).join('\n');

  panel.innerHTML = '<div class="ex-comp-grid">' + (cards || '<div class="ex-empty"><div class="ex-empty-text">아직 트립 멤버가 없어요</div></div>') + '</div>';

  panel.querySelectorAll('.ex-comp-card').forEach((card) => {
    card.addEventListener('click', () => {
      // 그 사람이 결제한 지출로 목록 필터 이동 — 카테고리 필터는 초기화
      categoryFilter = 'ALL';
      switchTab('list');
      searchQuery = ((card as HTMLElement).querySelector('.ex-comp-name')?.textContent || '').trim().toLowerCase();
      const searchInput = rootEl?.querySelector('#lf-search') as HTMLInputElement | null;
      if (searchInput) searchInput.value = searchQuery;
      refreshListBody(rootEl!.querySelector('#ex-tabpanel') as HTMLElement);
    });
  });
}

/* ══════════════════════ 설정 탭 ══════════════════════ */

function mountSettingsTab(panel: HTMLElement): void {
  const totalBudget = getTotalBudget();
  const categorySum = getCategoryBudgetSum();

  const categoryRows = EXPENSE_CATEGORIES.map((cat) => {
    const meta = CATEGORY_META[cat];
    const val = budgets.get(cat) ?? null;
    return [
      '<div class="ex-settings-row">',
      '  <span class="ex-settings-icon" style="color:' + meta.color + '">' + meta.icon + '</span>',
      '  <span class="ex-settings-label">' + meta.label + '</span>',
      '  <input type="number" inputmode="numeric" class="ex-settings-input" data-cat="' + cat + '" value="' + (val ?? '') + '" placeholder="예산(원)" />',
      '  <button type="button" class="ex-settings-save" data-cat="' + cat + '">저장</button>',
      '</div>',
    ].join('');
  }).join('\n');

  panel.innerHTML = [
    '<div class="ex-card al-glass ex-settings-card">',
    '  <div class="ex-card-title al-sign-label">총 예산</div>',
    '  <div class="ex-settings-hint">카테고리별 예산 배분과는 별개인, 이번 여행의 전체 목표 예산이에요. 만원 단위로 입력하세요.</div>',
    '  <div class="ex-settings-total-row">',
    '    <div class="ex-settings-total-inputwrap">',
    '      <input type="number" inputmode="numeric" class="ex-settings-total-input" id="settings-total" value="' + (totalBudget != null ? Math.round(totalBudget / 10000) : '') + '" placeholder="예: 150" />',
    '      <span class="ex-settings-unit">만원</span>',
    '    </div>',
    '    <button type="button" class="al-btn-primary ex-settings-save-total" id="settings-total-save">저장</button>',
    '  </div>',
    '  <span class="ex-settings-hint-inline" id="settings-total-hint"></span>',
    '</div>',
    '<div class="ex-card al-glass ex-settings-card">',
    '  <div class="ex-card-title al-sign-label">카테고리별 예산</div>',
    '  <div class="ex-settings-hint">카테고리 예산 합계: ' + fmtKRW(categorySum) + '</div>',
    '  <div class="ex-settings-list">' + categoryRows + '</div>',
    '</div>',
  ].join('\n');

  const commitBudget = async (category: string, raw: string, multiplier = 1, hintEl?: HTMLElement | null): Promise<void> => {
    const num = raw.trim() === '' ? null : Number(raw);
    if (num != null && !Number.isFinite(num)) return;
    const value = num == null ? null : Math.max(0, Math.round(num * multiplier));
    budgets.set(category, value);
    if (hintEl) { hintEl.textContent = '저장 중...'; }
    const { error } = await supabase
      .from('trip_expense_budgets')
      .upsert({ trip_id: currentTripId, category, amount_krw: value, updated_at: new Date().toISOString() }, { onConflict: 'trip_id,category' });
    if (hintEl) {
      hintEl.textContent = error ? '저장 실패' : '저장됨';
      setTimeout(() => { if (hintEl) hintEl.textContent = ''; }, 1500);
    }
    if (error) console.error('예산 저장 실패:', error.message);
  };

  panel.querySelector('#settings-total-save')?.addEventListener('click', () => {
    const input = panel.querySelector('#settings-total') as HTMLInputElement;
    void commitBudget(BUDGET_TOTAL_KEY, input.value, 10000, panel.querySelector('#settings-total-hint') as HTMLElement);
  });
  panel.querySelectorAll('.ex-settings-save').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = (btn as HTMLElement).dataset.cat!;
      const input = panel.querySelector('.ex-settings-input[data-cat="' + cat + '"]') as HTMLInputElement;
      void commitBudget(cat, input.value, 1);
      const original = btn.textContent;
      btn.textContent = '저장됨';
      setTimeout(() => { btn.textContent = original; }, 1200);
    });
  });
}

/* ══════════════════════ 입력 시트 (수정 모달 / 모바일 추가) ══════════════════════ */

function closeSheet(): void {
  rootEl?.querySelector('#ex-sheet-overlay')?.classList.remove('is-open');
  const sheet = rootEl?.querySelector('#ex-sheet');
  sheet?.classList.remove('is-open');
  if (sheet) (sheet as HTMLElement).innerHTML = '';
}

function openSheet(editing: TripExpense | null): void {
  if (!rootEl) return;
  const overlay = rootEl.querySelector('#ex-sheet-overlay') as HTMLElement;
  const sheet = rootEl.querySelector('#ex-sheet') as HTMLElement;
  const me = store.get('user');

  const selectedCategory = (editing?.category as ExpenseCategory) ?? 'ETC';
  const selectedCurrency = editing?.currency ?? lastUsedCurrency;
  const selectedPayer = editing?.paid_by ?? me?.id ?? null;
  const selectedMode: SplitMode = editing ? modeOf(editing) : 'SHARED';
  const selectedSplit = new Set<string>(
    editing?.split_user_ids && editing.split_user_ids.length > 0
      ? editing.split_user_ids
      : members.map((m) => m.user_id)
  );

  const catChips = EXPENSE_CATEGORIES.map((cat) => {
    const meta = CATEGORY_META[cat];
    return '<button type="button" class="ex-sheet-cat' + (cat === selectedCategory ? ' is-active' : '') + '" data-cat="' + cat + '"><span class="ex-chip-dot" style="background:' + meta.color + '"></span>' + meta.label + '</button>';
  }).join('');

  const currencyOptions = CURRENCIES.map((c) =>
    '<option value="' + c.code + '"' + (c.code === selectedCurrency ? ' selected' : '') + '>' + c.code + '</option>'
  ).join('');

  const payerChips = members.map((m) =>
    '<button type="button" class="ex-sheet-member' + (m.user_id === selectedPayer ? ' is-active' : '') + '" data-uid="' + m.user_id + '">' + avatarHtml(m.user_id, 'sm') + '<span>' + escapeHtml(m.display_name || '멤버') + '</span></button>'
  ).join('');

  const splitChips = members.map((m) =>
    '<button type="button" class="ex-sheet-member ex-sheet-split' + (selectedSplit.has(m.user_id) ? ' is-active' : '') + '" data-uid="' + m.user_id + '">' + avatarHtml(m.user_id, 'sm') + '<span>' + escapeHtml(m.display_name || '멤버') + '</span></button>'
  ).join('');

  sheet.innerHTML = [
    '<div class="ex-sheet-header">',
    '  <span class="ex-sheet-title">' + (editing ? '지출 수정' : '지출 추가') + '</span>',
    (editing ? '<button type="button" class="ex-sheet-delete" id="ex-sheet-delete" title="삭제">' + IC_TRASH + '</button>' : ''),
    '  <button type="button" class="ex-sheet-close" id="ex-sheet-close">' + IC_CLOSE + '</button>',
    '</div>',
    '<div class="ex-sheet-body">',
    '  <label class="ex-field"><span class="ex-field-label">내용</span>',
    '    <input type="text" class="ex-field-input" id="ex-f-title" placeholder="예: 방콕행 항공권" value="' + escapeHtml(editing?.title ?? '') + '" maxlength="80" />',
    '  </label>',
    '  <div class="ex-field-row">',
    '    <label class="ex-field ex-field-amount"><span class="ex-field-label">금액</span>',
    '      <input type="number" inputmode="decimal" class="ex-field-input" id="ex-f-amount" placeholder="0" min="0" step="any" value="' + (editing != null ? editing.amount : '') + '" />',
    '    </label>',
    '    <label class="ex-field ex-field-currency"><span class="ex-field-label">통화</span>',
    '      <select class="ex-field-input" id="ex-f-currency">' + currencyOptions + '</select>',
    '    </label>',
    '  </div>',
    '  <div class="ex-fx-hint" id="ex-f-fxhint"></div>',
    '  <div class="ex-field"><span class="ex-field-label">카테고리</span>',
    '    <div class="ex-sheet-cats" id="ex-f-cats">' + catChips + '</div>',
    '  </div>',
    '  <div class="ex-field"><span class="ex-field-label">구분</span>',
    '    <div class="ex-splitmode-toggle" id="ex-f-splitmode">',
    '      <button type="button" class="ex-splitmode-btn' + (selectedMode === 'SHARED' ? ' is-active' : '') + '" data-mode="SHARED">공동 지출</button>',
    '      <button type="button" class="ex-splitmode-btn' + (selectedMode === 'PERSONAL' ? ' is-active' : '') + '" data-mode="PERSONAL">개인 지출</button>',
    '    </div>',
    '  </div>',
    '  <div class="ex-field-row">',
    '    <label class="ex-field"><span class="ex-field-label">날짜 <em>(선택)</em></span>',
    '      <input type="date" class="ex-field-input" id="ex-f-date" value="' + (editing?.expense_date ?? '') + '" />',
    '    </label>',
    '    <label class="ex-field ex-field-paid"><span class="ex-field-label">결제 완료</span>',
    '      <button type="button" class="ex-paid-toggle' + (editing?.is_paid ? ' is-on' : '') + '" id="ex-f-paid" role="switch" aria-checked="' + (editing?.is_paid ? 'true' : 'false') + '"><span class="ex-paid-knob"></span></button>',
    '    </label>',
    '  </div>',
    '  <div class="ex-field"><span class="ex-field-label">결제한 사람</span>',
    '    <div class="ex-sheet-members" id="ex-f-payer">' + payerChips + '</div>',
    '  </div>',
    '  <div class="ex-field" id="ex-f-split-wrap"><span class="ex-field-label">함께 나눌 멤버 <em>(정산에 사용)</em></span>',
    '    <div class="ex-sheet-members" id="ex-f-split">' + splitChips + '</div>',
    '  </div>',
    '  <label class="ex-field"><span class="ex-field-label">메모 <em>(선택)</em></span>',
    '    <input type="text" class="ex-field-input" id="ex-f-memo" placeholder="예: 왕복 · 수하물 포함" value="' + escapeHtml(editing?.memo ?? '') + '" maxlength="120" />',
    '  </label>',
    '  <button type="button" class="al-btn-primary ex-sheet-save" id="ex-sheet-save">' + (editing ? '수정 저장' : '추가하기') + '</button>',
    '</div>',
  ].join('\n');

  overlay.classList.add('is-open');
  sheet.classList.add('is-open');

  let category = selectedCategory;
  const payerSet = new Set<string>(selectedPayer ? [selectedPayer] : []);
  let isPaid = editing?.is_paid ?? false;
  let splitMode = selectedMode;
  const split = selectedSplit;
  // 기존 항목 수정은 항상 1개 행만 바꾸므로 결제자 다중 선택(배치 입력)은 새로 추가할 때만 허용
  const allowMultiPayer = !editing;

  const splitWrap = sheet.querySelector('#ex-f-split-wrap') as HTMLElement;
  const updateSplitVisibility = (): void => {
    splitWrap.style.display = splitMode === 'SHARED' ? '' : 'none';
  };
  updateSplitVisibility();

  const fxHint = sheet.querySelector('#ex-f-fxhint') as HTMLElement;
  const currencySel = sheet.querySelector('#ex-f-currency') as HTMLSelectElement;
  const updateFxHint = async (): Promise<void> => {
    const cur = currencySel.value;
    if (cur === 'KRW') { fxHint.textContent = ''; return; }
    fxHint.textContent = '환율 확인 중...';
    const { rate, source } = await fetchRate(cur);
    if (currencySel.value !== cur) return;
    if (rate == null) {
      fxHint.textContent = '환율을 가져오지 못했어요 — 원화 환산 없이 저장돼요';
    } else {
      fxHint.textContent = '1 ' + cur + ' ≈ ' + fmtKRW(rate) + (source === 'fallback' ? ' (참고용 환율)' : '');
    }
  };
  void updateFxHint();
  currencySel.addEventListener('change', () => void updateFxHint());

  sheet.querySelector('#ex-sheet-close')?.addEventListener('click', closeSheet);
  overlay.onclick = closeSheet;

  sheet.querySelectorAll('.ex-sheet-cat').forEach((btn) => {
    btn.addEventListener('click', () => {
      category = (btn as HTMLElement).dataset.cat as ExpenseCategory;
      sheet.querySelectorAll('.ex-sheet-cat').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    });
  });

  const setPayerActive = (): void => {
    sheet.querySelectorAll('#ex-f-payer .ex-sheet-member').forEach((b) => {
      b.classList.toggle('is-active', payerSet.has((b as HTMLElement).dataset.uid!));
    });
  };

  sheet.querySelectorAll('#ex-f-splitmode .ex-splitmode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      splitMode = (btn as HTMLElement).dataset.mode as SplitMode;
      sheet.querySelectorAll('#ex-f-splitmode .ex-splitmode-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      updateSplitVisibility();
      if (splitMode === 'SHARED' && payerSet.size > 1) {
        const keep = payerSet.values().next().value as string;
        payerSet.clear();
        payerSet.add(keep);
        setPayerActive();
      }
    });
  });

  // 결제한 사람 — 새로 추가할 때의 개인 지출은 "각자 결제"를 배치 입력할 수 있게 여러 명
  // 선택 가능(체크박스). 그 외(공동 지출, 또는 기존 항목 수정)는 한 명만(라디오)
  sheet.querySelectorAll('#ex-f-payer .ex-sheet-member').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid = (btn as HTMLElement).dataset.uid!;
      if (allowMultiPayer && splitMode === 'PERSONAL') {
        if (payerSet.has(uid)) {
          if (payerSet.size <= 1) return;
          payerSet.delete(uid);
        } else {
          payerSet.add(uid);
        }
      } else {
        payerSet.clear();
        payerSet.add(uid);
      }
      setPayerActive();
    });
  });

  sheet.querySelectorAll('#ex-f-split .ex-sheet-member').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid = (btn as HTMLElement).dataset.uid!;
      if (split.has(uid)) {
        if (split.size <= 1) return;
        split.delete(uid);
        btn.classList.remove('is-active');
      } else {
        split.add(uid);
        btn.classList.add('is-active');
      }
    });
  });

  const paidToggle = sheet.querySelector('#ex-f-paid') as HTMLButtonElement;
  paidToggle.addEventListener('click', () => {
    isPaid = !isPaid;
    paidToggle.classList.toggle('is-on', isPaid);
    paidToggle.setAttribute('aria-checked', String(isPaid));
  });

  sheet.querySelector('#ex-sheet-delete')?.addEventListener('click', async () => {
    if (!editing) return;
    if (!window.confirm('이 지출을 삭제할까요?')) return;
    expenses = expenses.filter((x) => x.id !== editing.id);
    closeSheet();
    refreshActiveTabData();
    const { error } = await supabase.from('trip_expenses').delete().eq('id', editing.id);
    if (error) console.error('지출 삭제 실패:', error.message);
  });

  const saveBtn = sheet.querySelector('#ex-sheet-save') as HTMLButtonElement;
  saveBtn.addEventListener('click', async () => {
    const title = (sheet.querySelector('#ex-f-title') as HTMLInputElement).value.trim();
    const amount = Number((sheet.querySelector('#ex-f-amount') as HTMLInputElement).value);
    const currency = currencySel.value;
    const dateVal = (sheet.querySelector('#ex-f-date') as HTMLInputElement).value || null;
    const memo = (sheet.querySelector('#ex-f-memo') as HTMLInputElement).value.trim() || null;

    if (!title) { alert('내용을 입력해주세요.'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { alert('금액을 입력해주세요.'); return; }
    if (payerSet.size === 0) { alert('결제한 사람을 선택해주세요.'); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';
    lastUsedCurrency = currency;

    const payerIds = Array.from(payerSet);

    if (editing) {
      const payload = await buildExpensePayload({ category, title, amount, currency, expenseDate: dateVal, isPaid, splitMode, payer: payerIds[0] ?? null, split, memo });
      const { data, error } = await supabase.from('trip_expenses').update(payload).eq('id', editing.id).select().single();
      if (error) {
        console.error('지출 수정 실패:', error.message);
        alert('저장에 실패했어요. 잠시 후 다시 시도해주세요.');
        saveBtn.disabled = false;
        saveBtn.textContent = '수정 저장';
        return;
      }
      const idx = expenses.findIndex((x) => x.id === editing.id);
      if (idx !== -1 && data) expenses[idx] = data as TripExpense;
    } else if (splitMode === 'PERSONAL' && payerIds.length > 1) {
      // 개인 지출을 여러 명 배치 입력 — n빵이 아니라 각자 같은 금액을 따로 결제한 것으로 기록
      const payloads = await Promise.all(
        payerIds.map((uid) => buildExpensePayload({ category, title, amount, currency, expenseDate: dateVal, isPaid, splitMode, payer: uid, split: new Set([uid]), memo }))
      );
      const { data, error } = await supabase.from('trip_expenses').insert(payloads).select();
      if (error) {
        console.error('지출 추가 실패:', error.message);
        alert('저장에 실패했어요. supabase/trip_expenses.sql 마이그레이션이 실행됐는지 확인해주세요.');
        saveBtn.disabled = false;
        saveBtn.textContent = '추가하기';
        return;
      }
      if (data) expenses.push(...(data as TripExpense[]));
    } else {
      const payload = await buildExpensePayload({ category, title, amount, currency, expenseDate: dateVal, isPaid, splitMode, payer: payerIds[0] ?? null, split, memo });
      const { data, error } = await supabase.from('trip_expenses').insert(payload).select().single();
      if (error) {
        console.error('지출 추가 실패:', error.message);
        alert('저장에 실패했어요. supabase/trip_expenses.sql 마이그레이션이 실행됐는지 확인해주세요.');
        saveBtn.disabled = false;
        saveBtn.textContent = '추가하기';
        return;
      }
      if (data) expenses.push(data as TripExpense);
    }

    closeSheet();
    refreshActiveTabData();
  });
}

/* ══════════════════════ 초기화 / 정리 ══════════════════════ */

export function teardownExpense(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  if (outsideClickHandler) {
    document.removeEventListener('click', outsideClickHandler);
    outsideClickHandler = null;
  }
  rootEl = null;
  currentTripId = '';
  members = [];
  expenses = [];
  budgets = new Map();
  activeTab = 'overview';
  categoryViewMode = 'budget';
  openCategoryMenu = null;
  statusFilter = 'ALL';
  splitModeFilter = 'ALL';
  categoryFilter = 'ALL';
  sortMode = 'created_desc';
  searchQuery = '';
  listPageSize = 20;
  editingBudgetCategory = null;
  expandedBatchGroups = new Set();
  copyPopoverOpen = false;
  copySelectedMemberIds = new Set();
  copySelectionTouched = false;
  tipIndex = 0;
  quickAddMode = 'direct';
}

export async function renderExpenseContent(container: HTMLElement, tripId: string): Promise<void> {
  teardownExpense();
  currentTripId = tripId;

  container.innerHTML = [
    '<div class="ex-wrap">',
    '  <div class="ex-tabs" id="ex-tabs">' + tabsHtml() + '</div>',
    '  <div class="ex-tabpanel" id="ex-tabpanel"><div class="ex-placeholder-loading">불러오는 중...</div></div>',
    '  <button type="button" class="ex-fab" id="ex-fab" aria-label="지출 추가">' + IC_PLUS + '</button>',
    '  <div class="ex-sheet-overlay" id="ex-sheet-overlay"></div>',
    '  <div class="ex-sheet" id="ex-sheet"></div>',
    '</div>',
  ].join('\n');
  rootEl = container.querySelector('.ex-wrap') as HTMLElement;

  bindTabsNav();
  rootEl.querySelector('#ex-fab')?.addEventListener('click', () => openSheet(null));

  outsideClickHandler = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest('.ex-catcard-top') && openCategoryMenu !== null) {
      openCategoryMenu = null;
      const catgridEl = rootEl?.querySelector('#ex-catgrid');
      if (catgridEl) { catgridEl.innerHTML = EXPENSE_CATEGORIES.map(categoryCardHtml).join(''); bindOverviewData(); }
    }
    if (!(e.target as HTMLElement).closest('.ex-stat-card-usage') && copyPopoverOpen) {
      copyPopoverOpen = false;
      renderCopyPopover();
    }
  };
  document.addEventListener('click', outsideClickHandler);

  // 트립(인원수)·멤버·지출·예산을 병렬 로드
  const [tripRes, memberRes, expenseRes, budgetRes] = await Promise.all([
    supabase.from('trips').select('headcount').eq('id', tripId).single(),
    supabase.from('trip_members').select('user_id, display_name, avatar_url').eq('trip_id', tripId).order('joined_at', { ascending: true }),
    supabase.from('trip_expenses').select('*').eq('trip_id', tripId).order('created_at', { ascending: true }).limit(1000),
    supabase.from('trip_expense_budgets').select('*').eq('trip_id', tripId),
  ]);

  members = memberRes.data ?? [];
  headcount = tripRes.data?.headcount ?? Math.max(1, members.length);
  // trip_expenses 테이블이 아직 마이그레이션 전이어도 빈 상태로 동작 (graceful degradation)
  if (expenseRes.error) console.error('지출 로드 실패:', expenseRes.error.message);
  expenses = (expenseRes.data ?? []) as TripExpense[];
  if (budgetRes.error) console.error('예산 로드 실패:', budgetRes.error.message);
  for (const b of (budgetRes.data ?? []) as TripExpenseBudget[]) budgets.set(b.category, b.amount_krw);

  mountTab();

  channel = supabase
    .channel('trip-expenses:' + tripId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trip_expenses', filter: 'trip_id=eq.' + tripId },
      (payload) => {
        if (payload.eventType === 'INSERT') {
          const row = payload.new as TripExpense;
          if (!expenses.some((e) => e.id === row.id)) expenses.push(row);
        } else if (payload.eventType === 'UPDATE') {
          const row = payload.new as TripExpense;
          const idx = expenses.findIndex((e) => e.id === row.id);
          if (idx !== -1) expenses[idx] = row;
          else expenses.push(row);
        } else if (payload.eventType === 'DELETE') {
          const oldRow = payload.old as { id: string };
          expenses = expenses.filter((e) => e.id !== oldRow.id);
        }
        refreshActiveTabData();
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trip_expense_budgets', filter: 'trip_id=eq.' + tripId },
      (payload) => {
        if (payload.eventType === 'DELETE') return;
        const row = payload.new as TripExpenseBudget;
        budgets.set(row.category, row.amount_krw);
        refreshActiveTabData();
      }
    )
    .subscribe();
}
