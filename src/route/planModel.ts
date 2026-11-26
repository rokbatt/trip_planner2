/**
 * ROUTE AI 일정 — 구조는 코드가 정한다(planModel.test.ts).
 *
 * 예전엔 Gemini가 Day 배분·장소 고르기·시각을 다 정해서 장소를 빼먹고(12곳 누락), 도착 시각을
 * 추측하고, 숙소 출발·도착 같은 기본 틀을 지키지 않았다. 이제 역할을 나눈다:
 *  · 코드(여기): Day별 시간 틀(도착·출발 반영) → 모든 장소를 Day에 빠짐없이 배분(그룹은 같은 Day)
 *    → 식사 슬롯(아침·점심·저녁)에 식당을 배치하고, 모자라면 "장소 미정" 식사 자리를 만든다.
 *  · AI: Day 안에서 방문 순서만(서버 route-plan-day). 응답이 불완전하면 orderByDistance로 대신한다.
 * DOM·지도·DB를 모르는 순수 함수만 둔다.
 */

import { haversineKm, legForMode, pickAutoMode, STRAIGHT_TO_ROAD } from '../utils/travelEstimate';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner';
export const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

/** 식사 시각(분) — 사용자 결정 전까지의 기본값 */
export const MEAL_TIME: Record<MealSlot, number> = { breakfast: 9 * 60, lunch: 12 * 60 + 30, dinner: 18 * 60 + 30 };
export const MEAL_DWELL: Record<MealSlot, number> = { breakfast: 45, lunch: 60, dinner: 75 };
export const MEAL_LABEL: Record<MealSlot, string> = { breakfast: '아침 식사', lunch: '점심 식사', dinner: '저녁 식사' };

/** route_stops.stop_purpose에 이 값이 있으면 "장소 미정 식사" 자리다(숙소 들르기와 구분) */
const MEAL_PREFIX = 'meal:';
export function mealPurpose(slot: MealSlot): string {
  return MEAL_PREFIX + slot;
}
export function mealSlotOf(purpose: string | null | undefined): MealSlot | null {
  if (!purpose || !purpose.startsWith(MEAL_PREFIX)) return null;
  const s = purpose.slice(MEAL_PREFIX.length) as MealSlot;
  return MEAL_SLOTS.includes(s) ? s : null;
}

/** AI 일정이 하루 끝에 붙이는 "숙소로 돌아가기"(숙소 들르기와 같은 저장 방식) */
export const RETURN_PURPOSE = 'return:hotel';

/** 특별한 정류지의 표시 이름 — 식사 자리·숙소 복귀면 그 이름, 일반 "숙소 들르기"면 null */
export function purposeLabel(purpose: string | null | undefined): string | null {
  const slot = mealSlotOf(purpose);
  if (slot) return MEAL_LABEL[slot] + ' · 장소 미정';
  if (purpose === RETURN_PURPOSE) return '숙소로 돌아가기';
  return null;
}

/** 정보가 없을 때의 하루 — 숙소에서 09:00 출발, 21:00까지 */
export const DAY_START = 9 * 60;
export const DAY_END = 21 * 60;

/** 도착 후 일정 시작까지 / 출발 전 일정 끝까지 여유(분) — 추정치 */
export function arrivalBuffer(mode: string | null): number {
  return mode === 'FLIGHT' ? 90 : 30;
}
export function departureBuffer(mode: string | null): number {
  return mode === 'FLIGHT' ? 180 : 45;
}

export interface Point {
  lat: number;
  lng: number;
}

export interface PlanItem {
  id: string;
  lat: number;
  lng: number;
  groupId: string | null;
  /** 식사 장소(식당) — 식사 슬롯에 들어간다. 카페·바는 일반 장소로 본다 */
  isMeal: boolean;
  dwellMin: number;
  rating: number | null;
}

export interface DayFrame {
  /** 이 시각부터 일정을 시작할 수 있다(분) */
  startMin: number;
  /** 이 시각까지 끝점에 닿아야 한다(분) */
  endMin: number;
  start: Point | null;
  end: Point | null;
}

/** 이 하루에 들어가는 식사 — 시간 틀이 그 식사 시간대를 덮을 때만 */
export function mealSlotsFor(f: DayFrame): MealSlot[] {
  return MEAL_SLOTS.filter((s) => f.startMin <= MEAL_TIME[s] && f.endMin >= MEAL_TIME[s] + MEAL_DWELL[s]);
}

function km(a: Point, b: Point): number {
  return haversineKm(a.lat, a.lng, b.lat, b.lng);
}

/** 두 지점 사이 이동 추정(분) — 화면과 같은 규칙(travelEstimate) */
export function travelMin(a: Point, b: Point): number {
  const road = km(a, b) * STRAIGHT_TO_ROAD;
  return legForMode(road, pickAutoMode(road)).min;
}

function centroid(points: Point[]): Point {
  const n = points.length || 1;
  return { lat: points.reduce((s, p) => s + p.lat, 0) / n, lng: points.reduce((s, p) => s + p.lng, 0) / n };
}

function frameRef(f: DayFrame): Point | null {
  if (f.start && f.end) return centroid([f.start, f.end]);
  return f.start ?? f.end;
}

/** 하루 동안 장소에 쓸 수 있는 시간(분) — 식사·숙소 오가기를 뺀다 */
export function dayCapacity(f: DayFrame): number {
  const meals = mealSlotsFor(f).reduce((s, m) => s + MEAL_DWELL[m], 0);
  return f.endMin - f.startMin - meals - 30;
}

interface Unit {
  ids: string[];
  at: Point;
  load: number;
}

const VISIT_TRAVEL = 20;

function unitsOf(items: PlanItem[]): Unit[] {
  const byKey = new Map<string, PlanItem[]>();
  for (const it of items) {
    const k = it.groupId ? 'g:' + it.groupId : 'p:' + it.id;
    byKey.set(k, [...(byKey.get(k) ?? []), it]);
  }
  return [...byKey.keys()].sort().map((k) => {
    const its = byKey.get(k)!;
    return {
      ids: its.map((i) => i.id),
      at: centroid(its),
      // 그룹 안 식당은 식사 시간에 먹으므로 장소 시간에서 뺀다
      load: its.reduce((s, i) => s + (i.isMeal ? 0 : i.dwellMin + VISIT_TRAVEL), 0),
    };
  });
}

/** 결정적 k-means — 같은 입력이면 같은 결과(시드는 정렬된 순서에서 가장 먼 점 고르기) */
function kmeans(units: Unit[], k: number): number[] {
  if (k <= 1 || units.length <= 1) return units.map(() => 0);
  const centers: Point[] = [units[0].at];
  while (centers.length < k) {
    let best = units[0].at;
    let bestD = -1;
    for (const u of units) {
      const d = Math.min(...centers.map((c) => km(c, u.at)));
      if (d > bestD) { bestD = d; best = u.at; }
    }
    centers.push(best);
  }
  let assign = units.map(() => 0);
  for (let iter = 0; iter < 20; iter++) {
    const next = units.map((u) => {
      let bi = 0;
      centers.forEach((c, i) => { if (km(c, u.at) < km(centers[bi], u.at)) bi = i; });
      return bi;
    });
    centers.forEach((_, i) => {
      const mine = units.filter((_, j) => next[j] === i);
      if (mine.length) centers[i] = centroid(mine.map((u) => u.at));
    });
    const same = next.every((v, i) => v === assign[i]);
    assign = next;
    if (same && iter > 0) break;
  }
  return assign;
}

function permutations(n: number): number[][] {
  if (n <= 1) return [[0]];
  const out: number[][] = [];
  for (const p of permutations(n - 1)) for (let i = 0; i <= p.length; i++) out.push([...p.slice(0, i), n - 1, ...p.slice(i)]);
  return out;
}

export interface DayAssignment {
  /** 식사 슬롯이 아닌, 이 Day에 갈 장소들(그룹은 통째로) */
  ids: string[];
  /** 이 Day의 식사 — placeId가 null이면 "장소 미정" */
  meals: Array<{ slot: MealSlot; placeId: string | null }>;
  /** 장소 시간이 틀을 넘친다(빠듯함) — 화면 안내용 */
  overBy: number;
}

/**
 * 모든 장소를 Day에 빠짐없이 배분한다.
 *  1. 그룹은 한 덩어리(같은 Day). 식사 장소(그룹 밖)는 식사 슬롯으로 따로.
 *  2. 시간이 있는 Day 수만큼 지리적으로 묶고(k-means), 묶음을 Day 기준점(숙소·역)과 가까운 순으로 짝짓는다.
 *  3. 시간 틀을 넘친 Day에서 가장 가까운 여유 Day로 덩어리를 옮긴다.
 *  4. 식당을 가까운 Day의 빈 식사 슬롯(점심·저녁 우선)에 넣고, 남은 슬롯은 장소 미정으로 둔다.
 */
export function assignDays(items: PlanItem[], frames: DayFrame[]): DayAssignment[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const groupIds = new Set(items.filter((i) => i.groupId && items.some((o) => o !== i && o.groupId === i.groupId)).map((i) => i.groupId));
  const soloMeals = items.filter((i) => i.isMeal && !(i.groupId && groupIds.has(i.groupId)));
  const units = unitsOf(items.filter((i) => !soloMeals.includes(i)));

  const caps = frames.map(dayCapacity);
  const active = frames.map((_, i) => i).filter((i) => caps[i] > 60);
  const dayOf = new Array<number>(units.length).fill(active[0] ?? 0);

  if (active.length && units.length) {
    const k = Math.min(active.length, units.length);
    const cl = kmeans(units, k);
    const clCenter = Array.from({ length: k }, (_, c) => centroid(units.filter((_, j) => cl[j] === c).map((u) => u.at)));
    // 묶음 c → Day active[perm[c]] — 기준점 거리 합이 가장 작은 짝(7개 넘으면 앞에서부터 욕심껏)
    const cost = (c: number, d: number) => {
      const ref = frameRef(frames[active[d]]);
      return ref ? km(clCenter[c], ref) : 0;
    };
    let best: number[] = clCenter.map((_, c) => c);
    if (active.length <= 7) {
      let bestCost = Infinity;
      for (const perm of permutations(active.length)) {
        const s = clCenter.reduce((acc, _, c) => acc + cost(c, perm[c]), 0);
        if (s < bestCost) { bestCost = s; best = perm; }
      }
    }
    units.forEach((_, j) => { dayOf[j] = active[best[cl[j]]]; });

    // 시간 대비 가장 바쁜 Day → 가장 한가한 Day로, 한가한 Day 쪽에 가까운 덩어리부터 옮긴다.
    // 넘친 Day가 있거나(전체가 넘치면 고르게 나눠 넘치게) 두 Day 차이가 2시간을 넘을 때만 — 그 외엔 지역 묶음을 지킨다.
    const load = (d: number) => units.reduce((s, u, j) => s + (dayOf[j] === d ? u.load : 0), 0);
    const ratio = (d: number, extra = 0) => (load(d) + extra) / Math.max(1, caps[d]);
    const dayCenter = (d: number) => {
      const mine = units.filter((_, j) => dayOf[j] === d).map((u) => u.at);
      return mine.length ? centroid(mine) : frameRef(frames[d]);
    };
    for (let guard = 0; guard < units.length * active.length * 2; guard++) {
      const sorted = [...active].sort((a, b) => ratio(a) - ratio(b));
      const lo = sorted[0];
      const hi = sorted[sorted.length - 1];
      if (lo === hi || (ratio(hi) <= 1 && load(hi) - load(lo) <= 120)) break;
      const c = dayCenter(lo);
      let pick: { j: number; d: number } | null = null;
      units.forEach((u, j) => {
        if (dayOf[j] !== hi || ratio(lo, u.load) >= ratio(hi)) return;
        const d = c ? km(u.at, c) : 0;
        if (!pick || d < pick.d) pick = { j, d };
      });
      if (!pick) break;
      dayOf[(pick as { j: number }).j] = lo;
    }
  }

  const out: DayAssignment[] = frames.map((f) => ({ ids: [], meals: mealSlotsFor(f).map((slot) => ({ slot, placeId: null })), overBy: 0 }));
  units.forEach((u, j) => out[dayOf[j]].ids.push(...u.ids));

  // 그룹 안 식당 → 그 Day의 빈 슬롯(저녁 → 점심 → 아침), 없으면 일반 장소로 남긴다
  for (const a of out) {
    a.ids = a.ids.filter((id) => {
      if (!byId.get(id)?.isMeal) return true;
      const slot = (['dinner', 'lunch', 'breakfast'] as MealSlot[]).map((s) => a.meals.find((m) => m.slot === s && !m.placeId)).find(Boolean);
      if (!slot) return true;
      slot.placeId = id;
      return false;
    });
  }

  // 그룹 밖 식당 → 가까운 Day의 빈 슬롯. 평점 높은 곳부터, 아침 슬롯은 덜 선호
  const center = (d: number) => {
    const pts = out[d].ids.map((id) => byId.get(id)!).filter(Boolean);
    return pts.length ? centroid(pts) : frameRef(frames[d]);
  };
  const sortedMeals = [...soloMeals].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.id.localeCompare(b.id));
  for (const m of sortedMeals) {
    let pick: { d: number; slot: MealSlot; score: number } | null = null;
    out.forEach((a, d) => {
      for (const s of a.meals) {
        if (s.placeId) continue;
        const c = center(d);
        const score = (c ? km(m, c) : 0) + (s.slot === 'breakfast' ? 5 : 0);
        if (!pick || score < pick.score) pick = { d, slot: s.slot, score };
      }
    });
    if (pick) {
      const p = pick as { d: number; slot: MealSlot };
      out[p.d].meals.find((s) => s.slot === p.slot)!.placeId = m.id;
    } else {
      // 슬롯보다 식당이 많다 — 가장 가까운 Day에 일반 장소로
      let bd = active[0] ?? 0;
      active.forEach((d) => { const c = center(d); const cb = center(bd); if (c && cb && km(m, c) < km(m, cb)) bd = d; });
      out[bd].ids.push(m.id);
    }
  }

  out.forEach((a, d) => {
    const used = a.ids.reduce((s, id) => s + ((byId.get(id)?.dwellMin ?? 60) + VISIT_TRAVEL), 0);
    a.overBy = Math.max(0, used - caps[d]);
  });
  return out;
}

/** 순서 대신 정하기 — 시작점에서 가장 가까운 곳부터, 2-opt로 되돌아가는 동선을 편다(끝점 고려) */
export function orderByDistance(points: Array<Point & { id: string }>, start: Point | null, end: Point | null): string[] {
  if (points.length <= 1) return points.map((p) => p.id);
  const rest = [...points];
  const route: Array<Point & { id: string }> = [];
  let cur: Point = start ?? rest[0];
  while (rest.length) {
    let bi = 0;
    rest.forEach((p, i) => { if (km(cur, p) < km(cur, rest[bi])) bi = i; });
    cur = rest[bi];
    route.push(rest.splice(bi, 1)[0]);
  }
  const total = (r: Point[]) => {
    const seq = [...(start ? [start] : []), ...r, ...(end ? [end] : [])];
    let s = 0;
    for (let i = 0; i < seq.length - 1; i++) s += km(seq[i], seq[i + 1]);
    return s;
  };
  let improved = true;
  for (let guard = 0; improved && guard < 50; guard++) {
    improved = false;
    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const cand = [...route.slice(0, i), ...route.slice(i, j + 1).reverse(), ...route.slice(j + 1)];
        if (total(cand) + 1e-9 < total(route)) { route.splice(0, route.length, ...cand); improved = true; }
      }
    }
  }
  return route.map((p) => p.id);
}

export type SeqEntry =
  | { kind: 'place'; id: string }
  | { kind: 'meal'; slot: MealSlot; placeId: string | null; at: Point | null; arriveMin: number };

/**
 * 정한 방문 순서 사이에 식사를 끼워 넣는다. 시계를 흘려 보며, 다음 장소에 도착하면 식사 시각을
 * 넘기게 되는 순간 식사를 먼저 넣는다. 아침은 숙소에서 하루를 시작하자마자.
 * "장소 미정" 식사는 그 직전 위치(at)에 둔다 — 이동시간이 0으로 계산된다.
 */
export function weaveMeals(
  order: string[],
  byId: Map<string, PlanItem>,
  meals: Array<{ slot: MealSlot; placeId: string | null }>,
  frame: DayFrame
): SeqEntry[] {
  const pending = [...meals].sort((a, b) => MEAL_TIME[a.slot] - MEAL_TIME[b.slot]);
  const out: SeqEntry[] = [];
  let clock = frame.startMin;
  let pos: Point | null = frame.start;

  const eat = (m: { slot: MealSlot; placeId: string | null }) => {
    const place = m.placeId ? byId.get(m.placeId) ?? null : null;
    const at: Point | null = place ?? pos;
    const arrive = Math.max(clock + (pos && at ? travelMin(pos, at) : 0), MEAL_TIME[m.slot]);
    out.push({ kind: 'meal', slot: m.slot, placeId: m.placeId, at, arriveMin: arrive });
    clock = arrive + (place ? place.dwellMin : MEAL_DWELL[m.slot]);
    if (at) pos = at;
  };

  for (const id of order) {
    const it = byId.get(id);
    if (!it) continue;
    while (pending.length) {
      const next = pending[0];
      const arriveHere = clock + (pos ? travelMin(pos, it) : 0);
      // 이 장소를 마치면 식사 시각을 30분 넘게 지나게 되면 먼저 먹는다
      if (arriveHere + it.dwellMin <= MEAL_TIME[next.slot] + 30 && next.slot !== 'breakfast') break;
      eat(pending.shift()!);
    }
    clock = clock + (pos ? travelMin(pos, it) : 0) + it.dwellMin;
    pos = it;
    out.push({ kind: 'place', id });
  }
  while (pending.length) eat(pending.shift()!);
  return out;
}
