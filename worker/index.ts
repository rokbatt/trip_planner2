/**
 * Cloudflare Worker 진입점 (docs/CLOUDFLARE_MIGRATION.md 1단계 PR-2).
 *
 * - 화면 파일: wrangler.jsonc의 assets가 Worker를 거치지 않고 바로 내보낸다.
 *   없는 주소(/terms, /privacy, 해시 라우트 새로고침)는 index.html(SPA fallback).
 *   캐시 헤더는 public/_headers (vercel.json headers와 같은 규칙).
 * - /api/*: run_worker_first로 여기 fetch()에 먼저 오고, api/*.ts 핸들러를 변환 층으로 실행한다.
 * - 매일 정리 작업: scheduled() — vercel.json crons와 같은 시각(03:00 UTC).
 *
 * 환경 변수는 nodejs_compat + 호환 날짜 2025-04-01 이후라 api 파일의 process.env로 그대로 들어간다.
 */
import { runVercelHandler } from './vercelAdapter';
import { CLEANUP_HANDLER, findApiHandler } from './routes';
import { withEdgeCache, type EdgeCache } from './edgeCache';
import { edgeNote } from './edgeNote';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  CRON_SECRET?: string;
}

interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

declare const caches: { default: EdgeCache } | undefined;

function notFound(): Response {
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const handler = findApiHandler(url.pathname);
      if (!handler) return notFound();
      const run = () => runVercelHandler(handler, request);
      // s-maxage를 붙인 GET 응답(환율)은 Vercel CDN처럼 Cloudflare 캐시에 잠깐 둔다
      const edge = typeof caches !== 'undefined' ? caches.default : undefined;
      const res = await withEdgeCache(request, run, edge, (p) => ctx.waitUntil(p));
      const note = edgeNote(request, res.status);
      if (note) console.warn(note);
      return res;
    }

    // run_worker_first가 /api/*만이라 보통 여기까지 오지 않지만, 혹시 오면 화면 파일로 넘긴다
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller: unknown, env: Env, ctx: Ctx): Promise<void> {
    const headers: Record<string, string> = {};
    if (env.CRON_SECRET) headers.authorization = 'Bearer ' + env.CRON_SECRET;
    const request = new Request('https://cron.internal/api/cleanup-search-cache', { headers });
    ctx.waitUntil(
      runVercelHandler(CLEANUP_HANDLER, request).then(async (res) => {
        console.log('[cron] cleanup-search-cache', res.status, await res.text());
      })
    );
  },
};
