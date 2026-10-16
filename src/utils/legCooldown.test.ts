import { describe, it, expect, beforeEach } from 'vitest';
import { isLegCoolingDown, markLegsFailed, clearLegFailures, LEG_RETRY_COOLDOWN_MS } from './legCooldown';

beforeEach(() => clearLegFailures());

describe('legCooldown', () => {
  it('실패한 구간은 쿨다운 동안 다시 묻지 않는다', () => {
    markLegsFailed(['a>b'], 1000);
    expect(isLegCoolingDown('a>b', 1000 + 60_000)).toBe(true);
    expect(isLegCoolingDown('x>y', 1000)).toBe(false);
  });
  it('쿨다운이 지나면 다시 물을 수 있다', () => {
    markLegsFailed(['a>b'], 0);
    expect(isLegCoolingDown('a>b', LEG_RETRY_COOLDOWN_MS + 1)).toBe(false);
  });
  it('직접 다시 불러오기는 기억을 지운다', () => {
    markLegsFailed(['a>b', 'c>d'], 0);
    clearLegFailures(['a>b']);
    expect(isLegCoolingDown('a>b', 1)).toBe(false);
    expect(isLegCoolingDown('c>d', 1)).toBe(true);
  });
});
