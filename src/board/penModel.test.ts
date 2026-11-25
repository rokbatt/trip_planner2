import { describe, expect, it } from 'vitest';
import { PEN_MAX_POINTS, PEN_PALETTE, formatDistance, haversineMeters, isValidPath, memberColors, simplifyPath, straightDistance, type LatLng } from './penModel';

describe('memberColors — 사람마다 고유색', () => {
  it('들어온 순서대로 팔레트에서 하나씩, 겹치지 않는다', () => {
    const c = memberColors([
      { user_id: 'b', joined_at: '2026-11-02' },
      { user_id: 'a', joined_at: '2026-11-01' },
      { user_id: 'c', joined_at: '2026-11-03' },
    ]);
    expect(c.get('a')).toBe(PEN_PALETTE[0]);
    expect(c.get('b')).toBe(PEN_PALETTE[1]);
    expect(c.get('c')).toBe(PEN_PALETTE[2]);
    expect(new Set(c.values()).size).toBe(3);
  });
  it('8명까지는 모두 다른 색', () => {
    const c = memberColors(Array.from({ length: 8 }, (_, i) => ({ user_id: 'u' + i, joined_at: '2026-11-0' + (i + 1) })));
    expect(new Set(c.values()).size).toBe(8);
  });
  it('user_id 없는 줄은 건너뛴다', () => {
    expect(memberColors([{ user_id: null }, { user_id: 'x', joined_at: null }]).size).toBe(1);
  });
});

describe('거리', () => {
  it('하버사인 — 위도 1도는 약 111km', () => {
    expect(haversineMeters([0, 0], [1, 0])).toBeGreaterThan(111_000);
    expect(haversineMeters([0, 0], [1, 0])).toBeLessThan(111_400);
  });
  it('선의 거리는 시작점↔끝점 직선', () => {
    const path: LatLng[] = [[50.08, 14.40], [50.10, 14.45], [50.08, 14.41]];
    expect(straightDistance(path)).toBeCloseTo(haversineMeters(path[0], path[2]), 3);
    expect(straightDistance([[1, 1]])).toBe(0);
  });
  it('표시 형식', () => {
    expect(formatDistance(4)).toBe('10m');
    expect(formatDistance(347)).toBe('350m');
    expect(formatDistance(1234)).toBe('1.2km');
    expect(formatDistance(23_456)).toBe('23km');
    expect(formatDistance(0)).toBe('0m');
  });
});

describe('simplifyPath — 모양을 유지하며 점 줄이기', () => {
  it('일직선 위 점들은 양 끝만 남는다', () => {
    const line: LatLng[] = Array.from({ length: 50 }, (_, i) => [50 + i * 0.001, 14 + i * 0.001]);
    const s = simplifyPath(line, 1e-5);
    expect(s.length).toBe(2);
    expect(s[0]).toEqual([50, 14]);
  });
  it('꺾인 곳은 남는다', () => {
    const v: LatLng[] = [[0, 0], [0.5, 0.5], [1, 1], [0.5, 1.5], [0, 2]];
    const s = simplifyPath(v, 1e-4);
    expect(s).toContainEqual([1, 1]);
  });
  it('아무리 많아도 최대 점 수 이하', () => {
    const zig: LatLng[] = Array.from({ length: 3000 }, (_, i) => [i * 0.0001, (i % 2) * 0.01]);
    expect(simplifyPath(zig, 0).length).toBeLessThanOrEqual(PEN_MAX_POINTS);
  });
  it('같은 점이 이어지면 하나로', () => {
    expect(simplifyPath([[1, 1], [1, 1], [2, 2]], 0)).toEqual([[1, 1], [2, 2]]);
  });
});

describe('isValidPath', () => {
  it('올바른 배열만 통과', () => {
    expect(isValidPath([[1, 2], [3, 4]])).toBe(true);
    expect(isValidPath([[1, 2]])).toBe(false);
    expect(isValidPath([[1, 2], [91, 0]])).toBe(false);
    expect(isValidPath('x')).toBe(false);
    expect(isValidPath([[1, 'a'], [3, 4]])).toBe(false);
  });
});
