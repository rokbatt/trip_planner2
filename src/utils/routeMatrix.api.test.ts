/**
 * 구간 비교(legs) 호출이 키·권한 문제에서 폭주하지 않는지 — 대시보드에서 "Routes API 671건, 오류 100%"가
 * 찍힌 원인(구간 × 모드를 한꺼번에 쏴서 실패가 75건씩 나갔다)을 붙든다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../../api/route-matrix';

// 이 프로젝트의 tsconfig엔 node 타입이 없다(api/*.ts도 같은 방식으로 선언한다)
declare const process: { env: Record<string, string | undefined> };

function res() {
  const out: { status?: number; body?: any } = {};
  const r: any = { status: (c: number) => { out.status = c; return r; }, json: (b: any) => { out.body = b; } };
  return { r, out };
}

const legs = Array.from({ length: 10 }, (_, i) => ({
  id: 'leg' + i,
  from: { lat: 13.7 + i * 0.001, lng: 100.5 },
  to: { lat: 13.71 + i * 0.001, lng: 100.52 },
}));

beforeEach(() => {
  process.env.GOOGLE_ROUTES_API_KEY = 'k';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('route-matrix legs', () => {
  it('키·권한 문제(403)면 첫 호출에서 멈춘다 — 30건이 아니라 1건', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: 403, message: 'API_KEY_SERVICE_BLOCKED' } }), { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const { r, out } = res();
    await handler({ method: 'POST', body: { legs, modes: ['WALK', 'TRANSIT', 'DRIVE'] } }, r);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.status).toBe(200);
    expect(out.body.error).toEqual({ status: 403, message: 'API_KEY_SERVICE_BLOCKED' });
    expect(out.body.results).toHaveLength(10);
  });

  it('정상이면 첫 호출 뒤 나머지를 모두 요청한다', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ routes: [{ duration: '600s', distanceMeters: 900 }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { r, out } = res();
    await handler({ method: 'POST', body: { legs: legs.slice(0, 2), modes: ['WALK', 'DRIVE'] } }, r);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(out.body.error).toBeUndefined();
    expect(out.body.results[0].modes.WALK.seconds).toBe(600);
  });

  it('특정 구간만 틀린 요청(400)이면 멈추지 않는다', async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => (++n === 1 ? new Response('{"error":{"message":"bad"}}', { status: 400 }) : new Response(JSON.stringify({ routes: [{ duration: '60s', distanceMeters: 10 }] }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { r, out } = res();
    await handler({ method: 'POST', body: { legs: legs.slice(0, 2), modes: ['WALK'] } }, r);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.body.error).toBeUndefined();
  });
});
