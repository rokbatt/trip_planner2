import { describe, it, expect } from 'vitest';
import { sanitizeReceiptEntries } from '../../api/ai';

describe('sanitizeReceiptEntries (AI가 읽은 결제 건 다시 거르기)', () => {
  it('정상 값은 그대로, 통화는 대문자 3글자로', () => {
    const out = sanitizeReceiptEntries({ entries: [{ title: ' 이치란  라멘 ', amount: 1980, currency: 'jpy', date: '2026-11-14', category: 'FOOD', krwCharged: 18000 }] });
    expect(out).toEqual([{ title: '이치란 라멘', amount: 1980, currency: 'JPY', date: '2026-11-14', category: 'FOOD', krwCharged: 18000 }]);
  });

  it('모르는 값은 지어내지 않고 null — 통화·날짜·원화 청구액', () => {
    const [e] = sanitizeReceiptEntries({ entries: [{ title: 'x', amount: 10, currency: '¥', date: '11/14', category: 'FOOD', krwCharged: -5 }] });
    expect(e.currency).toBeNull();
    expect(e.date).toBeNull();
    expect(e.krwCharged).toBeNull();
  });

  it('금액이 없거나 0 이하·숫자가 아니면 그 건은 버린다', () => {
    const out = sanitizeReceiptEntries({ entries: [{ title: 'a', amount: 0 }, { title: 'b', amount: 'abc' }, { title: 'c', amount: 5, category: 'FOOD' }] });
    expect(out.map((e) => e.title)).toEqual(['c']);
  });

  it('모르는 분류는 ETC, 빈 이름은 "지출", 최대 20건', () => {
    const many = Array.from({ length: 30 }, () => ({ title: '', amount: 1, category: 'BAR' }));
    const out = sanitizeReceiptEntries({ entries: many });
    expect(out).toHaveLength(20);
    expect(out[0]).toMatchObject({ title: '지출', category: 'ETC' });
  });

  it('형식이 틀린 응답이면 빈 배열', () => {
    expect(sanitizeReceiptEntries(null)).toEqual([]);
    expect(sanitizeReceiptEntries({ entries: 'nope' })).toEqual([]);
  });
});
