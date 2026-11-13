import { describe, it, expect } from 'vitest';
import { API_ROUTES, findApiHandler } from './routes';
import { sharedMaxAge, withEdgeCache, type EdgeCache } from './edgeCache';

describe('API 주소 표', () => {
  // api/ 파일 이름 목록(내용은 불러오지 않음)
  const files = Object.keys(import.meta.glob('../api/*.ts')).map((p) => p.replace('../api/', '').replace(/\.ts$/, ''));

  it('api/*.ts 파일마다 /api/<이름> 주소가 있다 — 새 파일을 추가하고 표를 잊으면 실패', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(Object.keys(API_ROUTES).sort()).toEqual(files.map((f) => '/api/' + f).sort());
  });

  it('모든 항목이 함수다', () => {
    for (const fn of Object.values(API_ROUTES)) expect(typeof fn).toBe('function');
  });

  it('끝의 / 는 무시하고, 없는 주소나 객체 기본 속성은 null', () => {
    expect(findApiHandler('/api/ai')).toBe(API_ROUTES['/api/ai']);
    expect(findApiHandler('/api/ai/')).toBe(API_ROUTES['/api/ai']);
    expect(findApiHandler('/api/nope')).toBeNull();
    expect(findApiHandler('/api/toString')).toBeNull();
    expect(findApiHandler('constructor')).toBeNull();
  });
});

describe('sharedMaxAge', () => {
  it('s-maxage 값을 읽는다', () => {
    expect(sharedMaxAge('s-maxage=1800, stale-while-revalidate=21600')).toBe(1800);
    expect(sharedMaxAge('public, s-maxage=60')).toBe(60);
    expect(sharedMaxAge('no-store')).toBeNull();
    expect(sharedMaxAge('max-age=60')).toBeNull();
    expect(sharedMaxAge(null)).toBeNull();
  });
});

function memoryCache() {
  const store = new Map<string, Response>();
  const cache: EdgeCache = {
    async match(req) {
      return store.get(req.url)?.clone();
    },
    async put(req, res) {
      store.set(req.url, res);
    },
  };
  return { cache, store };
}

describe('withEdgeCache', () => {
  const url = 'https://www.mongsil2.com/api/exchange-rate?from=THB';
  const json = (cc: string, status = 200) =>
    new Response('{"rate":40}', { status, headers: { 'cache-control': cc, 'content-type': 'application/json' } });

  it('s-maxage 응답을 저장하고 다음엔 핸들러를 부르지 않는다', async () => {
    const { cache, store } = memoryCache();
    const pending: Promise<unknown>[] = [];
    let calls = 0;
    const run = async () => (calls++, json('s-maxage=1800, stale-while-revalidate=21600'));

    const first = await withEdgeCache(new Request(url), run, cache, (p) => pending.push(p));
    await Promise.all(pending);
    expect(await first.json()).toEqual({ rate: 40 });
    expect(store.get(url)?.headers.get('cache-control')).toBe('public, max-age=1800');

    const second = await withEdgeCache(new Request(url), run, cache, (p) => pending.push(p));
    expect(await second.json()).toEqual({ rate: 40 });
    expect(calls).toBe(1);
  });

  it('no-store·오류·POST·로그인 요청은 저장하지 않는다', async () => {
    const { cache, store } = memoryCache();
    const noop = () => {};
    await withEdgeCache(new Request(url), async () => json('no-store'), cache, noop);
    await withEdgeCache(new Request(url), async () => json('s-maxage=60', 500), cache, noop);
    await withEdgeCache(new Request(url, { method: 'POST', body: '{}' }), async () => json('s-maxage=60'), cache, noop);
    await withEdgeCache(new Request(url, { headers: { authorization: 'Bearer x' } }), async () => json('s-maxage=60'), cache, noop);
    expect(store.size).toBe(0);
  });

  it('캐시가 없으면(로컬·테스트) 그냥 실행', async () => {
    const res = await withEdgeCache(new Request(url), async () => json('s-maxage=60'), undefined, () => {});
    expect(res.status).toBe(200);
  });
});
