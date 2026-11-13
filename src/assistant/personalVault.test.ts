import { describe, it, expect } from 'vitest';
import { personalNotice, planPersonalVault } from './personalVault';

const ME = 'user-me';
const OTHER = 'user-other';
const mine = { id: 'v-mine', user_id: ME };
const legacy = { id: 'v-old', user_id: null };
const theirs = { id: 'v-their', user_id: OTHER };

describe('planPersonalVault', () => {
  it('PIN을 풀었고 내 계정에 연결된 보관함이면 ready', () => {
    expect(planPersonalVault({ unlockedId: 'v-mine', vaults: [mine, theirs], myUserId: ME })).toEqual({ state: 'ready', vaultId: 'v-mine' });
  });
  it('PIN을 풀었지만 계정 연결이 비어 있으면 unlinked', () => {
    expect(planPersonalVault({ unlockedId: 'v-old', vaults: [legacy], myUserId: ME })).toEqual({ state: 'unlinked', vaultId: 'v-old' });
  });
  it('PIN을 풀었지만 다른 계정 보관함이면 foreign', () => {
    expect(planPersonalVault({ unlockedId: 'v-their', vaults: [theirs], myUserId: ME })).toEqual({ state: 'foreign', vaultId: 'v-their' });
  });
  it('내 보관함이 있는데 안 풀었으면 locked', () => {
    expect(planPersonalVault({ unlockedId: null, vaults: [mine, theirs], myUserId: ME })).toEqual({ state: 'locked', vaultId: null });
  });
  it('남의 보관함만 있으면 안내하지 않는다(none)', () => {
    expect(planPersonalVault({ unlockedId: null, vaults: [theirs, legacy], myUserId: ME }).state).toBe('none');
    expect(planPersonalVault({ unlockedId: null, vaults: [], myUserId: ME }).state).toBe('none');
  });
  it('저장된 해제 기록이 가리키는 보관함이 없으면 잠긴 것으로 본다', () => {
    expect(planPersonalVault({ unlockedId: 'gone', vaults: [mine], myUserId: ME }).state).toBe('locked');
    expect(planPersonalVault({ unlockedId: 'gone', vaults: [theirs], myUserId: ME }).state).toBe('none');
  });
  it('로그인 정보를 모르면 ready가 되지 않는다', () => {
    expect(planPersonalVault({ unlockedId: 'v-mine', vaults: [mine], myUserId: null }).state).toBe('foreign');
  });
});

describe('personalNotice', () => {
  it('잠겨 있으면 PIN 안내', () => {
    expect(personalNotice('locked', 0)).toContain('PIN');
  });
  it('연결 안 된 보관함은 건너뛴 파일 수와 이유를 말한다', () => {
    expect(personalNotice('unlinked', 3)).toContain('3개');
    expect(personalNotice('unlinked', 3)).toContain('연결되지 않은');
    expect(personalNotice('foreign', 2)).toContain('다른 계정');
  });
  it('건너뛴 파일이 없거나 정상이면 안내 없음', () => {
    expect(personalNotice('unlinked', 0)).toBeNull();
    expect(personalNotice('foreign', 0)).toBeNull();
    expect(personalNotice('ready', 0)).toBeNull();
    expect(personalNotice('none', 0)).toBeNull();
  });
});
