/**
 * 지출 모델 — 돈에 관한 숫자의 **단일 기준**.
 *
 * EXPENSE(데스크톱 대시보드)와 MOBILE 지갑이 같은 지출을 다루므로, 집계·정산·환율 변환은
 * 여기 한 곳에만 둔다. 같은 트립인데 PC의 정산 결과와 폰의 정산 결과가 다르면 그 자체가
 * 버그다 — `timeline/dayModel.ts`가 "하루를 시간축에 올리는 규칙"의 단일 기준인 것과 같은
 * 이유이고 같은 구조다(Claude.md 5-3, 5-4).
 *
 * 표현 계층(마크업·색 토큰·레이아웃)은 각 모듈이 따로 갖는다. 여기엔 DOM이 없다.
 *
 * 원칙 3-1 — 환산에 쓴 환율과 그 출처(`fx_rate`/`fx_source`)를 반드시 함께 저장하고,
 * 환산이 불가능했던 항목은 집계에서 조용히 빼지 않고 `unconvertedCount`로 세어 화면이
 * "몇 건이 빠졌는지" 밝힐 수 있게 한다.
 */

import { supabase } from '../supabase';
import type { Database, TripExpense, TripExpenseBudget } from '../types/database';

type TripExpenseInsert = Database['public']['Tables']['trip_expenses']['Insert'];

/* ══════════════ 카테고리 ══════════════ */

/* 색은 CVD(색약) 검증을 통과한 7색 고정 순서 — 카드·범례·칩이 전부 이 순서를 따른다.
 * 순서 자체가 인접 색 구분성의 안전장치이므로 임의로 섞지 말 것. */
export const EXPENSE_CATEGORIES = ['FLIGHT', 'STAY', 'TRANSPORT', 'FOOD', 'ACTIVITY', 'SHOPPING', 'ETC'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type SplitMode = 'SHARED' | 'PERSONAL';

/** trip_expense_budgets에서 "카테고리별 배분과 별개인 총 예산" lump sum을 저장하는 sentinel 키.
 *  실제 카테고리 목록에 없는 값이라 trip_expenses.category 체크 제약과 절대 충돌하지 않는다. */
export const BUDGET_TOTAL_KEY = 'TOTAL';

const IC_PLANE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>';
const IC_HOTEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15"/><path d="M15 21v-8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v8"/><path d="M7.5 7.5h1M7.5 11h1M7.5 14.5h1M11.5 7.5h1M11.5 11h1M11.5 14.5h1M17.5 14.5h1M17.5 17.5h1"/><path d="M2 21h20"/></svg>';
const IC_BUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M3 11h18M7 18v2M17 18v2"/><circle cx="7.5" cy="14.5" r="0.8" fill="currentColor"/><circle cx="16.5" cy="14.5" r="0.8" fill="currentColor"/></svg>';
const IC_FORK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v6a2 2 0 0 0 4 0V3M9 11v10M17 3c-1.5 1-2 3-2 5s1 3 2 3 2-1 2-3-.5-4-2-5zM17 11v10"/></svg>';
const IC_FERRIS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><circle cx="12" cy="13" r="1.1" fill="currentColor" stroke="none"/><path d="M12 5v16M4 13h16M6.3 7.3l11.4 11.4M17.7 7.3 6.3 18.7"/><path d="M4 21h16"/></svg>';
const IC_BAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h12l1 13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L6 7z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/></svg>';
const IC_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

export const CATEGORY_META: Record<ExpenseCategory, { label: string; color: string; icon: string }> = {
  FLIGHT:    { label: '항공',        color: '#2a78d6', icon: IC_PLANE },
  STAY:      { label: '숙소',        color: '#eb6834', icon: IC_HOTEL },
  TRANSPORT: { label: '교통',        color: '#1baf7a', icon: IC_BUS },
  FOOD:      { label: '식비',        color: '#eda100', icon: IC_FORK },
  ACTIVITY:  { label: '관광·액티비티', color: '#e87ba4', icon: IC_FERRIS },
  SHOPPING:  { label: '쇼핑',        color: '#008300', icon: IC_BAG },
  ETC:       { label: '기타',        color: '#4a3aa7', icon: IC_DOTS },
};

export const SPLIT_MODE_LABEL: Record<SplitMode, string> = { SHARED: '공동 지출', PERSONAL: '개인 지출' };

/* 여행에서 실제로 자주 등장하는 통화만 — 자유 입력이 아니라 유한 목록 */
export const CURRENCIES: Array<{ code: string; symbol: string }> = [
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

/* ══════════════ 타입 ══════════════ */

export interface MemberLite {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * 집계·정산이 필요로 하는 데이터 묶음. 모듈 전역 상태로 두면 두 화면이 같은 전역을 밟게
 * 되므로 명시적으로 넘긴다(dayModel의 DayModelContext와 같은 이유).
 */
export interface ExpenseCtx {
  tripId: string;
  members: MemberLite[];
  expenses: TripExpense[];
  budgets: Map<string, number | null>;
  headcount: number;
}

export interface SettleRow {
  userId: string;
  paidSum: number;
  shareSum: number;
  balance: number; // + 받을 돈, - 보낼 돈
  paidCount: number;
}

export interface Settlement {
  rows: SettleRow[];
  transfers: Array<{ from: string; to: string; amount: number }>;
  /** 환율 없음·결제자 미지정 등으로 정산에서 빠진 항목 수 — 화면이 정직하게 밝힐 수 있게 */
  skipped: number;
}

/* ══════════════ 표시 형식 ══════════════ */

export function fmtKRW(n: number): string {
  return '₩' + Math.round(n).toLocaleString('ko-KR');
}

export function symbolOf(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code + ' ';
}

/** 소수점이 없는 통화(원·엔·동·루피아)는 반올림해서 보여준다 */
export function fmtAmount(amount: number, currency: string): string {
  const num = currency === 'KRW' || currency === 'JPY' || currency === 'VND' || currency === 'IDR'
    ? Math.round(amount).toLocaleString('ko-KR')
    : amount.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  return symbolOf(currency) + num;
}

/** 집계에 쓸 원화 금액 — KRW 입력은 amount 그대로, 그 외엔 저장된 환산값(없으면 null) */
export function krwOf(e: TripExpense): number | null {
  if (e.currency === 'KRW') return e.amount;
  return e.amount_krw;
}

export function modeOf(e: TripExpense): SplitMode {
  return e.split_mode === 'PERSONAL' ? 'PERSONAL' : 'SHARED';
}

export function categoryOf(e: TripExpense): ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(e.category) ? (e.category as ExpenseCategory) : 'ETC';
}

/* ══════════════ 집계 ══════════════ */

export function totalsByCategory(ctx: ExpenseCtx): Map<ExpenseCategory, number> {
  const map = new Map<ExpenseCategory, number>();
  for (const cat of EXPENSE_CATEGORIES) map.set(cat, 0);
  for (const e of ctx.expenses) {
    const krw = krwOf(e);
    if (krw == null) continue;
    const cat = categoryOf(e);
    map.set(cat, (map.get(cat) ?? 0) + krw);
  }
  return map;
}

export function getTotalBudget(ctx: ExpenseCtx): number | null {
  return ctx.budgets.get(BUDGET_TOTAL_KEY) ?? null;
}

export function getCategoryBudgetSum(ctx: ExpenseCtx): number {
  let sum = 0;
  for (const cat of EXPENSE_CATEGORIES) sum += ctx.budgets.get(cat) ?? 0;
  return sum;
}

/** "현재 사용" — 실제로 결제 완료한 금액(예정 항목은 제외) */
export function sumPaid(ctx: ExpenseCtx): number {
  return ctx.expenses.filter((e) => e.is_paid).reduce((acc, e) => acc + (krwOf(e) ?? 0), 0);
}

export function sumPaidByMode(ctx: ExpenseCtx, mode: SplitMode): number {
  return ctx.expenses.filter((e) => e.is_paid && modeOf(e) === mode).reduce((acc, e) => acc + (krwOf(e) ?? 0), 0);
}

/** 특정 날짜(YYYY-MM-DD)에 결제 완료된 금액 — MOBILE 지갑의 "오늘 쓴 돈" */
export function sumPaidOn(ctx: ExpenseCtx, dateISO: string): number {
  return ctx.expenses
    .filter((e) => e.is_paid && e.expense_date === dateISO)
    .reduce((acc, e) => acc + (krwOf(e) ?? 0), 0);
}

/** 환산 불가(환율 없음)로 집계에서 빠진 항목 수 — 화면에 정직하게 표시(원칙 3-1) */
export function unconvertedCount(ctx: ExpenseCtx): number {
  return ctx.expenses.filter((e) => krwOf(e) == null).length;
}

export function memberName(ctx: ExpenseCtx, userId: string | null): string {
  if (!userId) return '미지정';
  return ctx.members.find((m) => m.user_id === userId)?.display_name || '멤버';
}

/* ══════════════ 정산 ══════════════ */

/**
 * 결제 완료 + 공동 지출 항목만 정산에 넣고, 최소 송금 조합을 그리디로 매칭한다.
 * 개인 지출(PERSONAL)과 예정 항목은 정산 대상이 아니다.
 */
export function computeSettlement(ctx: ExpenseCtx): Settlement {
  const byUser = new Map<string, SettleRow>();
  const ensure = (uid: string): SettleRow => {
    let r = byUser.get(uid);
    if (!r) { r = { userId: uid, paidSum: 0, shareSum: 0, balance: 0, paidCount: 0 }; byUser.set(uid, r); }
    return r;
  };
  ctx.members.forEach((m) => ensure(m.user_id));

  let skipped = 0;
  const allIds = ctx.members.map((m) => m.user_id);
  for (const e of ctx.expenses) {
    if (!e.is_paid || modeOf(e) !== 'SHARED') continue;
    const krw = krwOf(e);
    if (krw == null || !e.paid_by) { skipped++; continue; }
    const splitIds = e.split_user_ids && e.split_user_ids.length > 0 ? e.split_user_ids : allIds;
    if (splitIds.length === 0) { skipped++; continue; }
    const payerRow = ensure(e.paid_by);
    payerRow.paidSum += krw;
    payerRow.paidCount += 1;
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

export function settlementSummaryText(ctx: ExpenseCtx): string {
  const { transfers } = computeSettlement(ctx);
  if (transfers.length === 0) return '모두 정산이 맞아요. 보낼 돈이 없어요!';
  return '[정산 안내]\n' + transfers.map((t) => memberName(ctx, t.from) + ' → ' + memberName(ctx, t.to) + ' : ' + fmtKRW(t.amount)).join('\n');
}

/**
 * 멤버별 "실제 부담액" 텍스트 — 결제 완료된 개인 지출 + 결제 완료된 공동 지출의 n분의 1을
 * 합산해 사람별로 정리한다. 지출명·메모까지 포함해 AI에 붙여넣어 예산 효율을 분석하기
 * 좋게 만든 것 — "현재 사용" 카드의 복사 버튼이 쓴다.
 *
 * `selectedUserIds`를 주면 그 사람들 섹션만 텍스트에 포함한다(다중 선택 복사).
 * 단, n분의 1 계산 자체는 선택 여부와 무관하게 전체 멤버 기준으로 그대로 하고, 필터는
 * 마지막에 "어느 섹션을 보여줄지"에만 적용한다 — 선택되지 않은 사람이 있어도 선택된
 * 사람의 공동 지출 분담액은 원래 몫(전체 인원 n분의 1) 그대로여야 하기 때문이다.
 * 생략하거나 빈 배열을 주면 전체 멤버(+ 결제자 미지정) 섹션을 모두 포함한다.
 *
 * 예정(is_paid=false) 항목은 정산과 마찬가지로 포함하지 않는다 — "현재 사용" 카드가 보여주는
 * 실제 지출 총액과 (필터 없을 때의) [합계]가 항상 일치해야 신뢰할 수 있는 자료가 된다.
 * 환산 불가 항목(krwOf가 null)도 조용히 빼지 않고 "환산 불가"로 표시하되 합계엔 0으로
 * 반영한다(원칙 3-1 — sumPaid/computeSettlement와 같은 처리).
 *
 * `tripPeriod`(예: "12.18 – 12.20")를 주면 제목 바로 아래 한 줄로 붙는다 — 나중에 이
 * 텍스트만 따로 떼어놓고 봐도 어느 여행 건인지 알 수 있게 하기 위함.
 */
export function buildPersonalBreakdownText(ctx: ExpenseCtx, selectedUserIds?: string[], tripPeriod?: string | null): string {
  interface Bucket { lines: string[]; total: number; }
  const UNASSIGNED = '__unassigned__';
  const perMember = new Map<string, Bucket>();
  const ensure = (uid: string): Bucket => {
    if (!perMember.has(uid)) perMember.set(uid, { lines: [], total: 0 });
    return perMember.get(uid)!;
  };
  ctx.members.forEach((m) => ensure(m.user_id));
  const allIds = ctx.members.map((m) => m.user_id);

  for (const e of ctx.expenses) {
    if (!e.is_paid) continue;
    const krw = krwOf(e);
    const detail = e.memo ? e.title + ' · ' + e.memo : e.title;
    const localNote = e.currency !== 'KRW' ? ' (' + fmtAmount(e.amount, e.currency) + ')' : '';

    if (modeOf(e) === 'PERSONAL') {
      const amt = krw ?? 0;
      const line = '- ' + detail + localNote + ' : ' + (krw != null ? fmtKRW(amt) : '환산 불가');
      const b = ensure(e.paid_by ?? UNASSIGNED);
      b.lines.push(line);
      b.total += amt;
    } else {
      const splitIds = e.split_user_ids && e.split_user_ids.length > 0 ? e.split_user_ids : allIds;
      if (splitIds.length === 0) continue;
      const share = krw != null ? krw / splitIds.length : 0;
      const line = '- ' + detail + localNote + ' (공동 ' + splitIds.length + '인분의 1) : ' + (krw != null ? fmtKRW(share) : '환산 불가');
      splitIds.forEach((uid) => {
        const b = ensure(uid);
        b.lines.push(line);
        b.total += share;
      });
    }
  }

  const filterSet = selectedUserIds && selectedUserIds.length > 0 ? new Set(selectedUserIds) : null;
  const membersToShow = filterSet ? ctx.members.filter((m) => filterSet.has(m.user_id)) : ctx.members;

  const sections = membersToShow.map((m) => {
    const b = perMember.get(m.user_id)!;
    const body = b.lines.length > 0 ? b.lines.join('\n') : '- (내역 없음)';
    return '■ ' + (m.display_name || '멤버') + '\n' + body + '\n합계: ' + fmtKRW(b.total);
  });

  // 결제자 미지정 몫은 특정 사람을 고른 게 아니므로, 필터 없이 전체를 볼 때만 덧붙인다
  const unassigned = perMember.get(UNASSIGNED);
  if (!filterSet && unassigned) {
    sections.push('■ 결제자 미지정\n' + unassigned.lines.join('\n') + '\n합계: ' + fmtKRW(unassigned.total));
  }

  const grandTotal = membersToShow.reduce((acc, m) => acc + (perMember.get(m.user_id)?.total ?? 0), 0)
    + (!filterSet && unassigned ? unassigned.total : 0);

  const title = filterSet
    ? '[개인별 지출 내역 — 선택: ' + membersToShow.map((m) => m.display_name || '멤버').join(', ') + ']'
    : '[개인별 지출 내역]';

  const headerLines = tripPeriod ? [title, tripPeriod] : [title];

  return [
    ...headerLines,
    '',
    sections.join('\n\n'),
    '',
    '[합계] ' + fmtKRW(grandTotal),
  ].join('\n');
}

/* ══════════════ 환율 · 저장 payload ══════════════ */

/** 환율 캐시 — 같은 세션에서 통화당 1회만 조회(원칙 3-2) */
const fxCache = new Map<string, { rate: number | null; source: string }>();

export async function fetchRate(currency: string): Promise<{ rate: number | null; source: string }> {
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

export interface ExpenseFields {
  category: string;
  title: string;
  amount: number;
  currency: string;
  expenseDate: string | null;
  isPaid: boolean;
  splitMode: SplitMode;
  payer: string | null;
  split: Set<string>;
  memo: string | null;
}

/**
 * 입력값 → 저장 payload(환율 조회 포함). 데스크톱 quick-add·수정 모달과 MOBILE 지갑이
 * 모두 이 함수를 쓴다 — 환산 규칙이 갈라지면 같은 지출이 화면마다 다른 원화로 보인다.
 */
export async function buildExpensePayload(ctx: ExpenseCtx, fields: ExpenseFields): Promise<TripExpenseInsert> {
  let amountKrw: number | null = Math.round(fields.amount);
  let fxRate: number | null = 1;
  let fxSource: string | null = 'live';
  if (fields.currency !== 'KRW') {
    const { rate, source } = await fetchRate(fields.currency);
    fxRate = rate;
    fxSource = source;
    amountKrw = rate != null ? Math.round(fields.amount * rate) : null;
  }
  const payerMember = fields.payer ? ctx.members.find((m) => m.user_id === fields.payer) : null;
  return {
    trip_id: ctx.tripId,
    category: fields.category,
    title: fields.title,
    amount: fields.amount,
    currency: fields.currency,
    amount_krw: amountKrw,
    fx_rate: fxRate,
    fx_source: fxSource,
    expense_date: fields.expenseDate,
    is_paid: fields.isPaid,
    split_mode: fields.splitMode,
    paid_by: fields.payer,
    paid_by_name: payerMember?.display_name ?? null,
    paid_by_avatar: payerMember?.avatar_url ?? null,
    split_user_ids: fields.splitMode === 'PERSONAL'
      ? (fields.payer ? [fields.payer] : null)
      : (fields.split.size === ctx.members.length ? null : Array.from(fields.split)),
    memo: fields.memo,
    updated_at: new Date().toISOString(),
  };
}

/* ══════════════ 로딩 ══════════════ */

/**
 * 트립(인원수)·멤버·지출·예산을 한 번에 병렬 로드한다.
 * trip_expenses 마이그레이션 전이어도 빈 상태로 동작한다(graceful degradation).
 */
export async function loadExpenseCtx(tripId: string): Promise<ExpenseCtx> {
  const [tripRes, memberRes, expenseRes, budgetRes] = await Promise.all([
    supabase.from('trips').select('headcount').eq('id', tripId).single(),
    supabase.from('trip_members').select('user_id, display_name, avatar_url').eq('trip_id', tripId).order('joined_at', { ascending: true }),
    supabase.from('trip_expenses').select('*').eq('trip_id', tripId).order('created_at', { ascending: true }).limit(1000),
    supabase.from('trip_expense_budgets').select('*').eq('trip_id', tripId),
  ]);

  const members = (memberRes.data ?? []) as MemberLite[];
  if (expenseRes.error) console.error('[ExpenseModel] 지출 로드 실패:', expenseRes.error.message);
  if (budgetRes.error) console.error('[ExpenseModel] 예산 로드 실패:', budgetRes.error.message);

  const budgets = new Map<string, number | null>();
  for (const b of (budgetRes.data ?? []) as TripExpenseBudget[]) budgets.set(b.category, b.amount_krw);

  return {
    tripId,
    members,
    expenses: (expenseRes.data ?? []) as TripExpense[],
    budgets,
    headcount: tripRes.data?.headcount ?? Math.max(1, members.length),
  };
}
