/**
 * 영업시간 문자열 파서 — **의존성 없는 순수 모듈**.
 *
 * `dayModel.ts`가 "하루를 시간축에 올리는 규칙"의 단일 기준이라면, 이 파일은 그중
 * "영업시간 문자열을 분(minute)으로 바꾸는 규칙"만 떼어낸 것이다. import가 하나도 없어서
 * 따로 돌려보며 검증할 수 있다 — 잘못 읽으면 멀쩡한 일정에 "닫혀 있어요"가 뜨기 때문에
 * 이 파일만큼은 반드시 실제 문자열로 테스트하고 고칠 것.
 *
 * 입력은 Google Places의 `weekdayDescriptions` 한 줄에서 요일 접두어를 뗀 형태다
 * (`language=ko`로 받으므로 "오전 9:00 ~ 오후 6:00" 같은 한국어가 온다).
 *
 * **못 읽으면 null을 돌려 경고를 포기한다**(원칙 3-1). 틀린 "닫혀 있어요"는 침묵보다 나쁘다 —
 * 멀쩡한 일정을 사용자가 지워버리게 만든다.
 */

/** 하루 안의 영업 구간 하나 (분). 자정을 넘기면 close < open 이다. */
export interface HoursRange {
  open: number;
  close: number;
}

/** "오전 9:00" / "오후 6:30" / "6:00 PM" / "09:00" / "9시" → 분. 못 읽으면 null. */
export function parseClock(raw: string): number | null {
  // 오전/오후는 시각 **앞**에, AM/PM은 **뒤**에 붙는다 — 양쪽 다 받는다
  const m = raw.match(/(오전|오후|AM|PM|am|pm)?\s*(\d{1,2})\s*[:시]\s*(\d{2})?\s*(AM|PM|am|pm)?/);
  if (!m) return null;
  const marker = m[1] ?? m[4];
  let hour = Number(m[2]);
  const min = m[3] ? Number(m[3]) : 0;
  if (!Number.isFinite(hour) || !Number.isFinite(min) || hour > 24 || min > 59) return null;

  const isPm = marker === '오후' || marker === 'PM' || marker === 'pm';
  const isAm = marker === '오전' || marker === 'AM' || marker === 'am';
  // 12시는 예외: 오전 12시 = 자정(0시), 오후 12시 = 정오(12시)
  if (isPm && hour < 12) hour += 12;
  if (isAm && hour === 12) hour = 0;
  if (hour > 24) return null;
  return (hour % 24) * 60 + min;
}

/**
 * 그날의 영업시간 한 줄을 구간 목록으로. 돌려주는 값의 뜻:
 *   null  = 못 읽음(= 판단 불가, 경고하지 않음)
 *   []    = 그날 휴무
 *   [...] = 영업 구간들("11:00~14:00, 17:00~21:00"처럼 브레이크 타임이 있으면 2개)
 */
export function parseHoursRanges(line: string | null): HoursRange[] | null {
  if (!line) return null;
  const text = line.trim();
  if (!text) return null;

  if (/휴무|휴업|휴일|closed/i.test(text)) return [];
  // 24시간 영업은 경고할 일이 없으므로 "하루 전체" 한 구간으로 둔다
  if (/24\s*시간|24\s*hours|open\s*24/i.test(text)) return [{ open: 0, close: 1440 }];

  const ranges: HoursRange[] = [];
  // "오전 9:00 ~ 오후 6:00" 덩어리를 쉼표로 나눠 각각 읽는다(브레이크 타임 대응)
  for (const chunk of text.split(/[,;]/)) {
    // 구분자가 '-'인 경우가 있어 범위 분리는 대시류와 '부터/to'까지 받는다
    const parts = chunk.split(/\s*(?:~|–|—|-|부터|to)\s*/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const open = parseClock(parts[0]);
    const close = parseClock(parts[1]);
    if (open == null || close == null) continue;
    // 자정 마감(0:00)은 1440으로 둬야 "자정 넘김"과 구분된다
    ranges.push({ open, close: close === 0 ? 1440 : close });
  }
  return ranges.length ? ranges : null;
}

/** 이 분(minute)이 영업 구간 안에 드는지. 1440을 넘는 값도 받아 하루 안으로 접는다. */
export function isWithinRanges(ranges: HoursRange[], minute: number): boolean {
  const t = ((minute % 1440) + 1440) % 1440;
  return ranges.some(({ open, close }) =>
    close > open ? t >= open && t < close : t >= open || t < close // close<open = 자정 넘김
  );
}

/** 영업시간과 어긋나는 상황. null이 아니면 언제나 "알릴 거리가 있다"는 뜻이다. */
export type HoursWarning =
  | { kind: 'closed-day' }                 // 그날 아예 휴무
  | { kind: 'before-open'; at: number }    // 문 열기 전에 도착
  | { kind: 'after-close'; at: number }    // 문 닫은 뒤에 도착
  | { kind: 'closes-during'; at: number }; // 도착은 되는데 머무는 중에 닫음

/**
 * 영업시간 한 줄과 계획 시각을 대조한다. 어긋나지 않거나 판단할 수 없으면 null.
 * `departMin`을 주면 "들어가긴 하는데 머무는 중에 닫는" 경우까지 잡는다.
 */
export function warningFor(line: string | null, arriveMin: number, departMin?: number): HoursWarning | null {
  const ranges = parseHoursRanges(line);
  if (ranges == null) return null; // 못 읽음 — 조용히 넘어간다
  if (ranges.length === 0) return { kind: 'closed-day' };

  if (!isWithinRanges(ranges, arriveMin)) {
    // 그날의 가장 이른 개점·가장 늦은 폐점과 비교해 "일찍 왔다 / 늦게 왔다"를 가른다
    const firstOpen = Math.min(...ranges.map((r) => r.open));
    const lastClose = Math.max(...ranges.map((r) => (r.close > r.open ? r.close : 1440)));
    const t = ((arriveMin % 1440) + 1440) % 1440;
    return t < firstOpen ? { kind: 'before-open', at: firstOpen } : { kind: 'after-close', at: lastClose };
  }

  if (departMin != null && departMin > arriveMin && !isWithinRanges(ranges, departMin)) {
    const t = ((arriveMin % 1440) + 1440) % 1440;
    const active = ranges.find(({ open, close }) =>
      close > open ? t >= open && t < close : t >= open || t < close
    );
    // 24시간 영업(0~1440)이면 닫을 일이 없다
    if (active && !(active.open === 0 && active.close === 1440)) {
      return { kind: 'closes-during', at: active.close };
    }
  }

  return null;
}
