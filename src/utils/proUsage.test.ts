/**
 * PRO 웹 검색의 이용권 상한(총 100번)과 PRO 사용 기록(환불 기준) — api/ai.ts 서버 흐름을 가짜 Supabase·Gemini로 시험한다.
 * 순서가 중요하다: PRO 확인 → 사용 기록 → (캐시) → 하루 상한(20) → 이용권 남은 수 → Gemini
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import handler from '../../api/ai';

declare const process: { env: Record<string, string | undefined> };

interface World { webLeft: boolean; dailyOk: boolean; rpc: string[]; gemini: number; planRow: Record<string, unknown> | null; admin?: boolean }

function stub(w: World) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = typeof init.body === 'string' ? init.body : '';
    if (url.includes('/auth/v1/user')) return Response.json({ id: 'u-1', email: 'a@x.com' });
    if (url.includes('/rest/v1/app_roles')) return Response.json(w.admin ? [{ role: 'admin' }] : []);
    if (url.includes('/rest/v1/user_plans')) return Response.json(w.planRow ? [w.planRow] : []);
    if (url.includes('/rest/v1/ai_plan_cache')) return (init.method ?? 'GET') === 'GET' ? Response.json([]) : new Response(null, { status: 201 });
    if (url.includes('/rest/v1/rpc/spend_api_quota')) {
      const kind = JSON.parse(body).p_kind;
      w.rpc.push('quota:' + kind);
      return Response.json(kind === 'web' ? w.dailyOk : true);
    }
    if (url.includes('/rest/v1/rpc/spend_web_left')) {
      w.rpc.push('web_left');
      return Response.json(w.webLeft);
    }
    if (url.includes('generativelanguage.googleapis.com')) {
      w.gemini++;
      return Response.json({ candidates: [{ content: { parts: [{ text: '###ANSWER###\n답이에요\n###USED###\n- 없음' }] } }] });
    }
    throw new Error('예상 못 한 호출 ' + url);
  });
}

function call(body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  return new Promise((resolve) => {
    let status = 200;
    const res = {
      status(c: number) { status = c; return res; },
      json(j: any) { resolve({ status, json: j }); },
      setHeader() { return res; },
    };
    void handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body } as any, res as any);
  });
}

const FUTURE = new Date(Date.now() + 10 * 86400_000).toISOString();
const world = (over: Partial<World> = {}): World => ({ webLeft: true, dailyOk: true, rpc: [], gemini: 0, planRow: { plan: 'pro', expires_at: FUTURE, web_left: 5 }, ...over });
const webQ = { kind: 'doc-qa', tripId: 't', question: '왕궁 입장료?', sources: [], web: true };

describe('PRO 웹 검색 — 이용권 총 100번', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://db.example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
    process.env.GEMINI_API_KEY = 'gemini-test';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('남은 수가 있으면: 사용 기록 → 하루 상한 → 남은 수 차감 → Gemini', async () => {
    const w = world();
    stub(w);
    const r = await call(webQ);
    expect(r.status).toBe(200);
    expect(w.rpc).toEqual(['quota:pro', 'quota:web', 'web_left']);
    expect(w.gemini).toBe(1);
  });

  it('남은 수가 0이면 429(web_left_exhausted), Gemini를 부르지 않는다', async () => {
    const w = world({ webLeft: false });
    stub(w);
    const r = await call(webQ);
    expect(r.status).toBe(429);
    expect(r.json.code).toBe('web_left_exhausted');
    expect(w.gemini).toBe(0);
  });

  it('하루 상한에 걸리면 이용권 남은 수를 쓰지 않는다', async () => {
    const w = world({ dailyOk: false });
    stub(w);
    const r = await call(webQ);
    expect(r.status).toBe(429);
    expect(w.rpc).not.toContain('web_left');
    expect(w.gemini).toBe(0);
  });

  it('무료면 403, 사용 기록도 남기지 않는다', async () => {
    const w = world({ planRow: null });
    stub(w);
    const r = await call(webQ);
    expect(r.status).toBe(403);
    expect(w.rpc).toEqual([]);
  });

  it('my-plan: PRO면 만료일·남은 웹 검색을 함께 준다, 무료면 plan만', async () => {
    stub(world());
    expect((await call({ kind: 'my-plan' })).json).toEqual({ plan: 'pro', expiresAt: FUTURE, webLeft: 5 });
    stub(world({ planRow: null }));
    expect((await call({ kind: 'my-plan' })).json).toEqual({ plan: 'free' });
  });

  it('인생샷·영수증 AI도 쓰면 PRO 사용 기록을 남긴다(환불 기준)', async () => {
    const w = world();
    stub(w);
    await call({ kind: 'photo-spots', lat: 13.75, lng: 100.49, city: '방콕' });
    expect(w.rpc[0]).toBe('quota:pro');
    process.env.RECEIPT_AI_ENABLED = 'true';
    const w2 = world();
    stub(w2);
    await call({ kind: 'receipt-read', mimeType: 'image/jpeg', image: 'QUJD' });
    delete process.env.RECEIPT_AI_ENABLED;
    expect(w2.rpc[0]).toBe('quota:pro');
  });

  it('my-plan: 관리자면 admin 표시가 붙는다(권한은 결제 서버가 다시 확인)', async () => {
    stub(world({ planRow: null, admin: true }));
    expect((await call({ kind: 'my-plan' })).json).toEqual({ plan: 'pro', expiresAt: null, webLeft: null, admin: true });
  });
});

