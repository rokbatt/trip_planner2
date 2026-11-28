import { describe, expect, it } from 'vitest';
import {
  alongSegment, distToSegmentMeters, guideKind, guideLegs, legStoryKey, pickCorridorPlace, readStored, similarName, storyKey, writeStored, STORY_TTL_MS,
} from './guide';
import type { TlDay, TlStop } from '../timeline/dayModel';

const stop = (key: string, o: Partial<TlStop> = {}): TlStop => ({
  key, placeId: key, customName: null, lat: 50.09, lng: 14.4, arriveTime: null, memo: null, travelMode: null, purpose: null, customDwellMin: null,
  name: key, cat: 'VISIT', place: { name: key, google_place_id: 'g-' + key, address: null, category: null, photo_url: null } as any, ...o,
});
const day = (stops: TlStop[]): TlDay => ({ dayIndex: 0, destId: null, destName: '프라하', dayNumber: 1, label: 'DAY 1', date: null, stops });

describe('도슨트 — 이야기를 붙일 대상', () => {
  it('관광지·체험·쇼핑은 visit, 식당은 food, 숙소·공항·장소 미정은 없음', () => {
    expect(guideKind(stop('a'))).toBe('visit');
    expect(guideKind(stop('b', { cat: 'ACTIVITY' }))).toBe('visit');
    expect(guideKind(stop('c', { cat: 'SHOPPING' }))).toBe('visit');
    expect(guideKind(stop('d', { cat: 'FOOD' }))).toBe('food');
    expect(guideKind(stop('e', { cat: 'STAY' }))).toBeNull();
    expect(guideKind(stop('f', { cat: 'AIRPORT' }))).toBeNull();
    expect(guideKind(stop('g', { purpose: 'meal:lunch' }))).toBeNull();
    expect(guideKind(stop('h', { place: null }))).toBeNull();
  });
});

describe('도슨트 — 가는 길 구간', () => {
  const A = stop('a', { lat: 50.09, lng: 14.4 });
  const B = stop('b', { lat: 50.087, lng: 14.411 });
  const C = stop('c', { lat: 50.0871, lng: 14.4112 }); // B 바로 옆(수십 m)
  it('이어지는 실제 장소 쌍만, 바로 옆·너무 먼 곳은 건너뛴다', () => {
    const legs = guideLegs(day([A, B, C]));
    expect(legs.map((l) => l.key)).toEqual(['a>b']);
    expect(legs[0].meters).toBeGreaterThan(500);
    expect(guideLegs(day([A, stop('far', { lat: 51.5, lng: 14.4 })]))).toEqual([]);
  });
  it('장소 미정(식사 등)은 사이에 있어도 건너뛰고 앞뒤 실제 장소를 잇는다', () => {
    const meal = stop('m', { purpose: 'meal:lunch', place: null });
    expect(guideLegs(day([A, meal, B])).map((l) => l.key)).toEqual(['a>b']);
  });
});

describe('도슨트 — 길 위 확인(원칙 3-1)', () => {
  const a = { lat: 50.0865, lng: 14.4114 }; // 카를교 쪽
  const b = { lat: 50.0875, lng: 14.4213 }; // 구시가 광장 쪽
  it('점과 선분 사이 거리와 진행 위치', () => {
    expect(distToSegmentMeters({ lat: 50.087, lng: 14.416 }, a, b)).toBeLessThan(100);
    expect(distToSegmentMeters({ lat: 50.1, lng: 14.416 }, a, b)).toBeGreaterThan(1000);
    expect(alongSegment(a, a, b)).toBeCloseTo(0, 2);
    expect(alongSegment(b, a, b)).toBeCloseTo(1, 2);
  });
  it('이름이 비슷하고 길에서 가까운 것만 고른다', () => {
    const found = [
      { name: 'Prašná brána (Powder Tower)', lat: 50.0875, lng: 14.4278 }, // 길에서 먼 같은 이름
      { name: '화약탑', lat: 50.0871, lng: 14.419 },
      { name: '다른 가게', lat: 50.087, lng: 14.416 },
    ];
    expect(pickCorridorPlace('화약탑', found, a, b)?.name).toBe('화약탑');
    expect(pickCorridorPlace('없는 곳', found, a, b)).toBeNull();
    expect(pickCorridorPlace('Powder Tower', [found[0]], a, b)).toBeNull(); // 이름은 같아도 길에서 멀다
  });
  it('이름 비교', () => {
    expect(similarName('Charles Bridge', 'charles bridge (Karlův most)')).toBe(true);
    expect(similarName('A', 'A')).toBe(false);
  });
});

describe('도슨트 — 이 기기 저장', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('쓰고 읽고, 30일이 지나면 없는 것으로', () => {
    const kv = mem();
    writeStored(kv, 'k', { a: 1 }, 1000);
    expect(readStored(kv, 'k', 1000 + 1000)).toEqual({ a: 1 });
    expect(readStored(kv, 'k', 1000 + STORY_TTL_MS + 1)).toBeNull();
    expect(readStored(kv, 'none', 5)).toBeNull();
    expect(readStored(null, 'k', 5)).toBeNull();
  });
  it('장소·구간 키는 같은 장소면 같다', () => {
    expect(storyKey(stop('a'), 'visit')).toBe(storyKey(stop('a'), 'visit'));
    expect(storyKey(stop('a'), 'visit')).not.toBe(storyKey(stop('a'), 'food'));
    const l = guideLegs(day([stop('a', { lat: 50.09, lng: 14.4 }), stop('b', { lat: 50.087, lng: 14.411 })]))[0];
    expect(legStoryKey(l)).toMatch(/^l:/);
  });
});
