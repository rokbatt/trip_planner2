import { describe, expect, it } from 'vitest';
import {
  assignDays, DAY_END, DAY_START, mealPurpose, mealSlotOf, mealSlotsFor, orderByDistance, weaveMeals,
  type DayFrame, type PlanItem,
} from './planModel';

const hotel = { lat: 50.087, lng: 14.42 };
const full = (): DayFrame => ({ startMin: DAY_START, endMin: DAY_END, start: hotel, end: hotel });
const item = (id: string, lat: number, lng: number, o: Partial<PlanItem> = {}): PlanItem => ({
  id, lat, lng, groupId: null, isMeal: false, dwellMin: 60, rating: 4.5, ...o,
});

// 프라하: 성 지구(서쪽) 7곳, 구시가(동쪽) 7곳, 식당 4곳
const castle = Array.from({ length: 7 }, (_, i) => item('c' + i, 50.09 + i * 0.001, 14.395 + i * 0.001));
const old = Array.from({ length: 7 }, (_, i) => item('o' + i, 50.086 + i * 0.001, 14.42 + i * 0.001));
const food = Array.from({ length: 4 }, (_, i) => item('f' + i, 50.085 + i * 0.002, 14.41 + i * 0.004, { isMeal: true, dwellMin: 75 }));

describe('식사 표시', () => {
  it('purpose 왕복', () => {
    expect(mealSlotOf(mealPurpose('lunch'))).toBe('lunch');
    expect(mealSlotOf('짐 맡기기')).toBeNull();
    expect(mealSlotOf(null)).toBeNull();
  });
  it('시간 틀이 덮는 식사만', () => {
    expect(mealSlotsFor(full())).toEqual(['breakfast', 'lunch', 'dinner']);
    expect(mealSlotsFor({ ...full(), startMin: 14 * 60 + 35 })).toEqual(['dinner']);
    expect(mealSlotsFor({ ...full(), endMin: 13 * 60 + 25 })).toEqual(['breakfast']);
  });
});

describe('assignDays', () => {
  const frames = [{ ...full(), startMin: 14 * 60 + 35 }, full(), { ...full(), endMin: 13 * 60 + 25 }];

  it('모든 장소를 빠짐없이, 겹치지 않게 쓴다', () => {
    const out = assignDays([...castle, ...old, ...food], frames);
    const used = out.flatMap((a) => [...a.ids, ...a.meals.map((m) => m.placeId).filter((x): x is string => !!x)]);
    expect(used.sort()).toEqual([...castle, ...old, ...food].map((i) => i.id).sort());
  });

  it('지역끼리 묶는다(성 지구가 여러 Day로 흩어지지 않는다)', () => {
    const out = assignDays([...castle, ...old], [full(), full()]);
    const dayOfC = new Set(castle.map((c) => out.findIndex((a) => a.ids.includes(c.id))));
    expect(dayOfC.size).toBe(1);
  });

  it('그룹은 같은 Day', () => {
    const g = [item('g1', 50.09, 14.39, { groupId: 'G' }), item('g2', 50.086, 14.43, { groupId: 'G' })];
    const out = assignDays([...g, ...castle, ...old], [full(), full()]);
    expect(out.findIndex((a) => a.ids.includes('g1'))).toBe(out.findIndex((a) => a.ids.includes('g2')));
  });

  it('식당이 하나면 한 슬롯만 채우고 나머지는 장소 미정', () => {
    const out = assignDays([...castle, food[0]], [full()]);
    const meals = out[0].meals;
    expect(meals.map((m) => m.slot)).toEqual(['breakfast', 'lunch', 'dinner']);
    expect(meals.filter((m) => m.placeId === 'f0')).toHaveLength(1);
    expect(meals.find((m) => m.placeId === 'f0')!.slot).not.toBe('breakfast');
    expect(meals.filter((m) => !m.placeId)).toHaveLength(2);
  });

  it('시간이 거의 없는 Day에는 장소를 넣지 않는다', () => {
    const out = assignDays([...castle, ...old], [{ ...full(), startMin: 20 * 60 }, full(), full()]);
    expect(out[0].ids).toHaveLength(0);
  });

  it('같은 입력이면 같은 결과', () => {
    const a = assignDays([...castle, ...old, ...food], frames);
    const b = assignDays([...castle, ...old, ...food], frames);
    expect(a).toEqual(b);
  });
});

describe('orderByDistance', () => {
  it('되돌아가지 않는 순서', () => {
    const line = [0, 3, 1, 4, 2].map((i) => ({ id: 'p' + i, lat: 50, lng: 14 + i * 0.01 }));
    const order = orderByDistance(line, { lat: 50, lng: 13.99 }, { lat: 50, lng: 13.99 });
    expect([order, [...order].reverse()]).toContainEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
  });
});

describe('weaveMeals', () => {
  it('아침은 맨 앞, 점심·저녁은 시각에 맞춰 끼운다', () => {
    const byId = new Map(old.map((o) => [o.id, o]));
    const seq = weaveMeals(old.map((o) => o.id), byId, [
      { slot: 'breakfast', placeId: null }, { slot: 'lunch', placeId: null }, { slot: 'dinner', placeId: null },
    ], full());
    expect(seq[0]).toMatchObject({ kind: 'meal', slot: 'breakfast' });
    const lunch = seq.find((e) => e.kind === 'meal' && e.slot === 'lunch') as { arriveMin: number };
    const dinner = seq.find((e) => e.kind === 'meal' && e.slot === 'dinner') as { arriveMin: number };
    expect(lunch.arriveMin).toBeGreaterThanOrEqual(12 * 60 + 30);
    expect(lunch.arriveMin).toBeLessThan(14 * 60);
    expect(dinner.arriveMin).toBeGreaterThanOrEqual(18 * 60 + 30);
    expect(seq.filter((e) => e.kind === 'place')).toHaveLength(7);
  });
});

describe('장소 미정 일정(식사 외)', () => {
  it('free 목적 왕복과 라벨, 숙소 들르기와 구분', async () => {
    const { freePurpose, freeKindOf, purposeLabel, isPlaceholderPurpose, RETURN_PURPOSE } = await import('./planModel');
    expect(freeKindOf(freePurpose('cafe'))?.label).toBe('카페');
    expect(purposeLabel(freePurpose('shop'))).toBe('쇼핑 · 장소 미정');
    expect(isPlaceholderPurpose(freePurpose('rest'))).toBe(true);
    expect(isPlaceholderPurpose(mealPurpose('lunch'))).toBe(true);
    expect(isPlaceholderPurpose('짐 두기')).toBe(false);
    expect(isPlaceholderPurpose(RETURN_PURPOSE)).toBe(false);
    expect(freeKindOf('free:unknown')).toBeNull();
  });
});
