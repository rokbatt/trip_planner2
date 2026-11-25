import { describe, expect, it } from 'vitest';
import { readTripCache, saveTripCache, sortTrips, todayIso } from './tripListModel';

const t = (id: string, start: string | null, end: string | null) => ({ id, start_date: start, end_date: end });

describe('sortTrips — 지금 열고 싶은 여행이 맨 앞', () => {
  const today = '2026-12-19';
  it('진행 중 → 가까운 다가오는 여행 → 먼 여행 → 날짜 미정 → 최근 지난 여행 → 오래된 여행', () => {
    const list = [
      t('old', '2025-05-01', '2025-05-05'),
      t('far', '2027-08-01', '2027-08-10'),
      t('tbd', null, null),
      t('now', '2026-12-18', '2026-12-22'),
      t('recent', '2026-11-01', '2026-11-05'),
      t('soon', '2027-01-10', '2027-01-15'),
    ];
    expect(sortTrips(list, today).map((x) => x.id)).toEqual(['now', 'soon', 'far', 'tbd', 'recent', 'old']);
  });
  it('오늘 끝나는 여행은 아직 진행 중으로 본다', () => {
    expect(sortTrips([t('past', '2026-12-01', '2026-12-05'), t('last', '2026-12-15', '2026-12-19')], today).map((x) => x.id)).toEqual(['last', 'past']);
  });
  it('원본 배열은 건드리지 않는다', () => {
    const list = [t('b', '2027-02-01', '2027-02-02'), t('a', '2027-01-01', '2027-01-02')];
    sortTrips(list, today);
    expect(list[0].id).toBe('b');
  });
});

describe('todayIso', () => {
  it('기기 시간대 날짜', () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('여행 목록 보관', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('사용자별로 저장하고 읽는다', () => {
    const kv = mem();
    saveTripCache(kv, 'u1', [t('a', '2027-01-01', '2027-01-02')]);
    expect(readTripCache(kv, 'u1')?.map((x) => x.id)).toEqual(['a']);
    expect(readTripCache(kv, 'u2')).toBeNull();
  });
  it('깨진 값·저장소 없음은 null', () => {
    const kv = mem();
    kv.setItem('mongsil:trips:u1', '{not json');
    expect(readTripCache(kv, 'u1')).toBeNull();
    expect(readTripCache(null, 'u1')).toBeNull();
  });
});
