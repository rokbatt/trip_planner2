/**
 * Cloudflare Worker 진입점 (docs/CLOUDFLARE_MIGRATION.md 1단계 PR-2).
 *
 * - 화면 파일: wrangler.jsonc의 assets가 Worker를 거치지 않고 바로 내보낸다.
 *   없는 주소(/terms, /privacy, 해시 라우트 새로고침)는 index.html(SPA fallback).
 *   캐시 헤더는 public/_headers (vercel.json headers와 같은 규칙).
 * - /api/*: run_worker_first로 여기 fetch()에 먼저 오고, api/*.ts 핸들러를 변환 층으로 실행한다.
 * - 매일 정리 작업: scheduled() — vercel.json crons와 같은 시각(03:00 UTC).
 * - 매시 정각: 날씨 알림(worker/weatherAlert.ts) — 현지 저녁 8시인 여행지만 보낸다.
 *
 * 환경 변수는 nodejs_compat + 호환 날짜 2025-04-01 이후라 api 파일의 process.env로 그대로 들어간다.
 */
import { runVercelHandler } from './vercelAdapter';
import { CLEANUP_HANDLER, findApiHandler } from './routes';
import { withEdgeCache, type EdgeCache } from './edgeCache';
import { edgeNote } from './edgeNote';
import { handleNotify, type NotifyEnv, type Limiter } from './notify';
import { runWeatherAlerts } from './weatherAlert';
import { requireLogin, type AuthEnv } from './auth';
import { handlePay, type PayEnv } from './pay';

interface Env extends NotifyEnv, AuthEnv, PayEnv {
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

/**
 * 짧은 연타 막기 — Cloudflare 캐시에 잠깐 표시를 남긴다. 데이터센터마다 따로라 완벽하진 않지만
 * 같은 사람이 같은 휴대폰으로 연달아 누르는 경우(대부분)는 막는다. DB 표를 늘리지 않으려고 이렇게 했다.
 */
function cacheLimiter(cache: EdgeCache): Limiter {
  return {
    async first(key, seconds) {
      const req = new Request('https://limit.internal/' + encodeURIComponent(key));
      if (await cache.match(req)) return false;
      await cache.put(req, new Response('1', { headers: { 'cache-control': 'max-age=' + seconds } }));
      return true;
    },
  };
}

/** wrangler.jsonc triggers.crons의 매시 실행 — 문자열이 정확히 같아야 한다 */
const WEATHER_CRON = '0 * * * *';

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      // 매일 정리 작업은 Worker 예약 실행(scheduled)이 부른다. 밖에서 부를 땐 CRON_SECRET이 있어야 한다 —
      // 비밀값을 안 넣은 채로 두면 누구나 정리 작업을 연달아 돌려 DB를 두드릴 수 있었다
      if (url.pathname.replace(/\/$/, '') === '/api/cleanup-search-cache' && !env.CRON_SECRET) return notFound();
      // 로그인 확인 — 토큰이 없거나 틀리면 여기서 401(worker/auth.ts). 관리·정리·알림 주소는 자체 확인
      const edgeCache = typeof caches !== 'undefined' ? caches.default : undefined;
      const denied = await requireLogin(request, env, edgeCache);
      if (denied) {
        const note = edgeNote(request, denied.status);
        if (note) console.warn(note);
        return denied;
      }
      // 다운 감시(외부 업타임 서비스)용 — 서버가 살아 있는지만 답한다. 비밀값·DB를 건드리지 않는다
      if (url.pathname === '/api/health') {
        return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }
      // 휴대폰 알림은 api/ 파일이 아니라 Worker 안에서 처리한다(worker/notify.ts 머리말)
      if (url.pathname === '/api/notify' || url.pathname === '/api/notify/') {
        const edge = typeof caches !== 'undefined' ? caches.default : undefined;
        const res = await handleNotify(request, env, undefined, edge ? cacheLimiter(edge) : undefined);
        const note = edgeNote(request, res.status);
        if (note) console.warn(note);
        return res;
      }
      // 결제도 Worker 안에서 처리한다(worker/pay.ts — 웹훅만 로그인 예외, 서명으로 지킨다)
      if (url.pathname.startsWith('/api/pay/')) {
        const res = await handlePay(request, env);
        const note = edgeNote(request, res.status);
        if (note) console.warn(note);
        return res;
      }
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

  async scheduled(controller: { cron?: string; scheduledTime?: number }, env: Env, ctx: Ctx): Promise<void> {
    // 매시 정각: 날씨 알림(현지 저녁 8시인 여행지만 보낸다, worker/weatherAlert.ts)
    if (controller?.cron === WEATHER_CRON) {
      ctx.waitUntil(
        runWeatherAlerts(env, controller.scheduledTime ?? Date.now())
          .then((r) => console.log('[cron] weather', JSON.stringify(r)))
          .catch((e) => console.error('[cron] weather 실패', e))
      );
      return;
    }
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
