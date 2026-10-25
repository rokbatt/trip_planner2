/**
 * 지도 "주변 탐색"의 Google 호출 — 기존 `utils/googleMaps.ts`가 띄운 Maps JS(Places API New)를 쓴다.
 * 새 서버 함수를 만들지 않는다(api/*.ts 12개 상한, 3-7).
 *
 * 비용 원칙(3-2)
 *   · 사용자가 **명시적으로** 검색할 때만 부른다(칩 선택·검색어 제출·"이 지역에서 다시 검색").
 *     지도를 움직인다고 부르지 않는다.
 *   · 같은 조건(약 110m 격자 + 반경)의 검색은 **이 기기에서 30분** 다시 쓴다(메모리, 새로고침하면 사라짐).
 *   · 목록은 목록에 필요한 필드만, 전화·웹사이트·리뷰·사진 여러 장은 상세를 열 때만 받는다.
 *   · 사진은 URL만 받고, 실제 이미지는 화면에 보일 때 브라우저가 받는다(lazy).
 *
 * Supabase에 저장하지 않는 이유: Google Places 약관상 서버에 오래 둘 수 있는 건 장소 ID(무기한)와
 * 좌표(30일)뿐이다. 이름·평점·사진·리뷰를 DB에 쌓으면 약관 위반이라, 기기 메모리에만 잠깐 둔다.
 */

import { loadGoogleMapsScript } from '../utils/googleMaps';
import { reportRouteError } from '../utils/legCooldown';
import {
  catDef,
  catOfTypes,
  nearbyDef,
  boundsAround,
  withinRadius,
  searchKey,
  normalizePrice,
  isOpenAt,
  todayHoursLine,
  type ExploreCat,
  type NearbyKey,
  type FilterablePlace,
  type HoursPeriod,
  type PriceLevel,
} from './explore';

export interface ExplorePlace extends FilterablePlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  types: string[];
  /** Google이 준 한국어 유형 이름(예: "태국 음식점"). 없으면 null */
  typeLabel: string | null;
  cat: Exclude<ExploreCat, 'all'>;
  photo: string | null;
  photoBy: string | null;
  priceLevel: PriceLevel | null;
  todayHours: string | null;
  weekdayHours: string[] | null;
}

export interface ExploreReview {
  author: string;
  authorUrl: string | null;
  rating: number | null;
  text: string;
  when: string | null;
}

export interface ExploreDetail {
  phone: string | null;
  phoneIntl: string | null;
  website: string | null;
  mapsUrl: string | null;
  summary: string | null;
  photos: Array<{ url: string; by: string | null }>;
  reviews: ExploreReview[];
  reservable: boolean | null;
  weekdayHours: string[] | null;
}

const LIST_FIELDS = [
  'id', 'displayName', 'location', 'types', 'primaryType', 'primaryTypeDisplayName', 'formattedAddress',
  'rating', 'userRatingCount', 'priceLevel', 'regularOpeningHours', 'utcOffsetMinutes', 'photos', 'isReservable',
];
const DETAIL_FIELDS = [
  'nationalPhoneNumber', 'internationalPhoneNumber', 'websiteURI', 'googleMapsURI', 'editorialSummary',
  'reviews', 'photos', 'regularOpeningHours', 'utcOffsetMinutes', 'isReservable',
];
/*
 * 필드 이름 주의: Maps JS의 Place 클래스는 REST(Places API New)와 이름이 다른 게 있다.
 *   REST `reservable` → JS `isReservable`, REST `websiteUri` → JS `websiteURI` …
 * 모르는 필드를 하나라도 넣으면 요청 전체가 InvalidValueError로 실패한다(실제로 났던 버그:
 * `reservable`을 넣어서 주변 검색이 통째로 안 됐다). 그래서 이름이 틀린 필드는 빼고 한 번 더
 * 요청한다(`withFieldRetry`) — 그 정보 한 줄만 비고 나머지는 보인다.
 */
const MAX_RESULTS = 20;

function reservableOf(p: any): boolean | null {
  const v = p?.isReservable ?? p?.reservable;
  return typeof v === 'boolean' ? v : null;
}

/** "Unknown fields requested: a, b" → 그 필드들을 빼고 다시(최대 3번) */
export async function withFieldRetry<T>(fields: string[], run: (fields: string[]) => Promise<T>): Promise<T> {
  let current = [...fields];
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(current);
    } catch (e) {
      const m = String((e as Error)?.message ?? e).match(/Unknown fields requested:\s*([^\n]+)/i);
      if (!m || attempt >= 3) throw e;
      const bad = m[1].split(',').map((x) => x.trim().replace(/[.\s]+$/, '')).filter(Boolean);
      const next = current.filter((f) => !bad.includes(f));
      if (next.length === current.length) throw e;
      console.warn('[Explore] Google이 모르는 필드를 빼고 다시 요청:', bad.join(', '));
      current = next;
    }
  }
}
const CACHE_MS = 30 * 60_000;

/** Google Place 객체 — 상세를 열 때 같은 객체에 필드를 더 받는다 */
const rawById = new Map<string, any>();
const searchCache = new Map<string, { at: number; places: ExplorePlace[] }>();
const detailCache = new Map<string, ExploreDetail>();

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function photoOf(p: any, maxWidth: number): { url: string; by: string | null } | null {
  const ph = Array.isArray(p?.photos) ? p.photos[0] : null;
  return photoUrl(ph, maxWidth);
}

function photoUrl(ph: any, maxWidth: number): { url: string; by: string | null } | null {
  if (!ph || typeof ph.getURI !== 'function') return null;
  try {
    const url = ph.getURI({ maxWidth });
    const by = Array.isArray(ph.authorAttributions) ? str(ph.authorAttributions[0]?.displayName) : null;
    return url ? { url, by } : null;
  } catch {
    return null;
  }
}

function toExplorePlace(p: any, nowMs: number): ExplorePlace | null {
  const loc = p?.location;
  const lat = typeof loc?.lat === 'function' ? loc.lat() : loc?.lat;
  const lng = typeof loc?.lng === 'function' ? loc.lng() : loc?.lng;
  if (!p?.id || typeof lat !== 'number' || typeof lng !== 'number') return null;
  const types: string[] = Array.isArray(p.types) ? p.types : [];
  const hours = p.regularOpeningHours;
  const periods: HoursPeriod[] | null = Array.isArray(hours?.periods) ? hours.periods : null;
  const weekday: string[] | null = Array.isArray(hours?.weekdayDescriptions) ? hours.weekdayDescriptions : null;
  const offset = typeof p.utcOffsetMinutes === 'number' ? p.utcOffsetMinutes : null;
  const photo = photoOf(p, 400);
  return {
    id: p.id,
    name: str(p.displayName) ?? '이름 없음',
    lat,
    lng,
    address: str(p.formattedAddress),
    types,
    typeLabel: str(p.primaryTypeDisplayName),
    cat: catOfTypes(p.primaryType ? [p.primaryType, ...types] : types),
    photo: photo?.url ?? null,
    photoBy: photo?.by ?? null,
    rating: typeof p.rating === 'number' ? p.rating : null,
    ratingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    priceLevel: normalizePrice(p.priceLevel),
    openNow: isOpenAt(periods, offset, nowMs),
    todayHours: todayHoursLine(weekday, offset, nowMs),
    weekdayHours: weekday,
    reservable: reservableOf(p),
    meters: null,
  };
}

async function placeClass(): Promise<any> {
  await loadGoogleMapsScript();
  const g = (window as unknown as { google?: any }).google;
  const lib = await g.maps.importLibrary('places');
  return lib.Place;
}

function fromCache(key: string): ExplorePlace[] | null {
  const hit = searchCache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_MS) return null;
  return hit.places;
}

function remember(key: string, raw: any[]): ExplorePlace[] {
  const now = Date.now();
  const places = raw.map((p) => toExplorePlace(p, now)).filter((p): p is ExplorePlace => !!p);
  raw.forEach((p) => { if (p?.id) rawById.set(p.id, p); });
  searchCache.set(key, { at: now, places });
  return places;
}

/** 카테고리 주변 검색 (Nearby Search). 실패하면 예외 — 화면이 "못 불러왔어요"를 띄운다 */
export function searchNearbyCat(key: string, cat: ExploreCat, center: { lat: number; lng: number }, radius: number): Promise<ExplorePlace[]> {
  return searchNearbyTypes(key, catDef(cat).includedTypes, center, radius);
}

async function searchNearbyTypes(key: string, includedTypes: string[], center: { lat: number; lng: number }, radius: number): Promise<ExplorePlace[]> {
  const cached = fromCache(key);
  if (cached) return cached;
  const Place = await placeClass();
  const { places } = await withFieldRetry<{ places: any[] }>(LIST_FIELDS, (fields) =>
    Place.searchNearby({
      fields,
      locationRestriction: { center, radius },
      includedTypes,
      maxResultCount: MAX_RESULTS,
    })
  );
  return remember(key, places ?? []);
}

/** 검색어 검색인데 **반경 밖은 받지 않는다**(locationRestriction 사각형) — 환전소처럼 타입이 없는 것용 */
async function searchTextWithin(key: string, query: string, center: { lat: number; lng: number }, radius: number): Promise<ExplorePlace[]> {
  const cached = fromCache(key);
  if (cached) return cached;
  const Place = await placeClass();
  const { places } = await withFieldRetry<{ places: any[] }>(LIST_FIELDS, (fields) =>
    Place.searchByText({
      textQuery: query,
      fields,
      locationRestriction: boundsAround(center, radius),
      maxResultCount: MAX_RESULTS,
    })
  );
  return remember(key, places ?? []);
}

/**
 * 일정 장소 근처 검색("이 근처 둘러보기"와, 거기서 넘어간 지도 탐색) — 반경 안만, 가까운 순.
 * 지도 탐색의 카테고리 검색과 캐시 키가 겹치지 않게 `near-` 접두어를 붙인다(타입 구성이 다르다).
 */
export async function searchNearbyKind(key: NearbyKey, center: { lat: number; lng: number }, radius: number): Promise<ExplorePlace[]> {
  const def = nearbyDef(key);
  const cacheKey = searchKey(def.query ? 'text' : 'cat', 'near-' + key, center, radius);
  const list = def.query
    ? (await searchTextWithin(cacheKey, def.query, center, radius)).map((p) => ({ ...p, cat: def.cat }))
    : await searchNearbyTypes(cacheKey, def.types ?? [], center, radius);
  return withinRadius(list, center, radius);
}

/** 검색어 검색 (Text Search) — 지금 기준 위치 근처를 우선한다 */
export async function searchText(key: string, query: string, center: { lat: number; lng: number }, radius: number): Promise<ExplorePlace[]> {
  const cached = fromCache(key);
  if (cached) return cached;
  const Place = await placeClass();
  const { places } = await withFieldRetry<{ places: any[] }>(LIST_FIELDS, (fields) =>
    Place.searchByText({
      textQuery: query,
      fields,
      locationBias: { center, radius },
      maxResultCount: MAX_RESULTS,
    })
  );
  return remember(key, places ?? []);
}

/** 상세 — 같은 장소는 이 기기에서 한 번만 받는다 */
export async function fetchDetail(id: string): Promise<ExploreDetail> {
  const hit = detailCache.get(id);
  if (hit) return hit;
  let p = rawById.get(id);
  if (!p) {
    const Place = await placeClass();
    p = new Place({ id });
    rawById.set(id, p);
  }
  await withFieldRetry(DETAIL_FIELDS, (fields) => p.fetchFields({ fields }));
  const photos = (Array.isArray(p.photos) ? p.photos : [])
    .slice(0, 5)
    .map((ph: any) => photoUrl(ph, 900))
    .filter((x: unknown): x is { url: string; by: string | null } => !!x);
  const reviews: ExploreReview[] = (Array.isArray(p.reviews) ? p.reviews : [])
    .map((r: any) => ({
      author: str(r?.authorAttribution?.displayName) ?? 'Google 사용자',
      authorUrl: str(r?.authorAttribution?.uri),
      rating: typeof r?.rating === 'number' ? r.rating : null,
      text: str(r?.text) ?? '',
      when: str(r?.relativePublishTimeDescription),
    }))
    .filter((r: ExploreReview) => r.text);
  const detail: ExploreDetail = {
    phone: str(p.nationalPhoneNumber),
    phoneIntl: str(p.internationalPhoneNumber),
    website: str(p.websiteURI),
    mapsUrl: str(p.googleMapsURI),
    summary: str(p.editorialSummary),
    photos,
    reviews,
    reservable: reservableOf(p),
    weekdayHours: Array.isArray(p.regularOpeningHours?.weekdayDescriptions) ? p.regularOpeningHours.weekdayDescriptions : null,
  };
  detailCache.set(id, detail);
  return detail;
}

export type TravelTimes = { walk: { meters: number; seconds: number } | null; drive: { meters: number; seconds: number } | null };

const travelCache = new Map<string, { at: number; value: TravelTimes }>();
const travelFailedAt = new Map<string, number>();
const TRAVEL_TTL_MS = 30 * 60_000;
const TRAVEL_RETRY_MS = 10 * 60_000;

/**
 * 실제 도보·차량 시간 — 기존 /api/route-matrix(Routes API, 실시간 교통 미반영)를 쓴다. 상세에서 한 번.
 *
 * 호출량 줄이기: ① 출발 좌표를 소수 4자리(약 11m)로 반올림해 보낸다 — GPS 좌표를 그대로 보내면
 * 서버의 전역 캐시(좌표 5자리 키)가 사실상 절대 맞지 않는다. ② 같은 장소·같은 자리는 30분간 기기에서
 * 다시 쓴다. ③ 실패하면 10분간 다시 묻지 않는다. 호출은 도보·차량 2건이다(대중교통은 안 묻는다).
 */
export async function fetchTravelTimes(
  placeId: string,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<TravelTimes> {
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const f = { lat: r4(from.lat), lng: r4(from.lng) };
  const key = placeId + '@' + f.lat + ',' + f.lng;
  const now = Date.now();
  const hit = travelCache.get(key);
  if (hit && now - hit.at < TRAVEL_TTL_MS) return hit.value;
  const failed = travelFailedAt.get(key);
  if (failed != null && now - failed < TRAVEL_RETRY_MS) throw new Error('route-matrix 최근에 실패 — 잠시 뒤 다시');

  try {
    const res = await fetch('/api/route-matrix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs: [{ id: 'explore', from: f, to }], modes: ['WALK', 'DRIVE'] }),
    });
    if (!res.ok) throw new Error('route-matrix ' + res.status);
    const json = await res.json();
    reportRouteError('Explore', json);
    const modes = json?.results?.[0]?.modes ?? {};
    const pick = (m: any) => (m && typeof m.seconds === 'number' && typeof m.meters === 'number' ? { meters: m.meters, seconds: m.seconds } : null);
    const value: TravelTimes = { walk: pick(modes.WALK), drive: pick(modes.DRIVE) };
    if (!value.walk && !value.drive) { travelFailedAt.set(key, now); return value; }
    travelCache.set(key, { at: now, value });
    return value;
  } catch (e) {
    travelFailedAt.set(key, now);
    throw e;
  }
}

/** 저장·일정 추가용 — 기존 `insertGooglePlace`가 받는 모양으로 */
export function toGooglePlaceResult(p: ExplorePlace): {
  place_id: string; name: string; address: string | null; lat: number; lng: number; rating: number | null;
  userRatingCount: number | null; category: string | null; photoUrl: string | null; openingHours: string[] | null;
} {
  const CATEGORY: Record<ExplorePlace['cat'], string> = { food: '음식점', cafe: '카페', sight: '관광명소', stay: '숙소', amenity: '편의점' };
  return {
    place_id: p.id,
    name: p.name,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    rating: p.rating,
    userRatingCount: p.ratingCount,
    category: CATEGORY[p.cat],
    photoUrl: p.photo,
    openingHours: p.weekdayHours,
  };
}
