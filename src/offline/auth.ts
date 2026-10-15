/**
 * 오프라인에서 로그인 상태 유지.
 *
 * 로그인 토큰은 1시간마다 갱신된다. 오프라인에서 앱을 열면 갱신을 못 해서 Supabase가
 * "세션 없음"으로 시작하고, 그대로 두면 **로그인 화면으로 튕긴다** — 비행기에서 내려
 * 항공권을 꺼내려는 순간에 그러면 오프라인 저장이 아무 소용이 없다.
 *
 * 그래서 세션이 비어서 시작했는데 (1) 이 기기에 로그인 기록이 남아 있고 (2) 서버에 닿지
 * 않는 상태면, 남아 있는 사용자 정보로 화면을 연다. 데이터는 어차피 저장본만 보이고, 다시
 * 연결되면 Supabase가 남은 갱신 토큰으로 스스로 세션을 되살린다. 서버에 닿는데 세션이
 * 없으면 진짜로 만료된 것이라 평소처럼 로그인 화면으로 보낸다.
 */

import type { User } from '@supabase/supabase-js';

function storageKey(supabaseUrl: string): string {
  try {
    return 'sb-' + new URL(supabaseUrl).hostname.split('.')[0] + '-auth-token';
  } catch {
    return '';
  }
}

/** 이 기기에 남아 있는 로그인 기록의 사용자. 없거나 읽을 수 없으면 null */
export function storedSessionUser(supabaseUrl: string): User | null {
  const key = storageKey(supabaseUrl);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: User; refresh_token?: string } | null;
    return parsed?.user && parsed.refresh_token ? parsed.user : null;
  } catch {
    return null;
  }
}

/** 서버(인증)에 닿는지 — 4초 안에 대답이 없으면 닿지 않는 것으로 본다 */
async function canReachServer(supabaseUrl: string, anonKey: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    await fetch(supabaseUrl + '/auth/v1/health', { headers: { apikey: anonKey }, signal: ctrl.signal, cache: 'no-store' });
    return true; // 상태 코드와 상관없이 대답이 왔으면 닿는 것
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 세션 없이 시작했을 때 오프라인이면 남은 사용자로 열어도 되는지 판단해 그 사용자를 돌려준다 */
export async function offlineFallbackUser(supabaseUrl: string, anonKey: string): Promise<User | null> {
  const user = storedSessionUser(supabaseUrl);
  if (!user) return null;
  return (await canReachServer(supabaseUrl, anonKey)) ? null : user;
}

/**
 * 오프라인용 세션 저장소 — Supabase `auth.storage`로 끼운다.
 *
 * 토큰이 만료된 채 오프라인으로 앱을 열면 Supabase는 **매 요청마다** 갱신을 시도하고, 네트워크
 * 오류는 "다시 시도할 오류"라 최대 30초씩 재시도하며 기다린다. 그동안 화면은 아무것도 못 그린다
 * (저장된 데이터가 있어도 요청이 저장소까지 오지 못한다 — 실제로 확인한 문제).
 *
 * 그래서 **오프라인일 때만** 읽어 가는 세션의 만료 시각을 1시간 뒤로 보여준다. 그러면 갱신을
 * 시도하지 않고 바로 요청을 보내고, 요청은 네트워크 실패 → 저장된 응답으로 대답한다.
 * 서버는 어차피 진짜 만료 시각으로 토큰을 검사하므로 권한이 넓어지는 일은 없다.
 *
 * 저장할 때는 진짜 만료 시각으로 되돌려 쓴다 — 가짜 시각이 저장되면 다시 연결된 뒤에도
 * 갱신을 안 해서 요청이 계속 401로 거절된다. 온라인이면 아무것도 바꾸지 않는다.
 */
export interface AuthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createOfflineAwareStorage(isOffline: () => boolean): AuthStorage {
  /** 만료 시각을 바꿔 보여준 토큰 → 진짜 만료 시각 */
  const realExpiry = new Map<string, number>();
  const ls = (): Storage | null => (typeof localStorage === 'undefined' ? null : localStorage);

  return {
    getItem(key) {
      const raw = ls()?.getItem(key) ?? null;
      if (!raw || !key.endsWith('-auth-token') || !isOffline()) return raw;
      try {
        const s = JSON.parse(raw) as { access_token?: string; expires_at?: number } | null;
        if (s?.access_token && typeof s.expires_at === 'number' && s.expires_at * 1000 < Date.now() + 5 * 60_000) {
          realExpiry.set(s.access_token, s.expires_at);
          return JSON.stringify({ ...s, expires_at: Math.floor(Date.now() / 1000) + 3600 });
        }
      } catch {
        /* 형식이 다르면 그대로 */
      }
      return raw;
    },
    setItem(key, value) {
      let out = value;
      try {
        const s = JSON.parse(value) as { access_token?: string; expires_at?: number } | null;
        const real = s?.access_token ? realExpiry.get(s.access_token) : undefined;
        if (s && real !== undefined && s.expires_at !== real) out = JSON.stringify({ ...s, expires_at: real });
      } catch {
        /* noop */
      }
      ls()?.setItem(key, out);
    },
    removeItem(key) {
      ls()?.removeItem(key);
    },
  };
}
