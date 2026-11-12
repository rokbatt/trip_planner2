/**
 * 환율 프록시(api/exchange-rate.ts) 테스트 — 네트워크 없이 가짜 fetch로.
 *
 * 순서가 약속이다: ECB(live) → 보조 소스(reference) → 대략치(fallback) → 없음(unavailable).
 * 특히 ECB가 모르는 통화(VND·TWD)가 "환산 불가"로 끝나지 않는지, 이상한 값을 그대로 믿지 않는지를 본다.
 */

import { describe, expect, it } from 'vitest';
import { lookupRate, parseFrankfurter, parseSecondary, secondaryUrls } from '../../api/exchange-rate';

type Route = (url: string) => { ok: boolean; body?: unknown } | 'throw';

function fakeFetch(route: Route): { fn: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const r = route(url);
    if (r === 'throw') throw new Error('network');
    return { ok: r.ok, json: async () => r.body } as Response;
  }) as typeof fetch;
  return { fn, calls };
}

const isEcb = (u: string) => u.includes('frankfurter');

describe('lookupRate', () => {
  it('ECB가 알면 그 값을 live로 쓴다 — 보조 소스는 부르지 않는다', async () => {
    const { fn, calls } = fakeFetch((u) => (isEcb(u) ? { ok: true, body: { rates: { KRW: 1495.2 } } } : 'throw'));
    expect(await lookupRate('USD', fn)).toEqual({ rate: 1495.2, source: 'live' });
    expect(calls).toHaveLength(1);
  });

  it('ECB에 없는 통화(VND)는 보조 소스로 구하고 reference로 표시한다', async () => {
    const { fn } = fakeFetch((u) => (isEcb(u) ? { ok: false } : { ok: true, body: { date: '2026-11-12', vnd: { krw: 0.0569 } } }));
    expect(await lookupRate('VND', fn)).toEqual({ rate: 0.0569, source: 'reference' });
  });

  it('보조 소스 첫 주소가 죽어도 다음 주소(미러)를 시도한다', async () => {
    const urls = secondaryUrls('TWD');
    const { fn, calls } = fakeFetch((u) => {
      if (isEcb(u)) return { ok: false };
      if (u === urls[0]) return 'throw';
      return { ok: true, body: { twd: { krw: 46.1 } } };
    });
    expect(await lookupRate('TWD', fn)).toEqual({ rate: 46.1, source: 'reference' });
    expect(calls).toContain(urls[1]);
  });

  it('모든 소스가 실패하면 대략치가 있는 통화(THB·USD)만 fallback', async () => {
    const down = fakeFetch(() => 'throw');
    expect((await lookupRate('THB', down.fn)).source).toBe('fallback');
    expect((await lookupRate('USD', down.fn)).source).toBe('fallback');
  });

  it('대략치도 없는 통화는 지어내지 않고 unavailable', async () => {
    const down = fakeFetch(() => 'throw');
    expect(await lookupRate('VND', down.fn)).toEqual({ rate: null, source: 'unavailable' });
  });

  it('KRW는 1', async () => {
    const down = fakeFetch(() => 'throw');
    expect(await lookupRate('KRW', down.fn)).toEqual({ rate: 1, source: 'live' });
    expect(down.calls).toHaveLength(0);
  });

  it('소스가 이상한 값(0·음수·문자열·무한)을 줘도 믿지 않는다', async () => {
    for (const bad of [0, -5, '1495', Infinity, NaN, 99_999_999]) {
      const { fn } = fakeFetch((u) => (isEcb(u) ? { ok: true, body: { rates: { KRW: bad } } } : { ok: false }));
      expect((await lookupRate('VND', fn)).source, String(bad)).toBe('unavailable');
    }
  });
});

describe('응답 해석', () => {
  it('Frankfurter: rates.KRW', () => {
    expect(parseFrankfurter({ rates: { KRW: 1300 } })).toBe(1300);
    expect(parseFrankfurter({})).toBeNull();
    expect(parseFrankfurter(null)).toBeNull();
  });

  it('보조 소스: 통화 코드(소문자) 아래 krw', () => {
    expect(parseSecondary({ idr: { krw: 0.0907 } }, 'IDR')).toBe(0.0907);
    expect(parseSecondary({ idr: { krw: 0.0907 } }, 'VND')).toBeNull();
    expect(parseSecondary({ vnd: {} }, 'VND')).toBeNull();
  });

  it('보조 소스 주소는 통화 코드 소문자로 만든다', () => {
    expect(secondaryUrls('VND')[0]).toMatch(/\/currencies\/vnd\.json$/);
    expect(secondaryUrls('VND')).toHaveLength(2);
  });
});
