/**
 * ROUTE 동선 3자 병합 — 순수 함수 (DB·화면 의존 없음).
 *
 * 저장은 "그 DAY의 정류지 전체를 지우고 다시 넣기"라, 친구와 같은 DAY를 동시에 만지면
 * 늦게 저장한 쪽이 상대가 담은 장소를 통째로 덮어써 "이유 없이 사라지는" 문제가 생긴다.
 * 그래서 저장/새로고침 전에 항상 세 상태를 합친다.
 *
 *   base   : 내가 마지막으로 DB와 맞춰 본 상태
 *   local  : 지금 내 화면의 상태
 *   remote : 지금 DB의 상태 (친구가 바꿨을 수 있음)
 *
 * 내가 base 이후 추가/삭제/수정한 것만 remote 위에 얹는다. 그래서 친구가 담은 장소는
 * 내가 건드리지 않는 한 살아남고, 내가 담은 장소도 친구의 저장에 지워지지 않는다.
 */

import type { StoredStop } from './routeStore';

/** 같은 정류지인지 가리는 키 — 지도에 직접 찍은 지점·공항·숙소 재방문은 place_id가 없어
 *  세션마다 id가 새로 만들어지므로 이름+좌표(+목적)로 비교한다. */
export function stopKey(s: StoredStop): string {
  if (s.placeId) return 'p:' + s.placeId;
  const n = (v: number | null) => (v == null ? '' : v.toFixed(6));
  return 'c:' + (s.customName ?? '') + '|' + n(s.customLat) + '|' + n(s.customLng) + '|' + (s.purpose ?? '');
}

export function sameStop(a: StoredStop, b: StoredStop): boolean {
  return (
    stopKey(a) === stopKey(b) &&
    a.arriveTime === b.arriveTime &&
    a.memo === b.memo &&
    a.travelMode === b.travelMode &&
    a.customDwellMin === b.customDwellMin
  );
}

export function sameStops(a: StoredStop[], b: StoredStop[]): boolean {
  return a.length === b.length && a.every((s, i) => sameStop(s, b[i]));
}

/** 같은 장소가 한 DAY에 두 번 들어간 것(동시 저장이 겹쳐 생긴 중복)을 하나로 줄인다.
 *  "숙소 들르기"는 같은 숙소를 하루에 여러 번 들르는 게 정상이라 목적이 있는 스탑은 그대로 둔다. */
export function dedupeStops(list: StoredStop[]): StoredStop[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    if (s.purpose) return true;
    const k = stopKey(s);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 같은 키가 여러 번 나와도 구분되도록 "키#몇 번째"로 만든다 */
function occurrenceKeys(list: StoredStop[]): string[] {
  const seen = new Map<string, number>();
  return list.map((s) => {
    const k = stopKey(s);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return k + '#' + n;
  });
}

export function mergeDay(base: StoredStop[], local: StoredStop[], remote: StoredStop[]): StoredStop[] {
  // 한쪽만 바뀌었으면 그쪽이 곧 결과 — 혼자 쓸 때(대부분)는 여기서 끝난다.
  if (sameStops(local, base)) return dedupeStops(remote);
  if (sameStops(remote, base)) return dedupeStops(local);

  const baseK = occurrenceKeys(base);
  const localK = occurrenceKeys(local);
  const remoteK = occurrenceKeys(remote);
  const baseSet = new Set(baseK);
  const localSet = new Set(localK);
  const baseByKey = new Map(baseK.map((k, i) => [k, base[i]] as const));

  const result: Array<{ k: string; s: StoredStop }> = [];

  // 친구가 만든 현재 DB 상태에서 출발 — 내가 지운 것만 뺀다
  remote.forEach((s, i) => {
    const k = remoteK[i];
    if (baseSet.has(k) && !localSet.has(k)) return;
    // 내가 시각·메모 등을 고친 정류지는 내 값을 쓴다(안 고쳤으면 친구가 고친 값 그대로)
    const li = localK.indexOf(k);
    const mine = li >= 0 ? local[li] : null;
    const orig = baseByKey.get(k);
    result.push({ k, s: mine && orig && !sameStop(mine, orig) ? mine : s });
  });

  // 내가 새로 담은 것을 내 화면에서 앞이던 정류지 뒤에 끼운다. 바로 앞 정류지를 친구가 지웠으면
  // 그보다 더 앞에서 아직 남아 있는 가장 가까운 정류지 뒤에 둔다(맨 끝 앵커 뒤로 밀리지 않게).
  localK.forEach((k, i) => {
    if (baseSet.has(k) || result.some((r) => r.k === k)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const p = result.findIndex((r) => r.k === localK[j]);
      if (p >= 0) { at = p + 1; break; }
    }
    result.splice(at, 0, { k, s: local[i] });
  });

  return dedupeStops(result.map((r) => r.s));
}

export interface DaySyncPlan {
  merged: StoredStop[];
  /** DB가 merged와 다르다 → 저장해야 함 */
  saveNeeded: boolean;
  /** 내 화면이 merged와 다르다 → 화면을 갱신해야 함 */
  applyNeeded: boolean;
}

/** baseUnknown이면(저장이 중간에 실패해 DB와 맞춘 기준을 믿을 수 없을 때) 내 화면을 정본으로 본다 */
export function planDaySync(
  base: StoredStop[],
  local: StoredStop[],
  remote: StoredStop[],
  baseUnknown = false
): DaySyncPlan {
  const merged = mergeDay(baseUnknown ? remote : base, local, remote);
  return { merged, saveNeeded: !sameStops(merged, remote), applyNeeded: !sameStops(merged, local) };
}
