import { describe, it, expect } from 'vitest';
import { requireLogin, AUTH_EXEMPT } from './auth';
import type { EdgeCache } from './edgeCache';

const env = { SUPABASE_URL: 'https://db.example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const req = (path: string, token?: string, method = 'POST') =>
  new Request('https://www.mongsil2.com' + path, { method, headers: token ? { authorization: 'Bearer ' + token } : {} });

function memCache() {
  const store = new Map<string, Response>();
  const cache: EdgeCache = {
    async match(r) { return store.get(r.url)?.clone(); },
    async put(r, res) { store.set(r.url, res); },
  };
  return { cache, store };
}

describe('requireLogin (서버 주소 로그인 확인)', () => {
  it('토큰이 없으면 401', async () => {
    const r = await requireLogin(req('/api/nearby-search'), env, undefined, async () => { throw new Error('부르면 안 됨'); });
    expect(r?.status).toBe(401);
    expect((await r!.json()).code).toBe('login_required');
  });

  it('Supabase가 맞다고 하면 통과, 결과를 캐시해 두 번째엔 묻지 않는다', async () => {
    const { cache, store } = memCache();
    let calls = 0;
    const f = async (url: string, init?: RequestInit) => {
      calls++;
      expect(url).toBe('https://db.example.supabase.co/auth/v1/user');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer good');
      return Response.json({ id: 'u1' });
    };
    expect(await requireLogin(req('/api/ai', 'good'), env, cache, f)).toBeNull();
    expect(await requireLogin(req('/api/ai', 'good'), env, cache, f)).toBeNull();
    expect(calls).toBe(1);
    // 캐시 키에 토큰 원문이 없다
    expect([...store.keys()].some((k) => k.includes('good'))).toBe(false);
  });

  it('틀리거나 만료된 토큰은 401, Supabase 장애는 503', async () => {
    expect((await requireLogin(req('/api/ai', 'bad'), env, undefined, async () => new Response('{}', { status: 401 })))?.status).toBe(401);
    expect((await requireLogin(req('/api/ai', 'x'), env, undefined, async () => new Response('', { status: 500 })))?.status).toBe(503);
    expect((await requireLogin(req('/api/ai', 'x'), env, undefined, async () => { throw new Error('net'); }))?.status).toBe(503);
  });

  it('관리·정리·알림 주소와 비상 스위치(API_AUTH=off)는 건너뛴다', async () => {
    const never = async () => { throw new Error('부르면 안 됨'); };
    for (const p of AUTH_EXEMPT) expect(await requireLogin(req(p), env, undefined, never)).toBeNull();
    expect(await requireLogin(req('/api/cleanup-search-cache/'), env, undefined, never)).toBeNull();
    expect(await requireLogin(req('/api/ai'), { ...env, API_AUTH: 'OFF' }, undefined, never)).toBeNull();
  });

  it('서버 설정이 없으면 503(조용히 열어 두지 않는다)', async () => {
    expect((await requireLogin(req('/api/ai', 't'), {}, undefined, async () => Response.json({ id: 'u' })))?.status).toBe(503);
  });
});
