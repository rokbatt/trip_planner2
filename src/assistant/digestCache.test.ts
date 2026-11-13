import { describe, it, expect } from 'vitest';
import { DIGEST_FAIL_TTL_MS, clearDigestCache, clearTripDigests, lookupDigest, storeDigest } from './digestCache';

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

describe('digestCache', () => {
  it('저장한 요약은 같은 문서·같은 수정 시각이면 다시 묻지 않는다', () => {
    const s = memStorage();
    storeDigest(s, 'trip1', 'doc1', '2026-11-01', ['편명 KE651'], 1000);
    expect(lookupDigest(s, 'trip1', 'doc1', '2026-11-01', 999_999_999)).toEqual({ hit: true, facts: ['편명 KE651'] });
  });

  it('문서가 수정되면(updated_at 변경) 다시 받는다', () => {
    const s = memStorage();
    storeDigest(s, 'trip1', 'doc1', '2026-11-01', ['a'], 1000);
    expect(lookupDigest(s, 'trip1', 'doc1', '2026-11-02', 2000)).toEqual({ hit: false });
  });

  it('다른 여행·다른 문서와 섞이지 않는다', () => {
    const s = memStorage();
    storeDigest(s, 'trip1', 'doc1', 'u', ['a'], 1000);
    expect(lookupDigest(s, 'trip2', 'doc1', 'u', 2000)).toEqual({ hit: false });
    expect(lookupDigest(s, 'trip1', 'doc2', 'u', 2000)).toEqual({ hit: false });
  });

  it('읽었지만 내용이 없던 문서(빈 배열)도 다시 묻지 않는다', () => {
    const s = memStorage();
    storeDigest(s, 't', 'd', 'u', [], 1000);
    expect(lookupDigest(s, 't', 'd', 'u', 999_999_999)).toEqual({ hit: true, facts: [] });
  });

  it('실패는 10분만 기억하고, 지나면 다시 시도한다', () => {
    const s = memStorage();
    storeDigest(s, 't', 'd', 'u', null, 1000);
    expect(lookupDigest(s, 't', 'd', 'u', 1000 + DIGEST_FAIL_TTL_MS - 1)).toEqual({ hit: true, facts: null });
    expect(lookupDigest(s, 't', 'd', 'u', 1000 + DIGEST_FAIL_TTL_MS)).toEqual({ hit: false });
  });

  it('깨진 저장값은 없는 것으로 본다', () => {
    const s = memStorage();
    s.setItem('mongsil:assistantDigest:t', '{not json');
    expect(lookupDigest(s, 't', 'd', 'u', 1)).toEqual({ hit: false });
  });

  it('로그아웃 정리는 요약 저장만 지운다', () => {
    const s = memStorage();
    storeDigest(s, 't1', 'd', 'u', ['a'], 1);
    storeDigest(s, 't2', 'd', 'u', ['a'], 1);
    s.setItem('other', 'x');
    clearDigestCache(s);
    expect(lookupDigest(s, 't1', 'd', 'u', 2)).toEqual({ hit: false });
    expect(s.getItem('other')).toBe('x');
  });

  it('다시 잠글 때는 그 여행의 요약만 지운다', () => {
    const s2 = memStorage();
    storeDigest(s2, 't1', 'd', 'u', ['a'], 1);
    storeDigest(s2, 't2', 'd', 'u', ['b'], 1);
    clearTripDigests(s2, 't1');
    expect(lookupDigest(s2, 't1', 'd', 'u', 2)).toEqual({ hit: false });
    expect(lookupDigest(s2, 't2', 'd', 'u', 2)).toEqual({ hit: true, facts: ['b'] });
  });
});
