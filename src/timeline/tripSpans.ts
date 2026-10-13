/**
 * 여행지 구간 계산 — 여러 여행지를 "하나의 연속된 DAY 목록"으로 이을 때 필요한 **순수 규칙**.
 *
 * 모바일 Companion은 여행지를 고르지 않아도 모든 여행지가 DAY로 쭉 이어져 보여야 한다
 * (방콕 DAY 1~4 다음에 푸켓 DAY 5~). 그 이음의 규칙(어떤 순서로, 몇 번부터)이 틀리면
 * **서류·도착 기록이 엉뚱한 날에 붙는다** — 서류의 `day_start`가 바로 이 "여행 전체 기준 DAY
 * 번호"이기 때문이다(docs/docsStore.loadDayAndRegionOptions도 같은 방식으로 센다).
 *
 * 그래서 DB 없이 돌려볼 수 있게 순수 함수로 떼어 두었다. 새로 만든 규칙은 하나도 없다 —
 * 정렬 기준과 DAY 개수는 `trips/destinations.ts`의 `dayNumberOffsetFor`·`destinationDayCount`를
 * **그대로 쓰고**, 테스트가 둘이 항상 같은 번호를 내는지 붙들고 있다.
 */

import { destinationDayCount, isSyntheticDestination } from '../trips/destinations';
import type { Database, TripDestination } from '../types/database';

type Trip = Database['public']['Tables']['trips']['Row'];

export interface DestSpan {
  dest: TripDestination;
  /** 이 여행지 앞에 이미 지나간 DAY 수 — 라벨 "DAY n"의 n에서 1을 뺀 시작점 */
  offset: number;
  /** 이 여행지의 DAY 개수(숙박 일수 + 1) */
  count: number;
}

/**
 * 날짜순 정렬. `dayNumberOffsetFor`와 **같은 기준**(start_date 문자열 비교, 날짜 없으면 맨 앞)이어야
 * 한다 — 다르면 PC ROUTE의 "DAY 5"와 폰의 "DAY 5"가 서로 다른 날이 된다.
 */
export function sortDestinations(dests: TripDestination[]): TripDestination[] {
  return [...dests].sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''));
}

/**
 * 실제 여행지들을 날짜순으로 늘어놓고 각자의 시작 번호를 붙인다.
 * 합성 여행지(아직 destination 행이 없는 트립용 임시값)는 뺀다 — 이어 붙일 "다음 여행지"가
 * 없고, 저장된 일정도 없기 때문이다.
 */
export function planSpans(destinations: TripDestination[], trip: Trip): DestSpan[] {
  const real = sortDestinations(destinations.filter((d) => !isSyntheticDestination(d.id)));
  let offset = 0;
  return real.map((dest) => {
    const count = destinationDayCount(dest, trip);
    const span: DestSpan = { dest, offset, count };
    offset += count;
    return span;
  });
}

/**
 * "오늘"에 해당하는 DAY 인덱스. 없으면 -1.
 *
 * 여행지가 바뀌는 날에는 **같은 날짜가 두 번** 나온다 — 방콕의 마지막 DAY(출국일)와 푸켓의
 * 첫 DAY(도착일)가 같은 달력 날짜다. 이때 `findIndex`로 첫 번째만 잡으면 이미 일정이 빈
 * 쪽이 "오늘"이 될 수 있다. 일정이 있는 날을 우선하고, 둘 다 있으면 앞쪽을 고른다
 * (옮겨 간 뒤에는 날짜 띠에서 눌러 다른 쪽으로 가면 된다).
 */
export function pickTodayIndex(
  days: Array<{ date: string | null; stops: readonly unknown[] }>,
  today: string
): number {
  let firstMatch = -1;
  for (let i = 0; i < days.length; i += 1) {
    if (days[i].date !== today) continue;
    if (days[i].stops.length > 0) return i;
    if (firstMatch < 0) firstMatch = i;
  }
  return firstMatch;
}

/** 여행지 이름들을 "방콕 → 푸켓"으로. 하나뿐이면 그 이름만, 이름이 비면 빈 문자열. */
export function tripDestinationLabel(destinations: TripDestination[]): string {
  const names = sortDestinations(destinations.filter((d) => !isSyntheticDestination(d.id)))
    .map((d) => d.name)
    .filter(Boolean);
  return names.join(' → ');
}
