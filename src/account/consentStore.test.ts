/**
 * 가입 동의 기록 테스트.
 *
 * 법적 증빙과 "막지 말아야 할 때 막지 않기"가 걸린 곳이라 두 가지를 본다.
 *  1) 버전이 하나라도 다르면 다시 동의받는다 (약관을 바꿨는데 옛 동의로 통과되면 안 된다)
 *  2) 저장소·서버가 이상해도 예외를 던지지 않는다 (동의 창 때문에 앱이 멈추면 안 된다)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// supabase 클라이언트는 이 테스트에서 네트워크를 쓰지 않는다 — 서버 호출 경로만 가짜로 대체
const upsert = vi.fn();
const limit = vi.fn();
vi.mock('../supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit }) }) }) }),
      upsert,
    }),
  },
}));

import { TERMS_VERSION, PRIVACY_VERSION, CONSENT_ITEMS } from '../legal/versions';
import {
  allRequiredChecked,
  canClaimLocalConsent,
  fetchServerConsent,
  isCurrentConsent,
  newConsentRecord,
  readLocalConsent,
  saveServerConsent,
  writeLocalConsent,
} from './consentStore';

/** 메모리 localStorage — node 환경엔 없어서 만든다 */
function fakeStorage(opts: { throwOnAccess?: boolean } = {}) {
  const map = new Map<string, string>();
  const guard = () => { if (opts.throwOnAccess) throw new Error('SecurityError: storage blocked'); };
  return {
    getItem: (k: string) => { guard(); return map.get(k) ?? null; },
    setItem: (k: string, v: string) => { guard(); map.set(k, v); },
    removeItem: (k: string) => { guard(); map.delete(k); },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
  vi.stubGlobal('navigator', { userAgent: 'vitest' });
  upsert.mockReset();
  limit.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('isCurrentConsent', () => {
  it('지금 버전과 같으면 유효하다', () => {
    expect(isCurrentConsent({ terms: TERMS_VERSION, privacy: PRIVACY_VERSION })).toBe(true);
  });

  it('약관 또는 방침 버전이 하나라도 다르면 다시 동의받는다', () => {
    expect(isCurrentConsent({ terms: 'old', privacy: PRIVACY_VERSION })).toBe(false);
    expect(isCurrentConsent({ terms: TERMS_VERSION, privacy: 'old' })).toBe(false);
  });

  it('기록이 없거나 엉뚱한 값이면 동의하지 않은 것이다', () => {
    expect(isCurrentConsent(null)).toBe(false);
    expect(isCurrentConsent(undefined)).toBe(false);
    expect(isCurrentConsent({})).toBe(false);
    expect(isCurrentConsent({ terms: 1, privacy: 2 })).toBe(false);
  });
});

describe('canClaimLocalConsent — 동의는 계정 단위다', () => {
  const rec = (userId?: string) => ({ ...newConsentRecord(), ...(userId ? { userId } : {}) });

  it('로그인 전에 받은(아직 주인 없는) 기록은 지금 로그인한 사람 것으로 확정할 수 있다', () => {
    expect(canClaimLocalConsent(rec(), 'A')).toBe(true);
  });

  it('이미 그 사람 것으로 확정된 기록은 계속 인정한다', () => {
    expect(canClaimLocalConsent(rec('A'), 'A')).toBe(true);
  });

  it('공용 기기: A 것으로 확정된 기록을 B 가 가져다 쓰지 못한다 — B 는 직접 동의해야 한다', () => {
    expect(canClaimLocalConsent(rec('A'), 'B')).toBe(false);
  });

  it('기록이 없거나 옛 버전이면 인정하지 않는다', () => {
    expect(canClaimLocalConsent(null, 'A')).toBe(false);
    expect(canClaimLocalConsent({ ...rec(), terms: 'old' }, 'A')).toBe(false);
  });

  it('userId 가 문자열이 아닌 깨진 기록은 읽을 때 걸러진다', () => {
    localStorage.setItem('mongsil:consent', JSON.stringify({ ...newConsentRecord(), userId: 42 }));
    expect(readLocalConsent()).toBeNull();
  });
});

describe('allRequiredChecked', () => {
  const keys = ['age', 'terms', 'privacy'];

  it('필수가 전부 체크돼야 true', () => {
    expect(allRequiredChecked({ age: true, terms: true, privacy: true }, keys)).toBe(true);
  });

  it('하나라도 빠지면 false — 체크하지 않은 것과 아직 모르는 것 모두', () => {
    expect(allRequiredChecked({ age: true, terms: true, privacy: false }, keys)).toBe(false);
    expect(allRequiredChecked({ age: true, terms: true }, keys)).toBe(false);
    expect(allRequiredChecked({}, keys)).toBe(false);
  });

  it('동의 항목 정의가 약관의 필수 3개와 어긋나지 않는다', () => {
    // 만 14세 미만 가입 불가(약관 4조)·약관·개인정보 — 이 셋 중 하나가 빠지면 동의가 성립하지 않는다
    expect(CONSENT_ITEMS.map((i) => i.key)).toEqual(['age', 'terms', 'privacy']);
    expect(CONSENT_ITEMS.every((i) => i.required)).toBe(true);
  });
});

describe('이 기기의 기록', () => {
  it('쓴 것을 그대로 읽는다', () => {
    const rec = newConsentRecord(new Date('2026-11-06T09:00:00Z'));
    writeLocalConsent(rec);
    expect(readLocalConsent()).toEqual(rec);
    expect(rec.agreedAt).toBe('2026-11-06T09:00:00.000Z');
  });

  it('기록이 없으면 null', () => {
    expect(readLocalConsent()).toBeNull();
  });

  it('깨진 JSON이나 모양이 다른 값은 기록 없음으로 취급한다', () => {
    localStorage.setItem('mongsil:consent', '{깨진');
    expect(readLocalConsent()).toBeNull();
    localStorage.setItem('mongsil:consent', JSON.stringify({ terms: 1 }));
    expect(readLocalConsent()).toBeNull();
  });

  it('저장소가 막힌 환경(사파리 비공개 모드 등)에서도 예외를 던지지 않는다', () => {
    vi.stubGlobal('localStorage', fakeStorage({ throwOnAccess: true }));
    expect(() => writeLocalConsent(newConsentRecord())).not.toThrow();
    expect(readLocalConsent()).toBeNull();
  });
});

describe('서버 기록 조회 — 막는 건 서버가 "없다"고 분명히 답했을 때뿐', () => {
  it('기록이 있으면 recorded 와 실제 동의 시각을 돌려준다', async () => {
    limit.mockResolvedValue({ data: [{ agreed_at: '2026-10-01T00:00:00Z' }], error: null });
    expect(await fetchServerConsent('u1')).toEqual({ state: 'recorded', agreedAt: '2026-10-01T00:00:00Z' });
  });

  it('조회는 됐는데 행이 없으면 missing — 이때만 동의 창을 띄운다', async () => {
    limit.mockResolvedValue({ data: [], error: null });
    expect(await fetchServerConsent('u1')).toEqual({ state: 'missing' });
  });

  it('테이블이 없거나 네트워크가 실패하면 unavailable — 사용자를 막지 않는다', async () => {
    limit.mockResolvedValue({ data: null, error: { code: 'PGRST205', message: 'schema cache' } });
    expect((await fetchServerConsent('u1')).state).toBe('unavailable');
    limit.mockRejectedValue(new Error('Failed to fetch'));
    expect((await fetchServerConsent('u1')).state).toBe('unavailable');
  });
});

describe('서버 기록 저장', () => {
  it('같은 버전에 두 번 동의해도 기록이 늘지 않게 중복 무시로 보낸다', async () => {
    upsert.mockResolvedValue({ error: null });
    const rec = newConsentRecord();
    expect(await saveServerConsent('u1', rec)).toBe('saved');
    const [row, opts] = upsert.mock.calls[0];
    expect(row).toMatchObject({ user_id: 'u1', terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION });
    expect(opts).toEqual({ onConflict: 'user_id,terms_version,privacy_version', ignoreDuplicates: true });
  });

  it('실패해도 예외 없이 unavailable — 로그인 흐름을 멈추지 않는다', async () => {
    upsert.mockResolvedValue({ error: { code: '42P01', message: 'relation "user_consents" does not exist' } });
    expect(await saveServerConsent('u1', newConsentRecord())).toBe('unavailable');
    upsert.mockRejectedValue(new Error('offline'));
    expect(await saveServerConsent('u1', newConsentRecord())).toBe('unavailable');
  });
});
