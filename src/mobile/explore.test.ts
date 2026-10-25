/**
 * 지도 "주변 탐색" 규칙 테스트 — 없는 값을 지어내지 않는지(영업 여부·거리·가격대)를 붙든다.
 */

import { describe, it, expect } from 'vitest';
import {
  catOfTypes, normalizePrice, priceLabel, isOpenAt, todayHoursLine, straightMeters, straightLabel,
  applyFilters, sortPlaces, DEFAULT_FILTERS, searchKey, movedFar, activeFilterCount, boundsAround, withinRadius, nearbyDef, NEARBY_CATS, type HoursPeriod,
} from './explore';

const BKK = 420; // 방콕 UTC+7
// 2026-10-26(월) 방콕 12:00 = UTC 05:00
const MON_NOON = Date.UTC(2026, 9, 26, 5, 0);

describe('catOfTypes', () => {
  it('카페가 음식점보다 먼저 (카페는 보통 restaurant 타입도 같이 붙는다)', () => {
    expect(catOfTypes(['cafe', 'restaurant', 'food'])).toBe('cafe');
    expect(catOfTypes(['restaurant', 'food'])).toBe('food');
    expect(catOfTypes(['lodging'])).toBe('stay');
    expect(catOfTypes(['convenience_store'])).toBe('amenity');
    expect(catOfTypes(['tourist_attraction'])).toBe('sight');
  });
});

describe('가격대', () => {
  it('문자열·숫자 모두 읽고, 모르면 null', () => {
    expect(normalizePrice('PRICE_LEVEL_MODERATE')).toBe('MODERATE');
    expect(normalizePrice('EXPENSIVE')).toBe('EXPENSIVE');
    expect(normalizePrice(1)).toBe('INEXPENSIVE');
    expect(normalizePrice('UNSPECIFIED')).toBeNull();
    expect(normalizePrice(undefined)).toBeNull();
  });
  it('금액이 아니라 등급으로 표시', () => {
    expect(priceLabel('MODERATE')).toBe('보통');
    expect(priceLabel(null)).toBeNull();
  });
});

describe('isOpenAt', () => {
  const daily = (oh: number, ch: number): HoursPeriod[] =>
    [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: { day: d, hour: oh, minute: 0 }, close: { day: d, hour: ch, minute: 0 } }));

  it('현지 시각 기준으로 판단한다', () => {
    expect(isOpenAt(daily(6, 23), BKK, MON_NOON)).toBe(true);
    expect(isOpenAt(daily(17, 23), BKK, MON_NOON)).toBe(false);
  });

  it('자정을 넘기는 영업 (월 22:00 ~ 화 02:00)', () => {
    const p: HoursPeriod[] = [{ open: { day: 1, hour: 22, minute: 0 }, close: { day: 2, hour: 2, minute: 0 } }];
    expect(isOpenAt(p, BKK, Date.UTC(2026, 9, 26, 17, 30))).toBe(true); // 화 00:30 방콕
    expect(isOpenAt(p, BKK, MON_NOON)).toBe(false);
  });

  it('주를 넘기는 영업 (토 22:00 ~ 일 03:00)', () => {
    const p: HoursPeriod[] = [{ open: { day: 6, hour: 22, minute: 0 }, close: { day: 0, hour: 3, minute: 0 } }];
    expect(isOpenAt(p, BKK, Date.UTC(2026, 9, 31, 18, 0))).toBe(true); // 일 01:00 방콕(UTC 토 18:00)
  });

  it('24시간 영업', () => {
    expect(isOpenAt([{ open: { day: 0, hour: 0, minute: 0 } }], BKK, MON_NOON)).toBe(true);
  });

  it('영업시간이나 오프셋을 모르면 null (추측하지 않는다)', () => {
    expect(isOpenAt(null, BKK, MON_NOON)).toBeNull();
    expect(isOpenAt(daily(6, 23), null, MON_NOON)).toBeNull();
  });
});

describe('todayHoursLine', () => {
  const week = ['월요일: 오전 6:00~오후 11:00', '화요일: 휴무일', '수요일: x', '목요일: x', '금요일: x', '토요일: x', '일요일: x'];
  it('Google 목록은 월요일부터 — 현지 요일에 맞는 줄', () => {
    expect(todayHoursLine(week, BKK, MON_NOON)).toBe('오전 6:00~오후 11:00');
    expect(todayHoursLine(week, BKK, MON_NOON + 86400000)).toBe('휴무일');
  });
  it('7줄이 아니거나 오프셋이 없으면 null', () => {
    expect(todayHoursLine(week.slice(0, 3), BKK, MON_NOON)).toBeNull();
    expect(todayHoursLine(week, undefined, MON_NOON)).toBeNull();
  });
});

describe('거리', () => {
  it('직선거리 계산과 표기 (도보 시간처럼 쓰지 않는다)', () => {
    const m = straightMeters({ lat: 13.7465, lng: 100.4927 }, { lat: 13.7516, lng: 100.4927 });
    expect(m).toBeGreaterThan(540);
    expect(m).toBeLessThan(590);
    expect(straightLabel(1234)).toBe('직선 1.2km');
    expect(straightLabel(287)).toBe('직선 290m');
  });
});

describe('필터·정렬', () => {
  const P = (name: string, o: Partial<{ rating: number | null; ratingCount: number | null; priceLevel: 'MODERATE' | 'EXPENSIVE' | null; openNow: boolean | null; reservable: boolean | null; meters: number | null }>) =>
    ({ name, rating: null, ratingCount: null, priceLevel: null, openNow: null, reservable: null, meters: null, ...o });
  const list = [
    P('a', { rating: 4.8, ratingCount: 2000, openNow: true, meters: 900, priceLevel: 'MODERATE', reservable: true }),
    P('b', { rating: 5.0, ratingCount: 3, openNow: null, meters: 300 }),
    P('c', { rating: 4.2, ratingCount: 50, openNow: false, meters: 100, priceLevel: 'EXPENSIVE' }),
  ];

  it('영업 여부를 모르는 곳은 "영업 중만"에서 뺀다', () => {
    expect(applyFilters(list, { ...DEFAULT_FILTERS, openNow: true }).map((p) => p.name)).toEqual(['a']);
  });
  it('평점·가격대·예약', () => {
    expect(applyFilters(list, { ...DEFAULT_FILTERS, minRating: 4.5 }).map((p) => p.name)).toEqual(['a', 'b']);
    expect(applyFilters(list, { ...DEFAULT_FILTERS, prices: ['EXPENSIVE'] }).map((p) => p.name)).toEqual(['c']);
    expect(applyFilters(list, { ...DEFAULT_FILTERS, reservable: true }).map((p) => p.name)).toEqual(['a']);
  });
  it('거리순·평점순, 추천순은 Google 순서 그대로', () => {
    expect(sortPlaces(list, 'distance').map((p) => p.name)).toEqual(['c', 'b', 'a']);
    expect(sortPlaces(list, 'rating').map((p) => p.name)).toEqual(['b', 'a', 'c']);
    expect(sortPlaces(list, 'relevance').map((p) => p.name)).toEqual(['a', 'b', 'c']);
  });
  it('적용된 필터 수', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, openNow: true, radius: 500 })).toBe(2);
  });
});

describe('검색 재사용', () => {
  it('약 110m 안에서는 같은 검색으로 본다', () => {
    expect(searchKey('cat', 'food', { lat: 13.74621, lng: 100.49271 }, 1500)).toBe(searchKey('cat', 'food', { lat: 13.74639, lng: 100.49268 }, 1500));
    expect(searchKey('cat', 'food', { lat: 13.7465, lng: 100.4927 }, 1500)).not.toBe(searchKey('cat', 'cafe', { lat: 13.7465, lng: 100.4927 }, 1500));
  });
  it('"이 지역에서 다시 검색"은 충분히 벗어났을 때만', () => {
    const a = { lat: 13.7465, lng: 100.4927 };
    expect(movedFar(a, { lat: 13.7475, lng: 100.4927 }, 1500)).toBe(false); // 약 110m
    expect(movedFar(a, { lat: 13.7565, lng: 100.4927 }, 1500)).toBe(true); // 약 1.1km
  });
});

describe('일정 장소 근처', () => {
  const c = { lat: 13.7465, lng: 100.4927 };
  it('사각형이 반경을 덮는다 (경도 폭은 위도에 맞춰 넓어진다)', () => {
    const b = boundsAround(c, 500);
    expect(straightMeters(c, { lat: b.north, lng: c.lng })).toBeCloseTo(500, -1);
    expect(straightMeters(c, { lat: c.lat, lng: b.east })).toBeCloseTo(500, -1);
    expect(b.south).toBeLessThan(c.lat);
    expect(b.west).toBeLessThan(c.lng);
  });
  it('반경 밖(사각형 모서리)은 버리고 가까운 순', () => {
    const b = boundsAround(c, 500);
    const list = [
      { id: 'corner', lat: b.north - 0.0001, lng: b.east - 0.0001 }, // 약 700m
      { id: 'far', lat: c.lat + 0.004, lng: c.lng }, // 약 445m
      { id: 'near', lat: c.lat + 0.001, lng: c.lng }, // 약 110m
    ];
    const r = withinRadius(list, c, 500);
    expect(r.map((p) => p.id)).toEqual(['near', 'far']);
    expect(r[0].meters).toBeGreaterThan(100);
    expect(r[0].meters).toBeLessThan(120);
  });
  it('환전소는 타입이 없어 검색어로, 나머지는 타입으로', () => {
    expect(nearbyDef('exchange').query).toBeTruthy();
    expect(nearbyDef('exchange').types).toBeUndefined();
    expect(NEARBY_CATS.filter((d) => d.key !== 'exchange').every((d) => d.types?.length && !d.query)).toBe(true);
  });
  it('은행·금융 타입은 편의시설로 (관광으로 잘못 칠하지 않는다)', () => {
    expect(catOfTypes(['finance', 'point_of_interest'])).toBe('amenity');
  });
});
