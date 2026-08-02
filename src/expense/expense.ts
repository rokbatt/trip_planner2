/**
 * EXPENSE 게이트 — 여행 예산·지출을 멤버들과 함께 계획하고, 여행 중엔 휴대폰으로
 * 기록해가는 탭.
 *
 * 화면 구성 (위 → 아래):
 *  1) 요약 스트립 — 총 예산 / 계획 합계 / 결제 완료 / 1인당(인원수 기준) + 예산 게이지
 *  2) 오버뷰 카드 — 카테고리별 도넛 차트 + 카테고리별 예산·지출 목록(예산 인라인 편집)
 *  3) 정산 카드 — 결제 완료 항목 기준 멤버별 낸 돈/부담액/차액 + 최소 송금 제안
 *  4) 지출 목록 — 날짜별 그룹, 상태(예정/결제완료)·카테고리 필터, 항목 클릭으로 수정
 *
 * 원칙:
 *  - 집계·차트는 전부 원화(amount_krw) 기준. 현지 통화 입력은 저장 시점 환율로 환산해
 *    환율·출처(fx_rate/fx_source)를 함께 저장하고, 참고용 환율이면 화면에 그렇다고 표시(3-1)
 *  - 환율은 기존 /api/exchange-rate 프록시 재사용 + 세션 캐시 (3-2)
 *  - 다른 멤버의 추가/수정이 realtime으로 즉시 반영 (links.ts와 같은 패턴)
 */
import { supabase } from '../supabase';
import { store } from '../store';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { TripExpense, TripExpenseBudget } from '../types/database';
import './expense.css';

/* ── 카테고리 정의 ──
 * 색은 CVD(색약) 검증을 통과한 7색 고정 순서 — 도넛 조각·범례·칩이 전부 이 순서를 따른다.
 * 순서 자체가 인접 색 구분성의 안전장치이므로 임의로 섞지 말 것. */
export const EXPENSE_CATEGORIES = ['FLIGHT', 'STAY', 'TRANSPORT', 'FOOD', 'ACTIVITY', 'SHOPPING', 'ETC'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const IC_PLANE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>';
const IC_BED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8M2 20v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3M2 20h20M6 10V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"/></svg>';
const IC_BUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M3 11h18M7 18v2M17 18v2"/><circle cx="7.5" cy="14.5" r="0.8" fill="currentColor"/><circle cx="16.5" cy="14.5" r="0.8" fill="currentColor"/></svg>';
const IC_FORK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v6a2 2 0 0 0 4 0V3M9 11v10M17 3c-1.5 1-2 3-2 5s1 3 2 3 2-1 2-3-.5-4-2-5zM17 11v10"/></svg>';
const IC_TICKET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.5a1.5 1.5 0 0 0 0 3V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a1.5 1.5 0 0 0 0-3V9z"/></svg>';
const IC_BAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h12l1 13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L6 7z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/></svg>';
const IC_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
const IC_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const IC_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>';
const IC_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
const IC_WALLET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z"/><path d="M18 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2"/><circle cx="16.5" cy="13.5" r="1" fill="currentColor" stroke="none"/></svg>';
const IC_SWAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h13M14 3l4 4-4 4M20 17H7M10 13l-4 4 4 4"/></svg>';

const CATEGORY_META: Record<ExpenseCategory, { label: string; color: string; icon: string }> = {
  FLIGHT:    { label: '항공',        color: '#2a78d6', icon: IC_PLANE },
  STAY:      { label: '숙소',        color: '#eb6834', icon: IC_BED },
  TRANSPORT: { label: '교통',        color: '#1baf7a', icon: IC_BUS },
  FOOD:      { label: '식비',        color: '#eda100', icon: IC_FORK },
  ACTIVITY:  { label: '관광·액티비티', color: '#e87ba4', icon: IC_TICKET },
  SHOPPING:  { label: '쇼핑',        color: '#008300', icon: IC_BAG },
  ETC:       { label: '기타',        color: '#4a3aa7', icon: IC_DOTS },
};

/* 여행에서 실제로 자주 등장하는 통화만 — 자유 입력이 아니라 유한 목록 */
const CURRENCIES: Array<{ code: string; symbol: string }> = [
  { code: 'KRW', symbol: '₩' },
  { code: 'THB', symbol: '฿' },
  { code: 'JPY', symbol: '¥' },
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'TWD', symbol: 'NT$' },
  { code: 'VND', symbol: '₫' },
  { code: 'SGD', symbol: 'S$' },
  { code: 'HKD', symbol: 'HK$' },
  { code: 'PHP', symbol: '₱' },
  { code: 'IDR', symbol: 'Rp' },
];

interface MemberLite {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

type StatusFilter = 'ALL' | 'PLANNED' | 'PAID';
type CategoryFilter = ExpenseCategory | 'ALL';

/* ── 모듈 상태 ── */
let rootEl: HTMLElement | null = null;
let currentTripId = '';
let headcount = 1;
let members: MemberLite[] = [];
let expenses: TripExpense[] = [];
let budgets = new Map<string, number | null>();
let statusFilter: StatusFilter = 'ALL';
let categoryFilter: CategoryFilter = 'ALL';
let channel: RealtimeChannel | null = null;
let editingBudgetCategory: ExpenseCategory | null = null;
let lastUsedCurrency = 'KRW';

/* 환율 캐시 — 같은 세션에서 통화당 1회만 조회 */
const fxCache = new Map<string, { rate: number | null; source: string }>();

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function fmtKRW(n: number): string {
  return '₩' + Math.round(n).toLocaleString('ko-KR');
}

function symbolOf(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code + ' ';
}

function fmtAmount(amount: number, currency: string): string {
  const num = currency === 'KRW' || currency === 'JPY' || currency === 'VND' || currency === 'IDR'
    ? Math.round(amount).toLocaleString('ko-KR')
    : amount.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  return symbolOf(currency) + num;
}

/** 집계에 쓸 원화 금액 — KRW 입력은 amount 그대로, 그 외엔 저장된 환산값 */
function krwOf(e: TripExpense): number | null {
  if (e.currency === 'KRW') return e.amount;
  return e.amount_krw;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function fmtDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return (d.getMonth() + 1) + '.' + String(d.getDate()).padStart(2, '0') + ' (' + WEEKDAYS[d.getDay()] + ')';
}

function memberName(userId: string | null): string {
  if (!userId) return '미지정';
  return members.find((m) => m.user_id === userId)?.display_name || '멤버';
}

function avatarHtml(userId: string | null, fallbackName?: string | null, fallbackAvatar?: string | null): string {
  const m = userId ? members.find((mm) => mm.user_id === userId) : null;
  const name = m?.display_name || fallbackName || '?';
  const url = m?.avatar_url || fallbackAvatar || null;
  const inner = url
    ? '<img src="' + escapeHtml(url) + '" alt="" referrerpolicy="no-referrer" />'
    : escapeHtml(name.charAt(0));
  return '<span class="ex-avatar" title="' + escapeHtml(name) + '">' + inner + '</span>';
}

/* ══════════════════════ 집계 ══════════════════════ */

function totalsByCategory(): Map<ExpenseCategory, number> {
  const map = new Map<ExpenseCategory, number>();
  for (const cat of EXPENSE_CATEGORIES) map.set(cat, 0);
  for (const e of expenses) {
    const krw = krwOf(e);
    if (krw == null) continue;
    const cat = (EXPENSE_CATEGORIES as readonly string[]).includes(e.category) ? (e.category as ExpenseCategory) : 'ETC';
    map.set(cat, (map.get(cat) ?? 0) + krw);
  }
  return map;
}

function sumBudget(): number | null {
  let sum = 0;
  let hasAny = false;
  for (const cat of EXPENSE_CATEGORIES) {
    const b = budgets.get(cat);
    if (b != null) { sum += b; hasAny = true; }
  }
  return hasAny ? sum : null;
}

function sumAll(): number {
  return expenses.reduce((acc, e) => acc + (krwOf(e) ?? 0), 0);
}

function sumPaid(): number {
  return expenses.filter((e) => e.is_paid).reduce((acc, e) => acc + (krwOf(e) ?? 0), 0);
}

/** 환산 불가(환율 없음)로 집계에서 빠진 항목 수 — 화면에 정직하게 표시 */
function unconvertedCount(): number {
  return expenses.filter((e) => krwOf(e) == null).length;
}

/* ══════════════════════ 정산 ══════════════════════ */

interface SettleRow {
  userId: string;
  paidSum: number;
  shareSum: number;
  balance: number; // + 받을 돈, - 보낼 돈
}

function computeSettlement(): { rows: SettleRow[]; transfers: Array<{ from: string; to: string; amount: number }>; skipped: number } {
  const byUser = new Map<string, SettleRow>();
  const ensure = (uid: string): SettleRow => {
    let r = byUser.get(uid);
    if (!r) { r = { userId: uid, paidSum: 0, shareSum: 0, balance: 0 }; byUser.set(uid, r); }
    return r;
  };
  members.forEach((m) => ensure(m.user_id));

  let skipped = 0;
  const allIds = members.map((m) => m.user_id);
  for (const e of expenses) {
    if (!e.is_paid) continue;
    const krw = krwOf(e);
    if (krw == null || !e.paid_by) { skipped++; continue; }
    const splitIds = e.split_user_ids && e.split_user_ids.length > 0 ? e.split_user_ids : allIds;
    if (splitIds.length === 0) { skipped++; continue; }
    ensure(e.paid_by).paidSum += krw;
    const share = krw / splitIds.length;
    splitIds.forEach((uid) => { ensure(uid).shareSum += share; });
  }

  const rows = Array.from(byUser.values());
  rows.forEach((r) => { r.balance = r.paidSum - r.shareSum; });

  // 최소 송금 제안 — 가장 많이 받을 사람과 가장 많이 보낼 사람을 그리디로 매칭
  const creditors = rows.filter((r) => r.balance > 0.5).map((r) => ({ uid: r.userId, amt: r.balance })).sort((a, b) => b.amt - a.amt);
  const debtors = rows.filter((r) => r.balance < -0.5).map((r) => ({ uid: r.userId, amt: -r.balance })).sort((a, b) => b.amt - a.amt);
  const transfers: Array<{ from: string; to: string; amount: number }> = [];
  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const pay = Math.min(creditors[ci].amt, debtors[di].amt);
    transfers.push({ from: debtors[di].uid, to: creditors[ci].uid, amount: pay });
    creditors[ci].amt -= pay;
    debtors[di].amt -= pay;
    if (creditors[ci].amt < 0.5) ci++;
    if (debtors[di].amt < 0.5) di++;
  }
  return { rows, transfers, skipped };
}

/* ══════════════════════ 도넛 차트 (SVG) ══════════════════════ */

const DONUT_SIZE = 220;
const DONUT_R = 82;
const DONUT_STROKE = 30;

function polar(cx: number, cy: number, r: number, angleRad: number): { x: number; y: number } {
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const s = polar(cx, cy, r, start);
  const e = polar(cx, cy, r, end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return 'M ' + s.x.toFixed(2) + ' ' + s.y.toFixed(2) + ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + e.x.toFixed(2) + ' ' + e.y.toFixed(2);
}

function donutSvg(): string {
  const totals = totalsByCategory();
  const total = Array.from(totals.values()).reduce((a, b) => a + b, 0);
  const c = DONUT_SIZE / 2;

  const centerText = [
    '<text x="' + c + '" y="' + (c - 8) + '" text-anchor="middle" class="ex-donut-center-label">지출 합계</text>',
    '<text x="' + c + '" y="' + (c + 16) + '" text-anchor="middle" class="ex-donut-center-value">' + escapeHtml(fmtKRW(total)) + '</text>',
  ].join('');

  if (total <= 0) {
    return [
      '<svg viewBox="0 0 ' + DONUT_SIZE + ' ' + DONUT_SIZE + '" class="ex-donut" role="img" aria-label="카테고리별 지출 없음">',
      '<circle cx="' + c + '" cy="' + c + '" r="' + DONUT_R + '" fill="none" stroke="rgba(130,150,170,0.14)" stroke-width="' + DONUT_STROKE + '"/>',
      centerText,
      '</svg>',
    ].join('');
  }

  const segs: string[] = [];
  const gapRad = 2 / DONUT_R; // 조각 사이 2px 간격(마크 스페이서)
  let angle = -Math.PI / 2;
  for (const cat of EXPENSE_CATEGORIES) {
    const v = totals.get(cat) ?? 0;
    if (v <= 0) continue;
    const frac = v / total;
    const sweep = frac * Math.PI * 2;
    const meta = CATEGORY_META[cat];
    const pct = Math.round(frac * 100);
    if (frac > 0.999) {
      // 단일 카테고리 100%는 arc가 그려지지 않으므로 원으로
      segs.push('<circle cx="' + c + '" cy="' + c + '" r="' + DONUT_R + '" fill="none" stroke="' + meta.color + '" stroke-width="' + DONUT_STROKE + '" class="ex-donut-seg" data-cat="' + cat + '"><title>' + escapeHtml(meta.label + ' ' + fmtKRW(v) + ' (' + pct + '%)') + '</title></circle>');
    } else {
      const start = angle + gapRad / 2;
      const end = angle + sweep - gapRad / 2;
      if (end > start) {
        segs.push('<path d="' + arcPath(c, c, DONUT_R, start, end) + '" fill="none" stroke="' + meta.color + '" stroke-width="' + DONUT_STROKE + '" stroke-linecap="butt" class="ex-donut-seg' + (categoryFilter === cat ? ' is-active' : '') + '" data-cat="' + cat + '"><title>' + escapeHtml(meta.label + ' ' + fmtKRW(v) + ' (' + pct + '%)') + '</title></path>');
      }
    }
    angle += sweep;
  }

  return [
    '<svg viewBox="0 0 ' + DONUT_SIZE + ' ' + DONUT_SIZE + '" class="ex-donut" role="img" aria-label="카테고리별 지출 비중">',
    segs.join(''),
    centerText,
    '</svg>',
  ].join('');
}

/* ══════════════════════ 렌더 ══════════════════════ */

function summaryHtml(): string {
  const budget = sumBudget();
  const all = sumAll();
  const paid = sumPaid();
  const remaining = budget != null ? budget - all : null;
  const people = Math.max(1, headcount);
  const perPerson = all / people;
  const pct = budget != null && budget > 0 ? Math.min(100, Math.round((all / budget) * 100)) : null;
  const over = remaining != null && remaining < 0;

  const gauge = budget != null && budget > 0
    ? [
        '<div class="ex-gauge" role="img" aria-label="예산 대비 ' + (pct ?? 0) + '% 사용">',
        '  <div class="ex-gauge-fill' + (over ? ' is-over' : '') + '" style="width:' + (pct ?? 0) + '%"></div>',
        '</div>',
        '<div class="ex-gauge-caption">예산의 <strong>' + (budget > 0 ? Math.round((all / budget) * 100) : 0) + '%</strong> 계획됨</div>',
      ].join('')
    : '<div class="ex-gauge-caption ex-gauge-caption-empty">카테고리별 예산을 입력하면 게이지가 표시돼요</div>';

  const unconverted = unconvertedCount();
  const unconvertedNote = unconverted > 0
    ? '<div class="ex-summary-note">환율을 가져오지 못해 합계에서 빠진 항목 ' + unconverted + '건</div>'
    : '';

  return [
    '<div class="ex-summary al-glass">',
    '  <div class="ex-summary-stats">',
    '    <div class="ex-stat">',
    '      <div class="ex-stat-label">TOTAL BUDGET</div>',
    '      <div class="ex-stat-value">' + (budget != null ? fmtKRW(budget) : '<span class="ex-stat-empty">미설정</span>') + '</div>',
    '      <div class="ex-stat-sub">카테고리 예산 합계</div>',
    '    </div>',
    '    <div class="ex-stat">',
    '      <div class="ex-stat-label">PLANNED</div>',
    '      <div class="ex-stat-value">' + fmtKRW(all) + '</div>',
    '      <div class="ex-stat-sub">예정 + 결제 완료</div>',
    '    </div>',
    '    <div class="ex-stat">',
    '      <div class="ex-stat-label">PAID</div>',
    '      <div class="ex-stat-value">' + fmtKRW(paid) + '</div>',
    '      <div class="ex-stat-sub">결제 완료</div>',
    '    </div>',
    '    <div class="ex-stat">',
    '      <div class="ex-stat-label">REMAINING</div>',
    '      <div class="ex-stat-value' + (over ? ' is-over' : '') + '">' + (remaining != null ? fmtKRW(remaining) : '<span class="ex-stat-empty">—</span>') + '</div>',
    '      <div class="ex-stat-sub">' + (over ? '예산 초과' : '남은 예산') + '</div>',
    '    </div>',
    '    <div class="ex-stat">',
    '      <div class="ex-stat-label">PER PERSON</div>',
    '      <div class="ex-stat-value">' + fmtKRW(perPerson) + '</div>',
    '      <div class="ex-stat-sub">' + people + '명 기준</div>',
    '    </div>',
    '  </div>',
    gauge,
    unconvertedNote,
    '</div>',
  ].join('\n');
}

function categoryRowsHtml(): string {
  const totals = totalsByCategory();
  const total = Array.from(totals.values()).reduce((a, b) => a + b, 0);

  return EXPENSE_CATEGORIES.map((cat) => {
    const meta = CATEGORY_META[cat];
    const spent = totals.get(cat) ?? 0;
    const budget = budgets.get(cat) ?? null;
    const pctOfTotal = total > 0 ? Math.round((spent / total) * 100) : 0;
    const pctOfBudget = budget != null && budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
    const overBudget = budget != null && budget > 0 && spent > budget;
    const editing = editingBudgetCategory === cat;

    const budgetPart = editing
      ? '<span class="ex-cat-budget-edit"><input type="number" inputmode="numeric" class="ex-cat-budget-input" data-cat="' + cat + '" value="' + (budget ?? '') + '" placeholder="예산(원)" /><button type="button" class="ex-cat-budget-save" data-cat="' + cat + '">저장</button></span>'
      : '<button type="button" class="ex-cat-budget-btn" data-cat="' + cat + '" title="클릭해서 예산 입력">' + (budget != null ? '예산 ' + fmtKRW(budget) : '예산 입력') + '</button>';

    return [
      '<div class="ex-cat-row' + (categoryFilter === cat ? ' is-active' : '') + '" data-cat="' + cat + '">',
      '  <span class="ex-cat-dot" style="background:' + meta.color + '"></span>',
      '  <span class="ex-cat-icon" style="color:' + meta.color + '">' + meta.icon + '</span>',
      '  <div class="ex-cat-main">',
      '    <div class="ex-cat-top">',
      '      <span class="ex-cat-label">' + meta.label + '</span>',
      '      <span class="ex-cat-amount">' + fmtKRW(spent) + '<span class="ex-cat-pct">' + pctOfTotal + '%</span></span>',
      '    </div>',
      '    <div class="ex-cat-bar"><div class="ex-cat-bar-fill' + (overBudget ? ' is-over' : '') + '" style="width:' + pctOfBudget + '%;background:' + meta.color + '"></div></div>',
      '    <div class="ex-cat-bottom">' + budgetPart + (overBudget ? '<span class="ex-cat-over">초과</span>' : '') + '</div>',
      '  </div>',
      '</div>',
    ].join('');
  }).join('\n');
}

function overviewHtml(): string {
  return [
    '<div class="ex-card al-glass ex-overview">',
    '  <div class="ex-card-title al-sign-label">BY CATEGORY</div>',
    '  <div class="ex-overview-body">',
    '    <div class="ex-donut-wrap" id="ex-donut-wrap">' + donutSvg() + '</div>',
    '    <div class="ex-cat-list" id="ex-cat-list">' + categoryRowsHtml() + '</div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

function settlementHtml(): string {
  const { rows, transfers, skipped } = computeSettlement();
  const hasPaid = expenses.some((e) => e.is_paid);

  let body: string;
  if (!hasPaid) {
    body = '<div class="ex-settle-empty">결제 완료로 표시한 지출부터 정산에 반영돼요.<br/>여행 중 휴대폰으로 기록하면서 바로 정산해보세요.</div>';
  } else {
    const memberRows = rows
      .filter((r) => members.some((m) => m.user_id === r.userId))
      .map((r) => {
        const balCls = r.balance > 0.5 ? ' is-plus' : r.balance < -0.5 ? ' is-minus' : '';
        const balText = Math.abs(r.balance) < 0.5 ? '정산 완료' : (r.balance > 0 ? '+' : '−') + fmtKRW(Math.abs(r.balance)).slice(0);
        return [
          '<div class="ex-settle-row">',
          avatarHtml(r.userId),
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
        ).join('') + '</div>'
      : '<div class="ex-settle-done">모두 정산이 맞아요 ✓</div>';

    const skippedNote = skipped > 0
      ? '<div class="ex-settle-note">결제 멤버가 없거나 환산 불가라 정산에서 빠진 항목 ' + skipped + '건</div>'
      : '';

    body = memberRows + transferRows + skippedNote;
  }

  return [
    '<div class="ex-card al-glass ex-settle">',
    '  <div class="ex-card-title al-sign-label">SETTLEMENT</div>',
    body,
    '</div>',
  ].join('\n');
}

function matchesFilter(e: TripExpense): boolean {
  if (statusFilter === 'PLANNED' && e.is_paid) return false;
  if (statusFilter === 'PAID' && !e.is_paid) return false;
  if (categoryFilter !== 'ALL' && e.category !== categoryFilter) return false;
  return true;
}

function expenseRowHtml(e: TripExpense): string {
  const cat = (EXPENSE_CATEGORIES as readonly string[]).includes(e.category) ? (e.category as ExpenseCategory) : 'ETC';
  const meta = CATEGORY_META[cat];
  const krw = krwOf(e);

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

  const memo = e.memo ? '<span class="ex-item-memo">' + escapeHtml(e.memo) + '</span>' : '';

  return [
    '<div class="ex-item" data-id="' + e.id + '">',
    '  <span class="ex-item-cat" style="color:' + meta.color + '" title="' + meta.label + '">' + meta.icon + '</span>',
    '  <div class="ex-item-main">',
    '    <div class="ex-item-title-row"><span class="ex-item-title">' + escapeHtml(e.title) + '</span>' + statusBadge + '</div>',
    '    <div class="ex-item-meta">' + avatarHtml(e.paid_by, e.paid_by_name, e.paid_by_avatar) + '<span>' + escapeHtml(e.paid_by ? memberName(e.paid_by) : (e.paid_by_name || '결제 미지정')) + '</span>' + memo + '</div>',
    '  </div>',
    '  <div class="ex-item-right">' + amountPart + '</div>',
    '</div>',
  ].join('');
}

function listHtml(): string {
  const filtered = expenses.filter(matchesFilter);

  const chips = (['ALL', ...EXPENSE_CATEGORIES] as CategoryFilter[]).map((key) => {
    const count = key === 'ALL' ? expenses.length : expenses.filter((e) => e.category === key).length;
    const label = key === 'ALL' ? '전체' : CATEGORY_META[key as ExpenseCategory].label;
    const dot = key === 'ALL' ? '' : '<span class="ex-chip-dot" style="background:' + CATEGORY_META[key as ExpenseCategory].color + '"></span>';
    return '<button type="button" class="ex-chip' + (categoryFilter === key ? ' is-active' : '') + '" data-category="' + key + '">' + dot + '<span>' + label + '</span><span class="ex-chip-count">' + count + '</span></button>';
  }).join('');

  const segments = [
    { key: 'ALL', label: '전체' },
    { key: 'PLANNED', label: '예정' },
    { key: 'PAID', label: '결제 완료' },
  ].map((s) =>
    '<button type="button" class="ex-seg' + (statusFilter === s.key ? ' is-active' : '') + '" data-status="' + s.key + '">' + s.label + '</button>'
  ).join('');

  let listBody: string;
  if (expenses.length === 0) {
    listBody = [
      '<div class="ex-empty">',
      '  <div class="ex-empty-icon">' + IC_WALLET + '</div>',
      '  <div class="ex-empty-text">아직 입력한 지출이 없어요</div>',
      '  <div class="ex-empty-hint">항공권·숙소처럼 확정된 비용부터 담아보세요. 여행 중엔 휴대폰으로 바로 기록할 수 있어요.</div>',
      '</div>',
    ].join('');
  } else if (filtered.length === 0) {
    listBody = '<div class="ex-empty"><div class="ex-empty-text">조건에 맞는 지출이 없어요</div></div>';
  } else {
    // 날짜별 그룹 — 날짜 있는 항목은 여행 순서(오름차순), 날짜 미정은 맨 뒤
    const groups = new Map<string, TripExpense[]>();
    for (const e of filtered) {
      const key = e.expense_date ?? '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
    const keys = Array.from(groups.keys()).sort((a, b) => {
      if (a === '') return 1;
      if (b === '') return -1;
      return a.localeCompare(b);
    });
    listBody = keys.map((key) => {
      const items = groups.get(key)!;
      const groupSum = items.reduce((acc, e) => acc + (krwOf(e) ?? 0), 0);
      return [
        '<div class="ex-group">',
        '  <div class="ex-group-header"><span class="ex-group-date">' + (key ? fmtDateLabel(key) : '날짜 미정') + '</span><span class="ex-group-sum">' + fmtKRW(groupSum) + '</span></div>',
        items.map(expenseRowHtml).join(''),
        '</div>',
      ].join('\n');
    }).join('\n');
  }

  return [
    '<div class="ex-list-section">',
    '  <div class="ex-toolbar">',
    '    <div class="ex-segmented">' + segments + '</div>',
    '    <div class="ex-chips">' + chips + '</div>',
    '    <button type="button" class="ex-add-btn" id="ex-add-btn">' + IC_PLUS + ' 지출 추가</button>',
    '  </div>',
    '  <div class="ex-list" id="ex-list">' + listBody + '</div>',
    '</div>',
  ].join('\n');
}

function renderAll(): void {
  if (!rootEl) return;
  const summaryEl = rootEl.querySelector('#ex-summary');
  const overviewEl = rootEl.querySelector('#ex-overview');
  const settleEl = rootEl.querySelector('#ex-settle');
  const listEl = rootEl.querySelector('#ex-list-region');
  if (summaryEl) summaryEl.innerHTML = summaryHtml();
  if (overviewEl) overviewEl.innerHTML = overviewHtml();
  if (settleEl) settleEl.innerHTML = settlementHtml();
  if (listEl) listEl.innerHTML = listHtml();
  bindDynamic();
}

/* ══════════════════════ 이벤트 바인딩 ══════════════════════ */

function bindDynamic(): void {
  if (!rootEl) return;

  // 도넛 조각 hover → 해당 카테고리 행 미리보기 강조(클릭 상태는 안 건드림), 클릭 → 필터 토글
  rootEl.querySelectorAll('.ex-donut-seg').forEach((seg) => {
    const cat = (seg as SVGElement).dataset.cat as ExpenseCategory;
    seg.addEventListener('mouseenter', () => {
      rootEl?.querySelector('.ex-cat-row[data-cat="' + cat + '"]')?.classList.add('is-hot');
    });
    seg.addEventListener('mouseleave', () => {
      rootEl?.querySelector('.ex-cat-row[data-cat="' + cat + '"]')?.classList.remove('is-hot');
    });
    seg.addEventListener('click', () => {
      categoryFilter = categoryFilter === cat ? 'ALL' : cat;
      renderAll();
    });
  });

  // 카테고리 행 클릭 → 필터 토글 (예산 편집 영역 제외)
  rootEl.querySelectorAll('.ex-cat-row').forEach((row) => {
    row.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('.ex-cat-bottom')) return;
      const cat = (row as HTMLElement).dataset.cat as ExpenseCategory;
      categoryFilter = categoryFilter === cat ? 'ALL' : cat;
      renderAll();
    });
  });

  // 예산 인라인 편집
  rootEl.querySelectorAll('.ex-cat-budget-btn').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      editingBudgetCategory = (btn as HTMLElement).dataset.cat as ExpenseCategory;
      renderAll();
      const input = rootEl?.querySelector('.ex-cat-budget-input') as HTMLInputElement | null;
      input?.focus();
      input?.select();
    });
  });
  const commitBudget = async (cat: ExpenseCategory, raw: string): Promise<void> => {
    const value = raw.trim() === '' ? null : Math.max(0, Math.round(Number(raw)));
    if (value != null && !Number.isFinite(value)) return;
    editingBudgetCategory = null;
    budgets.set(cat, value);
    renderAll();
    const { error } = await supabase
      .from('trip_expense_budgets')
      .upsert({ trip_id: currentTripId, category: cat, amount_krw: value, updated_at: new Date().toISOString() }, { onConflict: 'trip_id,category' });
    if (error) console.error('예산 저장 실패:', error.message);
  };
  rootEl.querySelectorAll('.ex-cat-budget-input').forEach((el) => {
    const input = el as HTMLInputElement;
    const cat = input.dataset.cat as ExpenseCategory;
    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') void commitBudget(cat, input.value);
      if ((ev as KeyboardEvent).key === 'Escape') { editingBudgetCategory = null; renderAll(); }
    });
  });
  rootEl.querySelectorAll('.ex-cat-budget-save').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const cat = (btn as HTMLElement).dataset.cat as ExpenseCategory;
      const input = rootEl?.querySelector('.ex-cat-budget-input[data-cat="' + cat + '"]') as HTMLInputElement | null;
      if (input) void commitBudget(cat, input.value);
    });
  });

  // 상태 세그먼트 / 카테고리 칩
  rootEl.querySelectorAll('.ex-seg').forEach((btn) => {
    btn.addEventListener('click', () => {
      statusFilter = (btn as HTMLElement).dataset.status as StatusFilter;
      renderAll();
    });
  });
  rootEl.querySelectorAll('.ex-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      categoryFilter = (btn as HTMLElement).dataset.category as CategoryFilter;
      renderAll();
    });
  });

  // 지출 추가/수정
  rootEl.querySelector('#ex-add-btn')?.addEventListener('click', () => openSheet(null));
  rootEl.querySelectorAll('.ex-item').forEach((row) => {
    row.addEventListener('click', () => {
      const id = (row as HTMLElement).dataset.id!;
      const e = expenses.find((x) => x.id === id);
      if (e) openSheet(e);
    });
  });
}

/* ══════════════════════ 입력 시트 (모달/바텀시트) ══════════════════════ */

async function fetchRate(currency: string): Promise<{ rate: number | null; source: string }> {
  if (currency === 'KRW') return { rate: 1, source: 'live' };
  const cached = fxCache.get(currency);
  if (cached) return cached;
  try {
    const res = await fetch('/api/exchange-rate?from=' + encodeURIComponent(currency));
    const data = (await res.json()) as { rate: number | null; source: string };
    const result = { rate: typeof data.rate === 'number' && data.rate > 0 ? data.rate : null, source: data.source ?? 'unavailable' };
    fxCache.set(currency, result);
    return result;
  } catch {
    return { rate: null, source: 'unavailable' };
  }
}

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
    '<button type="button" class="ex-sheet-member' + (m.user_id === selectedPayer ? ' is-active' : '') + '" data-uid="' + m.user_id + '">' + avatarHtml(m.user_id) + '<span>' + escapeHtml(m.display_name || '멤버') + '</span></button>'
  ).join('');

  const splitChips = members.map((m) =>
    '<button type="button" class="ex-sheet-member ex-sheet-split' + (selectedSplit.has(m.user_id) ? ' is-active' : '') + '" data-uid="' + m.user_id + '">' + avatarHtml(m.user_id) + '<span>' + escapeHtml(m.display_name || '멤버') + '</span></button>'
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
    '  <div class="ex-field"><span class="ex-field-label">함께 나눌 멤버 <em>(정산에 사용)</em></span>',
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
  let payer = selectedPayer;
  let isPaid = editing?.is_paid ?? false;
  const split = selectedSplit;

  const fxHint = sheet.querySelector('#ex-f-fxhint') as HTMLElement;
  const currencySel = sheet.querySelector('#ex-f-currency') as HTMLSelectElement;
  const updateFxHint = async (): Promise<void> => {
    const cur = currencySel.value;
    if (cur === 'KRW') { fxHint.textContent = ''; return; }
    fxHint.textContent = '환율 확인 중...';
    const { rate, source } = await fetchRate(cur);
    if (currencySel.value !== cur) return; // 그 사이 통화가 바뀌었으면 무시
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

  sheet.querySelectorAll('#ex-f-payer .ex-sheet-member').forEach((btn) => {
    btn.addEventListener('click', () => {
      payer = (btn as HTMLElement).dataset.uid!;
      sheet.querySelectorAll('#ex-f-payer .ex-sheet-member').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    });
  });

  sheet.querySelectorAll('#ex-f-split .ex-sheet-member').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid = (btn as HTMLElement).dataset.uid!;
      if (split.has(uid)) {
        if (split.size <= 1) return; // 최소 1명은 남겨야 정산이 성립
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
    renderAll();
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

    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';
    lastUsedCurrency = currency;

    let amountKrw: number | null = Math.round(amount);
    let fxRate: number | null = 1;
    let fxSource: string | null = 'live';
    if (currency !== 'KRW') {
      const { rate, source } = await fetchRate(currency);
      fxRate = rate;
      fxSource = source;
      amountKrw = rate != null ? Math.round(amount * rate) : null;
    }

    const payerMember = payer ? members.find((m) => m.user_id === payer) : null;
    const payload = {
      trip_id: currentTripId,
      category,
      title,
      amount,
      currency,
      amount_krw: amountKrw,
      fx_rate: fxRate,
      fx_source: fxSource,
      expense_date: dateVal,
      is_paid: isPaid,
      paid_by: payer,
      paid_by_name: payerMember?.display_name ?? null,
      paid_by_avatar: payerMember?.avatar_url ?? null,
      split_user_ids: split.size === members.length ? null : Array.from(split),
      memo,
      updated_at: new Date().toISOString(),
    };

    if (editing) {
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
    } else {
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
    renderAll();
  });
}

/* ══════════════════════ 초기화 / 정리 ══════════════════════ */

export function teardownExpense(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  rootEl = null;
  currentTripId = '';
  members = [];
  expenses = [];
  budgets = new Map();
  statusFilter = 'ALL';
  categoryFilter = 'ALL';
  editingBudgetCategory = null;
}

export async function renderExpenseContent(container: HTMLElement, tripId: string): Promise<void> {
  teardownExpense();
  currentTripId = tripId;

  container.innerHTML = [
    '<div class="ex-wrap">',
    '  <div id="ex-summary"></div>',
    '  <div class="ex-grid">',
    '    <div id="ex-overview"></div>',
    '    <div id="ex-settle"></div>',
    '  </div>',
    '  <div id="ex-list-region"></div>',
    '  <button type="button" class="ex-fab" id="ex-fab" aria-label="지출 추가">' + IC_PLUS + '</button>',
    '  <div class="ex-sheet-overlay" id="ex-sheet-overlay"></div>',
    '  <div class="ex-sheet" id="ex-sheet"></div>',
    '</div>',
  ].join('\n');
  rootEl = container.querySelector('.ex-wrap') as HTMLElement;

  rootEl.querySelector('#ex-fab')?.addEventListener('click', () => openSheet(null));

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

  renderAll();

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
        renderAll();
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trip_expense_budgets', filter: 'trip_id=eq.' + tripId },
      (payload) => {
        if (payload.eventType === 'DELETE') return;
        const row = payload.new as TripExpenseBudget;
        budgets.set(row.category, row.amount_krw);
        renderAll();
      }
    )
    .subscribe();
}
