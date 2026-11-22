import { describe, expect, it } from 'vitest';
import { USER_INFO_LABEL, composeFileDocDigest, needsSourceRefresh, userEnteredParts } from './docSource';

const doc = (description: string | null, reference_code: string | null) => ({ description, reference_code });

describe('userEnteredParts', () => {
  it('설명과 예약번호를 모은다', () => {
    expect(userEnteredParts(doc('출발 시간 14:10으로 변경', 'FJAZPV'))).toEqual(['출발 시간 14:10으로 변경', '예약번호 FJAZPV']);
  });
  it('공백뿐이거나 비어 있으면 뺀다', () => {
    expect(userEnteredParts(doc('   ', null))).toEqual([]);
    expect(userEnteredParts(doc(null, '  '))).toEqual([]);
  });
});

describe('composeFileDocDigest', () => {
  it('직접 입력한 정보를 파일 요약 앞에 붙이고 최신이라고 밝힌다', () => {
    const out = composeFileDocDigest(doc('출발 14:10으로 변경', null), ['출발: 10:30', '편명: SK988'])!;
    const lines = out.split('\n');
    expect(lines[0]).toContain(USER_INFO_LABEL);
    expect(lines[0]).toContain('이쪽이 최신');
    expect(lines[0]).toContain('출발 14:10으로 변경');
    expect(lines.slice(1)).toEqual(['출발: 10:30', '편명: SK988']);
  });
  it('직접 입력한 게 없으면 파일 요약만(예전과 같다)', () => {
    expect(composeFileDocDigest(doc(null, null), ['출발: 10:30'])).toBe('출발: 10:30');
  });
  it('파일을 못 읽었어도 직접 입력한 정보는 남긴다', () => {
    expect(composeFileDocDigest(doc('시간 변경됨', null), [])).toContain('시간 변경됨');
  });
  it('둘 다 없으면 null', () => {
    expect(composeFileDocDigest(doc(null, null), [])).toBeNull();
    expect(composeFileDocDigest(doc(null, null), ['  '])).toBeNull();
  });
});

describe('needsSourceRefresh', () => {
  const base = { lastLoadedAt: 1000, maxAgeMs: 60_000 };
  it('고쳤다는 신호가 있으면 방금 불러왔어도 다시', () => {
    expect(needsSourceRefresh({ ...base, stale: true, now: 1001 })).toBe(true);
  });
  it('신호가 없고 최근이면 그대로', () => {
    expect(needsSourceRefresh({ ...base, stale: false, now: 30_000 })).toBe(false);
  });
  it('신호가 없어도 오래됐으면 다시(다른 멤버가 고친 경우)', () => {
    expect(needsSourceRefresh({ ...base, stale: false, now: 61_001 })).toBe(true);
  });
});
