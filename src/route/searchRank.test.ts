/**
 * 검색 결과 "추천순" 테스트 — 사람이 구글맵 목록을 보고 고를 때의 직관과 맞는지만 본다.
 */

import { describe, it, expect } from 'vitest';
import { recommendScore, rankByRecommendation, type RankInput } from './searchRank';

const item = (id: string, rating: number | null, reviewCount: number | null, distanceKm: number | null = null): RankInput => ({
  id,
  name: id,
  rating,
  reviewCount,
  distanceKm,
});
const order = (list: RankInput[]) => rankByRecommendation(list).map((x) => x.id);

describe('recommendScore', () => {
  it('리뷰가 아주 많으면 실제 평점에 거의 붙는다', () => {
    expect(recommendScore(4.6, 100000)).toBeCloseTo(4.6, 2);
  });

  it('리뷰가 없으면 보통 수준(4.0)으로 본다', () => {
    expect(recommendScore(5, 0)).toBe(4);
    expect(recommendScore(5, null)).toBe(4);
  });

  it('평점이 없으면 맨 아래', () => {
    expect(recommendScore(null, 500)).toBeLessThan(recommendScore(1, 0));
  });
});

describe('rankByRecommendation', () => {
  it('리뷰 3개짜리 5.0점보다 리뷰 3천 개짜리 4.6점이 위', () => {
    expect(order([item('few', 5, 3), item('many', 4.6, 3000)])).toEqual(['many', 'few']);
  });

  it('리뷰 수가 충분하면 평점이 높은 쪽이 위', () => {
    expect(order([item('a', 4.5, 800), item('b', 4.9, 300)])).toEqual(['b', 'a']);
  });

  it('평점 없는 곳은 리뷰가 많아 보여도 맨 아래', () => {
    expect(order([item('none', null, null), item('low', 3.5, 20)])).toEqual(['low', 'none']);
  });

  it('점수가 같으면 가까운 곳이 먼저, 거리를 모르면 뒤로', () => {
    expect(order([item('far', 4.5, 200, 0.9), item('unk', 4.5, 200, null), item('near', 4.5, 200, 0.2)])).toEqual([
      'near',
      'far',
      'unk',
    ]);
  });

  it('입력 배열은 그대로 둔다', () => {
    const input = [item('a', 3, 10), item('b', 5, 1000)];
    rankByRecommendation(input);
    expect(input.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
