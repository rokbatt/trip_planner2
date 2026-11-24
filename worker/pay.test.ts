import { describe, it, expect } from 'vitest';
import { handlePay, verifyWebhook, signWebhook, checkPayment, missingPayEnv, isPaymentId, newPaymentId, payMethodLabel, type PayEnv } from './pay';
import { AUTH_EXEMPT } from './auth';
import { PRODUCTS } from '../src/pay/products';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const ENV: PayEnv = {
  SUPABASE_URL: 'https://db.example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  PORTONE_API_SECRET: 'portone-secret-test',
  PORTONE_WEBHOOK_SECRET: SECRET,
  PORTONE_STORE_ID: 'store-ours',
};
const PID = 'mongsil-0123456789abcdef01234567';
const UID = 'u-1';

describe('Standard Webhooks 서명', () => {
  // 명세(standardwebhooks.com / Svix 문서)의 공개 예제 값 — 파이썬 hmac으로도 같은 값을 확인했다
  const id = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
  const ts = '1614265330';
  const body = '{"test": 2432232314}';
  const sig = 'g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=';
  const h = (s: string, t = ts) => new Headers({ 'webhook-id': id, 'webhook-timestamp': t, 'webhook-signature': s });

  it('명세 예제와 같은 서명을 만든다', async () => {
    expect(await signWebhook(SECRET, id, ts, body)).toBe(sig);
  });
  it('맞는 서명은 통과(여러 개 중 하나만 맞아도)', async () => {
    expect(await verifyWebhook(SECRET, h('v1,' + sig), body, 1614265330)).toBe(true);
    expect(await verifyWebhook(SECRET, h('v1,AAAA v1,' + sig), body, 1614265330)).toBe(true);
  });
  it('본문이 한 글자라도 다르거나, 서명이 틀리거나, 버전 표시가 없으면 거절', async () => {
    expect(await verifyWebhook(SECRET, h('v1,' + sig), body + ' ', 1614265330)).toBe(false);
    expect(await verifyWebhook(SECRET, h('v1,' + sig.replace('g', 'h')), body, 1614265330)).toBe(false);
    expect(await verifyWebhook(SECRET, h(sig), body, 1614265330)).toBe(false);
  });
  it('시각이 5분 넘게 다르면 거절(다시 보내기 공격)', async () => {
    expect(await verifyWebhook(SECRET, h('v1,' + sig), body, 1614265330 + 301)).toBe(false);
    expect(await verifyWebhook(SECRET, h('v1,' + sig), body, 1614265330 + 299)).toBe(true);
  });
  it('헤더가 빠지면 거절', async () => {
    expect(await verifyWebhook(SECRET, new Headers(), body, 1614265330)).toBe(false);
  });
});

describe('포트원 결제 검증', () => {
  const paid = { status: 'PAID', amount: { total: 4900 }, currency: 'KRW', storeId: 'store-ours', transactionId: 'tx-1', channel: { type: 'LIVE' }, method: { type: 'PaymentMethodEasyPay', provider: 'KAKAOPAY' } };
  it('완료·금액·통화·상점·실결제 채널이 맞을 때만 통과', () => {
    expect(checkPayment(paid, 4900, ENV)).toEqual({ ok: true, tx: 'tx-1', method: 'EASY_PAY:KAKAOPAY' });
    expect(checkPayment({ ...paid, status: 'READY' }, 4900, ENV)).toMatchObject({ ok: false, reason: 'not_paid' });
    expect(checkPayment({ ...paid, amount: { total: 100 } }, 4900, ENV)).toMatchObject({ ok: false, reason: 'amount' });
    expect(checkPayment({ ...paid, currency: 'USD' }, 4900, ENV)).toMatchObject({ ok: false, reason: 'currency' });
    expect(checkPayment({ ...paid, storeId: 'store-other' }, 4900, ENV)).toMatchObject({ ok: false, reason: 'store' });
  });
  it('운영에서는 테스트 채널·채널 정보 없음을 거절, PAY_ALLOW_TEST=true면 허용', () => {
    expect(checkPayment({ ...paid, channel: { type: 'TEST' } }, 4900, ENV)).toMatchObject({ ok: false, reason: 'test_channel' });
    expect(checkPayment({ ...paid, channel: undefined }, 4900, ENV)).toMatchObject({ ok: false, reason: 'test_channel' });
    expect(checkPayment({ ...paid, channel: { type: 'TEST' } }, 4900, { ...ENV, PAY_ALLOW_TEST: 'true' }).ok).toBe(true);
  });
  it('결제 수단 이름', () => {
    expect(payMethodLabel({ type: 'PaymentMethodCard' })).toBe('CARD');
    expect(payMethodLabel({ type: 'PaymentMethodEasyPay', provider: 'TOSSPAY' })).toBe('EASY_PAY:TOSSPAY');
    expect(payMethodLabel(undefined)).toBe('');
  });
  it('결제 번호 형식', () => {
    expect(isPaymentId(newPaymentId())).toBe(true);
    expect(isPaymentId('mongsil-xyz')).toBe(false);
    expect(isPaymentId('../evil')).toBe(false);
  });
});

/* ── 가짜 Supabase·포트원 ── */
interface Fake {
  rows: Map<string, any>;
  calls: { url: string; method: string; body?: string; headers: Headers }[];
  portone: any;
  admin: boolean;
  proUse: number;
}

function fake(init: Partial<Fake> = {}): { f: (url: string, init?: RequestInit) => Promise<Response>; s: Fake } {
  const s: Fake = { rows: new Map(), calls: [], portone: null, admin: false, proUse: 0, ...init };
  const f = async (url: string, i: RequestInit = {}) => {
    const method = i.method ?? 'GET';
    const body = typeof i.body === 'string' ? i.body : undefined;
    s.calls.push({ url, method, body, headers: new Headers(i.headers) });
    if (url.endsWith('/auth/v1/user')) {
      const tok = new Headers(i.headers).get('authorization');
      if (tok === 'Bearer user-token') return Response.json({ id: UID, email: 'A@x.com' });
      if (tok === 'Bearer other-token') return Response.json({ id: 'u-2', email: 'b@x.com' });
      return new Response('{}', { status: 401 });
    }
    if (url.includes('/rest/v1/app_roles')) return Response.json(s.admin ? [{ role: 'admin' }] : []);
    if (url.includes('/rest/v1/api_usage')) return Response.json([{ count: s.proUse }]);
    if (url.includes('/rest/v1/rpc/grant_pro_pass')) {
      const a = JSON.parse(body!);
      const r = s.rows.get(a.p_payment);
      if (r.status === 'paid') return Response.json({ already: true, expires_at: r.period_end });
      r.status = 'paid';
      r.period_end = '2026-12-24T00:00:00Z';
      r.granted_at = new Date().toISOString();
      return Response.json({ already: false, expires_at: r.period_end, web_left: 100 });
    }
    if (url.includes('/rest/v1/rpc/revoke_pro_pass')) {
      const a = JSON.parse(body!);
      const r = s.rows.get(a.p_payment);
      const already = r.status === 'cancelled';
      r.status = 'cancelled';
      return Response.json({ already });
    }
    if (url.includes('/rest/v1/payments')) {
      if (method === 'POST') {
        const row = JSON.parse(body!);
        s.rows.set(row.payment_id, { status: 'ready', granted_at: null, period_end: null, ...row });
        return new Response(null, { status: 201 });
      }
      if (method === 'PATCH') {
        const id = decodeURIComponent(/payment_id=eq\.([^&]+)/.exec(url)![1]);
        const r = s.rows.get(id);
        if (r && r.status === 'ready') Object.assign(r, JSON.parse(body!));
        return new Response(null, { status: 204 });
      }
      const m = /payment_id=eq\.([^&]+)/.exec(url);
      if (m) {
        const r = s.rows.get(decodeURIComponent(m[1]));
        return Response.json(r ? [r] : []);
      }
      if (url.includes('created_at=gte.')) return Response.json([...s.rows.values()].filter((r) => r.user_id === UID));
      return Response.json([...s.rows.values()].filter((r) => r.user_id === UID && (r.status === 'paid' || r.status === 'cancelled')));
    }
    if (url.startsWith('https://api.portone.io/payments/')) {
      expect(new Headers(i.headers).get('authorization')).toBe('PortOne portone-secret-test');
      if (url.endsWith('/cancel')) {
        s.portone = { ...s.portone, status: 'CANCELLED' };
        return Response.json({ cancellation: { status: 'SUCCEEDED' } });
      }
      return s.portone ? Response.json(s.portone) : new Response('{}', { status: 404 });
    }
    throw new Error('예상 못 한 호출 ' + url);
  };
  return { f, s };
}

const req = (action: string, body?: unknown, token = 'user-token', method = 'POST') =>
  new Request('https://www.mongsil2.com/api/pay/' + action, {
    method,
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const readyRow = (extra: Record<string, unknown> = {}) => ({
  payment_id: PID, user_id: UID, buyer_email: 'a@x.com', amount: 4900, status: 'ready', period_days: 30, web_count: 100, granted_at: null, period_end: null, pay_method: null, ...extra,
});
const PAID = { status: 'PAID', amount: { total: 4900 }, currency: 'KRW', storeId: 'store-ours', transactionId: 'tx-9', channel: { type: 'LIVE' }, method: { type: 'PaymentMethodCard' } };

describe('/api/pay 설정·로그인', () => {
  it('설정이 빠지면 이름은 로그에만, 응답에는 값·이름 없이 503', async () => {
    expect(missingPayEnv({}, true)).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PORTONE_API_SECRET', 'PORTONE_STORE_ID', 'PORTONE_WEBHOOK_SECRET']);
    const res = await handlePay(req('prepare', { product: 'pro_30d' }), {}, async () => { throw new Error('호출하면 안 됨'); });
    expect(res.status).toBe(503);
    expect(await res.text()).not.toMatch(/SECRET|service/);
  });
  it('토큰이 없거나 틀리면 401', async () => {
    const { f } = fake();
    expect((await handlePay(req('prepare', { product: 'pro_30d' }, 'bad'), ENV, f)).status).toBe(401);
  });
  it('웹훅 주소만 Worker 입구의 로그인 확인 예외다', () => {
    expect(AUTH_EXEMPT.has('/api/pay/webhook')).toBe(true);
    expect(AUTH_EXEMPT.has('/api/pay/complete')).toBe(false);
    expect(AUTH_EXEMPT.has('/api/pay/refund')).toBe(false);
  });
});

describe('prepare — 주문 만들기', () => {
  it('금액·기간은 서버 상품표에서 정한다(화면이 보낸 금액은 무시)', async () => {
    const { f, s } = fake();
    const res = await handlePay(req('prepare', { product: 'pro_30d', amount: 1 }), ENV, f);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(isPaymentId(j.paymentId)).toBe(true);
    expect(j).toMatchObject({ amount: 4900, orderName: PRODUCTS.pro_30d.name, currency: 'KRW' });
    expect(s.rows.get(j.paymentId)).toMatchObject({ user_id: UID, buyer_email: 'a@x.com', amount: 4900, period_days: 30, web_count: 100, status: 'ready' });
  });
  it('없는 상품은 400', async () => {
    const { f } = fake();
    expect((await handlePay(req('prepare', { product: 'free_money' }), ENV, f)).status).toBe(400);
  });
  it('1시간에 10개를 넘으면 429', async () => {
    const { f, s } = fake();
    for (let i = 0; i < 10; i++) s.rows.set('mongsil-' + String(i).padStart(24, '0'), readyRow({ payment_id: 'x' + i }));
    expect((await handlePay(req('prepare', { product: 'pro_30d' }), ENV, f)).status).toBe(429);
  });
});

describe('complete — 결제 확인 후 반영', () => {
  it('포트원이 완료라고 하고 금액이 맞으면 반영', async () => {
    const { f, s } = fake({ portone: PAID });
    s.rows.set(PID, readyRow());
    const res = await handlePay(req('complete', { paymentId: PID }), ENV, f);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'paid', already: false, webLeft: 100 });
    const grant = s.calls.find((c) => c.url.includes('grant_pro_pass'))!;
    expect(JSON.parse(grant.body!)).toEqual({ p_payment: PID, p_tx: 'tx-9', p_method: 'CARD' });
  });
  it('남의 주문이면 404(존재 여부도 안 알려 줌)', async () => {
    const { f, s } = fake({ portone: PAID });
    s.rows.set(PID, readyRow());
    expect((await handlePay(req('complete', { paymentId: PID }, 'other-token'), ENV, f)).status).toBe(404);
    expect(s.calls.some((c) => c.url.includes('api.portone.io'))).toBe(false);
  });
  it('이미 반영됐으면 포트원을 다시 부르지 않고 성공', async () => {
    const { f, s } = fake({ portone: PAID });
    s.rows.set(PID, readyRow({ status: 'paid', period_end: '2026-12-24T00:00:00Z' }));
    const res = await handlePay(req('complete', { paymentId: PID }), ENV, f);
    expect(await res.json()).toMatchObject({ status: 'paid', already: true });
    expect(s.calls.some((c) => c.url.includes('api.portone.io'))).toBe(false);
  });
  it('금액이 다르면 반영하지 않는다', async () => {
    const { f, s } = fake({ portone: { ...PAID, amount: { total: 100 } } });
    s.rows.set(PID, readyRow());
    expect((await handlePay(req('complete', { paymentId: PID }), ENV, f)).status).toBe(409);
    expect(s.calls.some((c) => c.url.includes('grant_pro_pass'))).toBe(false);
  });
  it('아직 승인 전이면 202, 실패면 failed로 표시', async () => {
    const a = fake({ portone: { ...PAID, status: 'READY' } });
    a.s.rows.set(PID, readyRow());
    expect((await handlePay(req('complete', { paymentId: PID }), ENV, a.f)).status).toBe(202);
    const b = fake({ portone: { ...PAID, status: 'FAILED' } });
    b.s.rows.set(PID, readyRow());
    expect((await handlePay(req('complete', { paymentId: PID }), ENV, b.f)).status).toBe(402);
    expect(b.s.rows.get(PID).status).toBe('failed');
  });
  it('포트원 조회가 안 되면 503(웹훅이 나중에 반영)', async () => {
    const { f, s } = fake({ portone: null });
    s.rows.set(PID, readyRow());
    expect((await handlePay(req('complete', { paymentId: PID }), ENV, f)).status).toBe(503);
  });
});

async function webhookReq(payload: unknown, secret = SECRET): Promise<Request> {
  const body = JSON.stringify(payload);
  const id = 'msg_test';
  const ts = String(Math.floor(Date.now() / 1000));
  return new Request('https://www.mongsil2.com/api/pay/webhook', {
    method: 'POST',
    headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': 'v1,' + (await signWebhook(secret, id, ts, body)), 'content-type': 'application/json' },
    body,
  });
}

describe('webhook', () => {
  it('서명이 틀리면 401, 아무것도 하지 않는다', async () => {
    const { f, s } = fake({ portone: PAID });
    s.rows.set(PID, readyRow());
    const r = await webhookReq({ type: 'Transaction.Paid', data: { paymentId: PID, storeId: 'store-ours' } }, 'whsec_' + btoa('wrong-secret-wrong-secret'));
    expect((await handlePay(r, ENV, f)).status).toBe(401);
    expect(s.calls.length).toBe(0);
  });
  it('Transaction.Paid → 다시 조회해서 반영. 같은 웹훅이 또 와도 한 번만', async () => {
    const { f, s } = fake({ portone: PAID });
    s.rows.set(PID, readyRow());
    const msg = { type: 'Transaction.Paid', timestamp: '2026-11-24T00:00:00Z', data: { paymentId: PID, storeId: 'store-ours', transactionId: 'tx-9' } };
    expect((await handlePay(await webhookReq(msg), ENV, f)).status).toBe(200);
    expect(s.rows.get(PID).status).toBe('paid');
    await handlePay(await webhookReq(msg), ENV, f);
    expect(s.calls.filter((c) => c.url.includes('grant_pro_pass')).length).toBe(2); // DB 함수가 두 번째를 already로 처리
  });
  it('웹훅 본문이 완료라고 해도 포트원 조회가 완료가 아니면 반영하지 않는다', async () => {
    const { f, s } = fake({ portone: { ...PAID, status: 'READY' } });
    s.rows.set(PID, readyRow());
    await handlePay(await webhookReq({ type: 'Transaction.Paid', data: { paymentId: PID, storeId: 'store-ours' } }), ENV, f);
    expect(s.calls.some((c) => c.url.includes('grant_pro_pass'))).toBe(false);
  });
  it('Transaction.Cancelled → 포트원이 취소라고 하면 회수', async () => {
    const { f, s } = fake({ portone: { ...PAID, status: 'CANCELLED' } });
    s.rows.set(PID, readyRow({ status: 'paid' }));
    const res = await handlePay(await webhookReq({ type: 'Transaction.Cancelled', data: { paymentId: PID, storeId: 'store-ours' } }), ENV, f);
    expect(await res.json()).toEqual({ result: 'revoked' });
    expect(s.rows.get(PID).status).toBe('cancelled');
  });
  it('모르는 종류·남의 상점·우리 주문 아님은 200으로 무시', async () => {
    const { f, s } = fake({ portone: PAID });
    s.rows.set(PID, readyRow());
    expect(await (await handlePay(await webhookReq({ type: 'BillingKey.Issued', data: { storeId: 'store-ours', billingKey: 'x' } }), ENV, f)).json()).toEqual({ ignored: true });
    expect(await (await handlePay(await webhookReq({ type: 'Transaction.Paid', data: { paymentId: PID, storeId: 'store-other' } }), ENV, f)).json()).toEqual({ ignored: true });
    expect(await (await handlePay(await webhookReq({ type: 'Transaction.Paid', data: { paymentId: 'mongsil-ffffffffffffffffffffffff', storeId: 'store-ours' } }), ENV, f)).json()).toEqual({ ignored: true });
    expect(s.calls.some((c) => c.url.includes('grant_pro_pass'))).toBe(false);
  });
  it('DB나 포트원이 잠깐 안 되면 500(포트원이 다시 보낸다)', async () => {
    const { f, s } = fake({ portone: null });
    s.rows.set(PID, readyRow());
    expect((await handlePay(await webhookReq({ type: 'Transaction.Paid', data: { paymentId: PID, storeId: 'store-ours' } }), ENV, f)).status).toBe(500);
  });
});

describe('history · refund', () => {
  it('내 결제 내역은 완료·취소만', async () => {
    const { f, s } = fake();
    s.rows.set(PID, readyRow({ status: 'paid' }));
    s.rows.set('mongsil-ffffffffffffffffffffffff', readyRow({ payment_id: 'mongsil-ffffffffffffffffffffffff' }));
    const res = await handlePay(req('history', undefined, 'user-token', 'GET'), ENV, f);
    expect((await res.json()).payments.length).toBe(1);
  });
  it('관리자가 아니면 403', async () => {
    const { f, s } = fake({ portone: PAID });
    s.rows.set(PID, readyRow({ status: 'paid', granted_at: new Date().toISOString() }));
    expect((await handlePay(req('refund', { paymentId: PID }), ENV, f)).status).toBe(403);
  });
  it('관리자: 먼저 판단 자료(7일·PRO 사용 횟수)만, confirm이면 포트원 취소 → 회수', async () => {
    const { f, s } = fake({ portone: PAID, admin: true, proUse: 0 });
    s.rows.set(PID, readyRow({ status: 'paid', granted_at: new Date().toISOString() }));
    const review = await (await handlePay(req('refund', { paymentId: PID }), ENV, f)).json();
    expect(review).toMatchObject({ status: 'review', withinPolicy: true, proUseSincePaid: 0, daysSincePaid: 0 });
    expect(s.calls.some((c) => c.url.endsWith('/cancel'))).toBe(false);
    const done = await (await handlePay(req('refund', { paymentId: PID, confirm: true, reason: '단순 변심' }), ENV, f)).json();
    expect(done.status).toBe('cancelled');
    expect(JSON.parse(s.calls.find((c) => c.url.endsWith('/cancel'))!.body!)).toEqual({ reason: '단순 변심' });
    expect(s.rows.get(PID).status).toBe('cancelled');
  });
  it('PRO 기능을 썼으면 판단 자료에 기준 밖으로 표시', async () => {
    const { f, s } = fake({ portone: PAID, admin: true, proUse: 3 });
    s.rows.set(PID, readyRow({ status: 'paid', granted_at: new Date().toISOString() }));
    expect(await (await handlePay(req('refund', { paymentId: PID }), ENV, f)).json()).toMatchObject({ withinPolicy: false, proUseSincePaid: 3 });
  });
});
