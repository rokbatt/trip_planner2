/**
 * 순서 바꾸기 계산 — 손가락 위치 → 놓을 자리, 그리고 배열 이동.
 */

import { describe, it, expect } from 'vitest';
import { dropIndex, moveItem } from './reorder';

describe('dropIndex', () => {
  // 끌고 있는 카드를 뺀 나머지 3장의 세로 중심
  const centers = [100, 200, 300];
  it('맨 위로 끌면 0', () => expect(dropIndex(centers, 40)).toBe(0));
  it('두 카드 사이면 그 사이', () => {
    expect(dropIndex(centers, 150)).toBe(1);
    expect(dropIndex(centers, 250)).toBe(2);
  });
  it('맨 아래로 끌면 끝', () => expect(dropIndex(centers, 900)).toBe(3));
  it('카드가 없으면 0', () => expect(dropIndex([], 50)).toBe(0));
});

describe('moveItem', () => {
  const a = ['A', 'B', 'C', 'D'];
  it('앞으로', () => expect(moveItem(a, 3, 1)).toEqual(['A', 'D', 'B', 'C']));
  it('뒤로', () => expect(moveItem(a, 0, 2)).toEqual(['B', 'C', 'A', 'D']));
  it('맨 끝으로', () => expect(moveItem(a, 0, 3)).toEqual(['B', 'C', 'D', 'A']));
  it('범위를 벗어나면 그대로 복사본', () => {
    const r = moveItem(a, 9, 0);
    expect(r).toEqual(a);
    expect(r).not.toBe(a);
  });
  it('원본을 바꾸지 않는다', () => {
    moveItem(a, 0, 3);
    expect(a).toEqual(['A', 'B', 'C', 'D']);
  });
});
