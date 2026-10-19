/**
 * DAY 모델 — route_days/route_stops를 "시간축에 올린 하루"로 바꾸는 **단일 기준**.
 *
 * TIMELINE(데스크톱 시각표)과 MOBILE(여행 중 Companion)이 같은 일정을 보여줘야 하므로,
 * 저장 데이터를 화면 모델로 바꾸는 변환과 시각 계산은 여기 한 곳에만 둔다.
 * `utils/travelEstimate.ts`가 "구간 하나의 숫자"의 단일 기준이라면, 이 파일은 "하루 전체를
 * 시간축에 올리는 규칙"의 단일 기준이다 — 같은 DAY인데 두 화면의 도착 시각이 다르면
 * 그 자체가 버그다(Claude.md 5-3).
 *
 * 표현 계층(아이콘·색·마크업)은 각 모듈이 따로 가진다. 여기엔 DOM이 없다.
 *
 * 원칙 3-1 — 여기서 나오는 도착 시각·체류시간은 대부분 추정치다. 좌표가 없으면 구간을
 * 만들지 않고(null), 영업시간은 저장된 값이 있을 때만 고른다. 없는 값을 지어내지 않는다.
 */

import { makeStopKey } from '../route/progressRemap';
import { supabase } from '../supabase';
import {
  loadDestinations,
  resolveActiveDestination,
  loadStaySegments,
  isSyntheticDestination,
  dayNumberOffsetFor,
  destinationDayCount,
} from '../trips/destinations';
import { planSpans } from './tripSpans';
import { loadRoutePlan, isRouteStorageReady } from '../route/routeStore';
import type { StoredStop } from '../route/routeStore';
import {
  estimateLegBetween,
  legKey,
  catKeyFor,
  dwellMinutes,
  hhmmToMin,
} from '../utils/travelEstimate';
import type { Leg, RealLeg, TravelMode, CatKey } from '../utils/travelEstimate';
import type { Database, StaySegment, TripDestination } from '../types/database';
import { warningFor } from './openingHours';
import type { HoursWarning } from './openingHours';

export type { HoursWarning } from './openingHours';

type Place = Database['public']['Tables']['places']['Row'];
type Trip = Database['public']['Tables']['trips']['Row'];

/** 하루의 기본 시작 시각(분) — ROUTE의 computeStopTimes와 같은 09:00 기준 */
export const DAY_START_MIN = 9 * 60;

export const MODES: TravelMode[] = ['WALK', 'TRANSIT', 'TAXI'];

/* ══════════════ 타입 ══════════════ */

/** 일정 카드 한 장 — route_stops 한 행에 대응 */
export interface TlStop {
  /** 이 DAY 안에서만 유일하면 되는 행 키 (같은 장소를 하루에 두 번 담을 수 있으므로 순번 포함) */
  key: string;
  placeId: string | null;
  /** 지도에 직접 찍은 지점·공항처럼 places 행이 없는 정류지의 이름 */
  customName: string | null;
  lat: number | null;
  lng: number | null;
  /** 사용자가 직접 고정한 도착 시각 (HH:MM). 없으면 앞 일정에서 계산 */
  arriveTime: string | null;
  memo: string | null;
  /** 이 정류지로 **들어오는** 구간의 수동 이동수단 (저장 스키마가 도착지 기준) */
  travelMode: TravelMode | null;
  /** 비어있으면 일반 정류지, 있으면 "숙소 들르기"처럼 목적만 있는 특수 스탑 */
  purpose: string | null;
  /** 사용자가 직접 정한 체류시간(분). 없으면 카테고리 기본값(dwellMinutes) 추정치를 쓴다 */
  customDwellMin: number | null;
  /* 표시용 파생값 */
  name: string;
  cat: CatKey;
  place: Place | null;
}

export interface TlDay {
  /** **그 여행지 안에서의** 순번(0부터) — route_days.day_index와 trip_stop_progress가 이 값으로 저장된다 */
  dayIndex: number;
  /** 이 DAY가 속한 여행지. 합성 여행지(아직 destination 행이 없는 트립)면 null.
   *  여러 여행지를 이어 붙인 모델에서는 이 값으로 "어느 여행지의 DAY인지"를 되짚는다 —
   *  도착 기록이 (destination_id, day_index)로 저장되기 때문이다. */
  destId: string | null;
  destName: string | null;
  /** **여행 전체 기준** DAY 번호(1부터) — 라벨 "DAY n"의 n이고, 서류의 day_start/day_end와 같은 기준이다 */
  dayNumber: number;
  label: string;
  /** 이 DAY의 실제 캘린더 날짜 (YYYY-MM-DD). 시작일을 모르면 null */
  date: string | null;
  stops: TlStop[];
}

/** 한 DAY를 시간축에 올린 결과 */
export interface DaySchedule {
  arriveMin: number[];
  departMin: number[];
  dwellMin: number[];
  /** 고정 시각 때문에 생긴 여유(분). 0보다 크면 그 앞에 빈 시간이 있다는 뜻 */
  slackMin: number[];
  /** 고정 시각이 앞 일정보다 빠를 때 모자란 시간(분). 0보다 크면 일정이 겹친다 */
  overrunMin: number[];
  /** stops[i] → stops[i+1] 구간 (좌표가 없는 정류지는 null) */
  legs: Array<Leg | null>;
  totalMoveMin: number;
  totalDwellMin: number;
  totalCost: number;
  currency: string;
  spanStartMin: number;
  spanEndMin: number;
  realLegCount: number;
  legCount: number;
}

/**
 * `toStop`이 저장 행을 화면 모델로 바꿀 때 필요한 조회 테이블 묶음.
 * 모듈 전역 상태로 두면 두 화면이 같은 전역을 밟게 되므로 명시적으로 넘긴다.
 */
export interface DayModelContext {
  placeById: Map<string, Place>;
  basecampIds: Set<string>;
  airportPlaceByName: Map<string, Place>;
}

/** 실측 경로 캐시 — 구간 키 → 모드별 실측값 */
export type RealLegMap = Map<string, Record<string, RealLeg>>;

/** `loadDayModel`이 한 번에 돌려주는 하루 모델 전체 */
export interface DayModel {
  days: TlDay[];
  ctx: DayModelContext;
  /** 합성 여행지(=아직 실제 destination 행이 없음)면 null — 이때는 저장이 불가능하다 */
  activeDestId: string | null;
  destinations: TripDestination[];
  staySegments: StaySegment[];
  /** route_plan 마이그레이션이 적용돼 저장이 가능한 상태인지 */
  storageReady: boolean;
}

/* ══════════════ 날짜 · 영업시간 ══════════════ */

export function shiftDate(iso: string, plusDays: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + plusDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * 이 정류지가 속한 캘린더 날짜(dateISO)의 요일에 맞는 영업시간 한 줄을 고른다.
 * Google Places의 opening_hours(weekdayDescriptions)는 월요일부터 7줄이 오므로,
 * JS의 getDay()(일=0)를 월요일 기준 인덱스로 바꿔서 정확히 그날의 줄만 골라 쓴다.
 * 데이터가 없거나 형식이 다르면 null — 근거 없는 영업시간을 지어내지 않는다(원칙 3-1).
 */
export function todaysHoursLine(place: Place | null, dateISO: string | null): string | null {
  const lines = place?.opening_hours;
  if (!dateISO || !Array.isArray(lines) || lines.length !== 7) return null;
  if (!lines.every((l) => typeof l === 'string')) return null;
  const d = new Date(dateISO + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const mondayFirstIdx = (d.getDay() + 6) % 7;
  const line = String(lines[mondayFirstIdx]).trim();
  if (!line) return null;
  // "월요일: 09:00~18:00" 형식이면 요일 접두어는 떼고 시간만 배지에 보여준다
  const colonIdx = line.indexOf(':');
  return colonIdx >= 0 && colonIdx < 6 ? line.slice(colonIdx + 1).trim() : line;
}

/* ══════════════ 영업시간 대조 ══════════════ */

/**
 * 이 정류지의 계획 시각이 영업시간과 어긋나는지. 어긋나지 않거나 판단할 수 없으면 null.
 *
 * 영업시간은 전부터 저장돼 있었지만(`opening_hours`) **보여주기만 하고 도착 시각과 맞춰보진
 * 않았다** — "19:40 도착"과 "18:00 마감"이 한 화면에 떠 있어도 사람이 직접 비교해야 했다.
 * 여기서 그 대조를 한다. 새로 받아오는 데이터는 없고 이미 가진 두 값을 비교할 뿐이다.
 *
 * 문자열 해석 규칙은 `openingHours.ts`(의존성 없는 순수 모듈)에 있다 — 못 읽으면 경고를
 * 포기한다(원칙 3-1). 새 영업시간 형식이 안 읽히면 그 파일을 고치고 그 파일에서 검증할 것.
 */
export function hoursWarning(
  place: Place | null,
  dateISO: string | null,
  arriveMin: number,
  departMin?: number
): HoursWarning | null {
  return warningFor(todaysHoursLine(place, dateISO), arriveMin, departMin);
}

/* ══════════════ 공항 앵커 ══════════════ */

/** 공항 이름/좌표로 실제 Place 객체를 만든다 — ROUTE의 makeAnchorPlace와 동일한 목적.
 * 사진/평점은 트립 설정에서 자동완성으로 공항을 고를 때 이미 trip_destinations에
 * 캐싱되어 있으므로 그대로 넘겨받는다(원칙 3-1 — 없으면 null로 둔다). */
export function makeAnchorPlace(
  tripId: string,
  name: string,
  lat: number,
  lng: number,
  photoUrl: string | null,
  rating: number | null
): Place {
  return {
    id: 'airport:' + name,
    trip_id: tripId,
    name,
    lat,
    lng,
    address: null,
    photo_url: photoUrl,
    category: '공항',
    notes: null,
    added_by: null,
    created_at: new Date().toISOString(),
    likes_count: 0,
    google_place_id: null,
    google_rating: rating,
    photo_ref: null,
    opening_hours: null,
    mood: null,
    status: 'idea',
    is_idea: false,
    sort_order: 0,
    destination_id: null,
    group_id: null,
    group_name: null,
    group_order: null,
  } as Place;
}

export function buildAirportPlaceMap(trip: Trip, dest: TripDestination | null): Map<string, Place> {
  const map = new Map<string, Place>();
  if (dest?.arrival_airport && dest.arrival_lat != null && dest.arrival_lng != null) {
    map.set(
      dest.arrival_airport,
      makeAnchorPlace(trip.id, dest.arrival_airport, dest.arrival_lat, dest.arrival_lng, dest.arrival_photo_url ?? null, dest.arrival_rating ?? null)
    );
  }
  if (dest?.departure_airport && dest.departure_lat != null && dest.departure_lng != null) {
    map.set(
      dest.departure_airport,
      makeAnchorPlace(trip.id, dest.departure_airport, dest.departure_lat, dest.departure_lng, dest.departure_photo_url ?? null, dest.departure_rating ?? null)
    );
  }
  return map;
}

/* ══════════════ 저장 행 ↔ 화면 모델 ══════════════ */

export function toStop(ctx: DayModelContext, s: StoredStop, dayIndex: number, order: number): TlStop {
  const airportPlace = !s.placeId && s.customName ? ctx.airportPlaceByName.get(s.customName) ?? null : null;
  const place = s.placeId ? ctx.placeById.get(s.placeId) ?? null : airportPlace;
  const name = place?.name ?? s.customName ?? '이름 없는 지점';
  const isBasecamp = !!s.placeId && ctx.basecampIds.has(s.placeId);
  const isAirport = !!airportPlace;
  const mode = s.travelMode && (MODES as string[]).includes(s.travelMode) ? (s.travelMode as TravelMode) : null;
  return {
    key: makeStopKey(dayIndex, order, s.placeId, s.customName),
    placeId: s.placeId,
    customName: s.customName,
    purpose: s.purpose,
    customDwellMin: s.customDwellMin,
    lat: place?.lat ?? s.customLat,
    lng: place?.lng ?? s.customLng,
    arriveTime: s.arriveTime,
    memo: s.memo,
    travelMode: mode,
    name,
    cat: catKeyFor(place?.mood ?? null, place?.category ?? null, { isBasecamp, isAirport }),
    place,
  };
}

/** 이 정류지의 체류시간 — 사용자가 직접 정했으면 그 값, 아니면 카테고리 기본값(추정치).
 *  진행 중(실제 도착/출발 기록) 여부는 모르는 컨텍스트(상세 패널 등)에서 쓴다 — 실제 기록은
 *  scheduleFor에서만 이보다 우선한다(원칙 3-1 — 실제 기록 > 사용자 지정 > 추정치). */
export function effectiveDwellMinutes(stop: TlStop): number {
  return stop.customDwellMin ?? dwellMinutes(stop.cat);
}

export function toStoredStops(day: TlDay): StoredStop[] {
  return day.stops.map((s) => ({
    placeId: s.placeId,
    customName: s.placeId ? null : s.customName ?? s.name,
    customLat: s.placeId ? null : s.lat,
    customLng: s.placeId ? null : s.lng,
    arriveTime: s.arriveTime,
    memo: s.memo || null,
    travelMode: s.travelMode,
    purpose: s.purpose,
    customDwellMin: s.customDwellMin,
  }));
}

/* ══════════════ 구간 ══════════════ */

/** 실측 캐시 키 — 좌표 기반이라 같은 장소를 여러 DAY에 담아도 캐시가 공유된다 */
export function stopLegKey(a: TlStop, b: TlStop): string {
  return legKey(a.placeId ?? coordId(a), b.placeId ?? coordId(b));
}

export function coordId(s: TlStop): string {
  return (s.lat ?? 0).toFixed(5) + ',' + (s.lng ?? 0).toFixed(5);
}

/** 좌표가 둘 다 있어야 구간을 계산할 수 있다 (원칙 3-1 — 좌표를 지어내지 않음) */
export function legBetween(a: TlStop, b: TlStop, realLegs: RealLegMap): Leg | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  return estimateLegBetween(
    { lat: a.lat, lng: a.lng },
    { lat: b.lat, lng: b.lng },
    b.travelMode ?? undefined,
    realLegs.get(stopLegKey(a, b))
  );
}

/* ══════════════ 실시간 진행 상황 (MOBILE) ══════════════ */

/**
 * 정류지 하나의 실제 도착/출발 기록. `mobile/stopProgress.ts`(I/O 계층)가 Supabase에서 읽어
 * 채워 넣고, 여기(계산 계층)는 그 값을 시각 계산에 어떻게 반영할지만 안다 — 저장 방식은
 * 모른다. 키는 route_stops.id가 아니라 `TlStop.key`다(이유는 supabase/trip_stop_progress.sql
 * 상단 주석 참고 — route_stops는 저장할 때마다 그 DAY를 통째로 지우고 다시 넣으므로
 * FK로 걸면 관련 없는 수정에도 CASCADE로 진행 기록이 날아간다).
 */
export interface StopProgress {
  status: 'pending' | 'arrived' | 'departed' | 'skipped';
  actualArriveAt: string | null;
  actualDepartAt: string | null;
}

/** TlStop.key → 그 정류지의 실시간 진행 상황 */
export type ProgressMap = Map<string, StopProgress>;

/** ISO 타임스탬프를 "그 날짜의 자정부터 몇 분"으로 바꾼다 — 브라우저 로컬 시간대 기준
 *  (여행자의 폰이 현지 시간대를 따라간다고 가정, ROUTE/TIMELINE의 HH:MM 표시와 같은 기준) */
function isoToMinutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/* ══════════════ 시각 계산 ══════════════ */

/**
 * 하루를 시간축에 올린다. 09:00에서 출발해 "체류 + 이동"을 누적하고, 사용자가 고정한
 * 도착 시각을 만나면 그 시각으로 시계를 맞춘다(ROUTE의 computeStopTimes와 같은 규칙).
 *
 * 여기에 더해 고정 시각과 자연스러운 도착 시각의 차이를 따로 남긴다 —
 *   앞당겨 고정  → overrun(일정이 겹침, 앞 일정을 줄여야 함)
 *   늦춰서 고정  → slack(그 앞에 비는 시간이 생김)
 * 단순 나열이 아니라 "이 일정이 실제로 가능한가"를 보여주기 위한 값이다.
 *
 * `progress`(선택)를 넘기면 실제로 기록된 도착/출발 시각이 있는 정류지는 그 값을
 * **사용자가 고정한 시각보다도 우선해서** 쓴다 — 실제로 일어난 일이 계획보다 더 믿을 만한
 * 데이터이기 때문이다(원칙 3-1). 이후 시계는 그 실제 시각을 기준으로 계속 흘러가므로,
 * 아직 기록이 없는 뒤쪽 정류지들의 예상 시각도 자동으로 다시 계산된다.
 * 건너뛴(skipped) 정류지는 체류시간을 0으로 쳐서 뒤쪽 일정이 그만큼 당겨지게 한다.
 */
export function scheduleFor(day: TlDay, realLegs: RealLegMap, progress?: ProgressMap): DaySchedule {
  const stops = day.stops;
  const legs: Array<Leg | null> = [];
  for (let i = 0; i < stops.length - 1; i++) {
    legs.push(legBetween(stops[i], stops[i + 1], realLegs));
  }

  const arriveMin: number[] = [];
  const departMin: number[] = [];
  const dwellMin: number[] = [];
  const slackMin: number[] = [];
  const overrunMin: number[] = [];

  let clock = DAY_START_MIN;
  stops.forEach((s, i) => {
    const natural = clock;
    const fixed = s.arriveTime ? hhmmToMin(s.arriveTime) : null;
    const prog = progress?.get(s.key);
    const actualArrive = prog?.actualArriveAt != null ? isoToMinutesOfDay(prog.actualArriveAt) : null;
    const actualDepart = prog?.actualDepartAt != null ? isoToMinutesOfDay(prog.actualDepartAt) : null;
    // 실제 기록 > 사용자가 고정한 계획 시각 > 자연스러운 누적 시각, 이 순서로 우선한다
    const pinned = actualArrive ?? fixed;
    const arrive = pinned ?? natural;
    // 첫 정류지는 비교 대상이 없으므로 여유/겹침을 따지지 않는다
    slackMin.push(i > 0 && pinned != null && pinned > natural ? pinned - natural : 0);
    overrunMin.push(i > 0 && pinned != null && pinned < natural ? natural - pinned : 0);

    const dwell =
      prog?.status === 'skipped' ? 0
      : actualArrive != null && actualDepart != null ? Math.max(0, actualDepart - actualArrive)
      : effectiveDwellMinutes(s);
    const depart = actualDepart ?? arrive + dwell;

    arriveMin.push(arrive);
    dwellMin.push(dwell);
    departMin.push(depart);

    clock = depart + (legs[i]?.min ?? 0);
  });

  let totalMove = 0;
  let totalCost = 0;
  let realLegCount = 0;
  let legCount = 0;
  let currency = 'THB';
  legs.forEach((l) => {
    if (!l) return;
    legCount += 1;
    totalMove += l.min;
    totalCost += l.costTHB;
    if (l.real) realLegCount += 1;
    if (l.fare?.currency) currency = l.fare.currency;
  });

  return {
    arriveMin, departMin, dwellMin, slackMin, overrunMin, legs,
    totalMoveMin: totalMove,
    totalDwellMin: dwellMin.reduce((a, b) => a + b, 0),
    totalCost,
    currency,
    spanStartMin: arriveMin.length ? arriveMin[0] : DAY_START_MIN,
    spanEndMin: departMin.length ? departMin[departMin.length - 1] : DAY_START_MIN,
    realLegCount,
    legCount,
  };
}

/* ══════════════ 로딩 ══════════════ */

async function loadPlaces(tripId: string): Promise<Place[]> {
  const { data, error } = await supabase.from('places').select('*').eq('trip_id', tripId).not('mood', 'is', null);
  if (error) {
    console.error('[DayModel] places load error:', error.message);
    return [];
  }
  return data ?? [];
}

/**
 * 여행지 **하나**를 하루 모델로 만든다. 활성 여행지만 보는 PC(`loadDayModel`)와 모든 여행지를
 * 이어 보여주는 모바일(`loadTripDayModel`)이 **이 함수 하나를 공유한다** — 같은 DAY인데 두 화면의
 * 정류지·시각이 다르면 그 자체가 버그이기 때문이다(파일 머리말).
 *
 * `offset`은 이 여행지 앞에 이미 지나간 DAY 수다. DAY 라벨·번호가 여행 전체 기준으로 이어진다.
 */
async function buildDestinationDays(
  trip: Trip,
  dest: TripDestination | null,
  placeById: Map<string, Place>,
  offset: number
): Promise<{ days: TlDay[]; ctx: DayModelContext; staySegments: StaySegment[]; destId: string | null; storageReady: boolean }> {
  const destId = dest && !isSyntheticDestination(dest.id) ? dest.id : null;

  const segments = dest ? await loadStaySegments(trip, dest) : [];
  const staySegments = [...segments].sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''));

  const basecampIds = new Set(
    [...staySegments.map((s) => s.basecamp_place_id), trip.shortlist_basecamp_place_id].filter(
      (id): id is string => !!id
    )
  );
  const airportPlaceByName = buildAirportPlaceMap(trip, dest);
  const ctx: DayModelContext = { placeById, basecampIds, airportPlaceByName };

  // DAY 개수 = 숙박 일수 + 1 (ROUTE와 같은 계산 — 마지막 출국일도 하나의 DAY다)
  const start = dest?.start_date ?? trip.start_date;
  const dayCount = destinationDayCount(dest, trip);

  const days: TlDay[] = Array.from({ length: dayCount }, (_, i) => ({
    dayIndex: i,
    destId,
    destName: dest?.name ?? null,
    dayNumber: offset + i + 1,
    label: 'DAY ' + (offset + i + 1),
    date: start ? shiftDate(start, i) : null,
    stops: [] as TlStop[],
  }));

  if (!destId) return { days, ctx, staySegments, destId: null, storageReady: false };

  const stored = await loadRoutePlan(destId);
  const storageReady = isRouteStorageReady();
  if (stored) {
    stored.forEach((sd) => {
      const day = days[sd.dayIndex];
      if (!day) return; // 기간이 줄어들어 남은 DAY는 조용히 무시 (ROUTE와 같은 처리)
      day.stops = sd.stops.map((s, i) => toStop(ctx, s, sd.dayIndex, i));
    });
  }

  return { days, ctx, staySegments, destId, storageReady };
}

/** 활성 여행지 하나만 — 지금까지의 동작 그대로. 이미 불러온 places/destinations를 받는다. */
async function loadActiveOnly(
  trip: Trip,
  placeById: Map<string, Place>,
  destinations: TripDestination[]
): Promise<DayModel> {
  const dest: TripDestination | null = resolveActiveDestination(trip.id, destinations) ?? null;
  const activeId = dest && !isSyntheticDestination(dest.id) ? dest.id : null;

  // ROUTE와 같은 계산 — 이 여행지 앞에 다른 여행지가 있으면 그만큼 DAY 번호를 밀어서
  // 여행 전체 기준으로 이어지는 번호를 보여준다(예: 방콕 DAY1~3 다음 푸켓은 DAY4부터).
  const offset = activeId ? dayNumberOffsetFor(destinations, activeId, trip) : 0;
  const built = await buildDestinationDays(trip, dest, placeById, offset);

  return {
    days: built.days,
    ctx: built.ctx,
    activeDestId: activeId,
    destinations,
    staySegments: built.staySegments,
    storageReady: built.storageReady,
  };
}

/**
 * 저장된 동선(route_days/route_stops)을 하루 모델로 변환한다 — **활성 여행지 하나만.**
 * ROUTE가 숙소·공항 앵커까지 전부 순서대로 저장해 두므로, 여기서 앵커를 다시 계산하지 않고
 * 저장된 순서를 그대로 신뢰한다 — 그래야 화면끼리 일정이 어긋날 여지가 없다.
 */
export async function loadDayModel(trip: Trip): Promise<DayModel> {
  const places = await loadPlaces(trip.id);
  const placeById = new Map(places.map((p) => [p.id, p]));
  const destinations = await loadDestinations(trip);
  return loadActiveOnly(trip, placeById, destinations);
}

/**
 * **모든 여행지를 날짜순으로 이어 붙인** 하루 모델 — 모바일 Companion용.
 *
 * 폰에서는 여행지를 고르는 일이 곧 불편이다. 방콕 DAY 1~4 다음에 푸켓 DAY 5~가 선택 없이
 * 쭉 이어져야 한다. 각 날은 `destId`/`dayNumber`로 자기 여행지와 여행 전체 번호를 기억한다.
 *
 * 비용(원칙 3-2): 여행지마다 route_plan을 한 번씩 더 읽는다(여행지 N개면 N번, 병렬).
 * 정류지 좌표·진행 기록·실측 경로는 **여전히 활성 DAY 것만** 불러온다.
 * 여행지가 하나 이하면 `loadDayModel`과 완전히 같은 결과다.
 */
export async function loadTripDayModel(trip: Trip): Promise<DayModel> {
  const places = await loadPlaces(trip.id);
  const placeById = new Map(places.map((p) => [p.id, p]));
  const destinations = await loadDestinations(trip);

  const spans = planSpans(destinations, trip);
  if (spans.length <= 1) return loadActiveOnly(trip, placeById, destinations);

  const built = await Promise.all(
    spans.map((span) => buildDestinationDays(trip, span.dest, placeById, span.offset))
  );

  const basecampIds = new Set<string>();
  const airportPlaceByName = new Map<string, Place>();
  built.forEach((b) => {
    b.ctx.basecampIds.forEach((id) => basecampIds.add(id));
    b.ctx.airportPlaceByName.forEach((place, name) => airportPlaceByName.set(name, place));
  });

  const active = resolveActiveDestination(trip.id, destinations);
  return {
    days: built.flatMap((b) => b.days),
    ctx: { placeById, basecampIds, airportPlaceByName },
    activeDestId: active && !isSyntheticDestination(active.id) ? active.id : null,
    destinations,
    staySegments: built
      .flatMap((b) => b.staySegments)
      .sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? '')),
    storageReady: built.every((b) => b.storageReady),
  };
}
