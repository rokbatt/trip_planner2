/**
 * 정류지 순서가 바뀌어도 **도착·출발 기록이 그 정류지를 따라가게** 하는 규칙 — 순수 함수(테스트: progressRemap.test.ts).
 *
 * `trip_stop_progress`는 정류지 키(`d{DAY 순번}-{그 DAY 안의 순서}-{장소id|이름}`)로 기록을 찾는다.
 * 키에 "순서"가 들어 있어서 DAY의 순서가 바뀌거나 앞에 장소가 끼어들면 **같은 정류지의 키가 바뀐다** —
 * 가만히 두면 방콕 왕궁에 "도착" 기록이 있었는데 순서를 바꾼 뒤 엉뚱한 장소에 붙거나 사라진다.
 *
 * 그래서 DAY를 저장하는 한 곳(`routeStore.replaceRouteDay`)에서 옛 순서와 새 순서를 비교해 기록의 키를
 * 같이 옮긴다. 모바일·ROUTE·TIMELINE 어디서 저장하든 똑같이 적용된다.
 */

/** dayModel이 정류지마다 붙이는 키 — 형식은 여기가 단일 기준이다(dayModel.toStop이 이 함수를 쓴다) */
export function makeStopKey(dayIndex: number, order: number, placeId: string | null, customName: string | null): string {
  return 'd' + dayIndex + '-' + order + '-' + (placeId ?? customName ?? 'x');
}

export interface KeySource {
  placeId: string | null;
  customName: string | null;
}

/** 같은 정류지인지 가리는 값 — 키에서 순서를 뺀 부분 */
function identity(s: KeySource): string {
  return s.placeId ?? s.customName ?? 'x';
}

/**
 * 옛 순서 → 새 순서로 바뀔 때 각 옛 키가 어디로 가는지.
 *   · 값이 새 키면 그 정류지의 기록을 새 키로 옮긴다
 *   · 값이 null이면 그 정류지가 빠졌다 — 기록도 지운다
 * 같은 장소가 두 번 있으면 k번째 것은 k번째 것끼리 짝짓는다(앞에서부터).
 */
export function mapStopKeys(dayIndex: number, before: readonly KeySource[], after: readonly KeySource[]): Map<string, string | null> {
  const nextByIdentity = new Map<string, number[]>();
  after.forEach((s, i) => {
    const id = identity(s);
    const list = nextByIdentity.get(id) ?? [];
    list.push(i);
    nextByIdentity.set(id, list);
  });
  const taken = new Map<string, number>();

  const out = new Map<string, string | null>();
  before.forEach((s, i) => {
    const oldKey = makeStopKey(dayIndex, i, s.placeId, s.customName);
    const id = identity(s);
    const n = taken.get(id) ?? 0;
    taken.set(id, n + 1);
    const j = nextByIdentity.get(id)?.[n];
    out.set(oldKey, j == null ? null : makeStopKey(dayIndex, j, after[j].placeId, after[j].customName));
  });
  return out;
}

/** 바뀌는 게 하나라도 있나 — 없으면 DB를 건드릴 필요가 없다 */
export function hasKeyChanges(map: ReadonlyMap<string, string | null>): boolean {
  for (const [from, to] of map) if (from !== to) return true;
  return false;
}
