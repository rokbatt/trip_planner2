import { describe, expect, it } from 'vitest';
import { AREA_DAILY_LIMIT, AREA_MIN_RADIUS, coveringCircle, filterAndSort, isUsableArea, pointInPolygon, remainingToday, useOne } from './areaModel';
import type { LatLng } from './penModel';

// 프라하 구시가지 근처 대략 1km 사각형
const square: LatLng[] = [[50.080, 14.410], [50.080, 14.425], [50.090, 14.425], [50.090, 14.410]];

describe('pointInPolygon', () => {
  it('안과 밖', () => {
    expect(pointInPolygon([50.085, 14.418], square)).toBe(true);
    expect(pointInPolygon([50.095, 14.418], square)).toBe(false);
    expect(pointInPolygon([50.085, 14.430], square)).toBe(false);
  });
  it('오목한 모양(ㄷ자)의 빈 곳은 밖', () => {
    const u: LatLng[] = [[0, 0], [0, 3], [3, 3], [3, 2], [1, 2], [1, 1], [3, 1], [3, 0]];
    expect(pointInPolygon([2, 1.5], u)).toBe(false);
    expect(pointInPolygon([0.5, 1.5], u)).toBe(true);
  });
  it('꼭짓점이 3개 미만이면 언제나 밖', () => {
    expect(pointInPolygon([0, 0], [[0, 0], [1, 1]])).toBe(false);
  });
});

describe('coveringCircle', () => {
  it('가운데는 테두리 상자 가운데, 반경은 꼭짓점까지 덮는다', () => {
    const c = coveringCircle(square);
    expect(c.center.lat).toBeCloseTo(50.085, 6);
    expect(c.center.lng).toBeCloseTo(14.4175, 6);
    expect(c.radius).toBeGreaterThan(600);
    expect(c.radius).toBeLessThan(800);
  });
  it('아주 작은 영역도 최소 반경', () => {
    expect(coveringCircle([[1, 1], [1, 1.00001], [1.00001, 1]]).radius).toBe(AREA_MIN_RADIUS);
  });
});

describe('isUsableArea', () => {
  it('제대로 그린 영역은 통과, 제자리 꾹 누름은 거른다', () => {
    expect(isUsableArea(square)).toBe(true);
    expect(isUsableArea([[1, 1], [1, 1.000001], [1.000001, 1]])).toBe(false);
    expect(isUsableArea([[1, 1], [2, 2]])).toBe(false);
  });
});

describe('filterAndSort', () => {
  const r = (id: string, lat: number, lng: number, rating: number | null, ratingCount: number | null) => ({ id, lat, lng, rating, ratingCount });
  const results = [
    r('a', 50.085, 14.418, 4.2, 900),
    r('b', 50.081, 14.411, 4.8, 120),
    r('out', 50.100, 14.418, 5.0, 9999),
    r('c', 50.0851, 14.4176, null, null),
    r('a', 50.085, 14.418, 4.2, 900),
  ];
  it('영역 밖·중복은 뺀다', () => {
    expect(filterAndSort(results, square, 'rating').map((x) => x.id).sort()).toEqual(['a', 'b', 'c']);
  });
  it('평점순 · 리뷰 많은순 · 가까운순', () => {
    expect(filterAndSort(results, square, 'rating').map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(filterAndSort(results, square, 'reviews').map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(filterAndSort(results, square, 'near')[0].id).toBe('c');
  });
});

describe('하루 횟수', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('쓰면 줄고, 날짜가 바뀌면 다시 찬다', () => {
    const kv = mem();
    expect(remainingToday(kv, 'u', '2026-12-19')).toBe(AREA_DAILY_LIMIT);
    expect(useOne(kv, 'u', '2026-12-19')).toBe(AREA_DAILY_LIMIT - 1);
    expect(remainingToday(kv, 'u', '2026-12-19')).toBe(AREA_DAILY_LIMIT - 1);
    expect(remainingToday(kv, 'u', '2026-12-20')).toBe(AREA_DAILY_LIMIT);
    expect(remainingToday(kv, 'other', '2026-12-19')).toBe(AREA_DAILY_LIMIT);
  });
  it('0 아래로 내려가지 않는다', () => {
    const kv = mem();
    for (let i = 0; i < AREA_DAILY_LIMIT + 3; i++) useOne(kv, 'u', 'd');
    expect(remainingToday(kv, 'u', 'd')).toBe(0);
  });
});

describe('rankColor — 구름 그라데이션', () => {
  it('1위는 하늘색, 꼴찌는 분홍, 가운데는 사이 색', async () => {
    const { rankColor, RANK_STOPS } = await import('./areaModel');
    expect(rankColor(0, 10)).toBe(RANK_STOPS[0]);
    expect(rankColor(9, 10)).toBe(RANK_STOPS[RANK_STOPS.length - 1]);
    expect(rankColor(0, 1)).toBe(RANK_STOPS[0]);
    const mid = rankColor(5, 11);
    expect(mid).toMatch(/^#[0-9A-F]{6}$/);
    expect(mid).not.toBe(RANK_STOPS[0]);
  });
  it('tint는 흰색에 가까운 옅은 색', async () => {
    const { tint } = await import('./areaModel');
    expect(tint('#000000', 0.1)).toBe('#E6E6E6');
    expect(tint('#7EC8F2', 0)).toBe('#FFFFFF');
  });
});

describe('무료 하루 3번 · PRO 20번 (IDEAS·ROUTE 같은 횟수)', () => {
  it('무료는 3번, PRO는 같은 날 쓴 횟수를 이어서 20번까지', async () => {
    const { areaDailyLimit, AREA_FREE_DAILY_LIMIT } = await import('./areaModel');
    const m = new Map<string, string>();
    const kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(areaDailyLimit(false)).toBe(AREA_FREE_DAILY_LIMIT);
    for (let i = 0; i < 3; i++) useOne(kv, 'u', 'd', areaDailyLimit(false));
    expect(remainingToday(kv, 'u', 'd', areaDailyLimit(false))).toBe(0);
    expect(remainingToday(kv, 'u', 'd', areaDailyLimit(true))).toBe(AREA_DAILY_LIMIT - 3);
  });
});
