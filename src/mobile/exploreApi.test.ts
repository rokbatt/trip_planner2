/**
 * Google이 모르는 필드 이름이 섞여도 검색이 통째로 실패하지 않는지(실제로 났던 버그:
 * Maps JS는 `reservable`이 아니라 `isReservable` — 요청 전체가 InvalidValueError로 실패했다).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/googleMaps', () => ({ loadGoogleMapsScript: async () => undefined }));

import { withFieldRetry, searchNearbyKind } from './exploreApi';

const KNOWN = new Set(['id', 'displayName', 'isReservable']);
function fakeRequest(fields: string[]): Promise<string[]> {
  const bad = fields.filter((f) => !KNOWN.has(f));
  if (bad.length) return Promise.reject(new Error('InvalidValueError: in property fields: Unknown fields requested: ' + bad.join(', ')));
  return Promise.resolve(fields);
}

describe('withFieldRetry', () => {
  it('모르는 필드를 빼고 다시 요청한다', async () => {
    expect(await withFieldRetry(['id', 'displayName', 'reservable', 'oops'], fakeRequest)).toEqual(['id', 'displayName']);
  });
  it('필드 문제가 아닌 오류는 그대로 던진다', async () => {
    await expect(withFieldRetry(['id'], () => Promise.reject(new Error('network')))).rejects.toThrow('network');
  });
  it('알려진 필드만 있으면 한 번에 끝난다', async () => {
    const run = vi.fn(fakeRequest);
    await withFieldRetry(['id', 'isReservable'], run);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('searchNearbyKind', () => {
  const center = { lat: 13.7465, lng: 100.4927 };
  const raw = (id: string, dLat: number, types: string[]) => ({
    id, displayName: id, types, location: { lat: () => center.lat + dLat, lng: () => center.lng },
  });
  const calls: Array<{ kind: string; req: any }> = [];
  (globalThis as any).window = {
    google: {
      maps: {
        importLibrary: async () => ({
          Place: {
            searchNearby: async (req: any) => { calls.push({ kind: 'nearby', req }); return { places: [raw('far', 0.004, ['cafe']), raw('near', 0.001, ['cafe'])] }; },
            searchByText: async (req: any) => { calls.push({ kind: 'text', req }); return { places: [raw('fx', 0.002, ['finance']), raw('corner', 0.0044, ['store'])] }; },
          },
        }),
      },
    },
  };

  it('타입 검색 — 가까운 순, 거리는 그 장소에서', async () => {
    const r = await searchNearbyKind('cafe', center, 500);
    expect(r.map((p) => p.id)).toEqual(['near', 'far']);
    expect(r[0].meters).toBeLessThan(120);
    expect(calls[calls.length - 1]?.req.includedTypes).toEqual(['cafe', 'coffee_shop']);
    expect(calls[calls.length - 1]?.req.locationRestriction).toEqual({ center, radius: 500 });
  });

  it('환전소 — 검색어 + 사각형 제한, 반경 밖은 버리고 표시 카테고리는 편의시설', async () => {
    const r = await searchNearbyKind('exchange', center, 300);
    const req = calls[calls.length - 1]?.req;
    expect(calls[calls.length - 1]?.kind).toBe('text');
    expect(req.textQuery).toBe('currency exchange');
    expect(req.locationRestriction.north).toBeGreaterThan(center.lat);
    expect(req.locationBias).toBeUndefined();
    expect(r.map((p) => p.id)).toEqual(['fx']);
    expect(r[0].cat).toBe('amenity');
  });

  it('같은 자리·같은 칩은 다시 부르지 않는다(30분 캐시)', async () => {
    const before = calls.length;
    await searchNearbyKind('cafe', { lat: center.lat - 0.0002, lng: center.lng + 0.0002 }, 500); // 같은 110m 격자
    expect(calls.length).toBe(before);
    await searchNearbyKind('cafe', center, 1000);
    expect(calls.length).toBe(before + 1);
  });
});
