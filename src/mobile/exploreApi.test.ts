/**
 * Google이 모르는 필드 이름이 섞여도 검색이 통째로 실패하지 않는지(실제로 났던 버그:
 * Maps JS는 `reservable`이 아니라 `isReservable` — 요청 전체가 InvalidValueError로 실패했다).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/googleMaps', () => ({ loadGoogleMapsScript: async () => undefined }));

import { withFieldRetry } from './exploreApi';

const KNOWN = new Set(['id', 'displayName', 'isReservable']);
function fakeRequest(fields: string[]): Promise<string[]> {
  const bad = fields.filter((f) => !KNOWN.has(f));
  if (bad.length) return Promise.reject(new Error('InvalidValueError: in property fields: Unknown fields requested: ' + bad.join(', ')));
  return Promise.resolve(fields);
}

describe('withFieldRetry', () => {
  it('모르는 필드를 빼고 다시 요청한다', async () => {
    expect(await withFieldRetry(['id', 'displayName', 'reservable', 'oops'], fakeRequest)).toEqual(['id', 'displayName']);
  });
  it('필드 문제가 아닌 오류는 그대로 던진다', async () => {
    await expect(withFieldRetry(['id'], () => Promise.reject(new Error('network')))).rejects.toThrow('network');
  });
  it('알려진 필드만 있으면 한 번에 끝난다', async () => {
    const run = vi.fn(fakeRequest);
    await withFieldRetry(['id', 'isReservable'], run);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
