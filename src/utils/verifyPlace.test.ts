import { describe, it, expect, vi, afterEach } from 'vitest';
import { lookupPlace } from '../../api/ai';
// ?raw 는 Vite 가 파일 내용을 문자열로 넘겨 준다(deletionDrift.test.ts와 같은 방식)
import aiSrc from '../../api/ai.ts?raw';
import scoreSrc from '../../api/hotel-score.ts?raw';
import infraSrc from '../../api/nearby-infra.ts?raw';
import searchSrc from '../../api/nearby-search.ts?raw';

/**
 * 공유 캐시(placeId 키)를 만들 때 쓰는 "Google에서 장소 확인" 규칙(Claude.md 5-11, 캐시 오염 방지).
 */

const PID = 'ChIJjYPUa8GZ4jARi9fgigQOiR8';

describe('lookupPlace', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('장소 ID 형식이 틀리거나 키가 없으면 Google을 부르지 않는다', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await lookupPlace('../x', 'k', true)).toBeNull();
    expect(await lookupPlace(undefined, 'k', true)).toBeNull();
    expect(await lookupPlace(PID, undefined, true)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('좌표만 필요하면 기본 등급 필드(location)만 요청한다', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ location: { latitude: 13.75, longitude: 100.49 } }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const v = await lookupPlace(PID, 'k', false);
    expect(v).toEqual({ name: null, address: null, lat: 13.75, lng: 100.49 });
    const init = (f.mock.calls[0] as any[])[1];
    expect(init.headers['X-Goog-FieldMask']).toBe('location');
  });

  it('이름이 필요하면 이름·주소·좌표를 받아 Google 값으로 돌려준다', async () => {
    const f = vi.fn(async () =>
      new Response(JSON.stringify({ displayName: { text: '방콕 왕궁' }, formattedAddress: '방콕', location: { latitude: 1, longitude: 2 } }), { status: 200 })
    );
    vi.stubGlobal('fetch', f);
    expect(await lookupPlace(PID, 'k', true)).toEqual({ name: '방콕 왕궁', address: '방콕', lat: 1, lng: 2 });
    expect((f.mock.calls[0] as any[])[1].headers['X-Goog-FieldMask']).toBe('displayName,formattedAddress,location');
  });

  it('Google이 거절하거나 좌표가 없으면 null(캐시에 남기지 않는 신호)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    expect(await lookupPlace(PID, 'k', true)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    expect(await lookupPlace(PID, 'k', true)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    expect(await lookupPlace(PID, 'k', true)).toBeNull();
  });
});

describe('네 서버 파일의 장소 확인 코드가 같다', () => {
  // api/*.ts는 자립형이라(Claude.md 4장) 같은 코드를 복사해 둔다 — 한쪽만 고치면 이 테스트가 잡는다
  function block(src: string): string {
    const start = src.indexOf('// ── 장소 확인 (BEGIN');
    const end = src.indexOf('// ── 장소 확인 (END) ──');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  }

  it('ai.ts · hotel-score.ts · nearby-infra.ts · nearby-search.ts', () => {
    const base = block(aiSrc);
    expect(block(scoreSrc)).toBe(base);
    expect(block(infraSrc)).toBe(base);
    expect(block(searchSrc)).toBe(base);
  });
});
