/**
 * 영업시간 파서 테스트.
 *
 * 이 모듈의 출력은 사용자에게 **"가도 소용없다"**고 말하는 근거다. 틀린 경고는 멀쩡한 일정을
 * 지우게 만들기 때문에, 여기서 검증하는 건 "얼마나 많이 읽어내는가"가 아니라
 * **확신 없을 때 확실히 입을 다무는가**다(원칙 3-1).
 *
 * 입력은 Google Places의 `weekdayDescriptions`에서 요일 접두어를 뗀 실제 형식이다
 * (`language=ko`로 받으므로 한국어가 기본, 영문이 섞여 오는 경우도 있다).
 */

import { describe, it, expect } from 'vitest';
import { parseClock, parseHoursRanges, isWithinRanges, warningFor } from './openingHours';

describe('parseClock', () => {
  it('한국어는 오전/오후가 시각 앞에 붙는다', () => {
    expect(parseClock('오전 9:00')).toBe(9 * 60);
    expect(parseClock('오후 6:30')).toBe(18 * 60 + 30);
  });

  // 실제로 났던 버그: 영어는 AM/PM이 뒤에 붙는데 앞만 보고 있어서 "6:00 PM"을 6시로 읽었다
  it('영어는 AM/PM이 시각 뒤에 붙는다', () => {
    expect(parseClock('6:00 PM')).toBe(18 * 60);
    expect(parseClock('9:00 AM')).toBe(9 * 60);
  });

  it('12시 경계 — 오전 12시는 자정, 오후 12시는 정오', () => {
    expect(parseClock('오전 12:00')).toBe(0);
    expect(parseClock('오후 12:00')).toBe(12 * 60);
  });

  it('24시간 표기와 "9시" 형식도 읽는다', () => {
    expect(parseClock('09:00')).toBe(9 * 60);
    expect(parseClock('18:45')).toBe(18 * 60 + 45);
    expect(parseClock('9시')).toBe(9 * 60);
  });

  it('시각이 아니면 null', () => {
    expect(parseClock('영업시간 문의')).toBeNull();
    expect(parseClock('')).toBeNull();
  });
});

describe('parseHoursRanges', () => {
  it('기본 영업시간', () => {
    expect(parseHoursRanges('오전 9:00 ~ 오후 6:00')).toEqual([{ open: 540, close: 1080 }]);
    expect(parseHoursRanges('09:00~18:00')).toEqual([{ open: 540, close: 1080 }]);
    expect(parseHoursRanges('오전 9:00 - 오후 6:00')).toEqual([{ open: 540, close: 1080 }]);
    expect(parseHoursRanges('9:00 AM – 6:00 PM')).toEqual([{ open: 540, close: 1080 }]);
  });

  it('휴무는 빈 배열 — "못 읽음"(null)과 구분된다', () => {
    expect(parseHoursRanges('휴무일')).toEqual([]);
    expect(parseHoursRanges('휴업')).toEqual([]);
    expect(parseHoursRanges('Closed')).toEqual([]);
  });

  it('24시간 영업은 하루 전체 한 구간', () => {
    expect(parseHoursRanges('24시간 영업')).toEqual([{ open: 0, close: 1440 }]);
  });

  it('브레이크 타임은 구간 두 개', () => {
    expect(parseHoursRanges('오전 11:00 ~ 오후 2:00, 오후 5:00 ~ 오후 9:00')).toEqual([
      { open: 660, close: 840 },
      { open: 1020, close: 1260 },
    ]);
  });

  it('자정을 넘기면 close < open', () => {
    expect(parseHoursRanges('오후 6:00 ~ 오전 2:00')).toEqual([{ open: 1080, close: 120 }]);
  });

  it('자정 마감(오전 12:00)은 1440으로 — 자정 넘김과 섞이면 안 된다', () => {
    expect(parseHoursRanges('오전 10:00 ~ 오전 12:00')).toEqual([{ open: 600, close: 1440 }]);
  });

  // 핵심: 확신 없으면 읽지 않는다. 억지로 읽어내면 틀린 경고가 나간다.
  it('못 읽는 줄은 null', () => {
    expect(parseHoursRanges('영업시간 문의')).toBeNull();
    expect(parseHoursRanges('')).toBeNull();
    expect(parseHoursRanges(null)).toBeNull();
  });
});

describe('isWithinRanges', () => {
  const day = [{ open: 540, close: 1080 }]; // 09:00–18:00

  it('개점 시각은 포함, 마감 시각은 제외', () => {
    expect(isWithinRanges(day, 540)).toBe(true);
    expect(isWithinRanges(day, 1080)).toBe(false);
  });

  it('자정 넘김 구간', () => {
    const night = [{ open: 1080, close: 120 }]; // 18:00–02:00
    expect(isWithinRanges(night, 23 * 60)).toBe(true);
    expect(isWithinRanges(night, 60)).toBe(true);
    expect(isWithinRanges(night, 15 * 60)).toBe(false);
  });

  it('1440을 넘는 값도 하루 안으로 접는다 (스케줄이 자정을 넘길 수 있다)', () => {
    const night = [{ open: 1080, close: 120 }];
    expect(isWithinRanges(night, 25 * 60)).toBe(true); // 다음날 01:00
  });
});

describe('warningFor', () => {
  const H = '오전 9:00 ~ 오후 6:00'; // 09:00–18:00

  it('영업시간 안이면 경고 없음', () => {
    expect(warningFor(H, 10 * 60, 11 * 60)).toBeNull();
    expect(warningFor(H, 9 * 60)).toBeNull(); // 개점 정각
  });

  it('닫은 뒤 도착', () => {
    expect(warningFor(H, 19 * 60 + 40)).toEqual({ kind: 'after-close', at: 1080 });
    expect(warningFor(H, 18 * 60)).toEqual({ kind: 'after-close', at: 1080 }); // 마감 정각
  });

  it('열기 전 도착', () => {
    expect(warningFor(H, 7 * 60)).toEqual({ kind: 'before-open', at: 540 });
  });

  it('들어가긴 하는데 머무는 중에 닫음', () => {
    expect(warningFor(H, 17 * 60 + 30, 19 * 60)).toEqual({ kind: 'closes-during', at: 1080 });
  });

  it('휴무일', () => {
    expect(warningFor('휴무일', 14 * 60)).toEqual({ kind: 'closed-day' });
  });

  it('24시간 영업은 언제 가도 경고 없음', () => {
    expect(warningFor('24시간 영업', 3 * 60, 5 * 60)).toBeNull();
  });

  // 가장 중요한 성질 — 근거가 없으면 아무 말도 하지 않는다
  it('못 읽거나 데이터가 없으면 경고하지 않는다', () => {
    expect(warningFor('영업시간 문의', 23 * 60)).toBeNull();
    expect(warningFor(null, 23 * 60)).toBeNull();
  });

  describe('브레이크 타임', () => {
    const B = '오전 11:00 ~ 오후 2:00, 오후 5:00 ~ 오후 9:00';

    it('각 영업 구간 안은 정상', () => {
      expect(warningFor(B, 12 * 60, 13 * 60)).toBeNull();
      expect(warningFor(B, 18 * 60, 19 * 60)).toBeNull();
    });

    it('브레이크 중 도착', () => {
      expect(warningFor(B, 15 * 60)).toEqual({ kind: 'after-close', at: 1260 });
    });

    it('1부에 들어가 브레이크에 걸치면 그 구간 마감을 알린다', () => {
      expect(warningFor(B, 13 * 60 + 30, 15 * 60)).toEqual({ kind: 'closes-during', at: 840 });
    });
  });

  describe('심야 영업', () => {
    const N = '오후 6:00 ~ 오전 2:00'; // 18:00–02:00

    it('영업 중이면 정상 (자정 전후 모두)', () => {
      expect(warningFor(N, 23 * 60)).toBeNull();
      expect(warningFor(N, 25 * 60)).toBeNull(); // 다음날 01:00
    });

    // 낮 3시엔 "닫았다"가 아니라 "아직 안 열었다"가 맞다 — 둘 다 영업 중이 아니지만
    // 사용자가 할 행동이 다르다(포기 ↔ 저녁에 다시).
    it('낮에 가면 "닫았다"가 아니라 "아직 안 열었다"', () => {
      expect(warningFor(N, 15 * 60)).toEqual({ kind: 'before-open', at: 1080 });
      expect(warningFor(N, 3 * 60)).toEqual({ kind: 'before-open', at: 1080 });
    });
  });
});
