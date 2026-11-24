import { describe, it, expect, vi, afterEach } from 'vitest';
import { payConfig, capturePayReturn, takePayReturn, payMethodName, PAY_RETURN_KEY } from './payClient';
import { planStatusText, PURCHASE_NOTICE, reviewHtml } from './pro';
import { PRODUCTS } from './products';

describe('결제 설정', () => {
  it('상점 ID와 채널이 하나도 없으면 결제를 열지 않는다', () => {
    expect(payConfig({})).toBeNull();
    expect(payConfig({ VITE_PORTONE_STORE_ID: 'store-1' })).toBeNull();
  });
  it('있는 결제 수단만 연다', () => {
    expect(payConfig({ VITE_PORTONE_STORE_ID: 'store-1', VITE_PORTONE_CHANNEL_CARD: 'ch-card' })).toEqual({ storeId: 'store-1', channels: { card: 'ch-card' } });
  });
});

describe('휴대폰 결제창에서 돌아오기(/pay/done)', () => {
  afterEach(() => vi.unstubAllGlobals());
  function stubBrowser() {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    const replaced: string[] = [];
    vi.stubGlobal('history', { replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) });
    return { store, replaced };
  }
  it('결과를 세션에 두고 주소를 #pro로 바꾼다 — 한 번 읽으면 지운다', () => {
    const { replaced } = stubBrowser();
    expect(capturePayReturn({ pathname: '/pay/done', search: '?paymentId=mongsil-abc&code=FAILURE_TYPE_PG&message=사용자%20취소' })).toBe(true);
    expect(replaced).toEqual(['/#pro']);
    expect(takePayReturn()).toEqual({ paymentId: 'mongsil-abc', code: 'FAILURE_TYPE_PG', message: '사용자 취소' });
    expect(takePayReturn()).toBeNull();
  });
  it('다른 주소면 아무것도 안 한다', () => {
    const { store, replaced } = stubBrowser();
    expect(capturePayReturn({ pathname: '/', search: '?paymentId=x' })).toBe(false);
    expect(replaced).toEqual([]);
    expect(store.has(PAY_RETURN_KEY)).toBe(false);
  });
});

describe('표시 문구', () => {
  it('요금제 상태', () => {
    expect(planStatusText({ plan: 'free', expiresAt: null, webLeft: null }).title).toBe('무료 이용 중');
    expect(planStatusText({ plan: 'pro', expiresAt: '2026-12-24T03:00:00Z', webLeft: 97 })).toEqual({ title: 'PRO 이용 중', sub: '2026.12.24까지 · 웹 검색 남은 97번' });
    expect(planStatusText({ plan: 'pro', expiresAt: null, webLeft: null }).sub).toBe('기간 제한 없음');
  });
  it('결제 수단 이름', () => {
    expect(payMethodName('CARD')).toBe('카드');
    expect(payMethodName('EASY_PAY:KAKAOPAY')).toBe('카카오페이');
    expect(payMethodName('EASY_PAY:TOSSPAY')).toBe('토스페이');
    expect(payMethodName(null)).toBe('');
  });
  it('결제 전 고지가 상품표의 가격·기간·횟수와 같다(가격을 바꾸면 고지도 따라간다)', () => {
    const p = PRODUCTS.pro_30d;
    const all = PURCHASE_NOTICE.join(' ');
    expect(all).toContain(p.amount.toLocaleString('ko-KR') + '원(부가세 포함)');
    expect(all).toContain(p.days + '일');
    expect(all).toContain(p.web + '번');
    expect(all).toContain('자동으로 갱신되거나 다시 결제되지 않습니다');
    expect(all).toContain('7일 이내');
  });
});

describe('관리자 환불 판단 자료', () => {
  it('기준 안이면 전액 환불 대상, 기준 밖이면 예외 판단으로 표시', () => {
    const base = { status: 'review', paymentId: 'mongsil-x', buyerEmail: 'a@x.com', amount: 4900, paidAt: '2026-11-24T03:00:00Z', daysSincePaid: 2 };
    expect(reviewHtml({ ...base, proUseSincePaid: 0, withinPolicy: true })).toContain('기준 안');
    expect(reviewHtml({ ...base, proUseSincePaid: 3, withinPolicy: false })).toContain('기준 밖');
    expect(reviewHtml({ status: 'cancelled', already: true })).toContain('이미 환불된');
    expect(reviewHtml({ ...base, buyerEmail: '<img src=x onerror=alert(1)>', withinPolicy: true })).not.toContain('<img');
  });
});

