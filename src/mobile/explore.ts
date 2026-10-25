/**
 * 지도 "주변 탐색" — DB·네트워크 없이 돌려볼 수 있는 규칙만 모았다(테스트: explore.test.ts).
 *
 * 원칙(3-1): Google Places가 실제로 준 값만 보여준다. 이 파일의 함수들은 값을 **해석**만 한다 —
 * 없는 값은 null로 돌려주고, 화면은 null이면 그 줄을 그리지 않는다.
 *   · 거리는 직선거리다. 실제 도보·차량 시간은 상세에서 경로 API로 따로 받는다(이름도 다르게 쓴다).
 *   · 영업 여부는 Google이 준 영업시간(periods)과 그 장소의 UTC 오프셋으로만 계산한다.
 *   · 예약은 Google의 `reservable`(예약을 받는 곳인지)뿐이다 — 예약 가능 시간은 없다.
 */

/** 칩 하나 = 검색 하나. includedTypes는 Places API(New) Table A 타입 */
export type ExploreCat = 'all' | 'food' | 'cafe' | 'sight' | 'stay' | 'amenity';

export interface ExploreCatDef {
  key: ExploreCat;
  label: string;
  includedTypes: string[];
}

export const EXPLORE_CATS: ExploreCatDef[] = [
  { key: 'food', label: '맛집', includedTypes: ['restaurant'] },
  { key: 'cafe', label: '카페', includedTypes: ['cafe', 'coffee_shop'] },
  { key: 'sight', label: '관광지', includedTypes: ['tourist_attraction', 'museum', 'art_gallery', 'park'] },
  { key: 'stay', label: '숙소', includedTypes: ['lodging'] },
  { key: 'amenity', label: '편의시설', includedTypes: ['convenience_store', 'pharmacy', 'supermarket', 'atm'] },
  { key: 'all', label: '전체', includedTypes: ['restaurant', 'cafe', 'tourist_attraction'] },
];

export function catDef(key: ExploreCat): ExploreCatDef {
  return EXPLORE_CATS.find((c) => c.key === key) ?? EXPLORE_CATS[0];
}

/** 장소의 타입 목록 → 마커·칩 색을 정할 표시 카테고리('all'은 없다) */
export function catOfTypes(types: readonly string[]): Exclude<ExploreCat, 'all'> {
  const has = (...t: string[]) => t.some((x) => types.includes(x));
  if (has('cafe', 'coffee_shop', 'bakery', 'tea_house')) return 'cafe';
  if (has('restaurant', 'food', 'meal_takeaway', 'bar')) return 'food';
  if (has('lodging', 'hotel', 'hostel', 'resort_hotel', 'guest_house')) return 'stay';
  if (has('convenience_store', 'pharmacy', 'drugstore', 'supermarket', 'atm', 'grocery_store', 'bank', 'finance')) return 'amenity';
  return 'sight';
}

/* ── 일정 장소 근처 ("이 근처 둘러보기") ── */

/**
 * 일정 장소 상세에서 "그 근처에 카페·환전소가 있나"를 미리 보는 칩. 여행 중에 실제로 찾게 되는
 * 것 위주로 골랐다.
 *
 * 환전소는 Places API(New)에 타입이 없다(Table A에 `atm`·`bank`는 있지만 환전소는 없다) — 그래서
 * 검색어 검색(Text Search)으로 찾고, 반경 밖 결과는 버린다. `cat`은 그때 마커·태그 색을 정할 표시
 * 카테고리다(검색어 결과는 타입이 제각각이라 "관광"으로 잘못 분류되기 쉽다).
 */
export type NearbyKey = 'cafe' | 'exchange' | 'food' | 'convenience' | 'atm' | 'pharmacy';

export interface NearbyDef {
  key: NearbyKey;
  label: string;
  cat: Exclude<ExploreCat, 'all'>;
  /** Nearby Search 타입 — 이게 있으면 타입 검색 */
  types?: string[];
  /** Text Search 검색어 — 타입이 없는 것(환전소) */
  query?: string;
}

export const NEARBY_CATS: NearbyDef[] = [
  { key: 'cafe', label: '카페', cat: 'cafe', types: ['cafe', 'coffee_shop'] },
  { key: 'exchange', label: '환전소', cat: 'amenity', query: 'currency exchange' },
  { key: 'food', label: '맛집', cat: 'food', types: ['restaurant'] },
  { key: 'convenience', label: '편의점', cat: 'amenity', types: ['convenience_store'] },
  { key: 'atm', label: 'ATM', cat: 'amenity', types: ['atm'] },
  { key: 'pharmacy', label: '약국', cat: 'amenity', types: ['pharmacy'] },
];

export const NEARBY_RADII = [500, 1000];

export function nearbyDef(key: NearbyKey): NearbyDef {
  return NEARBY_CATS.find((c) => c.key === key) ?? NEARBY_CATS[0];
}

/**
 * 중심 ± 반경을 덮는 사각형 — Text Search의 `locationRestriction`은 사각형만 받는다.
 * 모서리는 반경보다 멀어서(약 1.41배) 결과를 받은 뒤 `withinRadius`로 한 번 더 거른다.
 */
export function boundsAround(center: { lat: number; lng: number }, radius: number): { north: number; south: number; east: number; west: number } {
  const dLat = radius / 111_320;
  const dLng = radius / (111_320 * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)));
  return { north: center.lat + dLat, south: center.lat - dLat, east: center.lng + dLng, west: center.lng - dLng };
}

/** 반경 안만 남기고 가까운 순으로 — `meters`는 그 중심에서 잰 직선거리 */
export function withinRadius<T extends { lat: number; lng: number }>(list: readonly T[], center: { lat: number; lng: number }, radius: number): Array<T & { meters: number }> {
  return list
    .map((p) => ({ ...p, meters: straightMeters(center, p) }))
    .filter((p) => p.meters <= radius)
    .sort((a, b) => a.meters - b.meters);
}

export const CAT_SHORT: Record<Exclude<ExploreCat, 'all'>, string> = {
  food: '맛집',
  cafe: '카페',
  sight: '관광',
  stay: '숙소',
  amenity: '편의',
};

/* ── 가격대 ── */

export type PriceLevel = 'FREE' | 'INEXPENSIVE' | 'MODERATE' | 'EXPENSIVE' | 'VERY_EXPENSIVE';
const PRICE_ORDER: PriceLevel[] = ['FREE', 'INEXPENSIVE', 'MODERATE', 'EXPENSIVE', 'VERY_EXPENSIVE'];

/** Google의 priceLevel(문자열 또는 0~4 숫자) → 우리 표준. 모르면 null */
export function normalizePrice(v: unknown): PriceLevel | null {
  if (typeof v === 'number' && v >= 0 && v <= 4) return PRICE_ORDER[v];
  if (typeof v !== 'string') return null;
  const s = v.replace(/^PRICE_LEVEL_/, '').toUpperCase();
  return (PRICE_ORDER as string[]).includes(s) ? (s as PriceLevel) : null;
}

/** 화폐 기호는 쓰지 않는다 — Google의 가격대는 상대 등급이지 금액이 아니다 */
export function priceLabel(p: PriceLevel | null): string | null {
  switch (p) {
    case 'FREE': return '무료';
    case 'INEXPENSIVE': return '저렴';
    case 'MODERATE': return '보통';
    case 'EXPENSIVE': return '비쌈';
    case 'VERY_EXPENSIVE': return '매우 비쌈';
    default: return null;
  }
}

/* ── 영업 여부 ── */

export interface HoursPoint { day: number; hour: number; minute: number }
export interface HoursPeriod { open: HoursPoint; close?: HoursPoint | null }

/** 그 장소 현지 기준 "주 안에서 몇 분째인지"(일요일 0시 = 0) */
function weekMinute(p: HoursPoint): number {
  return p.day * 1440 + p.hour * 60 + p.minute;
}

/**
 * 지금 영업 중인가. periods가 없거나 UTC 오프셋을 모르면 **null**(모른다) — 추측하지 않는다.
 * 닫는 시각이 없는 period 하나뿐이면 24시간 영업이다(Google 규칙).
 */
export function isOpenAt(periods: readonly HoursPeriod[] | null | undefined, utcOffsetMinutes: number | null | undefined, nowMs: number): boolean | null {
  if (!periods || !periods.length || typeof utcOffsetMinutes !== 'number') return null;
  if (periods.length === 1 && !periods[0].close && periods[0].open.day === 0 && periods[0].open.hour === 0 && periods[0].open.minute === 0) return true;
  const local = new Date(nowMs + utcOffsetMinutes * 60_000);
  const now = local.getUTCDay() * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes();
  const WEEK = 7 * 1440;
  for (const p of periods) {
    if (!p.close) continue;
    const start = weekMinute(p.open);
    let end = weekMinute(p.close);
    if (end <= start) end += WEEK; // 주를 넘어가는 영업(토 22:00 ~ 일 02:00)
    if ((now >= start && now < end) || (now + WEEK >= start && now + WEEK < end)) return true;
  }
  return false;
}

/**
 * 오늘(그 장소 현지 요일) 영업시간 한 줄 — Google의 weekdayDescriptions는 **월요일부터** 7줄이다.
 * "월요일: 오전 6:00~오후 11:00" → "오전 6:00~오후 11:00"
 */
export function todayHoursLine(weekday: readonly string[] | null | undefined, utcOffsetMinutes: number | null | undefined, nowMs: number): string | null {
  if (!weekday || weekday.length !== 7 || typeof utcOffsetMinutes !== 'number') return null;
  const dow = new Date(nowMs + utcOffsetMinutes * 60_000).getUTCDay(); // 0=일
  const line = weekday[(dow + 6) % 7];
  if (!line) return null;
  const i = line.indexOf(':');
  return (i >= 0 ? line.slice(i + 1) : line).trim() || null;
}

/* ── 거리 ── */

export function straightMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function fmtMeters(m: number): string {
  return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + 'km' : Math.round(m / 10) * 10 + 'm';
}

/** 목록용 — 직선거리라는 걸 이름에 밝힌다(도보 시간처럼 보이게 쓰지 않는다) */
export function straightLabel(m: number): string {
  return '직선 ' + fmtMeters(m);
}

/* ── 필터·정렬 ── */

export interface ExploreFilters {
  /** 검색 반경(m) — 바꾸면 새로 검색해야 한다(나머지는 받은 결과 안에서 거른다) */
  radius: number;
  minRating: number;
  openNow: boolean;
  prices: PriceLevel[];
  reservable: boolean;
}

export const DEFAULT_FILTERS: ExploreFilters = { radius: 1500, minRating: 0, openNow: false, prices: [], reservable: false };
export const RADIUS_OPTIONS = [500, 1000, 1500, 3000, 5000];

export type ExploreSort = 'relevance' | 'distance' | 'rating';

export interface FilterablePlace {
  rating: number | null;
  ratingCount: number | null;
  priceLevel: PriceLevel | null;
  openNow: boolean | null;
  reservable: boolean | null;
  meters: number | null;
}

/**
 * 받은 결과 안에서 거른다. 값을 **모르는** 장소는 그 조건이 걸리면 뺀다 — 영업 여부를 모르는
 * 곳을 "영업 중만" 목록에 남기면 그게 곧 거짓 정보가 된다.
 */
export function applyFilters<T extends FilterablePlace>(list: readonly T[], f: ExploreFilters): T[] {
  return list.filter((p) => {
    if (f.minRating > 0 && !(p.rating != null && p.rating >= f.minRating)) return false;
    if (f.openNow && p.openNow !== true) return false;
    if (f.reservable && p.reservable !== true) return false;
    if (f.prices.length && !(p.priceLevel && f.prices.includes(p.priceLevel))) return false;
    return true;
  });
}

/** relevance = Google이 준 순서 그대로(인기도 기준) */
export function sortPlaces<T extends FilterablePlace>(list: readonly T[], sort: ExploreSort): T[] {
  const out = [...list];
  if (sort === 'distance') out.sort((a, b) => (a.meters ?? Infinity) - (b.meters ?? Infinity));
  else if (sort === 'rating') {
    // 평점이 같으면 리뷰가 많은 쪽 — 리뷰 3개짜리 5.0이 2천 개짜리 4.8을 이기지 않게
    out.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0));
  }
  return out;
}

export function activeFilterCount(f: ExploreFilters): number {
  return (f.radius !== DEFAULT_FILTERS.radius ? 1 : 0) + (f.minRating > 0 ? 1 : 0) + (f.openNow ? 1 : 0) + (f.prices.length ? 1 : 0) + (f.reservable ? 1 : 0);
}

/* ── 검색 캐시 키 ── */

/**
 * 같은 조건의 검색을 다시 하지 않으려고 쓰는 키. 중심 좌표를 약 110m 격자로 반올림해서
 * 손가락이 조금 움직인 정도로는 같은 검색으로 본다.
 */
export function searchKey(kind: 'cat' | 'text', value: string, center: { lat: number; lng: number }, radius: number): string {
  return kind + ':' + value.trim().toLowerCase() + '@' + center.lat.toFixed(3) + ',' + center.lng.toFixed(3) + '/' + radius;
}

/** 검색한 자리에서 이만큼(반경의 35%, 최소 300m) 벗어나면 "이 지역에서 다시 검색"을 띄운다 */
export function movedFar(from: { lat: number; lng: number }, to: { lat: number; lng: number }, radius: number): boolean {
  return straightMeters(from, to) > Math.max(300, radius * 0.35);
}
