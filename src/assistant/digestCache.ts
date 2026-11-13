/**
 * 어시스턴트 문서 요약의 탭 단위 저장 — 새로고침할 때마다 문서마다 서버에 다시 묻지 않게 한다.
 *
 * 요약의 주 저장소는 여전히 서버(`ai_plan_cache`)다(다른 멤버가 만든 결과를 같이 쓰기 위해).
 * 여기는 "이 탭에서 이미 받은 것"만 sessionStorage에 붙들어 둔다 — 탭을 닫으면 사라지고,
 * 로그아웃하면 지운다(요약에 예약번호·편명이 들어 있다). 개인 문서 잠금 상태도 같은 sessionStorage 수명이다.
 * 문서가 수정되면(updated_at 변경) 그 문서만 다시 받는다. 실패는 잠깐만 기억해 새로고침마다 재시도하지 않는다.
 */

export const DIGEST_CACHE_PREFIX = 'mongsil:assistantDigest:';
/** 실패(한도 초과·일시 오류)를 기억하는 시간 — 지나면 다시 시도한다 */
export const DIGEST_FAIL_TTL_MS = 10 * 60 * 1000;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

interface Entry {
  /** 문서의 updated_at — 다르면 문서가 바뀐 것 */
  u: string;
  /** 요약 문장들. 빈 배열 = 읽었지만 쓸 내용 없음. null = 실패 */
  f: string[] | null;
  /** 저장 시각(ms) */
  t: number;
}

export type DigestLookup = { hit: true; facts: string[] | null } | { hit: false };

function readAll(storage: StorageLike, tripId: string): Record<string, Entry> {
  try {
    const raw = storage.getItem(DIGEST_CACHE_PREFIX + tripId);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function lookupDigest(storage: StorageLike, tripId: string, docId: string, updatedAt: string, now: number): DigestLookup {
  const e = readAll(storage, tripId)[docId];
  if (!e || e.u !== updatedAt) return { hit: false };
  if (e.f === null) return now - e.t < DIGEST_FAIL_TTL_MS ? { hit: true, facts: null } : { hit: false };
  return { hit: true, facts: Array.isArray(e.f) ? e.f : [] };
}

export function storeDigest(storage: StorageLike, tripId: string, docId: string, updatedAt: string, facts: string[] | null, now: number): void {
  try {
    const all = readAll(storage, tripId);
    all[docId] = { u: updatedAt, f: facts, t: now };
    storage.setItem(DIGEST_CACHE_PREFIX + tripId, JSON.stringify(all));
  } catch {
    /* 저장소를 못 쓰면(용량·차단) 예전처럼 서버에 다시 묻는다 */
  }
}

/** 개인 문서를 다시 잠글 때 — 그 여행의 요약 저장을 지운다(개인 문서 요약이 탭에 남지 않게) */
export function clearTripDigests(storage: StorageLike, tripId: string): void {
  try {
    storage.removeItem(DIGEST_CACHE_PREFIX + tripId);
  } catch {
    /* 무시 */
  }
}

/** 로그아웃 때 — 모든 여행의 요약 저장을 지운다 */
export function clearDigestCache(storage: StorageLike): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(DIGEST_CACHE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => storage.removeItem(k));
  } catch {
    /* 무시 */
  }
}
