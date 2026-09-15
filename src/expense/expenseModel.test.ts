/**
 * 정산·집계 테스트.
 *
 * 이 파일이 지키려는 건 기능이 아니라 신뢰다. 같은 트립인데 PC의 정산 결과와 폰의 정산
 * 결과가 다르면 그 자체가 버그이고(expenseModel.ts 머리말), 정산이 한 번 틀리면 그 그룹은
 * 이 서비스를 다시 쓰지 않는다. 그래서 개별 케이스보다 **불변식**을 우선해서 검증한다:
 *   - 차액(balance)의 총합은 항상 0이다 — 돈이 생기거나 사라지지 않는다
 *   - 제안된 송금을 다 하고 나면 모두의 차액이 0이 된다 — 정산이 실제로 끝난다
 *   - 집계에서 빠진 항목은 조용히 사라지지 않고 skipped로 셈된다 (원칙 3-1)
 */

import { describe, it, expect } from 'vitest';
import type { TripExpense } from '../types/database';
import {
  computeSettlement,
  sumPaid,
  sumPaidByMode,
  sumPaidOn,
  totalsByCategory,
  unconvertedCount,
  krwOf,
  categoryOf,
  modeOf,
  getTotalBudget,
  getCategoryBudgetSum,
  settlementSummaryText,
  fmtKRW,
  fmtAmount,
  BUDGET_TOTAL_KEY,
  type ExpenseCtx,
  type MemberLite,
} from './expenseModel';

/* ══════════════ 픽스처 ══════════════ */

let seq = 0;

/** 지출 한 건. 테스트에서 신경 쓰는 필드만 넘기고 나머지는 기본값으로 채운다. */
function expense(over: Partial<TripExpense> = {}): TripExpense {
  seq += 1;
  return {
    id: 'e' + seq,
    trip_id: 't1',
    destination_id: null,
    category: 'FOOD',
    title: '지출 ' + seq,
    amount: 0,
    currency: 'KRW',
    amount_krw: null,
    fx_rate: null,
    fx_source: null,
    expense_date: '2026-03-01',
    is_paid: true,
    split_mode: 'SHARED',
    paid_by: null,
    paid_by_name: null,
    paid_by_avatar: null,
    split_user_ids: null,
    memo: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    ...over,
  };
}

function member(user_id: string, display_name: string): MemberLite {
  return { user_id, display_name, avatar_url: null };
}

function ctxOf(members: MemberLite[], expenses: TripExpense[], budgets = new Map<string, number | null>()): ExpenseCtx {
  return { tripId: 't1', members, expenses, budgets, headcount: members.length };
}

const [A, B, C] = ['user-a', 'user-b', 'user-c'];
const THREE = [member(A, '민수'), member(B, '지현'), member(C, '태호')];

/** 제안된 송금을 전부 실행한 뒤의 차액 — 0에 수렴해야 정산이 끝난 것이다 */
function balancesAfterTransfers(ctx: ExpenseCtx): Map<string, number> {
  const { rows, transfers } = computeSettlement(ctx);
  const after = new Map(rows.map((r) => [r.userId, r.balance]));
  for (const t of transfers) {
    after.set(t.from, (after.get(t.from) ?? 0) + t.amount);
    after.set(t.to, (after.get(t.to) ?? 0) - t.amount);
  }
  return after;
}

/* ══════════════ 정산 ══════════════ */

describe('computeSettlement', () => {
  it('지출이 없으면 보낼 돈도 없다', () => {
    const { rows, transfers, skipped } = computeSettlement(ctxOf(THREE, []));
    expect(transfers).toEqual([]);
    expect(skipped).toBe(0);
    // 멤버는 지출이 없어도 행을 갖는다 — 화면이 "0원"을 그릴 수 있어야 하므로
    expect(rows.map((r) => r.userId).sort()).toEqual([A, B, C].sort());
    expect(rows.every((r) => r.balance === 0)).toBe(true);
  });

  it('한 명이 3만원을 내면 나머지 두 명이 1만원씩 보낸다', () => {
    const ctx = ctxOf(THREE, [expense({ amount: 30000, paid_by: A })]);
    const { rows, transfers } = computeSettlement(ctx);

    expect(rows.find((r) => r.userId === A)!.balance).toBe(20000);
    expect(rows.find((r) => r.userId === B)!.balance).toBe(-10000);

    expect(transfers).toHaveLength(2);
    expect(transfers.every((t) => t.to === A && t.amount === 10000)).toBe(true);
    expect(transfers.map((t) => t.from).sort()).toEqual([B, C].sort());
  });

  it('예정(is_paid=false) 항목은 정산에 넣지 않는다', () => {
    const ctx = ctxOf(THREE, [
      expense({ amount: 30000, paid_by: A }),
      expense({ amount: 90000, paid_by: B, is_paid: false }),
    ]);
    const { rows, transfers } = computeSettlement(ctx);
    // 예정 항목이 반영됐다면 B가 받는 쪽이 됐을 것
    expect(rows.find((r) => r.userId === B)!.paidSum).toBe(0);
    expect(transfers.every((t) => t.to === A)).toBe(true);
  });

  it('개인 지출(PERSONAL)은 정산에 넣지 않는다', () => {
    const ctx = ctxOf(THREE, [
      expense({ amount: 30000, paid_by: A }),
      expense({ amount: 50000, paid_by: B, split_mode: 'PERSONAL' }),
    ]);
    const { rows } = computeSettlement(ctx);
    expect(rows.find((r) => r.userId === B)!.paidSum).toBe(0);
    expect(rows.find((r) => r.userId === B)!.balance).toBe(-10000);
  });

  it('split_user_ids가 있으면 그 사람들끼리만 나눈다', () => {
    // A가 낸 2만원을 A·B 둘이서만 부담 — C는 무관
    const ctx = ctxOf(THREE, [expense({ amount: 20000, paid_by: A, split_user_ids: [A, B] })]);
    const { rows, transfers } = computeSettlement(ctx);

    expect(rows.find((r) => r.userId === C)!.shareSum).toBe(0);
    expect(rows.find((r) => r.userId === C)!.balance).toBe(0);
    expect(transfers).toEqual([{ from: B, to: A, amount: 10000 }]);
  });

  it('split_user_ids가 빈 배열이면 전원으로 나눈다', () => {
    // null과 [] 둘 다 "전원"으로 취급된다 — 저장 경로에 따라 어느 쪽도 올 수 있어서
    const withNull = computeSettlement(ctxOf(THREE, [expense({ amount: 30000, paid_by: A, split_user_ids: null })]));
    const withEmpty = computeSettlement(ctxOf(THREE, [expense({ amount: 30000, paid_by: A, split_user_ids: [] })]));
    expect(withEmpty.rows).toEqual(withNull.rows);
    expect(withEmpty.skipped).toBe(0);
  });

  it('환산 실패·결제자 미지정 항목은 조용히 빼지 않고 skipped로 센다', () => {
    const ctx = ctxOf(THREE, [
      expense({ amount: 30000, paid_by: A }),
      expense({ amount: 500, currency: 'THB', amount_krw: null, paid_by: B }), // 환율 없음
      expense({ amount: 10000, paid_by: null }), // 결제자 미지정
    ]);
    const { rows, skipped } = computeSettlement(ctx);
    expect(skipped).toBe(2);
    // 빠진 항목은 부담액에도 반영되지 않아야 한다
    expect(rows.find((r) => r.userId === A)!.shareSum).toBe(10000);
  });

  it('환산된 외화 지출은 원화 금액으로 정산에 들어간다', () => {
    const ctx = ctxOf(THREE, [expense({ amount: 500, currency: 'THB', amount_krw: 21000, paid_by: A })]);
    const { rows, skipped } = computeSettlement(ctx);
    expect(skipped).toBe(0);
    expect(rows.find((r) => r.userId === A)!.paidSum).toBe(21000);
  });

  it('차액의 총합은 항상 0이다 — 돈이 생기거나 사라지지 않는다', () => {
    const ctx = ctxOf(THREE, [
      expense({ amount: 31000, paid_by: A }),
      expense({ amount: 17500, paid_by: B, split_user_ids: [A, B] }),
      expense({ amount: 9999, paid_by: C }),
      expense({ amount: 4, paid_by: A, split_user_ids: [B, C] }),
    ]);
    const { rows } = computeSettlement(ctx);
    const sum = rows.reduce((acc, r) => acc + r.balance, 0);
    expect(sum).toBeCloseTo(0, 6);
  });

  it('제안된 송금을 전부 실행하면 모두의 차액이 0이 된다', () => {
    const ctx = ctxOf(THREE, [
      expense({ amount: 31000, paid_by: A }),
      expense({ amount: 17500, paid_by: B, split_user_ids: [A, B] }),
      expense({ amount: 9999, paid_by: C }),
    ]);
    for (const [, balance] of balancesAfterTransfers(ctx)) {
      // 그리디 매칭이 0.5원 미만 잔액에서 멈추므로 그 오차까지만 허용한다
      expect(Math.abs(balance)).toBeLessThan(0.5);
    }
  });

  it('3으로 나누어떨어지지 않는 금액도 송금을 마치면 차액이 사라진다', () => {
    // 10000 / 3 = 3333.33... — 반올림을 잘못하면 여기서 1원이 남거나 생긴다
    const ctx = ctxOf(THREE, [expense({ amount: 10000, paid_by: A })]);
    const { rows } = computeSettlement(ctx);
    expect(rows.reduce((acc, r) => acc + r.balance, 0)).toBeCloseTo(0, 6);
    for (const [, balance] of balancesAfterTransfers(ctx)) {
      expect(Math.abs(balance)).toBeLessThan(0.5);
    }
  });

  it('이미 균형이 맞으면 송금을 제안하지 않는다', () => {
    const ctx = ctxOf(THREE, [
      expense({ amount: 30000, paid_by: A }),
      expense({ amount: 30000, paid_by: B }),
      expense({ amount: 30000, paid_by: C }),
    ]);
    const { transfers } = computeSettlement(ctx);
    expect(transfers).toEqual([]);
  });

  it('송금 건수는 최소 송금 조합 범위 안에 있다', () => {
    // n명이 정산할 때 필요한 송금은 많아야 n-1건이다. 그리디가 쓸데없이 쪼개면 여기서 걸린다.
    const ctx = ctxOf(THREE, [
      expense({ amount: 60000, paid_by: A }),
      expense({ amount: 30000, paid_by: B }),
    ]);
    const { transfers } = computeSettlement(ctx);
    expect(transfers.length).toBeLessThanOrEqual(THREE.length - 1);
    expect(transfers.every((t) => t.amount > 0)).toBe(true);
  });

  it('멤버 목록에 없는 사람이 결제했어도 정산에 포함한다', () => {
    // 나갔거나 아직 프로필이 없는 멤버의 결제가 통째로 증발하면 총합이 깨진다
    const ctx = ctxOf(THREE, [expense({ amount: 30000, paid_by: 'user-ghost' })]);
    const { rows } = computeSettlement(ctx);
    expect(rows.find((r) => r.userId === 'user-ghost')!.paidSum).toBe(30000);
    expect(rows.reduce((acc, r) => acc + r.balance, 0)).toBeCloseTo(0, 6);
  });
});

describe('settlementSummaryText', () => {
  it('보낼 돈이 없으면 그렇게 말한다', () => {
    expect(settlementSummaryText(ctxOf(THREE, []))).toContain('보낼 돈이 없어요');
  });

  it('송금 안내에 이름과 금액이 들어간다', () => {
    const ctx = ctxOf(THREE, [expense({ amount: 20000, paid_by: A, split_user_ids: [A, B] })]);
    const text = settlementSummaryText(ctx);
    expect(text).toContain('지현 → 민수');
    expect(text).toContain('₩10,000');
  });
});

/* ══════════════ 집계 ══════════════ */

describe('집계', () => {
  it('sumPaid는 결제 완료 항목만 더한다', () => {
    const ctx = ctxOf(THREE, [
      expense({ amount: 10000 }),
      expense({ amount: 5000, is_paid: false }),
    ]);
    expect(sumPaid(ctx)).toBe(10000);
  });

  it('sumPaid는 환산 불가 항목을 0으로 치고 계속 더한다', () => {
    // 한 건이 환산 불가라고 해서 합계가 NaN이 되면 화면 전체가 망가진다.
    // 빠진 건수는 unconvertedCount가 따로 알려준다 (원칙 3-1)
    const ctx = ctxOf(THREE, [
      expense({ amount: 10000 }),
      expense({ amount: 500, currency: 'THB', amount_krw: null }),
    ]);
    expect(sumPaid(ctx)).toBe(10000);
    expect(unconvertedCount(ctx)).toBe(1);
  });

  it('sumPaidByMode가 공동/개인을 갈라서 더한다', () => {
    const ctx = ctxOf(THREE, [
      expense({ amount: 10000, split_mode: 'SHARED' }),
      expense({ amount: 7000, split_mode: 'PERSONAL' }),
      expense({ amount: 3000, split_mode: 'PERSONAL', is_paid: false }),
    ]);
    expect(sumPaidByMode(ctx, 'SHARED')).toBe(10000);
    expect(sumPaidByMode(ctx, 'PERSONAL')).toBe(7000);
  });

  it('sumPaidOn이 그 날짜 것만 더한다', () => {
    const ctx = ctxOf(THREE, [
      expense({ amount: 10000, expense_date: '2026-03-01' }),
      expense({ amount: 20000, expense_date: '2026-03-02' }),
      expense({ amount: 30000, expense_date: null }),
    ]);
    expect(sumPaidOn(ctx, '2026-03-01')).toBe(10000);
    expect(sumPaidOn(ctx, '2026-03-03')).toBe(0);
  });

  it('totalsByCategory는 카테고리 키 7개를 빠짐없이 채운다', () => {
    const ctx = ctxOf(THREE, [expense({ amount: 10000, category: 'FOOD' })]);
    const totals = totalsByCategory(ctx);
    expect(totals.get('FOOD')).toBe(10000);
    // 지출이 없는 카테고리도 0으로 존재해야 카드 그리드가 7칸을 그린다
    expect(totals.get('SHOPPING')).toBe(0);
    expect(totals.size).toBe(7);
  });

  /**
   * ⚠️ 현재 동작을 고정해 둔 테스트지, "이게 맞다"는 뜻이 아니다.
   *
   * totalsByCategory는 is_paid를 보지 않아 예정 항목까지 더하는데, sumPaid는 결제 완료만
   * 더한다. 그래서 예산 요약 탭 한 화면 안에서 통계 카드의 "현재 사용"과 카테고리 카드의
   * 금액이 서로 다른 값을 가리킬 수 있다(expense.ts categoryCardHtml은 이 값을 `spent`로
   * 받아 예산 대비 진행바와 "초과" 배지까지 그린다).
   *
   * 어느 쪽에 맞출지는 제품 판단이라 여기서 바꾸지 않았다. 결론이 나면 이 테스트가
   * 실패하면서 "여기도 같이 고쳐야 한다"고 알려줄 것이다.
   */
  it('[현재 동작] totalsByCategory는 예정 항목까지 더해서 sumPaid와 어긋난다', () => {
    const ctx = ctxOf(THREE, [
      expense({ amount: 10000, category: 'FOOD', is_paid: true }),
      expense({ amount: 500000, category: 'FLIGHT', is_paid: false }),
    ]);
    expect(totalsByCategory(ctx).get('FLIGHT')).toBe(500000);
    expect(sumPaid(ctx)).toBe(10000);
  });

  it('모르는 카테고리는 기타로 접어 넣는다', () => {
    const ctx = ctxOf(THREE, [expense({ amount: 10000, category: 'NOT_A_CATEGORY' })]);
    expect(categoryOf(ctx.expenses[0])).toBe('ETC');
    expect(totalsByCategory(ctx).get('ETC')).toBe(10000);
  });

  it('총 예산은 카테고리 합계와 별개로 읽힌다', () => {
    const budgets = new Map<string, number | null>([
      [BUDGET_TOTAL_KEY, 1000000],
      ['FOOD', 300000],
      ['STAY', 400000],
    ]);
    const ctx = ctxOf(THREE, [], budgets);
    expect(getTotalBudget(ctx)).toBe(1000000);
    expect(getCategoryBudgetSum(ctx)).toBe(700000);
  });

  it('총 예산이 없으면 0이 아니라 null이다', () => {
    // 0으로 떨어지면 화면이 "예산 0원"을 진짜 설정값처럼 그린다 (원칙 3-1)
    expect(getTotalBudget(ctxOf(THREE, []))).toBeNull();
  });
});

/* ══════════════ 단위 변환 · 표기 ══════════════ */

describe('krwOf / modeOf', () => {
  it('KRW는 amount를, 외화는 환산값을 쓴다', () => {
    expect(krwOf(expense({ amount: 10000, currency: 'KRW', amount_krw: 999 }))).toBe(10000);
    expect(krwOf(expense({ amount: 500, currency: 'THB', amount_krw: 21000 }))).toBe(21000);
    expect(krwOf(expense({ amount: 500, currency: 'THB', amount_krw: null }))).toBeNull();
  });

  it('split_mode가 PERSONAL이 아니면 전부 공동으로 본다', () => {
    expect(modeOf(expense({ split_mode: 'PERSONAL' }))).toBe('PERSONAL');
    expect(modeOf(expense({ split_mode: 'SHARED' }))).toBe('SHARED');
    expect(modeOf(expense({ split_mode: '' }))).toBe('SHARED');
  });
});

describe('표기', () => {
  it('원화는 반올림해서 천단위로 끊는다', () => {
    expect(fmtKRW(1234567)).toBe('₩1,234,567');
    expect(fmtKRW(1234.6)).toBe('₩1,235');
  });

  it('소수점이 없는 통화는 반올림하고, 있는 통화는 둘째 자리까지 둔다', () => {
    expect(fmtAmount(1234.5, 'JPY')).toBe('¥1,235');
    expect(fmtAmount(1234.56, 'USD')).toBe('$1,234.56');
  });

  it('목록에 없는 통화는 코드를 그대로 붙인다', () => {
    expect(fmtAmount(100, 'AUD')).toBe('AUD 100');
  });
});
