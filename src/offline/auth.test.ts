/**
 * 오프라인 세션 저장소 테스트 — 오프라인에서 만료 토큰 때문에 요청이 멈추지 않게 하되,
 * 가짜 만료 시각이 저장돼 다시 연결된 뒤 401이 계속되는 일은 없어야 한다.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createOfflineAwareStorage } from './auth';

const KEY = 'sb-abc-auth-token';
let mem: Record<string, string>;
beforeEach(() => {
  mem = {};
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => mem[k] ?? null,
    setItem: (k: string, v: string) => { mem[k] = v; },
    removeItem: (k: string) => { delete mem[k]; },
  } as Storage;
});

const expired = () => JSON.stringify({ access_token: 'tok', refresh_token: 'rt', expires_at: Math.floor(Date.now() / 1000) - 600, user: { id: 'u1' } });

describe('createOfflineAwareStorage', () => {
  it('온라인이면 그대로 읽는다 (갱신은 Supabase가 평소대로)', () => {
    mem[KEY] = expired();
    expect(createOfflineAwareStorage(() => false).getItem(KEY)).toBe(mem[KEY]);
  });

  it('오프라인이면 만료 토큰을 1시간 뒤 만료로 보여준다', () => {
    mem[KEY] = expired();
    const got = JSON.parse(createOfflineAwareStorage(() => true).getItem(KEY)!);
    expect(got.expires_at * 1000).toBeGreaterThan(Date.now() + 50 * 60_000);
    expect(got.access_token).toBe('tok');
  });

  it('보여준 가짜 만료 시각을 그대로 저장하려 하면 진짜 시각으로 되돌린다', () => {
    mem[KEY] = expired();
    const real = JSON.parse(mem[KEY]).expires_at;
    const st = createOfflineAwareStorage(() => true);
    const shown = st.getItem(KEY)!;
    st.setItem(KEY, shown);
    expect(JSON.parse(mem[KEY]).expires_at).toBe(real);
  });

  it('새로 갱신된 토큰은 그대로 저장한다', () => {
    mem[KEY] = expired();
    const st = createOfflineAwareStorage(() => true);
    st.getItem(KEY);
    const fresh = JSON.stringify({ access_token: 'new', expires_at: 9999999999 });
    st.setItem(KEY, fresh);
    expect(mem[KEY]).toBe(fresh);
  });

  it('인증 토큰이 아닌 키는 건드리지 않는다', () => {
    mem['other'] = expired();
    expect(createOfflineAwareStorage(() => true).getItem('other')).toBe(mem['other']);
  });
});
