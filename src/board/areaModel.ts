/**
 * IDEAS 지도 영역 검색 — DOM·지도를 모르는 계산(areaModel.test.ts).
 *
 *  · 그린 영역(다각형)을 덮는 원(가운데 + 반경)으로 Google에 묻고, 돌아온 결과 중 **영역 안**만 남긴다.
 *  · 정렬 3가지: 평점 높은 순 / 리뷰 많은 순 / 영역 가운데서 가까운 순.
 *  · 하루 20번(사용자 결정, 무료) — 이 기기·사용자별로 센다.
 */

import { haversineMeters, type LatLng } from './penModel';

export type AreaSort = 'rating' | 'reviews' | 'near';

export const AREA_SORTS: Array<{ key: AreaSort; label: string }> = [
  { key: 'rating', label: '평점순' },
  { key: 'reviews', label: '리뷰 많은순' },
  { key: 'near', label: '가까운순' },
];

export const AREA_DAILY_LIMIT = 20;
export const AREA_MIN_RADIUS = 150;
export const AREA_MAX_RADIUS = 50_000;

/** 점이 다각형 안에 있는가(광선 교차) — 여행지 규모에서는 평면 근사로 충분하다 */
export function pointInPolygon(pt: LatLng, poly: readonly LatLng[]): boolean {
  if (poly.length < 3) return false;
  const [y, x] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** 다각형을 덮는 원 — 테두리 상자의 가운데, 가운데에서 가장 먼 꼭짓점까지가 반경 */
export function coveringCircle(poly: readonly LatLng[]): { center: { lat: number; lng: number }; radius: number } {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [la, ln] of poly) {
    minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la);
    minLng = Math.min(minLng, ln); maxLng = Math.max(maxLng, ln);
  }
  const c: LatLng = [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
  const far = Math.max(0, ...poly.map((p) => haversineMeters(c, p)));
  const radius = Math.min(AREA_MAX_RADIUS, Math.max(AREA_MIN_RADIUS, Math.ceil(far)));
  return { center: { lat: c[0], lng: c[1] }, radius };
}

/** 영역으로 볼 만한가 — 점 3개 이상이고 너무 작지 않음(실수로 꾹 눌렀다 뗀 것 걸러내기) */
export function isUsableArea(poly: readonly LatLng[]): boolean {
  if (poly.length < 3) return false;
  const { radius } = coveringCircle(poly);
  const far = Math.max(...poly.map((p) => haversineMeters(poly[0], p)));
  return far >= 30 && radius > 0;
}

export interface AreaResult {
  id: string;
  lat: number;
  lng: number;
  rating: number | null;
  ratingCount: number | null;
}

/** 영역 안 결과만 남기고 정렬. near는 영역 가운데 기준 */
export function filterAndSort<T extends AreaResult>(results: readonly T[], poly: readonly LatLng[], sort: AreaSort): T[] {
  const center = coveringCircle(poly).center;
  const c: LatLng = [center.lat, center.lng];
  const seen = new Set<string>();
  const inside = results.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return pointInPolygon([r.lat, r.lng], poly);
  });
  const dist = (r: T) => haversineMeters(c, [r.lat, r.lng]);
  return inside.sort((a, b) => {
    if (sort === 'rating') return (b.rating ?? -1) - (a.rating ?? -1) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0);
    if (sort === 'reviews') return (b.ratingCount ?? -1) - (a.ratingCount ?? -1) || (b.rating ?? 0) - (a.rating ?? 0);
    return dist(a) - dist(b);
  });
}

/* ── 하루 횟수 ── */

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const QUOTA_PREFIX = 'mongsil:area-quota:';

function readQuota(kv: KV | null, userId: string, today: string): number {
  try {
    const raw = kv?.getItem(QUOTA_PREFIX + userId);
    if (!raw) return 0;
    const v = JSON.parse(raw);
    return v?.date === today && Number.isFinite(v.n) ? Number(v.n) : 0;
  } catch {
    return 0;
  }
}

/** 오늘 남은 횟수 */
export function remainingToday(kv: KV | null, userId: string, today: string): number {
  return Math.max(0, AREA_DAILY_LIMIT - readQuota(kv, userId, today));
}

/** 한 번 썼다고 적는다 — 남은 횟수를 돌려준다 */
export function useOne(kv: KV | null, userId: string, today: string): number {
  const n = readQuota(kv, userId, today) + 1;
  try {
    kv?.setItem(QUOTA_PREFIX + userId, JSON.stringify({ date: today, n }));
  } catch {
    /* 저장 못 하면 세지 못할 뿐 — 검색은 그대로 */
  }
  return Math.max(0, AREA_DAILY_LIMIT - n);
}
