/**
 * Vercel CDN의 `s-maxage` 캐시를 Worker에서 흉내 낸다.
 * Worker가 만든 응답은 Cache-Control만으로는 Cloudflare에 저장되지 않아서 Cache API에 직접 넣는다.
 * 지금 쓰는 곳은 api/exchange-rate 하나(30분). 캐시가 없거나 실패해도 응답은 그대로 나간다.
 */

export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/** `s-maxage=1800, …` → 1800. 없거나 0이면 null */
export function sharedMaxAge(cacheControl: string | null): number | null {
  const m = /(?:^|,)\s*s-maxage=(\d+)/i.exec(cacheControl ?? '');
  const sec = m ? Number(m[1]) : 0;
  return sec > 0 ? sec : null;
}

export async function withEdgeCache(
  request: Request,
  run: () => Promise<Response>,
  cache: EdgeCache | undefined,
  waitUntil: (p: Promise<unknown>) => void
): Promise<Response> {
  // 로그인 정보가 붙은 요청은 사람마다 답이 다를 수 있으니 캐시하지 않는다
  if (!cache || request.method !== 'GET' || request.headers.has('authorization')) return run();

  try {
    const hit = await cache.match(request);
    if (hit) return hit;
  } catch {
    // 캐시 조회 실패는 무시하고 원래대로
  }

  const res = await run();
  const sec = sharedMaxAge(res.headers.get('cache-control'));
  if (res.status === 200 && sec) {
    const stored = new Response(res.clone().body, res);
    // Cache API는 max-age를 보고 보관 기간을 정한다. 브라우저에는 원래 헤더가 그대로 간다.
    stored.headers.set('cache-control', `public, max-age=${sec}`);
    waitUntil(cache.put(request, stored).catch(() => {}));
  }
  return res;
}
