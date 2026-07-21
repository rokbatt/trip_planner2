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

/**
 * 한 여행지의 숙소 구간 목록. stay_segments 테이블에 행이 있으면 그걸,
 * 없거나(마이그레이션 전) 비어있으면 기존 shortlist_* 컬럼으로 합성한 단일 구간 1개.
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
    } catch {
      /* 테이블 없음 등 → 폴백 */
    }
  }
  return [syntheticSegmentFromTrip(trip, destination)];
}
