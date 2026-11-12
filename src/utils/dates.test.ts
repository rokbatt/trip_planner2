/**
 * 날짜 읽기 테스트 — 기기 시간대가 어디든 'YYYY-MM-DD'가 그 날짜로 보여야 한다.
 *
 * 예전에는 `new Date('2026-10-26')`(UTC 자정)을 로컬 getDate()로 읽어서, 하와이(UTC-10) 기기에서
 * 10.26이 10.25로 보였다. 시간대를 바꿔 가며 같은 입력이 같은 날짜로 나오는지 본다.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { daysBetweenISO, parseISODate, toISODate, todayLocalISO } from './dates';

declare const process: { env: Record<string, string | undefined> };

const ZONES = ['Asia/Seoul', 'Pacific/Honolulu', 'America/Los_Angeles', 'America/New_York', 'Europe/Paris', 'Pacific/Pago_Pago', 'Pacific/Kiritimati', 'UTC'];
const originalTZ = process.env.TZ;

afterEach(() => {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});

function inZone<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz;
  return fn();
}

describe('parseISODate', () => {
  it('어느 시간대에서도 그 날짜의 월·일로 읽힌다', () => {
    for (const tz of ZONES) {
      const got = inZone(tz, () => {
        const d = parseISODate('2026-10-26');
        return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
      });
      expect(got, tz).toEqual([2026, 10, 26]);
    }
  });

  it('이게 고친 버그: 옛 방식(new Date(문자열))은 UTC보다 이른 시간대에서 하루 앞으로 보인다', () => {
    const old = inZone('Pacific/Honolulu', () => new Date('2026-10-26').getDate());
    expect(old).toBe(25); // 하와이에서 10.26이 10.25로 — 증명용
    const fixed = inZone('Pacific/Honolulu', () => parseISODate('2026-10-26').getDate());
    expect(fixed).toBe(26);
  });

  it('요일도 그 날짜의 요일이다', () => {
    // 2026-10-27은 화요일
    for (const tz of ZONES) expect(inZone(tz, () => parseISODate('2026-10-27').getDay()), tz).toBe(2);
  });

  it('날짜 더하기도 월말·월초를 정확히 넘는다', () => {
    for (const tz of ZONES) {
      const next = inZone(tz, () => {
        const d = parseISODate('2026-10-31');
        d.setDate(d.getDate() + 1);
        return toISODate(d);
      });
      expect(next, tz).toBe('2026-11-01');
    }
  });

  it('타임스탬프(시각이 있는 문자열)는 기존 Date 해석 그대로', () => {
    const ts = '2026-10-26T15:00:00Z';
    expect(parseISODate(ts).getTime()).toBe(new Date(ts).getTime());
  });
});

describe('toISODate · todayLocalISO', () => {
  it('toISOString(UTC)이 아니라 로컬 날짜로 만든다', () => {
    // 하와이 2026-10-26 23:00 = UTC로는 10-27 09:00
    const s = inZone('Pacific/Honolulu', () => toISODate(new Date(2026, 9, 26, 23, 0)));
    expect(s).toBe('2026-10-26');
  });

  it('오늘 날짜는 기기 로컬 기준', () => {
    expect(inZone('Pacific/Kiritimati', () => todayLocalISO(new Date(2026, 9, 26, 1, 0)))).toBe('2026-10-26');
  });
});

describe('daysBetweenISO', () => {
  it('달력 기준 일수 — 서머타임이 끼어도 어긋나지 않는다', () => {
    // 2026-03-29는 유럽 서머타임 시작일
    expect(daysBetweenISO('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetweenISO('2026-10-26', '2026-10-30')).toBe(4);
    expect(daysBetweenISO('2026-10-30', '2026-10-26')).toBe(-4);
  });
});
