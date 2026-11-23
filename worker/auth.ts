/**
 * 서버 주소(/api/*) 로그인 확인 — 모든 요청이 지나는 Worker 입구 한 곳에서 한다(Claude.md 5-11 "치명" 항목).
 *
 * - 앱은 이미 모든 /api 호출에 로그인 토큰을 붙인다(src/utils/apiFetch.ts). 토큰이 없거나 틀리면 401.
 * - 예외: 비밀값으로 따로 지키는 관리·정리 주소(ADMIN_SECRET · CRON_SECRET), 그리고 자체 확인하는 /api/notify.
 * - 토큰 확인은 Supabase에 묻고(`/auth/v1/user`), 결과를 Cloudflare 캐시에 5분 둔다 — 같은 토큰으로 연달아 부를 때
 *   매번 묻지 않는다. 캐시 키는 토큰의 SHA-256(토큰 원문을 저장하지 않는다).
 * - 비상 스위치: 환경 변수 `API_AUTH=off`면 확인을 건너뛴다(예전 화면을 가진 기기가 많이 막힐 때 코드 없이 되돌리기).
 */
import type { EdgeCache } from './edgeCache';

export interface AuthEnv {
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  API_AUTH?: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** 로그인 없이 들어올 수 있는 주소 — 각자 비밀값이나 자체 확인으로 지킨다 */
export const AUTH_EXEMPT = new Set(['/api/cleanup-search-cache', '/api/backfill-photos', '/api/notify']);

const OK_TTL_SEC = 300;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function bearer(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  return m ? m[1] : null;
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 통과면 null, 막으면 응답. 경로는 끝의 / 를 뗀 값으로 비교한다.
 */
export async function requireLogin(
  request: Request,
  env: AuthEnv,
  cache?: EdgeCache,
  f: FetchLike = (i, init) => fetch(i, init)
): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (AUTH_EXEMPT.has(path)) return null;
  if ((env.API_AUTH ?? '').toLowerCase() === 'off') return null;
  // 브라우저의 사전 확인(CORS preflight)은 토큰 없이 온다
  if (request.method === 'OPTIONS') return null;

  const token = bearer(request);
  if (!token) return json(401, { error: '로그인이 필요해요. 다시 로그인해 주세요.', code: 'login_required' });

  const base = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    console.warn('[auth] 서버 설정 없음 — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY');
    return json(503, { error: '서버 설정을 확인하는 중이에요. 잠시 후 다시 시도해 주세요.' });
  }

  const cacheReq = new Request('https://auth.internal/ok/' + (await sha256Hex(token)));
  if (cache && (await cache.match(cacheReq))) return null;

  let res: Response;
  try {
    res = await f(base + '/auth/v1/user', { headers: { apikey: key, authorization: 'Bearer ' + token } });
  } catch {
    return json(503, { error: '로그인을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.' });
  }
  if (res.status === 401 || res.status === 403) {
    return json(401, { error: '로그인이 만료됐어요. 다시 로그인해 주세요.', code: 'login_required' });
  }
  if (!res.ok) return json(503, { error: '로그인을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.' });
  const user = (await res.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof user?.id !== 'string') return json(401, { error: '로그인이 만료됐어요. 다시 로그인해 주세요.', code: 'login_required' });

  if (cache) await cache.put(cacheReq, new Response('1', { headers: { 'cache-control': 'max-age=' + OK_TTL_SEC } })).catch(() => undefined);
  return null;
}
