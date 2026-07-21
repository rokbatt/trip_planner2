/**
 * 다중 여행지 · 다중 숙소 구간 — 데이터 접근 계층 (Phase 1 토대)
 *
 * 이 모듈은 새 스키마(trip_destinations / stay_segments)를 읽되,
 * 아직 마이그레이션(supabase/multi_destination.sql)이 실행되지 않은 환경에서도
 * 앱이 그대로 동작하도록 "우아한 폴백(graceful degradation)"을 제공한다.
 *
 *   - 새 테이블이 있으면       → 그 데이터를 사용
 *   - 새 테이블이 없거나 비어있으면 → 기존 trips.destinations[0] / shortlist_* 컬럼으로 합성
 *
 * 합성 레코드는 id 앞에 접두사(legacy:)를 붙여 "진짜 DB 행이 아님"을 표시한다.
 * 이렇게 하면 Phase 2/3 UI가 "저장 가능한 실제 여행지/구간"인지 구분할 수 있다.
 */

import { supabase } from '../supabase';
import type { Trip, TripDestination, StaySegment } from '../types/database';

const SYNTHETIC_DEST_PREFIX = 'legacy-dest:';
const SYNTHETIC_SEG_PREFIX = 'legacy-seg:';

/** 합성(마이그레이션 전 폴백) 레코드인지 — 저장 대상이 아직 DB에 없다는 뜻 */
export function isSyntheticDestination(id: string): boolean {
  return id.startsWith(SYNTHETIC_DEST_PREFIX);
}
export function isSyntheticSegment(id: string): boolean {
  return id.startsWith(SYNTHETIC_SEG_PREFIX);
}

/**
 * 여행의 "대표 여행지 이름" (동기). 기존 여기저기 흩어져 있던
 * `trip.destinations?.[0] ?? trip.name` 로직을 한 곳으로 모은 것.
 */
export function syntheticDestinationName(trip: Trip | null): string {
  if (!trip) return '';
  return trip.destinations?.[0] ?? trip.name ?? '';
}

function syntheticDestination(trip: Trip): TripDestination {
  return {
    id: SYNTHETIC_DEST_PREFIX + trip.id,
    trip_id: trip.id,
    name: syntheticDestinationName(trip),
    lat: trip.dest_lat ?? null,
    lng: trip.dest_lng ?? null,
    start_date: trip.start_date,
    end_date: trip.end_date,
    sort_order: 0,
    created_at: trip.created_at,
  };
}

/**
 * 여행지 목록. trip_destinations 테이블이 있으면 그걸(정렬 순),
 * 없거나 비어있으면 trip 으로 합성한 단일 여행지 1개를 반환.
 * → 여행지 1곳인 기존 여행은 화면상 완전히 동일하게 동작.
 */
export async function loadDestinations(trip: Trip): Promise<TripDestination[]> {
  try {
    const { data, error } = await supabase
      .from('trip_destinations')
      .select('*')
      .eq('trip_id', trip.id)
      .order('sort_order', { ascending: true });
    if (!error && data && data.length > 0) return data as TripDestination[];
  } catch {
    /* 테이블 없음 등 → 폴백 */
  }
  return [syntheticDestination(trip)];
}

function syntheticSegmentFromTrip(trip: Trip, destination: TripDestination): StaySegment {
  return {
    id: SYNTHETIC_SEG_PREFIX + destination.id,
    trip_id: trip.id,
    destination_id: isSyntheticDestination(destination.id) ? null : destination.id,
    sort_order: 0,
    start_date: destination.start_date ?? trip.start_date,
    end_date: destination.end_date ?? trip.end_date,
    zone_name: trip.shortlist_zone_name,
    zone_place_ids: trip.shortlist_zone_place_ids,
    basecamp_place_id: trip.shortlist_basecamp_place_id,
    confirmed_place_ids: trip.shortlist_confirmed_place_ids,
    created_at: trip.created_at,
  };
}

/** 실제 여행지인데 아직 구간 행이 없을 때의 빈 구간 (새로 추가된 여행지 등) */
function emptySegment(trip: Trip, destination: TripDestination): StaySegment {
  return {
    id: SYNTHETIC_SEG_PREFIX + destination.id,
    trip_id: trip.id,
    destination_id: destination.id,
    sort_order: 0,
    start_date: destination.start_date,
    end_date: destination.end_date,
    zone_name: null,
    zone_place_ids: null,
    basecamp_place_id: null,
    confirmed_place_ids: null,
    created_at: trip.created_at,
  };
}

/**
 * 한 여행지의 숙소 구간 목록.
 *  - 실제 여행지 + 구간 행 있음 → 그 행들
 *  - 실제 여행지 + 구간 행 없음 → 빈 구간 1개 (새 여행지는 아직 아무것도 안 정함)
 *  - 합성 여행지(마이그레이션 전) 또는 테이블 자체 없음 → 기존 shortlist_* 컬럼으로 합성 1개
 * → 숙소를 안 나눈 여행지는 항상 구간 1개로 보이므로 기존 흐름과 동일.
 */
export async function loadStaySegments(trip: Trip, destination: TripDestination): Promise<StaySegment[]> {
  if (!isSyntheticDestination(destination.id)) {
    try {
      const { data, error } = await supabase
        .from('stay_segments')
        .select('*')
        .eq('destination_id', destination.id)
        .order('sort_order', { ascending: true });
      if (!error && data && data.length > 0) return data as StaySegment[];
      if (!error) return [emptySegment(trip, destination)]; // 테이블은 있고 이 여행지 구간만 없음
    } catch {
      /* 테이블 없음 → 아래 컬럼 폴백 */
    }
  }
  return [syntheticSegmentFromTrip(trip, destination)];
}

/** stay_segment 저장 상태(Step1~3 결과) */
export interface SegmentState {
  zone_name: string | null;
  zone_place_ids: string[] | null;
  basecamp_place_id: string | null;
  confirmed_place_ids: string[] | null;
}

/**
 * 숙소 구간 상태 저장. 저장 위치는 상황에 따라 자동 결정:
 *  - 합성 여행지(마이그레이션 전) → 기존 trips.shortlist_* 컬럼 (기존 동작 유지)
 *  - 실제 여행지 + 실제 구간 행 → 그 행 update
 *  - 실제 여행지 + 아직 행 없음(빈/합성 구간) → 새 stay_segments 행 insert
 * 반환: 갱신된 StaySegment (insert된 실제 행 포함) — 호출부가 이후 update용 id를 이어받도록.
 */
export async function saveStaySegment(
  trip: Trip,
  destination: TripDestination,
  segment: StaySegment,
  state: SegmentState
): Promise<StaySegment> {
  if (isSyntheticDestination(destination.id)) {
    await supabase
      .from('trips')
      .update({
        shortlist_zone_name: state.zone_name,
        shortlist_zone_place_ids: state.zone_place_ids,
        shortlist_basecamp_place_id: state.basecamp_place_id,
        shortlist_confirmed_place_ids: state.confirmed_place_ids,
      })
      .eq('id', trip.id);
    return { ...segment, ...state };
  }

  if (!isSyntheticSegment(segment.id)) {
    const { data, error } = await supabase
      .from('stay_segments')
      .update(state)
      .eq('id', segment.id)
      .select()
      .single();
    if (error) console.error('[stay_segments] 구간 저장 실패:', error.message);
    return (data as StaySegment) ?? { ...segment, ...state };
  }

  const { data, error } = await supabase
    .from('stay_segments')
    .insert({
      trip_id: trip.id,
      destination_id: destination.id,
      sort_order: segment.sort_order ?? 0,
      start_date: segment.start_date,
      end_date: segment.end_date,
      ...state,
    })
    .select()
    .single();
  if (error) console.error('[stay_segments] 구간 생성 실패:', error.message);
  return (data as StaySegment) ?? { ...segment, ...state };
}

/* ────────────────────────────────────────────────────────────
 * 활성 여행지 — 세션 내 공유 상태
 * 보드에서 고른 여행지를 shortlist에서도 이어받도록 트립별로 기억(in-memory).
 * ──────────────────────────────────────────────────────────── */
const activeByTrip = new Map<string, string>();

/**
 * 활성 여행지가 바뀌었을 때 발생하는 이벤트. 워크스페이스 헤더(방콕 · 10.26–11.01 같은
 * 여행지·날짜 표시)가 게이트 재렌더 없이도 즉시 갱신되도록, 이 이벤트를 듣고 자기 갱신한다
 * (헤더는 워크스페이스 셸에 속해 보드/shortlist 재렌더와는 별개 타이밍에 그려지기 때문).
 */
export const ACTIVE_DESTINATION_CHANGED_EVENT = 'mongsil:activeDestinationChanged';

export function setActiveDestinationId(tripId: string, destId: string): void {
  activeByTrip.set(tripId, destId);
  window.dispatchEvent(new CustomEvent(ACTIVE_DESTINATION_CHANGED_EVENT, { detail: { tripId, destId } }));
}

/** 목록에서 활성 여행지를 고름 — 저장된 활성값이 유효하면 그걸, 아니면 첫 번째 */
export function resolveActiveDestination(tripId: string, dests: TripDestination[]): TripDestination {
  const savedId = activeByTrip.get(tripId);
  const found = savedId ? dests.find((d) => d.id === savedId) : null;
  const active = found ?? dests[0];
  if (active) activeByTrip.set(tripId, active.id);
  return active;
}

/* ── 활성 숙소 구간(세션 공유, 여행지별) ── */
const activeSegByDest = new Map<string, string>();

export function setActiveSegmentId(destId: string, segId: string): void {
  activeSegByDest.set(destId, segId);
}

/** 여행지의 구간 목록에서 활성 구간을 고름 — 저장값이 유효하면 그걸, 아니면 첫 번째 */
export function resolveActiveSegment(destId: string, segs: StaySegment[]): StaySegment | null {
  const savedId = activeSegByDest.get(destId);
  const found = savedId ? segs.find((s) => s.id === savedId) : null;
  const active = found ?? segs[0] ?? null;
  if (active) activeSegByDest.set(destId, active.id);
  return active;
}

/**
 * 장소가 이 여행지에 속하는지. 마이그레이션 전(합성 여행지)에는 모든 장소를 보여주고,
 * 실제 여행지에서는 destination_id가 일치하는 장소만.
 * (마이그레이션 5b가 기존 장소를 전부 태깅하므로 실제 환경에선 정확히 나뉨)
 */
export function placeBelongsToDestination(
  place: { destination_id: string | null },
  destination: TripDestination
): boolean {
  if (isSyntheticDestination(destination.id)) return true; // 마이그레이션 전 = 단일 여행지 = 전부
  return place.destination_id === destination.id;
}

/* ── 쓰기 ── */

export async function createDestination(
  tripId: string,
  name: string,
  opts: { lat?: number | null; lng?: number | null; startDate?: string | null; endDate?: string | null; sortOrder?: number } = {}
): Promise<TripDestination | null> {
  const { data, error } = await supabase
    .from('trip_destinations')
    .insert({
      trip_id: tripId,
      name,
      lat: opts.lat ?? null,
      lng: opts.lng ?? null,
      start_date: opts.startDate ?? null,
      end_date: opts.endDate ?? null,
      sort_order: opts.sortOrder ?? 0,
    })
    .select()
    .single();
  if (error) {
    console.error('[destinations] 여행지 추가 실패:', error.message);
    return null;
  }
  return data as TripDestination;
}

export async function updateDestination(
  id: string,
  patch: Partial<Pick<TripDestination, 'name' | 'lat' | 'lng' | 'start_date' | 'end_date' | 'sort_order'>>
): Promise<boolean> {
  const { error } = await supabase.from('trip_destinations').update(patch).eq('id', id);
  if (error) console.error('[destinations] 여행지 수정 실패:', error.message);
  return !error;
}

/**
 * 여행지 삭제. 그 전에 이 여행지의 장소들을 다른 여행지로 옮겨(reassignToId)
 * 장소가 미아(destination_id=null)가 되지 않게 한다.
 */
export async function deleteDestination(id: string, reassignToId: string | null): Promise<boolean> {
  if (reassignToId) {
    const { error: moveErr } = await supabase
      .from('places')
      .update({ destination_id: reassignToId })
      .eq('destination_id', id);
    if (moveErr) {
      console.error('[destinations] 장소 재배정 실패:', moveErr.message);
      return false;
    }
  }
  const { error } = await supabase.from('trip_destinations').delete().eq('id', id);
  if (error) console.error('[destinations] 여행지 삭제 실패:', error.message);
  return !error;
}

/* ── 숙소 구간 CRUD (Phase 3 — 한 여행지 안에서 숙소 나누기) ── */

export async function createStaySegment(
  trip: Trip,
  destination: TripDestination,
  opts: {
    startDate?: string | null;
    endDate?: string | null;
    sortOrder?: number;
    // 기존 구간을 나눌 때(가운데를 잘라내는 경우) 남는 뒤쪽 조각이 원래 구간과 같은
    // 숙소/지역 선택 상태를 그대로 이어받도록 복제해 넣을 때 사용
    zoneName?: string | null;
    zonePlaceIds?: string[] | null;
    basecampPlaceId?: string | null;
    confirmedPlaceIds?: string[] | null;
  } = {}
): Promise<StaySegment | null> {
  const { data, error } = await supabase
    .from('stay_segments')
    .insert({
      trip_id: trip.id,
      destination_id: destination.id,
      sort_order: opts.sortOrder ?? 0,
      start_date: opts.startDate ?? null,
      end_date: opts.endDate ?? null,
      zone_name: opts.zoneName ?? null,
      zone_place_ids: opts.zonePlaceIds ?? null,
      basecamp_place_id: opts.basecampPlaceId ?? null,
      confirmed_place_ids: opts.confirmedPlaceIds ?? null,
    })
    .select()
    .single();
  if (error) {
    console.error('[stay_segments] 숙소 구간 추가 실패:', error.message);
    return null;
  }
  return data as StaySegment;
}

export async function updateStaySegment(
  id: string,
  patch: Partial<Pick<StaySegment, 'start_date' | 'end_date' | 'sort_order'>>
): Promise<boolean> {
  const { error } = await supabase.from('stay_segments').update(patch).eq('id', id);
  if (error) console.error('[stay_segments] 숙소 구간 수정 실패:', error.message);
  return !error;
}

export async function deleteStaySegment(id: string): Promise<boolean> {
  const { error } = await supabase.from('stay_segments').delete().eq('id', id);
  if (error) console.error('[stay_segments] 숙소 구간 삭제 실패:', error.message);
  return !error;
}

/**
 * 숙소 구간의 "날짜만" 수정 (숙소/지역 선택은 그대로 유지).
 * saveStaySegment와 동일한 우아한 폴백 원칙:
 *  - 합성 여행지(마이그레이션 전) → trips.start_date/end_date를 대신 수정
 *  - 실제 여행지 + 아직 실제 구간 행 없음(빈/합성 구간, 숙소를 안 나눈 상태) → trip_destinations 날짜를 대신 수정
 *  - 실제 구간 행 있음 → 그 행의 날짜만 update
 */
export async function updateSegmentDates(
  trip: Trip,
  destination: TripDestination,
  segment: StaySegment,
  startDate: string | null,
  endDate: string | null
): Promise<StaySegment> {
  if (isSyntheticDestination(destination.id)) {
    await supabase.from('trips').update({ start_date: startDate, end_date: endDate }).eq('id', trip.id);
    return { ...segment, start_date: startDate, end_date: endDate };
  }
  if (isSyntheticSegment(segment.id)) {
    await updateDestination(destination.id, { start_date: startDate, end_date: endDate });
    return { ...segment, start_date: startDate, end_date: endDate };
  }
  await updateStaySegment(segment.id, { start_date: startDate, end_date: endDate });
  return { ...segment, start_date: startDate, end_date: endDate };
}
