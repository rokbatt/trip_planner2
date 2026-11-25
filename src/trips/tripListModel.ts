/**
 * 내 여행 목록의 순서와 "마지막으로 불러온 목록" 보관 — DOM을 모르는 부분만 모았다(tripListModel.test.ts).
 */

export interface TripLike {
  id: string;
  start_date: string | null;
  end_date: string | null;
}

/** YYYY-MM-DD → 비교용 문자열(날짜가 없으면 null) */
function day(d: string | null): string | null {
  return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

/**
 * 목록 순서 — 사람이 지금 열고 싶은 여행이 맨 앞에 오게 한다.
 *  1) 진행 중·다가오는 여행: 가까운 출발일부터(진행 중인 여행이 가장 앞)
 *  2) 날짜를 안 정한 여행
 *  3) 지난 여행: 최근에 끝난 것부터
 * (예전에는 출발일 내림차순이라 다가오는 여행이 여러 개면 가장 먼 여행이 맨 앞에 왔다)
 */
export function sortTrips<T extends TripLike>(trips: readonly T[], today: string): T[] {
  const rank = (t: T): number => {
    const end = day(t.end_date) ?? day(t.start_date);
    if (!day(t.start_date)) return 1;
    return end && end < today ? 2 : 0;
  };
  return [...trips].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return (day(a.start_date) ?? '').localeCompare(day(b.start_date) ?? '');
    if (ra === 2) return (day(b.end_date) ?? day(b.start_date) ?? '').localeCompare(day(a.end_date) ?? day(a.start_date) ?? '');
    return 0;
  });
}

/** 오늘 날짜(기기 시간대) YYYY-MM-DD */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* ── 마지막으로 불러온 목록(이 기기) ──
 * 비행기 안처럼 서버에 못 닿을 때 "아직 여행이 없어요"를 보여 주면 여행이 사라진 줄 안다.
 * 마지막으로 받은 목록을 사용자별로 남겨 두고, 불러오기에 실패하면 그걸 보여 준다. */

const CACHE_PREFIX = 'mongsil:trips:';

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function saveTripCache<T>(kv: KV | null, userId: string, trips: readonly T[]): void {
  try {
    kv?.setItem(CACHE_PREFIX + userId, JSON.stringify(trips));
  } catch {
    /* 저장소가 막혀도 목록 표시는 그대로 */
  }
}

export function readTripCache<T extends TripLike>(kv: KV | null, userId: string): T[] | null {
  try {
    const raw = kv?.getItem(CACHE_PREFIX + userId);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    return v.filter((t): t is T => !!t && typeof t === 'object' && typeof (t as TripLike).id === 'string');
  } catch {
    return null;
  }
}
