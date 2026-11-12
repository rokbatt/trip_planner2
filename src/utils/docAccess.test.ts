import { describe, it, expect } from 'vitest';
import { bearerToken, canReadDocument, isUuid } from '../../api/ai';

/**
 * 문서 AI(doc-digest)가 문서를 읽어도 되는지 판단하는 규칙.
 * 서버는 서비스 키로 비공개 보관함을 열기 때문에, 이 규칙이 느슨해지면 남의 여권·항공권을 읽게 된다.
 */

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('canReadDocument', () => {
  it('멤버가 아니면 공용 문서도 못 읽는다', () => {
    expect(canReadDocument({ userId: ME, isMember: false, visibility: 'SHARED', ownerUserId: null })).toBe(false);
  });
  it('멤버면 공용 문서를 읽는다', () => {
    expect(canReadDocument({ userId: ME, isMember: true, visibility: 'SHARED', ownerUserId: null })).toBe(true);
  });
  it('개인 문서는 주인만 읽는다', () => {
    expect(canReadDocument({ userId: ME, isMember: true, visibility: 'PERSONAL', ownerUserId: ME })).toBe(true);
    expect(canReadDocument({ userId: ME, isMember: true, visibility: 'PERSONAL', ownerUserId: OTHER })).toBe(false);
  });
  it('주인이 계정과 연결되지 않은 옛 개인 문서는 읽지 않는다', () => {
    expect(canReadDocument({ userId: ME, isMember: true, visibility: 'PERSONAL', ownerUserId: null })).toBe(false);
  });
  it('모르는 공개 범위는 거절한다', () => {
    expect(canReadDocument({ userId: ME, isMember: true, visibility: 'PUBLIC', ownerUserId: null })).toBe(false);
  });
});

describe('bearerToken', () => {
  it('Bearer 토큰만 꺼낸다', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken(['Bearer x'])).toBe('x');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

describe('isUuid', () => {
  it('UUID 형식만 통과', () => {
    expect(isUuid(ME)).toBe(true);
    expect(isUuid('../x')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
