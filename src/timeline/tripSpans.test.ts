/**
 * 여행지 이어붙이기 규칙 테스트.
 *
 * 폰에서는 여행지를 고르지 않아도 방콕 DAY 1~4 다음에 푸켓 DAY 5~가 쭉 이어져 보인다.
 * 이 이음이 틀리면 **서류·도착 기록이 엉뚱한 날에 붙는다** — 서류의 day_start가 바로 이
 * "여행 전체 기준 DAY 번호"이기 때문이다. 그래서 여기서 지키는 건 새 규칙이 아니라
 * **PC가 이미 쓰는 번호와 항상 같은가**다(dayNumberOffsetFor / destinationDayCount).
 */

import { describe, it, expect } from 'vitest';
import { planSpans, sortDestinations, pickTodayIndex, tripDestinationLabel } from './tripSpans';
import { dayNumberOffsetFor, destinationDayCount } from '../trips/destinations';
import type { TripDestination, Trip } from '../types/database';

function dest(id: string, name: string, start: string | null, end: string | null): TripDestination {
  return { id, name, start_date: start, end_date: end, trip_id: 't1', sort_order: 0 } as unknown as TripDestination;
}
const TRIP = { id: 't1', name: '태국', start_date: '2026-10-26', end_date: '2026-11-02' } as unknown as Trip;

const BKK = dest('d-bkk', '방콕', '2026-10-26', '2026-10-29'); // 3박 → DAY 4개
const PKT = dest('d-pkt', '푸켓', '2026-10-29', '2026-11-02'); // 4박 → DAY 5개

describe('planSpans', () => {
  it('날짜순으로 정렬하고 누적 시작 번호를 붙인다', () => {
    // 일부러 거꾸로 넣는다 — 입력 순서와 상관없이 날짜순이어야 한다
    const spans = planSpans([PKT, BKK], TRIP);
    expect(spans.map((s) => s.dest.name)).toEqual(['방콕', '푸켓']);
    expect(spans.map((s) => s.count)).toEqual([4, 5]);
    expect(spans.map((s) => s.offset)).toEqual([0, 4]); // 푸켓은 DAY 5부터
  });

  // 핵심 성질: PC ROUTE가 쓰는 번호와 폰이 쓰는 번호가 **같은 함수의 결과**여야 한다
  it('PC가 쓰는 dayNumberOffsetFor와 항상 같은 번호를 낸다', () => {
    const all = [BKK, PKT];
    for (const span of planSpans(all, TRIP)) {
      expect(span.offset).toBe(dayNumberOffsetFor(all, span.dest.id, TRIP));
    }
  });

  it('DAY 개수는 destinationDayCount와 같다', () => {
    for (const span of planSpans([BKK, PKT], TRIP)) {
      expect(span.count).toBe(destinationDayCount(span.dest, TRIP));
    }
  });

  it('여행지가 셋이어도 번호가 끊기지 않고 이어진다', () => {
    const CNX = dest('d-cnx', '치앙마이', '2026-11-02', '2026-11-04'); // 2박 → 3개
    const spans = planSpans([CNX, PKT, BKK], TRIP);
    expect(spans.map((s) => s.offset)).toEqual([0, 4, 9]);
  });

  it('합성 여행지(아직 DB 행이 없는 임시값)는 뺀다', () => {
    const legacy = dest('legacy-dest:t1', '방콕', '2026-10-26', '2026-10-29');
    expect(planSpans([legacy], TRIP)).toEqual([]);
  });

  it('날짜가 비어 있는 여행지도 터지지 않고 맨 앞에 둔다', () => {
    const blank = dest('d-x', '미정', null, null);
    const spans = planSpans([BKK, blank], TRIP);
    expect(spans[0].dest.name).toBe('미정');
    expect(spans[1].offset).toBe(spans[0].count);
  });
});

describe('sortDestinations', () => {
  it('원본 배열을 바꾸지 않는다', () => {
    const input = [PKT, BKK];
    sortDestinations(input);
    expect(input[0].name).toBe('푸켓');
  });
});

describe('pickTodayIndex', () => {
  const day = (date: string | null, n: number) => ({ date, stops: new Array(n).fill(0) });

  it('오늘이 아니면 -1', () => {
    expect(pickTodayIndex([day('2026-10-26', 2), day('2026-10-27', 1)], '2026-12-01')).toBe(-1);
  });

  it('오늘 날짜의 DAY를 찾는다', () => {
    expect(pickTodayIndex([day('2026-10-26', 2), day('2026-10-27', 1)], '2026-10-27')).toBe(1);
  });

  // 여행지가 바뀌는 날 — 방콕 출국일과 푸켓 도착일이 같은 달력 날짜다
  it('같은 날짜가 두 번이면 일정이 있는 쪽을 고른다', () => {
    const days = [day('2026-10-28', 2), day('2026-10-29', 0), day('2026-10-29', 3)];
    expect(pickTodayIndex(days, '2026-10-29')).toBe(2); // 앞쪽(0곳)이 아니라 일정 있는 쪽
  });

  it('둘 다 일정이 있으면 앞쪽', () => {
    const days = [day('2026-10-29', 2), day('2026-10-29', 3)];
    expect(pickTodayIndex(days, '2026-10-29')).toBe(0);
  });

  it('둘 다 비어 있어도 날짜는 맞으니 첫 번째', () => {
    expect(pickTodayIndex([day('2026-10-29', 0), day('2026-10-29', 0)], '2026-10-29')).toBe(0);
  });

  it('날짜 없는 DAY는 건너뛴다', () => {
    expect(pickTodayIndex([day(null, 1), day('2026-10-29', 1)], '2026-10-29')).toBe(1);
  });
});

describe('tripDestinationLabel', () => {
  it('날짜순으로 화살표로 잇는다', () => {
    expect(tripDestinationLabel([PKT, BKK])).toBe('방콕 → 푸켓');
  });
  it('하나뿐이면 그 이름만', () => {
    expect(tripDestinationLabel([BKK])).toBe('방콕');
  });
  it('합성 여행지만 있으면 빈 문자열', () => {
    expect(tripDestinationLabel([dest('legacy-dest:t1', '방콕', null, null)])).toBe('');
  });
});
