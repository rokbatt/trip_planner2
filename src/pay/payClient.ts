/**
 * 결제 — 화면 쪽(docs/PAYMENT_DESIGN.md 1장·6장).
 *
 * 흐름: prepare(서버가 주문·금액을 정함) → 포트원 결제창 → complete(서버가 포트원에 다시 조회해 반영)
 *  - 휴대폰은 결제창이 다른 페이지로 넘어갔다가 `/pay/done?paymentId=…`로 돌아온다(redirectUrl).
 *    돌아온 주소는 main.ts가 받아 `#pro`로 바꾸고, 요금제 화면이 complete를 부른다.
 *  - PC는 결제창이 끝나면 함수 결과로 돌아온다. 그때도 같은 complete를 부른다.
 *  - 결제가 됐는데 complete가 실패해도 포트원 웹훅이 서버에서 반영한다.
 *
 * 공개 설정값(Build 변수, 값이 없으면 결제 버튼을 열지 않는다):
 *   VITE_PORTONE_STORE_ID, VITE_PORTONE_CHANNEL_CARD, VITE_PORTONE_CHANNEL_TOSSPAY, VITE_PORTONE_CHANNEL_KAKAOPAY
 *   (결제 수단별 채널이 하나면 같은 값을 넣는다 — 계약에 따라 다름)
 */
import { apiFetch } from '../utils/apiFetch';

export type PayMethodKey = 'card' | 'tosspay' | 'kakaopay';

export const PAY_METHODS: { key: PayMethodKey; label: string }[] = [
  { key: 'card', label: '신용·체크카드' },
  { key: 'tosspay', label: '토스페이' },
  { key: 'kakaopay', label: '카카오페이' },
];

interface PayConfig {
  storeId: string;
  channels: Partial<Record<PayMethodKey, string>>;
}

export function payConfig(env: Record<string, string | undefined> = import.meta.env as unknown as Record<string, string | undefined>): PayConfig | null {
  const storeId = (env.VITE_PORTONE_STORE_ID ?? '').trim();
  if (!storeId) return null;
  const channels: PayConfig['channels'] = {};
  const card = (env.VITE_PORTONE_CHANNEL_CARD ?? '').trim();
  const toss = (env.VITE_PORTONE_CHANNEL_TOSSPAY ?? '').trim();
  const kakao = (env.VITE_PORTONE_CHANNEL_KAKAOPAY ?? '').trim();
  if (card) channels.card = card;
  if (toss) channels.tosspay = toss;
  if (kakao) channels.kakaopay = kakao;
  return Object.keys(channels).length ? { storeId, channels } : null;
}

/** 결제창이 돌아올 주소 — main.ts의 handlePayReturn과 짝 */
export const PAY_RETURN_PATH = '/pay/done';
/** 돌아온 결과를 요금제 화면에 넘기는 칸(세션 동안만) */
export const PAY_RETURN_KEY = 'mongsil:payReturn';

export interface PayReturn {
  paymentId: string;
  /** 포트원이 실패·취소일 때 붙여 주는 코드·메시지 */
  code: string | null;
  message: string | null;
}

/**
 * `/pay/done?paymentId=…&code=…&message=…`로 돌아왔으면 결과를 세션에 두고 주소를 `/#pro`로 바꾼다.
 * 라우터가 시작하기 전에 부른다. 돌아온 경우면 true.
 */
export function capturePayReturn(loc: Pick<Location, 'pathname' | 'search'> = window.location): boolean {
  if (loc.pathname.replace(/\/+$/, '') !== PAY_RETURN_PATH) return false;
  const q = new URLSearchParams(loc.search);
  const r: PayReturn = { paymentId: (q.get('paymentId') ?? '').slice(0, 64), code: q.get('code'), message: (q.get('message') ?? '').slice(0, 200) || null };
  try {
    if (r.paymentId) sessionStorage.setItem(PAY_RETURN_KEY, JSON.stringify(r));
  } catch {
    // 저장이 안 되면 웹훅이 반영한다 — 화면만 결과를 못 보여 준다
  }
  history.replaceState(null, '', '/#pro');
  return true;
}

export function takePayReturn(): PayReturn | null {
  try {
    const raw = sessionStorage.getItem(PAY_RETURN_KEY);
    sessionStorage.removeItem(PAY_RETURN_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as PayReturn;
    return typeof r?.paymentId === 'string' && r.paymentId ? r : null;
  } catch {
    return null;
  }
}

async function postPay<T>(path: string, body: unknown): Promise<{ status: number; json: T & { error?: string } }> {
  const res = await apiFetch('/api/pay/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { status: res.status, json };
}

export type CompleteResult =
  | { kind: 'paid'; expiresAt: string | null; webLeft: number | null }
  | { kind: 'pending'; message: string }
  | { kind: 'failed'; message: string };

export async function completePayment(paymentId: string): Promise<CompleteResult> {
  try {
    const { status, json } = await postPay<{ status?: string; expiresAt?: string | null; webLeft?: number | null; message?: string }>('complete', { paymentId });
    if (status === 200 && json.status === 'paid') return { kind: 'paid', expiresAt: json.expiresAt ?? null, webLeft: typeof json.webLeft === 'number' ? json.webLeft : null };
    if (status === 202 || status === 503) return { kind: 'pending', message: json.message || json.error || '결제를 확인하고 있어요. 잠시 뒤 자동으로 반영돼요.' };
    return { kind: 'failed', message: json.error || '결제가 완료되지 않았어요.' };
  } catch {
    return { kind: 'pending', message: '결제를 확인하지 못했어요. 결제가 됐다면 잠시 뒤 자동으로 반영돼요.' };
  }
}

/**
 * 결제 시작. 휴대폰은 결제창 페이지로 넘어가므로 이 함수가 돌아오지 않을 수 있다.
 * PC는 결제창이 닫히면 결과를 돌려준다.
 */
export async function startCheckout(productId: string, method: PayMethodKey): Promise<CompleteResult | { kind: 'cancelled'; message: string }> {
  const cfg = payConfig();
  const channelKey = cfg?.channels[method];
  if (!cfg || !channelKey) return { kind: 'failed', message: '결제 준비 중이에요.' };

  const prep = await postPay<{ paymentId?: string; orderName?: string; amount?: number }>('prepare', { product: productId });
  if (prep.status !== 200 || !prep.json.paymentId || !prep.json.orderName || typeof prep.json.amount !== 'number') {
    return { kind: 'failed', message: prep.json.error || '결제를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.' };
  }
  const paymentId = prep.json.paymentId;

  // 결제창 SDK는 결제할 때만 불러온다(첫 화면을 무겁게 하지 않게)
  const PortOne = (await import('@portone/browser-sdk/v2')).default;
  const base = {
    storeId: cfg.storeId,
    channelKey,
    paymentId,
    orderName: prep.json.orderName,
    totalAmount: prep.json.amount,
    currency: 'KRW' as const,
    redirectUrl: window.location.origin + PAY_RETURN_PATH,
  };
  const res =
    method === 'card'
      ? await PortOne.requestPayment({ ...base, payMethod: 'CARD' })
      : await PortOne.requestPayment({ ...base, payMethod: 'EASY_PAY', easyPay: { easyPayProvider: method === 'tosspay' ? 'TOSSPAY' : 'KAKAOPAY' } });

  if (!res) return { kind: 'pending', message: '결제를 확인하고 있어요.' };
  if (res.code !== undefined) return { kind: 'cancelled', message: res.message || '결제가 완료되지 않았어요.' };
  return completePayment(paymentId);
}

export interface PaymentHistoryRow {
  payment_id: string;
  product: string;
  amount: number;
  status: 'paid' | 'cancelled';
  pay_method: string | null;
  granted_at: string | null;
  period_end: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export async function fetchPaymentHistory(): Promise<PaymentHistoryRow[] | null> {
  try {
    const res = await apiFetch('/api/pay/history');
    if (!res.ok) return null;
    const j = (await res.json()) as { payments?: PaymentHistoryRow[] };
    return Array.isArray(j.payments) ? j.payments : [];
  } catch {
    return null;
  }
}

/** 결제 수단 표시 이름 — 서버가 저장한 값(CARD · EASY_PAY:KAKAOPAY …) */
export function payMethodName(v: string | null): string {
  if (!v) return '';
  if (v === 'CARD') return '카드';
  if (/KAKAOPAY/.test(v)) return '카카오페이';
  if (/TOSSPAY/.test(v)) return '토스페이';
  if (v.startsWith('EASY_PAY')) return '간편결제';
  return '';
}
