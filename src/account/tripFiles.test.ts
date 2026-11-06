/**
 * 문서 파일 삭제 헬퍼 테스트.
 *
 * 여권 사본이 주인 없이 저장소에 남는 게 이 기능이 막으려는 최악의 결과라서, 목록을 끝까지
 * 읽는지(페이징·하위 폴더)와 실패를 조용히 삼키지 않는지를 본다.
 */

import { describe, expect, it } from 'vitest';
import { chunk, listAllFiles, removeFiles, removeTripFiles, type StorageBucketLike } from './tripFiles';

type Node = { name: string; id: string | null };

/** 폴더 트리를 가진 가짜 버킷. list는 실제처럼 offset/limit 페이징을 한다. */
function fakeBucket(tree: Record<string, Node[]>, opts: { failList?: string; failRemove?: boolean } = {}) {
  const removed: string[][] = [];
  const bucket: StorageBucketLike = {
    async list(path, { limit, offset }) {
      if (opts.failList === path) return { data: null, error: { message: 'boom' } };
      return { data: (tree[path] ?? []).slice(offset, offset + limit), error: null };
    },
    async remove(paths) {
      if (opts.failRemove) return { error: { message: 'denied' } };
      removed.push(paths);
      return { error: null };
    },
  };
  return { bucket, removed };
}

const file = (name: string): Node => ({ name, id: 'f-' + name });
const folder = (name: string): Node => ({ name, id: null });

describe('chunk', () => {
  it('크기대로 나눈다', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe('listAllFiles', () => {
  it('shared·personal 하위 폴더까지 따라 들어가 파일 경로를 모은다', async () => {
    const { bucket } = fakeBucket({
      t1: [folder('shared'), folder('personal')],
      't1/shared': [file('a.pdf'), file('b.jpg')],
      't1/personal': [file('p.jpg')],
    });
    const { paths, failed } = await listAllFiles(bucket, 't1');
    expect(paths.sort()).toEqual(['t1/personal/p.jpg', 't1/shared/a.pdf', 't1/shared/b.jpg']);
    expect(failed).toBe(false);
  });

  it('한 폴더에 100개를 넘어도 끝까지 읽는다 (페이징)', async () => {
    const many = Array.from({ length: 250 }, (_, i) => file(`f${i}.jpg`));
    const { bucket } = fakeBucket({ t1: [folder('shared')], 't1/shared': many });
    const { paths } = await listAllFiles(bucket, 't1');
    expect(paths).toHaveLength(250);
  });

  it('딱 100개일 때도 무한 반복하지 않는다', async () => {
    const exact = Array.from({ length: 100 }, (_, i) => file(`f${i}`));
    const { bucket } = fakeBucket({ t1: exact });
    expect((await listAllFiles(bucket, 't1')).paths).toHaveLength(100);
  });

  it('목록을 못 읽은 폴더가 있으면 failed 로 알리되 읽은 만큼은 돌려준다', async () => {
    const { bucket } = fakeBucket(
      { t1: [folder('shared'), folder('personal')], 't1/personal': [file('p.jpg')] },
      { failList: 't1/shared' }
    );
    const r = await listAllFiles(bucket, 't1');
    expect(r.failed).toBe(true);
    expect(r.paths).toEqual(['t1/personal/p.jpg']);
  });
});

describe('removeFiles / removeTripFiles', () => {
  it('100개씩 끊어서 지운다', async () => {
    const { bucket, removed } = fakeBucket({});
    const paths = Array.from({ length: 230 }, (_, i) => `t1/shared/${i}`);
    const r = await removeFiles(paths, bucket);
    expect(removed.map((c) => c.length)).toEqual([100, 100, 30]);
    expect(r).toEqual({ removed: 230, failed: false });
  });

  it('삭제가 거부되면 failed — 조용히 성공한 척하지 않는다', async () => {
    const { bucket } = fakeBucket({}, { failRemove: true });
    const r = await removeFiles(['t1/shared/a'], bucket);
    expect(r).toEqual({ removed: 0, failed: true });
  });

  it('여행 폴더 전체를 지운다', async () => {
    const { bucket, removed } = fakeBucket({
      t1: [folder('shared'), folder('personal')],
      't1/shared': [file('a.pdf')],
      't1/personal': [file('p.jpg')],
    });
    const r = await removeTripFiles('t1', bucket);
    expect(removed.flat().sort()).toEqual(['t1/personal/p.jpg', 't1/shared/a.pdf']);
    expect(r.failed).toBe(false);
  });

  it('파일이 하나도 없는 여행도 정상이다', async () => {
    const { bucket, removed } = fakeBucket({ t1: [] });
    expect(await removeTripFiles('t1', bucket)).toEqual({ removed: 0, failed: false });
    expect(removed).toEqual([]);
  });

  it('저장소가 예외를 던져도 호출부(여행 삭제)를 멈추지 않는다', async () => {
    const bucket: StorageBucketLike = {
      list: async () => { throw new Error('network down'); },
      remove: async () => ({ error: null }),
    };
    expect(await removeTripFiles('t1', bucket)).toEqual({ removed: 0, failed: true });
  });
});
