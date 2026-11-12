import { describe, it, expect } from 'vitest';
import { createApiFetch } from './apiFetch';

function recorder() {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchImpl = async (input: string, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response('{}', { status: 200 });
  };
  return { calls, fetchImpl };
}

describe('apiFetch', () => {
  it('로그인 토큰을 Authorization 헤더로 붙이고 기존 헤더·옵션은 그대로 둔다', async () => {
    const { calls, fetchImpl } = recorder();
    const f = createApiFetch(async () => 'tok123', fetchImpl);
    await f('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
    const h = new Headers(calls[0].init?.headers);
    expect(calls[0].input).toBe('/api/ai');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toBe('{"a":1}');
    expect(h.get('Authorization')).toBe('Bearer tok123');
    expect(h.get('Content-Type')).toBe('application/json');
  });

  it('로그인 전(토큰 없음)이면 헤더 없이 보낸다', async () => {
    const { calls, fetchImpl } = recorder();
    await createApiFetch(async () => null, fetchImpl)('/api/exchange-rate?from=USD');
    expect(new Headers(calls[0].init?.headers).has('Authorization')).toBe(false);
  });

  it('세션을 못 읽어도 요청은 보낸다', async () => {
    const { calls, fetchImpl } = recorder();
    await createApiFetch(async () => { throw new Error('offline'); }, fetchImpl)('/api/route-matrix', { method: 'POST' });
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0].init?.headers).has('Authorization')).toBe(false);
  });

  it('호출부가 직접 넣은 Authorization은 덮어쓰지 않는다', async () => {
    const { calls, fetchImpl } = recorder();
    await createApiFetch(async () => 'tok', fetchImpl)('/api/x', { headers: { Authorization: 'Bearer mine' } });
    expect(new Headers(calls[0].init?.headers).get('Authorization')).toBe('Bearer mine');
  });
});
