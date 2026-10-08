/**
 * 지도/근처 검색 결과의 "추천순" — 순수 함수(화면·API 의존 없음).
 *
 * 평점만으로 줄 세우면 리뷰 3개짜리 5.0점이 리뷰 3천 개짜리 4.6점보다 위로 올라온다.
 * 그래서 리뷰 수가 적을수록 평점을 "보통 수준(PRIOR_RATING)" 쪽으로 끌어당긴 값(베이지안 평균)으로
 * 비교한다 — 리뷰가 충분히 많으면 실제 평점이 그대로 반영되고, 적으면 그만큼 덜 믿는다.
 * 평점이 아예 없는 곳은 맨 아래로. 점수가 같으면 가까운 곳이 먼저.
 */

/** 리뷰가 없을 때 가정하는 "보통" 평점 */
const PRIOR_RATING = 4.0;
/** 이만큼의 리뷰가 있어야 실제 평점과 가정값을 반반 믿는다 */
const PRIOR_WEIGHT = 50;

export function recommendScore(rating: number | null, reviewCount: number | null): number {
  if (rating == null) return -1;
  const n = Math.max(0, reviewCount ?? 0);
  return (n * rating + PRIOR_WEIGHT * PRIOR_RATING) / (n + PRIOR_WEIGHT);
}

export interface RankInput {
  id: string;
  name: string;
  rating: number | null;
  reviewCount: number | null;
  /** 검색 기준점까지 거리(km). 모르면 null */
  distanceKm: number | null;
}

/** 추천순으로 정렬한 새 배열(입력은 건드리지 않는다) */
export function rankByRecommendation<T extends RankInput>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const s = recommendScore(b.rating, b.reviewCount) - recommendScore(a.rating, a.reviewCount);
    if (Math.abs(s) > 1e-9) return s;
    const da = a.distanceKm ?? Infinity;
    const db = b.distanceKm ?? Infinity;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });
}
