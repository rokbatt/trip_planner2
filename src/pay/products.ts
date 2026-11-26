/**
 * 판매 상품 — 금액·기간의 단일 기준(docs/PAYMENT_DESIGN.md 2장 1단계).
 * 서버(worker/pay.ts)는 이 값으로 주문을 만들고 결제 금액을 대조한다. 화면이 보낸 금액은 쓰지 않는다.
 * 가격을 바꾸는 건 사용자 결정이다(Claude.md 6장). 바꾸면 결제 전 고지·약관·랜딩 표시도 같이 바뀌어야 한다.
 */
export interface Product {
  id: string;
  /** 결제창·내역에 보이는 이름 */
  name: string;
  /** 원(부가세 포함) */
  amount: number;
  currency: 'KRW';
  /** 이용권 기간(일) */
  days: number;
  /** 이용권당 PRO 웹 검색 수 */
  web: number;
}

export const PRODUCTS: Record<string, Product> = {
  pro_30d: { id: 'pro_30d', name: 'PRO 30일 이용권', amount: 4900, currency: 'KRW', days: 30, web: 100 },
};

export function productById(id: unknown): Product | null {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PRODUCTS, id) ? PRODUCTS[id] : null;
}
