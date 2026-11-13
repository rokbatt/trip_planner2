import { describe, it, expect, vi } from 'vitest';
import { chunk, requestRouteLegs, LEGS_PER_REQUEST } from './routeLegs';
import routeMatrixSrc from '../../api/route-matrix.ts?raw';

const legs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'L' + i }));
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const echo = (init?: RequestInit) => {
  const sent = JSON.parse(String(init?.body)).legs as Array<{ id: string }>;
  return ok({ results: sent.map((l) => ({ id: l.id, modes: { WALK: {} } })) });
};

describe('chunk', () => {
  it('정해진 크기로 나눈다', () => {
    expect(chunk(legs(25)).map((c) => c.length)).toEqual([12, 12, 1]);
    expect(chunk(legs(12))).toHaveLength(1);
    expect(chunk([])).toEqual([]);
  });
});

describe('requestRouteLegs', () => {
  it('서버의 MAX_LEGS와 숫자가 같다', () => {
    const m = /const MAX_LEGS = (\d+);/.exec(routeMatrixSrc);
    expect(Number(m?.[1])).toBe(LEGS_PER_REQUEST);
  });

  it('25구간이면 3번 나눠 보내고 결과를 합친다', async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => echo(init));
    const r = await requestRouteLegs(legs(25), ['WALK'], f);
    expect(f).toHaveBeenCalledTimes(3);
    expect(r.ok && r.json.results.map((x) => x.id)).toEqual(legs(25).map((l) => l.id));
  });

  it('첫 묶음이 실패하면 ok:false', async () => {
    const f = vi.fn(async () => new Response('quota', { status: 429 }));
    const r = await requestRouteLegs(legs(20), ['WALK'], f);
    expect(r).toEqual({ ok: false, status: 429, text: 'quota' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('중간 묶음이 실패하면 거기서 멈추고 받은 것만 돌려준다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    const f = vi.fn(async (_u: string, init?: RequestInit) => (++n === 2 ? new Response('x', { status: 500 }) : echo(init)));
    const r = await requestRouteLegs(legs(30), ['WALK'], f);
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.ok && r.json.results).toHaveLength(12);
    warn.mockRestore();
  });

  it('키·한도 오류(error)가 오면 다음 묶음을 보내지 않는다', async () => {
    const f = vi.fn(async () => ok({ results: [], error: { status: 403, message: 'denied' } }));
    const r = await requestRouteLegs(legs(30), ['WALK'], f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(r.ok && r.json.error).toEqual({ status: 403, message: 'denied' });
  });
});
