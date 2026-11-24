/**
 * /api/pay/* — 결제 (Worker 전용 주소, docs/PAYMENT_DESIGN.md 3장).
 *
 * api/ 폴더 12개 한도 때문에 알림(worker/notify.ts)처럼 Worker 안에서 처리한다.
 *
 *   POST /api/pay/prepare   { product }            로그인 — 주문 만들기(금액·상품은 서버가 정함)
 *   POST /api/pay/complete  { paymentId }          로그인 — 포트원에 다시 조회해 확인 → 이용권 반영
 *   POST /api/pay/webhook                          로그인 예외 — Standard Webhooks 서명 확인 → 다시 조회 → 반영·회수
 *   GET  /api/pay/history                          로그인 — 내 결제 내역
 *   POST /api/pay/refund    { paymentId, reason, confirm? }  관리자 — 환불 판단 자료 / confirm이면 포트원 취소 → 회수
 *   POST /api/pay/recheck   { paymentId }          관리자 — 반영 안 된 결제를 포트원에 다시 조회해 반영
 *
 * 원칙
 *   - 결제 상태는 **포트원 API로 다시 조회한 값만** 믿는다(웹훅 본문·화면이 보낸 값은 믿지 않는다).
 *   - 반영·회수는 DB 함수(grant_pro_pass·revoke_pro_pass, supabase/payments.sql)가 행 잠금으로 한 번만 한다.
 *     그래서 complete와 웹훅이 동시에 와도 이용권이 두 번 늘지 않는다.
 *   - 비밀값(PORTONE_API_SECRET·PORTONE_WEBHOOK_SECRET)은 Cloudflare Secret. 오류 응답·로그에 값을 싣지 않는다.
 *   - 운영에서는 테스트 채널 결제를 거절한다(PAY_ALLOW_TEST=true일 때만 허용).
 *
 * ⚠️ 포트원 응답 중 아래 필드는 공식 예제로 확인한 것만 쓴다: status · amount.total · (조회 주소·인증 헤더 형식).
 *    channel.type · method · currency · storeId · transactionId 는 실제 응답으로 다시 확인할 것(설계 문서 3장 "확인 필요").
 */
import { productById, type Product } from '../src/pay/products';

export interface PayEnv {
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  PORTONE_API_SECRET?: string;
  PORTONE_WEBHOOK_SECRET?: string;
  PORTONE_STORE_ID?: string;
  PAY_ALLOW_TEST?: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const PORTONE_API = 'https://api.portone.io';
/** 한 사람이 1시간에 만들 수 있는 주문 수 — 결제창을 여러 번 열고 닫는 정도는 넉넉하게 */
export const MAX_ORDERS_PER_HOUR = 10;
/** 웹훅 시각 허용 오차(초) — Standard Webhooks 권장값 */
export const WEBHOOK_TOLERANCE_SEC = 5 * 60;
const PAYMENT_ID_RE = /^mongsil-[a-f0-9]{24}$/;
const TIMEOUT_MS = 10_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** 설정이 빠졌는지 — 빠진 "이름"만(값은 절대 안 보낸다). 웹훅에는 웹훅 시크릿도 필요하다 */
export function missingPayEnv(env: PayEnv, forWebhook = false): string[] {
  const miss: string[] = [];
  if (!(env.SUPABASE_URL || env.VITE_SUPABASE_URL)) miss.push('SUPABASE_URL');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) miss.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!env.PORTONE_API_SECRET) miss.push('PORTONE_API_SECRET');
  if (!env.PORTONE_STORE_ID) miss.push('PORTONE_STORE_ID');
  if (forWebhook && !env.PORTONE_WEBHOOK_SECRET) miss.push('PORTONE_WEBHOOK_SECRET');
  return miss;
}

export function newPaymentId(): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return 'mongsil-' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const isPaymentId = (v: unknown): v is string => typeof v === 'string' && PAYMENT_ID_RE.test(v);

/* ── Standard Webhooks 서명 (https://www.standardwebhooks.com/) ──
 * 서명 대상: "{webhook-id}.{webhook-timestamp}.{원문 본문}"
 * 키: 시크릿에서 "whsec_" 앞머리를 뗀 base64를 디코드한 바이트
 * 헤더 webhook-signature: "v1,<base64>"를 공백으로 여러 개 — 하나라도 맞으면 통과
 */
function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** 길이가 같을 때 끝까지 비교한다(어디서 틀렸는지 시간으로 드러나지 않게) */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signWebhook(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const keyBytes = b64ToBytes(secret.startsWith('whsec_') ? secret.slice(6) : secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id + '.' + timestamp + '.' + body));
  return bytesToB64(new Uint8Array(sig));
}

export async function verifyWebhook(
  secret: string,
  headers: Headers,
  body: string,
  nowSec: number = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  const id = headers.get('webhook-id');
  const ts = headers.get('webhook-timestamp');
  const sigHeader = headers.get('webhook-signature');
  if (!id || !ts || !sigHeader || !/^\d{1,12}$/.test(ts)) return false;
  if (Math.abs(nowSec - Number(ts)) > WEBHOOK_TOLERANCE_SEC) return false;
  let expected: string;
  try {
    expected = await signWebhook(secret, id, ts, body);
  } catch {
    return false; // 시크릿 형식이 틀림
  }
  return sigHeader
    .split(' ')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('v1,'))
    .some((p) => sameText(p.slice(3), expected));
}

/* ── 포트원 결제 조회 결과 검증 ── */
export interface PortonePayment {
  status?: string;
  amount?: { total?: number };
  currency?: string;
  storeId?: string;
  transactionId?: string;
  channel?: { type?: string };
  method?: { type?: string; provider?: string };
}

export type Verdict =
  | { ok: true; tx: string; method: string }
  | { ok: false; reason: 'not_paid' | 'amount' | 'currency' | 'store' | 'test_channel'; status?: string };

/** 포트원이 "결제 완료"라고 한 결제가 우리 주문과 맞는지 — 하나라도 어긋나면 반영하지 않는다 */
export function checkPayment(p: PortonePayment, expectAmount: number, env: PayEnv): Verdict {
  if (p.status !== 'PAID') return { ok: false, reason: 'not_paid', status: String(p.status ?? '') };
  if (p.amount?.total !== expectAmount) return { ok: false, reason: 'amount' };
  if (p.currency != null && p.currency !== 'KRW' && p.currency !== 'CURRENCY_KRW') return { ok: false, reason: 'currency' };
  if (p.storeId != null && p.storeId !== env.PORTONE_STORE_ID) return { ok: false, reason: 'store' };
  // 운영에서는 실결제 채널만. 필드가 없으면(응답 형식이 다르면) 안전하게 거절 — 실제 응답으로 확인 전까지
  if (env.PAY_ALLOW_TEST !== 'true' && p.channel?.type !== 'LIVE') return { ok: false, reason: 'test_channel' };
  return { ok: true, tx: String(p.transactionId ?? '').slice(0, 200), method: payMethodLabel(p.method) };
}

/** 결제 수단 이름(내역 표시용). 모르는 형식이면 빈 문자열 */
export function payMethodLabel(m: PortonePayment['method']): string {
  if (!m?.type) return '';
  if (/EasyPay/i.test(m.type)) return 'EASY_PAY' + (m.provider ? ':' + String(m.provider).slice(0, 20) : '');
  if (/Card/i.test(m.type)) return 'CARD';
  return String(m.type).slice(0, 40);
}

/* ── 외부 호출 ── */
class Api {
  constructor(private env: PayEnv, private f: FetchLike) {}

  private get base(): string {
    return (this.env.SUPABASE_URL || this.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  }

  private db(path: string, init: RequestInit = {}): Promise<Response> {
    const key = this.env.SUPABASE_SERVICE_ROLE_KEY!;
    const headers = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) };
    return this.f(this.base + path, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  }

  async user(token: string): Promise<{ id: string; email: string } | null> {
    const key = this.env.SUPABASE_SERVICE_ROLE_KEY!;
    const res = await this.f(this.base + '/auth/v1/user', { headers: { apikey: key, authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const u = (await res.json().catch(() => null)) as { id?: unknown; email?: unknown } | null;
    return typeof u?.id === 'string' ? { id: u.id, email: typeof u.email === 'string' ? u.email.toLowerCase() : '' } : null;
  }

  async isAdmin(email: string): Promise<boolean> {
    if (!email) return false;
    const res = await this.db('/rest/v1/app_roles?select=role&email=eq.' + encodeURIComponent(email));
    if (!res.ok) return false;
    const rows = (await res.json()) as { role?: string }[];
    return rows.some((r) => r.role === 'admin');
  }

  async recentOrders(userId: string, sinceIso: string): Promise<number | null> {
    const res = await this.db('/rest/v1/payments?select=payment_id&user_id=eq.' + encodeURIComponent(userId) +
      '&created_at=gte.' + encodeURIComponent(sinceIso) + '&limit=' + (MAX_ORDERS_PER_HOUR + 1));
    if (!res.ok) return null;
    return ((await res.json()) as unknown[]).length;
  }

  async insertOrder(row: Record<string, unknown>): Promise<boolean> {
    const res = await this.db('/rest/v1/payments', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify(row) });
    return res.ok;
  }

  async order(paymentId: string): Promise<PaymentRow | null | 'error'> {
    const res = await this.db('/rest/v1/payments?select=payment_id,user_id,buyer_email,amount,status,period_days,web_count,granted_at,period_end,pay_method&payment_id=eq.' + encodeURIComponent(paymentId));
    if (!res.ok) return 'error';
    const rows = (await res.json()) as PaymentRow[];
    return rows[0] ?? null;
  }

  async markFailed(paymentId: string): Promise<void> {
    await this.db('/rest/v1/payments?payment_id=eq.' + encodeURIComponent(paymentId) + '&status=eq.ready', {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'failed', updated_at: new Date().toISOString() }),
    }).catch(() => undefined);
  }

  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
    const res = await this.db('/rest/v1/rpc/' + fn, { method: 'POST', body: JSON.stringify(args) });
    if (!res.ok) {
      console.warn('[pay] ' + fn + ' 실패 ' + res.status + ' ' + (await res.text()).slice(0, 200));
      return null;
    }
    return (await res.json()) as T;
  }

  async history(userId: string): Promise<unknown[] | null> {
    const res = await this.db('/rest/v1/payments?select=payment_id,product,amount,currency,status,pay_method,granted_at,period_end,cancelled_at,created_at' +
      '&user_id=eq.' + encodeURIComponent(userId) + '&status=in.(paid,cancelled)&order=created_at.desc&limit=20');
    if (!res.ok) return null;
    return (await res.json()) as unknown[];
  }

  /** 결제일(한국 날짜) 이후 PRO 전용 기능 사용 기록 — 환불 판단 자료(api_usage 'pro', 7일 보관) */
  async proUseSince(userId: string, dayKst: string): Promise<number | null> {
    const res = await this.db('/rest/v1/api_usage?select=count&user_id=eq.' + encodeURIComponent(userId) + '&kind=eq.pro&day=gte.' + dayKst);
    if (!res.ok) return null;
    return ((await res.json()) as { count: number }[]).reduce((s, r) => s + (r.count || 0), 0);
  }

  async portonePayment(paymentId: string): Promise<PortonePayment | null> {
    try {
      const res = await this.f(PORTONE_API + '/payments/' + encodeURIComponent(paymentId), {
        headers: { authorization: 'PortOne ' + this.env.PORTONE_API_SECRET },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn('[pay] 포트원 조회 실패 ' + res.status + ' ' + paymentId);
        return null;
      }
      return (await res.json()) as PortonePayment;
    } catch {
      console.warn('[pay] 포트원 조회 네트워크 오류 ' + paymentId);
      return null;
    }
  }

  async portoneCancel(paymentId: string, reason: string): Promise<boolean> {
    try {
      const res = await this.f(PORTONE_API + '/payments/' + encodeURIComponent(paymentId) + '/cancel', {
        method: 'POST',
        headers: { authorization: 'PortOne ' + this.env.PORTONE_API_SECRET, 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) console.warn('[pay] 포트원 취소 실패 ' + res.status + ' ' + paymentId + ' ' + (await res.text()).slice(0, 200));
      return res.ok;
    } catch {
      console.warn('[pay] 포트원 취소 네트워크 오류 ' + paymentId);
      return false;
    }
  }
}

export interface PaymentRow {
  payment_id: string;
  user_id: string | null;
  buyer_email: string | null;
  amount: number;
  status: 'ready' | 'paid' | 'cancelled' | 'failed';
  period_days: number;
  web_count: number;
  granted_at: string | null;
  period_end: string | null;
  pay_method: string | null;
}

interface GrantResult { already: boolean; expires_at: string | null; web_left?: number | null }

/** 결제 확인 → 반영. complete와 웹훅이 같이 쓴다 */
async function confirmAndGrant(api: Api, env: PayEnv, row: PaymentRow): Promise<
  | { kind: 'granted'; result: GrantResult }
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'mismatch'; reason: string }
  | { kind: 'error' }
> {
  const p = await api.portonePayment(row.payment_id);
  if (!p) return { kind: 'error' };
  const v = checkPayment(p, row.amount, env);
  if (!v.ok) {
    if (v.reason === 'not_paid') {
      if (v.status === 'FAILED' || v.status === 'CANCELLED') {
        await api.markFailed(row.payment_id);
        return { kind: 'failed' };
      }
      return { kind: 'pending' }; // READY · PAY_PENDING 등 — 웹훅이 나중에 마무리
    }
    console.warn('[pay] mismatch ' + v.reason + ' ' + row.payment_id);
    return { kind: 'mismatch', reason: v.reason };
  }
  const result = await api.rpc<GrantResult>('grant_pro_pass', { p_payment: row.payment_id, p_tx: v.tx, p_method: v.method });
  if (!result) return { kind: 'error' };
  return { kind: 'granted', result };
}

function kstDay(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = await request.json();
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function handlePay(request: Request, env: PayEnv, f: FetchLike = (i, init) => fetch(i, init)): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const action = path.slice('/api/pay/'.length);
  const api = new Api(env, f);

  // ── 웹훅: 로그인 없이 오고, 서명으로 지킨다 ──
  if (action === 'webhook') {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
    const miss = missingPayEnv(env, true);
    if (miss.length) {
      console.warn('[pay] 서버 설정 없음: ' + miss.join(', '));
      return json(503, { error: 'not configured' });
    }
    const raw = await request.text();
    if (raw.length > 64_000 || !(await verifyWebhook(env.PORTONE_WEBHOOK_SECRET!, request.headers, raw))) {
      console.warn('[pay] 웹훅 서명 실패');
      return json(401, { error: 'invalid signature' });
    }
    let msg: { type?: unknown; data?: { paymentId?: unknown; storeId?: unknown } } = {};
    try {
      msg = JSON.parse(raw);
    } catch {
      return json(400, { error: 'bad body' });
    }
    const type = String(msg.type ?? '');
    const paymentId = msg.data?.paymentId;
    // 모르는 종류·우리 주문이 아닌 것은 200으로 무시한다(포트원 안내: 새 type이 예고 없이 생길 수 있다)
    if (!isPaymentId(paymentId)) return json(200, { ignored: true });
    if (msg.data?.storeId != null && msg.data.storeId !== env.PORTONE_STORE_ID) return json(200, { ignored: true });

    const row = await api.order(paymentId);
    if (row === 'error') return json(500, { error: 'db' }); // 포트원이 다시 보낸다
    if (!row) return json(200, { ignored: true });

    if (type === 'Transaction.Paid') {
      const r = await confirmAndGrant(api, env, row);
      if (r.kind === 'error') return json(500, { error: 'retry' });
      return json(200, { result: r.kind });
    }
    if (type === 'Transaction.Cancelled' || type === 'Transaction.PartialCancelled') {
      const p = await api.portonePayment(paymentId);
      if (!p) return json(500, { error: 'retry' });
      if (p.status === 'CANCELLED') {
        const r = await api.rpc<{ already: boolean }>('revoke_pro_pass', { p_payment: paymentId, p_reason: 'portone:' + type });
        if (!r) return json(500, { error: 'retry' });
        return json(200, { result: 'revoked' });
      }
      // 부분 취소는 이 상품에 없다(항상 전액 취소) — 생기면 사람이 본다
      console.warn('[pay] 부분 취소 수신 — 수동 확인 필요 ' + paymentId);
      return json(200, { result: 'partial_ignored' });
    }
    if (type === 'Transaction.Failed') {
      await api.markFailed(paymentId);
      return json(200, { result: 'failed' });
    }
    return json(200, { ignored: true });
  }

  // ── 그 밖의 주소: 로그인 필요 ──
  const miss = missingPayEnv(env);
  if (miss.length) {
    console.warn('[pay] 서버 설정 없음: ' + miss.join(', '));
    return json(503, { error: '결제 기능이 아직 준비 중이에요.', code: 'not_configured' });
  }
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!m) return json(401, { error: '로그인이 필요해요.' });
  const user = await api.user(m[1]);
  if (!user) return json(401, { error: '로그인이 필요해요.' });

  if (action === 'history') {
    if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
    const rows = await api.history(user.id);
    if (!rows) return json(503, { error: '결제 내역을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' });
    return json(200, { payments: rows });
  }

  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const body = await readJson(request);
  if (!body) return json(400, { error: '요청 형식이 올바르지 않아요.' });

  if (action === 'prepare') {
    const product: Product | null = productById(body.product);
    if (!product) return json(400, { error: '상품이 올바르지 않아요.' });
    const recent = await api.recentOrders(user.id, new Date(Date.now() - 3600_000).toISOString());
    if (recent === null) return json(503, { error: '결제를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.' });
    if (recent >= MAX_ORDERS_PER_HOUR) return json(429, { error: '결제 시도가 많았어요. 잠시 후 다시 시도해 주세요.' });
    const paymentId = newPaymentId();
    const ok = await api.insertOrder({
      payment_id: paymentId,
      user_id: user.id,
      buyer_email: user.email || null,
      product: product.id,
      amount: product.amount,
      currency: product.currency,
      period_days: product.days,
      web_count: product.web,
    });
    if (!ok) return json(503, { error: '결제를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.' });
    return json(200, { paymentId, orderName: product.name, amount: product.amount, currency: product.currency });
  }

  if (action === 'complete') {
    if (!isPaymentId(body.paymentId)) return json(400, { error: '결제 번호가 올바르지 않아요.' });
    const row = await api.order(body.paymentId);
    if (row === 'error') return json(503, { error: '결제를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.' });
    if (!row || row.user_id !== user.id) return json(404, { error: '결제를 찾지 못했어요.' });
    if (row.status === 'paid') return json(200, { status: 'paid', already: true, expiresAt: row.period_end });
    if (row.status === 'cancelled') return json(409, { error: '취소된 결제예요.', status: 'cancelled' });
    const r = await confirmAndGrant(api, env, row);
    switch (r.kind) {
      case 'granted':
        return json(200, { status: 'paid', already: r.result.already, expiresAt: r.result.expires_at, webLeft: r.result.web_left ?? null });
      case 'pending':
        return json(202, { status: 'pending', message: '결제를 확인하고 있어요. 잠시 뒤 자동으로 반영돼요.' });
      case 'failed':
        return json(402, { status: 'failed', error: '결제가 완료되지 않았어요.' });
      case 'mismatch':
        return json(409, { status: 'mismatch', error: '결제 확인이 필요해요. help@mongsil2.com으로 결제 번호와 함께 문의해 주세요.' });
      default:
        return json(503, { status: 'pending', error: '결제를 확인하지 못했어요. 결제가 됐다면 잠시 뒤 자동으로 반영돼요.' });
    }
  }

  // 관리자: 반영이 안 된 결제(웹훅 실패 등)를 포트원에 다시 조회해 반영 — 운영 절차 docs/PAYMENT_OPERATIONS.md
  if (action === 'recheck') {
    if (!(await api.isAdmin(user.email))) return json(403, { error: '관리자만 쓸 수 있어요.' });
    if (!isPaymentId(body.paymentId)) return json(400, { error: '결제 번호가 올바르지 않아요.' });
    const row = await api.order(body.paymentId);
    if (row === 'error') return json(503, { error: 'DB 조회 실패' });
    if (!row) return json(404, { error: '결제를 찾지 못했어요.' });
    if (row.status === 'paid' || row.status === 'cancelled') return json(200, { status: row.status, already: true, buyerEmail: row.buyer_email });
    const r = await confirmAndGrant(api, env, row);
    const status = r.kind === 'granted' ? 'paid' : r.kind;
    return json(200, { status, buyerEmail: row.buyer_email, ...(r.kind === 'mismatch' ? { reason: r.reason } : {}) });
  }

  if (action === 'refund') {
    if (!(await api.isAdmin(user.email))) return json(403, { error: '관리자만 쓸 수 있어요.' });
    if (!isPaymentId(body.paymentId)) return json(400, { error: '결제 번호가 올바르지 않아요.' });
    const row = await api.order(body.paymentId);
    if (row === 'error') return json(503, { error: 'DB 조회 실패' });
    if (!row) return json(404, { error: '결제를 찾지 못했어요.' });
    if (row.status === 'cancelled') return json(200, { status: 'cancelled', already: true });
    if (row.status !== 'paid') return json(409, { error: '완료된 결제만 환불할 수 있어요.', status: row.status });
    const paidAt = row.granted_at ?? new Date().toISOString();
    const days = Math.floor((Date.now() - Date.parse(paidAt)) / 86_400_000);
    const proUse = row.user_id ? await api.proUseSince(row.user_id, kstDay(paidAt)) : null;
    // 판단 자료 — 기준: 결제 후 7일 이내 + PRO 전용 기능 미사용(설계 문서 0장). 최종 판단은 관리자
    const info = { paymentId: row.payment_id, buyerEmail: row.buyer_email, amount: row.amount, paidAt, daysSincePaid: days, proUseSincePaid: proUse, withinPolicy: days < 7 && proUse === 0 };
    if (body.confirm !== true) return json(200, { status: 'review', ...info });
    const reason = String(body.reason ?? '').trim().slice(0, 200) || '고객 요청';
    if (!(await api.portoneCancel(row.payment_id, reason))) return json(502, { error: '포트원 취소에 실패했어요. 포트원 콘솔에서 상태를 확인해 주세요.', ...info });
    const r = await api.rpc<{ already: boolean }>('revoke_pro_pass', { p_payment: row.payment_id, p_reason: reason });
    if (!r) return json(500, { error: '취소는 됐지만 이용권 회수에 실패했어요. 웹훅이 다시 시도해요. 로그를 확인해 주세요.', ...info });
    return json(200, { status: 'cancelled', ...info });
  }

  return json(404, { error: 'Not found' });
}
