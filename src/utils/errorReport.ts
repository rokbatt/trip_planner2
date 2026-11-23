/**
 * 앱 오류 기록 — 사용자 화면에서 난 오류를 Supabase `client_errors`에 남긴다(supabase/client_errors.sql).
 *
 * - 잡는 것: 처리 안 된 오류(window error), 처리 안 된 Promise 거부(unhandledrejection)
 * - 남기지 않는 것: 입력값·문서 내용. 주소는 # 뒤 경로만, ? 뒤(검색어·토큰)는 지운다. 오류 문장 속 이메일·토큰 모양도 가린다
 * - 폭주 막기: 탭 하나에서 같은 오류는 한 번, 전부 합쳐 최대 10번
 * - 로그인 전이거나 표가 없으면 조용히 건너뛴다(기록이 앱을 멈추게 하면 안 된다)
 */
import { supabase } from '../supabase';

export const MAX_REPORTS_PER_TAB = 10;

/** 개인정보처럼 보이는 조각을 가린다 */
export function scrub(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[token]')
    .replace(/([?&](?:code|token|access_token|refresh_token|key|q)=)[^&\s#]*/gi, '$1[x]');
}

/** 화면 주소에서 남길 부분 — 해시 경로만, ? 뒤는 버린다 */
export function safePath(href: string): string {
  try {
    const u = new URL(href);
    const hash = u.hash.split('?')[0];
    return (u.pathname + hash).slice(0, 200);
  } catch {
    return '';
  }
}

/** 기록할 가치가 없는 소음 */
export function isNoise(message: string): boolean {
  return (
    !message ||
    /ResizeObserver loop/i.test(message) ||
    /^Script error\.?$/i.test(message) || // 다른 사이트 스크립트(지도 등) — 내용을 알 수 없다
    /AbortError|The user aborted/i.test(message)
  );
}

export interface ErrorRow {
  message: string;
  stack: string | null;
  path: string;
  app_version: string;
  user_agent: string;
}

export function buildRow(err: unknown, href: string, version: string, ua: string): ErrorRow | null {
  const e = err as { message?: unknown; stack?: unknown } | null;
  const raw = typeof err === 'string' ? err : typeof e?.message === 'string' ? e.message : String(err ?? '');
  const message = scrub(raw).slice(0, 500);
  if (isNoise(message)) return null;
  const stack = typeof e?.stack === 'string' ? scrub(e.stack).split('\n').slice(0, 8).join('\n').slice(0, 2000) : null;
  return { message, stack, path: safePath(href), app_version: version.slice(0, 40), user_agent: ua.slice(0, 160) };
}

let sent = 0;
const seen = new Set<string>();

async function report(err: unknown): Promise<void> {
  if (sent >= MAX_REPORTS_PER_TAB) return;
  const row = buildRow(err, location.href, (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'web', navigator.userAgent);
  if (!row || seen.has(row.message)) return;
  seen.add(row.message);
  sent++;
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return; // 로그인 전 오류는 남기지 않는다(쓰기 권한도 없다)
    await supabase.from('client_errors').insert(row);
  } catch {
    /* 기록 실패는 무시 */
  }
}

export function installErrorReporter(win: Window = window): void {
  win.addEventListener('error', (ev) => { void report(ev.error ?? ev.message); });
  win.addEventListener('unhandledrejection', (ev) => { void report((ev as PromiseRejectionEvent).reason); });
}
