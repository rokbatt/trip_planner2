/**
 * ROUTE 동선 병합 테스트.
 *
 * 이 파일이 지키는 약속은 하나: **친구와 같은 DAY를 같이 만져도 누가 담은 장소든 이유 없이
 * 사라지지 않고, 같은 장소가 두 번 들어가지도 않는다.**
 */

import { describe, it, expect } from 'vitest';
import type { StoredStop } from './routeStore';
import { mergeDay, planDaySync, dedupeStops, sameStops, stopKey } from './routeMerge';

const p = (placeId: string, extra: Partial<StoredStop> = {}): StoredStop => ({
  placeId,
  customName: null,
  customLat: null,
  customLng: null,
  arriveTime: null,
  memo: null,
  travelMode: null,
  purpose: null,
  customDwellMin: null,
  ...extra,
});

const custom = (name: string, lat: number, lng: number, extra: Partial<StoredStop> = {}): StoredStop =>
  p('', { placeId: null, customName: name, customLat: lat, customLng: lng, ...extra });

const ids = (list: StoredStop[]) => list.map((s) => s.placeId ?? s.customName);

describe('mergeDay — 한쪽만 바뀐 경우', () => {
  it('나만 바꿨으면 내 화면이 그대로 저장된다 (혼자 쓸 때의 기본 경로)', () => {
    const base = [p('a'), p('b')];
    expect(ids(mergeDay(base, [p('a'), p('b'), p('c')], base))).toEqual(['a', 'b', 'c']);
  });

  it('친구만 바꿨으면 친구 것을 받아온다', () => {
    const base = [p('a'), p('b')];
    expect(ids(mergeDay(base, base, [p('a'), p('x'), p('b')]))).toEqual(['a', 'x', 'b']);
  });

  it('내가 순서만 바꿨으면 그 순서가 유지된다', () => {
    const base = [p('a'), p('b'), p('c')];
    expect(ids(mergeDay(base, [p('c'), p('a'), p('b')], base))).toEqual(['c', 'a', 'b']);
  });

  it('친구가 DAY를 비웠고 나는 안 건드렸으면 비워진 채로 받아온다', () => {
    const base = [p('a'), p('b')];
    expect(mergeDay(base, base, [])).toEqual([]);
  });
});

describe('mergeDay — 동시에 바꾼 경우 (예전엔 늦게 저장한 쪽이 상대 것을 지웠다)', () => {
  it('둘이 각자 다른 장소를 담으면 둘 다 남는다', () => {
    const base = [p('a'), p('h')];
    const mine = [p('a'), p('x'), p('h')];
    const theirs = [p('a'), p('y'), p('h')];
    const out = ids(mergeDay(base, mine, theirs));
    expect(out).toContain('x');
    expect(out).toContain('y');
    expect(out).toEqual(['a', 'x', 'y', 'h']);
  });

  it('내가 담는 동안 친구가 다른 장소를 지워도 내가 담은 건 남는다', () => {
    const base = [p('a'), p('b'), p('h')];
    const mine = [p('a'), p('b'), p('x'), p('h')];
    const theirs = [p('a'), p('h')];
    expect(ids(mergeDay(base, mine, theirs))).toEqual(['a', 'x', 'h']);
  });

  it('내가 지운 건 친구가 다른 걸 담아도 계속 지워진 채다', () => {
    const base = [p('a'), p('b'), p('h')];
    const mine = [p('a'), p('h')];
    const theirs = [p('a'), p('b'), p('y'), p('h')];
    expect(ids(mergeDay(base, mine, theirs))).toEqual(['a', 'y', 'h']);
  });

  it('둘이 같은 장소를 담으면 한 번만 들어간다', () => {
    const base = [p('a')];
    const out = mergeDay(base, [p('a'), p('x')], [p('a'), p('x'), p('y')]);
    expect(ids(out)).toEqual(['a', 'x', 'y']);
  });

  it('내가 연달아 담은 장소들은 내 순서대로 같이 들어간다', () => {
    const base = [p('a'), p('h')];
    const out = mergeDay(base, [p('a'), p('x1'), p('x2'), p('h')], [p('a'), p('h'), p('y')]);
    expect(ids(out)).toEqual(['a', 'x1', 'x2', 'h', 'y']);
  });

  it('내 바로 앞 정류지를 친구가 지웠다면 남아 있는 가장 가까운 앞 정류지 뒤에 붙는다 (사라지지 않는다)', () => {
    const base = [p('a'), p('b')];
    const out = mergeDay(base, [p('a'), p('b'), p('x')], [p('a'), p('y')]);
    expect(ids(out)).toEqual(['a', 'x', 'y']);
  });

  it('앞쪽 정류지가 전부 사라졌어도 내가 담은 건 남는다', () => {
    const base = [p('a')];
    const out = mergeDay(base, [p('a'), p('x')], [p('y')]);
    expect(ids(out).sort()).toEqual(['x', 'y']);
  });

  it('내가 고친 시각/메모는 친구가 장소를 담아도 유지되고, 안 건드린 것의 친구 수정은 받는다', () => {
    const base = [p('a'), p('b')];
    const mine = [p('a', { arriveTime: '10:00' }), p('b')];
    const theirs = [p('a'), p('b', { memo: '예약함' }), p('y')];
    const out = mergeDay(base, mine, theirs);
    expect(out.find((s) => s.placeId === 'a')?.arriveTime).toBe('10:00');
    expect(out.find((s) => s.placeId === 'b')?.memo).toBe('예약함');
    expect(ids(out)).toEqual(['a', 'b', 'y']);
  });

  it('지도에 직접 찍은 지점도 이름+좌표로 같은 곳이면 중복 없이 합쳐진다', () => {
    const base: StoredStop[] = [];
    const mine = [custom('편의점', 13.7, 100.5)];
    const theirs = [custom('편의점', 13.7, 100.5), p('y')];
    expect(ids(mergeDay(base, mine, theirs))).toEqual(['편의점', 'y']);
  });
});

describe('중복 방지', () => {
  it('동시 저장이 겹쳐 같은 장소가 두 번 들어간 DB 상태는 하나로 줄어든다', () => {
    const dup = [p('a'), p('b'), p('a'), p('b')];
    expect(ids(dedupeStops(dup))).toEqual(['a', 'b']);
  });

  it('DB에 중복이 있어도 한쪽만 바뀐 경로에서 그대로 걸러져 나온다', () => {
    const base = [p('a'), p('b')];
    expect(ids(mergeDay(base, base, [p('a'), p('b'), p('b')]))).toEqual(['a', 'b']);
    expect(ids(mergeDay(base, [p('a'), p('b'), p('b')], base))).toEqual(['a', 'b']);
  });

  it('"숙소 들르기"는 같은 숙소를 하루에 여러 번 들르는 게 정상이라 그대로 둔다', () => {
    const rv = (purpose: string) => custom('호텔', 13.7, 100.5, { purpose });
    expect(dedupeStops([p('a'), rv('짐 두기'), p('b'), rv('짐 두기')])).toHaveLength(4);
  });
});

describe('planDaySync', () => {
  it('아무도 안 바꿨으면 저장도 화면 갱신도 필요 없다', () => {
    const s = [p('a')];
    const plan = planDaySync(s, s, s);
    expect(plan.saveNeeded).toBe(false);
    expect(plan.applyNeeded).toBe(false);
  });

  it('나만 바꿨으면 저장만 필요하다', () => {
    const base = [p('a')];
    const plan = planDaySync(base, [p('a'), p('x')], base);
    expect(plan.saveNeeded).toBe(true);
    expect(plan.applyNeeded).toBe(false);
  });

  it('친구만 바꿨으면 화면 갱신만 필요하다', () => {
    const base = [p('a')];
    const plan = planDaySync(base, base, [p('a'), p('y')]);
    expect(plan.saveNeeded).toBe(false);
    expect(plan.applyNeeded).toBe(true);
  });

  it('둘 다 바꿨으면 저장과 화면 갱신이 모두 필요하다', () => {
    const base = [p('a')];
    const plan = planDaySync(base, [p('a'), p('x')], [p('a'), p('y')]);
    expect(plan.saveNeeded).toBe(true);
    expect(plan.applyNeeded).toBe(true);
    expect(ids(plan.merged)).toEqual(['a', 'x', 'y']);
  });

  it('내 저장이 중간에 실패해 DB가 비어버렸어도(baseUnknown) 내 화면이 정본이라 되살아난다', () => {
    const local = [p('a'), p('b'), p('c')];
    const stale = [p('a'), p('b')]; // 실패 전에 마지막으로 맞춘 상태
    const remote: StoredStop[] = []; // 지우기만 성공하고 넣기가 실패한 DB
    // 기준을 믿고 병합하면 a, b를 "친구가 지운 것"으로 오해해 잃는다
    expect(ids(planDaySync(stale, local, remote).merged)).toEqual(['c']);
    // 기준을 못 믿는 상태로 표시하면 내 화면 그대로 복구된다
    const plan = planDaySync(stale, local, remote, true);
    expect(ids(plan.merged)).toEqual(['a', 'b', 'c']);
    expect(plan.saveNeeded).toBe(true);
  });
});

describe('stopKey / sameStops', () => {
  it('좌표 소수점 끝자리 오차로 같은 지점이 다른 지점이 되지 않는다', () => {
    expect(stopKey(custom('x', 13.7000001, 100.5))).toBe(stopKey(custom('x', 13.7000002, 100.5)));
  });

  it('순서가 다르면 다른 상태다', () => {
    expect(sameStops([p('a'), p('b')], [p('b'), p('a')])).toBe(false);
  });
});

describe('두 사람이 번갈아 편집·저장해도 (무작위 시뮬레이션)', () => {
  // 동기화 한 번 = route.ts의 syncOnce와 같은 순서: DB를 읽고 → 3자 병합 → 달라졌으면 DB에 쓰고 →
  // 내 화면이 달라졌으면 갱신. DB는 "DAY 통째로 교체"로만 쓴다(실제 저장 방식과 같음).
  class Client {
    base: StoredStop[] = [];
    local: StoredStop[] = [];
    sync(db: { rows: StoredStop[] }): void {
      const plan = planDaySync(this.base, this.local, db.rows);
      if (plan.saveNeeded) db.rows = plan.merged;
      this.base = plan.merged;
      if (plan.applyNeeded) this.local = plan.merged;
    }
  }

  // 시드 고정 난수 — 실패하면 같은 순서로 다시 재현할 수 있다
  const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  it('200번 섞어 돌려도: 담은 건 남고, 지운 건 사라지고, 중복은 없고, 둘이 같은 결과로 수렴한다', () => {
    for (let round = 0; round < 200; round++) {
      const rand = rng(round + 1);
      const db = { rows: [] as StoredStop[] };
      const A = new Client();
      const B = new Client();
      const clients = [A, B];
      const expected = new Set<string>();
      let next = 0;

      for (let step = 0; step < 30; step++) {
        const c = clients[Math.floor(rand() * 2)];
        const r = rand();
        if (r < 0.4) {
          const id = 'p' + next++;
          // 내 화면의 끝 앵커 바로 앞(또는 맨 끝)에 담는다
          const at = c.local.length ? Math.floor(rand() * (c.local.length + 1)) : 0;
          c.local = [...c.local.slice(0, at), p(id), ...c.local.slice(at)];
          expected.add(id);
        } else if (r < 0.55 && c.local.length) {
          const i = Math.floor(rand() * c.local.length);
          expected.delete(c.local[i].placeId!);
          c.local = c.local.filter((_, k) => k !== i);
        } else {
          c.sync(db);
        }
      }
      // 마지막에 서로 한 바퀴씩 더 맞춘다
      [A, B, A, B].forEach((c) => c.sync(db));

      const dbIds = db.rows.map((s) => s.placeId!);
      expect(new Set(dbIds).size, `round ${round}: DB 중복`).toBe(dbIds.length);
      expect(new Set(dbIds), `round ${round}: DB 내용`).toEqual(expected);
      expect(A.local.map((s) => s.placeId), `round ${round}: A 화면`).toEqual(dbIds);
      expect(B.local.map((s) => s.placeId), `round ${round}: B 화면`).toEqual(dbIds);
    }
  });

  it('변경이 없으면 서로 저장을 주고받으며 끝없이 되풀이하지 않는다 (핑퐁 방지)', () => {
    const db = { rows: [p('a'), p('b')] };
    const A = new Client();
    const B = new Client();
    [A, B].forEach((c) => c.sync(db));
    const snapshot = db.rows;
    for (let i = 0; i < 5; i++) [A, B].forEach((c) => c.sync(db));
    expect(db.rows).toBe(snapshot); // 같은 배열 그대로 = 한 번도 다시 쓰지 않았다
  });
});
