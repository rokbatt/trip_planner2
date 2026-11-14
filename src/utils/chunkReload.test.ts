import { describe, it, expect } from 'vitest';
import { claimReload, RELOAD_COOLDOWN_MS, RELOAD_KEY } from './chunkReload';
import swSource from '../pwa/sw-template.js?raw';

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('claimReload', () => {
  it('처음에는 허용하고 시각을 적어 둔다', () => {
    const s = memStorage();
    expect(claimReload(s, 1_000_000)).toBe(true);
    expect(s.getItem(RELOAD_KEY)).toBe('1000000');
  });

  it('방금 한 뒤에는 막는다(무한 새로고침 방지)', () => {
    const s = memStorage({ [RELOAD_KEY]: '1000000' });
    expect(claimReload(s, 1_000_000 + RELOAD_COOLDOWN_MS - 1)).toBe(false);
  });

  it('시간이 지나면 다시 허용한다', () => {
    const s = memStorage({ [RELOAD_KEY]: '1000000' });
    expect(claimReload(s, 1_000_000 + RELOAD_COOLDOWN_MS)).toBe(true);
  });

  it('저장소를 못 쓰면(예외) 새로고침하지 않는다', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(claimReload(broken, 5)).toBe(false);
  });
});

describe('서비스워커: HTML 응답은 저장하지 않는다', () => {
  it('cacheFirst와 staleWhileRevalidate 모두 okToCache를 거친다', () => {
    expect(swSource).toMatch(/function okToCache\(res\)/);
    expect(swSource).toContain("text/html");
    expect(swSource).toMatch(/if \(okToCache\(res\)\) cache\.put\(req, res\.clone\(\)\);\s*\n\s*return res;/);
    expect(swSource).toMatch(/\.then\(\(res\) => \{ if \(okToCache\(res\)\) cache\.put\(req, res\.clone\(\)\); return res; \}\)/);
    // 예전 방식(무조건 res.ok만 보고 저장)이 남아 있지 않아야 한다
    expect(swSource).not.toMatch(/if \(res\.ok\) cache\.put\(req, res\.clone\(\)\)/);
  });
});
