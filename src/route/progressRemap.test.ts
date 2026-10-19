/**
 * 순서가 바뀔 때 도착 기록이 정류지를 따라가는지 — 같은 장소가 두 번 있어도, 다른 날과 섞이지 않아도.
 */

import { describe, it, expect } from 'vitest';
import { makeStopKey, mapStopKeys, hasKeyChanges } from './progressRemap';

const P = (id: string) => ({ placeId: id, customName: null });
const C = (name: string) => ({ placeId: null, customName: name });

describe('makeStopKey', () => {
  it('dayModel이 쓰던 형식 그대로', () => {
    expect(makeStopKey(2, 0, 'p1', null)).toBe('d2-0-p1');
    expect(makeStopKey(0, 3, null, '수완나품 공항')).toBe('d0-3-수완나품 공항');
    expect(makeStopKey(0, 1, null, null)).toBe('d0-1-x');
  });
});

describe('mapStopKeys', () => {
  it('순서를 바꾸면 각 정류지의 키가 새 순서로 따라간다', () => {
    const m = mapStopKeys(1, [P('a'), P('b'), P('c')], [P('c'), P('a'), P('b')]);
    expect(m.get('d1-0-a')).toBe('d1-1-a');
    expect(m.get('d1-1-b')).toBe('d1-2-b');
    expect(m.get('d1-2-c')).toBe('d1-0-c');
  });

  it('두 칸을 맞바꿔도 서로의 기록에 부딪히지 않는다 (키가 교환된다)', () => {
    const m = mapStopKeys(0, [P('a'), P('b')], [P('b'), P('a')]);
    expect(m.get('d0-0-a')).toBe('d0-1-a');
    expect(m.get('d0-1-b')).toBe('d0-0-b');
  });

  it('앞에 장소가 끼어들면 뒤 정류지들의 키가 하나씩 밀린다', () => {
    const m = mapStopKeys(0, [P('a'), P('b')], [P('x'), P('a'), P('b')]);
    expect(m.get('d0-0-a')).toBe('d0-1-a');
    expect(m.get('d0-1-b')).toBe('d0-2-b');
  });

  it('빠진 정류지는 null — 기록도 지운다', () => {
    const m = mapStopKeys(0, [P('a'), P('b'), P('c')], [P('a'), P('c')]);
    expect(m.get('d0-1-b')).toBeNull();
    expect(m.get('d0-2-c')).toBe('d0-1-c');
  });

  it('같은 장소가 두 번(숙소 들르기)이면 앞에서부터 짝짓는다', () => {
    const m = mapStopKeys(0, [C('호텔'), P('a'), C('호텔')], [P('a'), C('호텔'), C('호텔')]);
    expect(m.get('d0-0-호텔')).toBe('d0-1-호텔'); // 첫 번째 호텔 → 첫 번째 호텔
    expect(m.get('d0-2-호텔')).toBe('d0-2-호텔'); // 두 번째 → 두 번째
    expect(m.get('d0-1-a')).toBe('d0-0-a');
  });

  it('DAY 순번이 키에 들어 있어 다른 날 기록과 섞이지 않는다', () => {
    const day0 = mapStopKeys(0, [P('a'), P('b')], [P('b'), P('a')]);
    const day1 = mapStopKeys(1, [P('a'), P('b')], [P('b'), P('a')]);
    expect([...day0.keys()].every((k) => k.startsWith('d0-'))).toBe(true);
    expect([...day1.values()].every((k) => k?.startsWith('d1-'))).toBe(true);
  });

  it('공항처럼 place_id 없이 이름만 있는 정류지도 따라간다', () => {
    const m = mapStopKeys(0, [C('수완나품 국제공항'), P('hotel')], [P('hotel'), C('수완나품 국제공항')]);
    expect(m.get('d0-0-수완나품 국제공항')).toBe('d0-1-수완나품 국제공항');
  });
});

describe('hasKeyChanges', () => {
  it('아무것도 안 바뀌었으면 false', () => {
    expect(hasKeyChanges(mapStopKeys(0, [P('a'), P('b')], [P('a'), P('b')]))).toBe(false);
  });
  it('바뀌면 true', () => {
    expect(hasKeyChanges(mapStopKeys(0, [P('a'), P('b')], [P('b'), P('a')]))).toBe(true);
  });
});
