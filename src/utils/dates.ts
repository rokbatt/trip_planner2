/**
 * 날짜(YYYY-MM-DD) 다루기.
 *
 * `new Date('2026-10-26')`은 **UTC 자정**으로 해석된다. 그런데 화면에 쓰는 getMonth()·getDate()는
 * 기기의 로컬 시간대 기준이라, UTC보다 늦은 한국(+9)에서는 우연히 맞지만 UTC보다 이른 곳
 * (하와이 -10, 미국 본토, 중남미…)에서는 10.26이 **10.25로** 보인다. 현지에서 쓰는 여행 앱이라
 * 미주 여행 중에 헤더 날짜·박수·D-day·DAY 날짜가 하루씩 밀리던 버그의 원인이다.
 *
 * 날짜만 있는 문자열은 전부 이 파일의 함수로 읽는다 — "그 날의 로컬 자정"이 된다.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 'YYYY-MM-DD'를 그 날 **로컬 자정**의 Date로. 시각이 들어 있는 문자열(타임스탬프)은 기존 Date 해석 그대로 —
 * 그건 "순간"이라 로컬 시간대로 보여 주는 게 맞다.
 */
export function parseISODate(s: string): Date {
  const m = DATE_ONLY.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
}

/** Date → 로컬 기준 'YYYY-MM-DD' (toISOString은 UTC라 쓰지 않는다) */
export function toISODate(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** 오늘(이 기기의 로컬 날짜) */
export function todayLocalISO(now: Date = new Date()): string {
  return toISODate(now);
}

/** 두 날짜 문자열 사이의 일수(b - a). 시간대·서머타임과 무관하게 달력 기준 */
export function daysBetweenISO(a: string, b: string): number {
  const utc = (s: string) => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(b) - utc(a)) / 86400000);
}
