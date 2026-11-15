import { describe, it, expect } from 'vitest';
import { toDraft, chargedRate } from './receiptImport';

describe('toDraft', () => {
  it('모르는 통화·날짜는 지갑 통화·오늘로 채운다(화면에서 고칠 수 있게)', () => {
    const d = toDraft({ title: '세븐일레븐', amount: 120, currency: null, date: null, category: 'SHOPPING', krwCharged: null }, 'THB', '2026-11-15');
    expect(d).toMatchObject({ include: true, currency: 'THB', date: '2026-11-15', category: 'SHOPPING', splitMode: 'SHARED' });
  });
  it('모르는 분류는 ETC', () => {
    expect(toDraft({ title: 'x', amount: 1, currency: 'JPY', date: '2026-11-01', category: 'BAR', krwCharged: null }, 'KRW', '2026-11-15').category).toBe('ETC');
  });
});

describe('chargedRate (카드사가 실제로 쓴 환율)', () => {
  it('원화 청구액이 있으면 그걸로 1단위 환율을 계산', () => {
    expect(chargedRate({ currency: 'JPY', amount: 1000, krwCharged: 9100 })).toBeCloseTo(9.1);
  });
  it('원화 결제·청구액 없음·금액 0이면 null', () => {
    expect(chargedRate({ currency: 'KRW', amount: 1000, krwCharged: 1000 })).toBeNull();
    expect(chargedRate({ currency: 'JPY', amount: 1000, krwCharged: null })).toBeNull();
    expect(chargedRate({ currency: 'JPY', amount: 0, krwCharged: 100 })).toBeNull();
  });
});
