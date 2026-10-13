/**
 * 여러 여행지 이어붙이기 — 조립 테스트.
 *
 * 폰에서는 여행지를 고르지 않아도 방콕 DAY 1~4 다음에 푸켓 DAY 5~가 쭉 이어져야 한다.
 * 조립이 틀리면 (1) 도착 기록이 다른 여행지의 날에 저장되고 (2) 서류가 엉뚱한 날에 붙는다.
 * 그래서 여기서는 DB를 모의해 **실제로 조립해 보고** 아래를 붙든다:
 *
 *   · 각 날이 자기 여행지(destId)와 **여행지 안의 순번**(dayIndex), **여행 전체 번호**(dayNumber)를 안다
 *   · 정류지는 자기 여행지의 route plan에서 온다(다른 여행지 것과 섞이지 않는다)
 *   · PC TIMELINE이 쓰는 `loadDayModel`은 여전히 **활성 여행지 하나만** 돌려준다
 *   · 여행지가 하나뿐이면 두 로더의 결과가 같다
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Trip, TripDestination, StaySegment } from '../types/database';

const H = vi.hoisted(() => ({
  places: [] as unknown[],
  active: { id: 'd-pkt' } as { id: string },
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ not: async () => ({ data: H.places, error: null }) }) }) }),
  },
}));

vi.mock('../trips/destinations', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../trips/destinations')>();
  return {
    ...orig,
    loadDestinations: vi.fn(),
    loadStaySegments: vi.fn(),
    // 실제 함수처럼 **목록 안의 여행지 객체**를 돌려준다(id만 있는 껍데기를 주면 날짜가 없어서
    // 여행 전체 기간으로 DAY 수가 계산된다)
    resolveActiveDestination: vi.fn((_tripId: string, dests: TripDestination[]) =>
      dests.find((d) => d.id === H.active.id) ?? dests[0]
    ),
  };
});

vi.mock('../route/routeStore', () => ({
  loadRoutePlan: vi.fn(),
  isRouteStorageReady: () => true,
}));

import { loadDayModel, loadTripDayModel } from './dayModel';
import { loadDestinations, loadStaySegments } from '../trips/destinations';
import { loadRoutePlan } from '../route/routeStore';

function dest(id: string, name: string, start: string, end: string): TripDestination {
  return {
    id, name, start_date: start, end_date: end, trip_id: 't1', sort_order: 0,
    arrival_airport: null, arrival_lat: null, arrival_lng: null,
    departure_airport: null, departure_lat: null, departure_lng: null,
  } as unknown as TripDestination;
}
function seg(id: string, destId: string, start: string, end: string): StaySegment {
  return { id, destination_id: destId, start_date: start, end_date: end, basecamp_place_id: null } as unknown as StaySegment;
}
function place(id: string, name: string) {
  return { id, name, lat: 13.7, lng: 100.5, category: '관광지', mood: '가고싶어', photo_url: null, address: null } as unknown;
}
const stop = (placeId: string) => ({
  placeId, customName: null, customLat: null, customLng: null, arriveTime: null,
  memo: null, travelMode: null, purpose: null, customDwellMin: null,
});

const TRIP = { id: 't1', name: '태국', start_date: '2026-10-26', end_date: '2026-11-02', shortlist_basecamp_place_id: null } as unknown as Trip;
const BKK = dest('d-bkk', '방콕', '2026-10-26', '2026-10-29'); // 3박 → DAY 4개
const PKT = dest('d-pkt', '푸켓', '2026-10-29', '2026-11-02'); // 4박 → DAY 5개

beforeEach(() => {
  vi.mocked(loadDestinations).mockReset();
  vi.mocked(loadStaySegments).mockReset();
  vi.mocked(loadRoutePlan).mockReset();
  H.places = [place('p-wat', '왓 포'), place('p-beach', '카타 비치')];
  H.active = { id: 'd-pkt' };

  vi.mocked(loadDestinations).mockResolvedValue([PKT, BKK]); // 일부러 거꾸로 — 날짜순이어야 한다
  vi.mocked(loadStaySegments).mockImplementation(async (_t, d) =>
    d.id === 'd-bkk' ? [seg('s-bkk', 'd-bkk', '2026-10-26', '2026-10-29')] : [seg('s-pkt', 'd-pkt', '2026-10-29', '2026-11-02')]
  );
  vi.mocked(loadRoutePlan).mockImplementation(async (destId: string) =>
    destId === 'd-bkk'
      ? [{ dayIndex: 1, stops: [stop('p-wat')] }]
      : [{ dayIndex: 0, stops: [stop('p-beach')] }]
  );
});

describe('loadTripDayModel — 여행지를 이어붙인다', () => {
  it('방콕 4일 + 푸켓 5일이 DAY 1~9로 쭉 이어진다', async () => {
    const m = await loadTripDayModel(TRIP);
    expect(m.days).toHaveLength(9);
    expect(m.days.map((d) => d.label)).toEqual(['DAY 1', 'DAY 2', 'DAY 3', 'DAY 4', 'DAY 5', 'DAY 6', 'DAY 7', 'DAY 8', 'DAY 9']);
    expect(m.days.map((d) => d.dayNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('날짜순으로 이어붙인다 (입력이 거꾸로여도)', async () => {
    const m = await loadTripDayModel(TRIP);
    expect(m.days.slice(0, 4).every((d) => d.destName === '방콕')).toBe(true);
    expect(m.days.slice(4).every((d) => d.destName === '푸켓')).toBe(true);
  });

  // 도착 기록은 (destination_id, day_index)로 저장된다 — 이어붙인 번호가 아니라 여행지 안의 순번이어야 한다
  it('dayIndex는 여행지 안의 순번이고 destId가 자기 여행지를 가리킨다', async () => {
    const m = await loadTripDayModel(TRIP);
    expect(m.days.map((d) => d.dayIndex)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 4]);
    expect(m.days[3].destId).toBe('d-bkk');
    expect(m.days[4].destId).toBe('d-pkt');
  });

  // 여행지가 바뀌는 날은 같은 달력 날짜가 두 번 나온다 (방콕 출국일 = 푸켓 도착일)
  it('여행지가 바뀌는 날은 같은 날짜가 두 번 나온다', async () => {
    const m = await loadTripDayModel(TRIP);
    expect(m.days[3].date).toBe('2026-10-29');
    expect(m.days[4].date).toBe('2026-10-29');
    expect(m.days[8].date).toBe('2026-11-02');
  });

  it('정류지는 자기 여행지의 일정에서 온다 (섞이지 않는다)', async () => {
    const m = await loadTripDayModel(TRIP);
    expect(m.days[1].stops.map((s) => s.name)).toEqual(['왓 포']);   // 방콕 DAY 2
    expect(m.days[4].stops.map((s) => s.name)).toEqual(['카타 비치']); // 푸켓 DAY 1 (= 전체 DAY 5)
    expect(m.days[0].stops).toHaveLength(0);
    expect(vi.mocked(loadRoutePlan)).toHaveBeenCalledWith('d-bkk');
    expect(vi.mocked(loadRoutePlan)).toHaveBeenCalledWith('d-pkt');
  });

  it('숙소 구간은 모든 여행지 것을 날짜순으로 합친다', async () => {
    const m = await loadTripDayModel(TRIP);
    expect(m.staySegments.map((s) => s.id)).toEqual(['s-bkk', 's-pkt']);
  });

  it('저장소를 쓸 수 있으면 storageReady', async () => {
    expect((await loadTripDayModel(TRIP)).storageReady).toBe(true);
  });

  it('어떤 여행지의 일정이 비어 있어도(null) 터지지 않는다', async () => {
    vi.mocked(loadRoutePlan).mockResolvedValue(null);
    const m = await loadTripDayModel(TRIP);
    expect(m.days).toHaveLength(9);
    expect(m.days.every((d) => d.stops.length === 0)).toBe(true);
  });
});

describe('loadDayModel — PC는 활성 여행지 하나만', () => {
  it('활성 여행지(푸켓)의 DAY만, 여행 전체 번호로 돌려준다', async () => {
    const m = await loadDayModel(TRIP);
    expect(m.days).toHaveLength(5);
    expect(m.days.map((d) => d.label)).toEqual(['DAY 5', 'DAY 6', 'DAY 7', 'DAY 8', 'DAY 9']);
    expect(m.days.every((d) => d.destId === 'd-pkt')).toBe(true);
    expect(vi.mocked(loadRoutePlan)).toHaveBeenCalledTimes(1);
  });

  it('활성 여행지를 방콕으로 바꾸면 방콕만', async () => {
    H.active = { id: 'd-bkk' };
    const m = await loadDayModel(TRIP);
    expect(m.days.map((d) => d.label)).toEqual(['DAY 1', 'DAY 2', 'DAY 3', 'DAY 4']);
  });
});

describe('여행지가 하나뿐일 때', () => {
  it('두 로더의 결과가 같다 (모바일이 PC와 어긋나지 않는다)', async () => {
    vi.mocked(loadDestinations).mockResolvedValue([BKK]);
    H.active = { id: 'd-bkk' };
    const a = await loadDayModel(TRIP);
    const b = await loadTripDayModel(TRIP);
    expect(b.days.map((d) => [d.label, d.date, d.destId, d.dayIndex, d.stops.length]))
      .toEqual(a.days.map((d) => [d.label, d.date, d.destId, d.dayIndex, d.stops.length]));
  });

  it('합성 여행지(DB 행 없음)면 destId가 null이고 일정은 비어 있다', async () => {
    const legacy = dest('legacy-dest:t1', '방콕', '2026-10-26', '2026-10-29');
    vi.mocked(loadDestinations).mockResolvedValue([legacy]);
    H.active = { id: 'legacy-dest:t1' };
    const m = await loadTripDayModel(TRIP);
    expect(m.days.every((d) => d.destId === null)).toBe(true);
    expect(m.days.every((d) => d.stops.length === 0)).toBe(true);
    expect(m.storageReady).toBe(false);
    expect(vi.mocked(loadRoutePlan)).not.toHaveBeenCalled();
  });
});
