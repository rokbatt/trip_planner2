/**
 * 오프라인 대기열 겹치기 테스트 — 오프라인에서 누른 도착·체크·지출이 앱을 다시 열어도
 * 화면에 남아 있는지(저장된 옛 응답 + 대기열)를 붙든다.
 */

import { describe, it, expect } from 'vitest';
import { parseRestUrl, applyQueued, isQueueable, withClientIds, cacheKey, type QueuedWrite } from './restModel';

const BASE = 'https://x.supabase.co/rest/v1/';
const w = (method: QueuedWrite['method'], path: string, body: unknown, headers: Record<string, string> = {}): QueuedWrite => ({
  method, url: BASE + path, table: path.split('?')[0], headers, body: body == null ? null : JSON.stringify(body), at: 0,
});

describe('parseRestUrl', () => {
  it('테이블과 eq/in/is 필터를 읽는다', () => {
    const p = parseRestUrl(BASE + 'trip_stop_progress?select=*&destination_id=eq.d1&day_index=eq.2&stop_key=in.(a,"b c")&memo=is.null')!;
    expect(p.table).toBe('trip_stop_progress');
    expect(p.supported).toBe(true);
    expect(p.filters).toEqual([
      { col: 'destination_id', op: 'eq', values: ['d1'] },
      { col: 'day_index', op: 'eq', values: ['2'] },
      { col: 'stop_key', op: 'in', values: ['a', 'b c'] },
      { col: 'memo', op: 'is.null', values: [] },
    ]);
  });

  it('흉내 낼 수 없는 필터가 있으면 supported=false', () => {
    expect(parseRestUrl(BASE + 'trip_expenses?amount=gt.10')!.supported).toBe(false);
  });

  it('on_conflict를 읽는다', () => {
    expect(parseRestUrl(BASE + 'trip_stop_progress?on_conflict=destination_id%2Cday_index%2Cstop_key')!.onConflict)
      .toEqual(['destination_id', 'day_index', 'stop_key']);
  });

  it('REST가 아니면 null', () => {
    expect(parseRestUrl('https://x.supabase.co/auth/v1/user')).toBeNull();
  });
});

describe('isQueueable', () => {
  it('여행 중 폰에서 누르는 테이블의 쓰기만', () => {
    expect(isQueueable('POST', BASE + 'trip_stop_progress')).toBe(true);
    expect(isQueueable('PATCH', BASE + 'trip_checklist?id=eq.1')).toBe(true);
    expect(isQueueable('POST', BASE + 'trip_expenses')).toBe(true);
    expect(isQueueable('POST', BASE + 'route_stops')).toBe(false); // ROUTE 저장은 넣지 않는다
    expect(isQueueable('GET', BASE + 'trip_checklist')).toBe(false);
  });
});

describe('applyQueued — 도착 기록 (upsert)', () => {
  const read = parseRestUrl(BASE + 'trip_stop_progress?select=*&destination_id=eq.d1&day_index=eq.0')!;
  const up = (key: string, status: string, day = 0) =>
    w('POST', 'trip_stop_progress?on_conflict=destination_id%2Cday_index%2Cstop_key',
      { destination_id: 'd1', day_index: day, stop_key: key, status }, { Prefer: 'resolution=merge-duplicates' });

  it('저장된 응답에 없던 도착이 생긴다', () => {
    expect(applyQueued([], read, [up('k1', 'arrived')]).map((r) => r.status)).toEqual(['arrived']);
  });

  it('같은 정류지는 덮어쓴다 (도착 → 출발)', () => {
    const cached = [{ destination_id: 'd1', day_index: 0, stop_key: 'k1', status: 'arrived', actual_arrive_at: 't1' }];
    const out = applyQueued(cached, read, [up('k1', 'departed')]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: 'departed', actual_arrive_at: 't1' });
  });

  it('다른 DAY의 기록은 이 읽기에 섞이지 않는다', () => {
    expect(applyQueued([], read, [up('k9', 'arrived', 3)])).toEqual([]);
  });
});

describe('applyQueued — 체크리스트·지출', () => {
  const read = parseRestUrl(BASE + 'trip_checklist?select=*&trip_id=eq.t1')!;
  const cached = [{ id: 'c1', trip_id: 't1', title: '여권', checked_at: null }, { id: 'c2', trip_id: 't1', title: '충전기', checked_at: null }];

  it('체크(PATCH)와 삭제(DELETE)를 반영한다', () => {
    const out = applyQueued(cached, read, [
      w('PATCH', 'trip_checklist?id=eq.c1', { checked_at: 'now' }),
      w('DELETE', 'trip_checklist?id=eq.c2', null),
    ]);
    expect(out).toEqual([{ id: 'c1', trip_id: 't1', title: '여권', checked_at: 'now' }]);
  });

  it('새 항목(insert)이 뒤에 붙는다', () => {
    const out = applyQueued(cached, read, [w('POST', 'trip_checklist', { id: 'c3', trip_id: 't1', title: '우산' })]);
    expect(out.map((r) => r.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('흉내 낼 수 없는 읽기에는 겹치지 않는다', () => {
    const odd = parseRestUrl(BASE + 'trip_checklist?title=like.*여*')!;
    expect(applyQueued(cached, odd, [w('DELETE', 'trip_checklist?id=eq.c1', null)])).toHaveLength(2);
  });

  it('원본 배열을 바꾸지 않는다', () => {
    applyQueued(cached, read, [w('PATCH', 'trip_checklist?id=eq.c1', { checked_at: 'x' })]);
    expect(cached[0].checked_at).toBeNull();
  });
});

describe('withClientIds', () => {
  it('일반 insert에는 id를 미리 넣는다', () => {
    const out = withClientIds(w('POST', 'trip_expenses', { trip_id: 't1', amount: 100 }), () => 'new-id');
    expect(JSON.parse(out.body!)).toEqual({ trip_id: 't1', amount: 100, id: 'new-id' });
  });

  it('upsert에는 넣지 않는다 (기존 행 id를 바꿔 버린다)', () => {
    const up = w('POST', 'trip_stop_progress?on_conflict=destination_id%2Cday_index%2Cstop_key', { stop_key: 'k' }, { Prefer: 'resolution=merge-duplicates' });
    expect(withClientIds(up, () => 'x').body).toBe(up.body);
  });
});

describe('cacheKey', () => {
  it('한 행 요청과 목록 요청을 구분한다', () => {
    expect(cacheKey('GET', 'u', 'application/vnd.pgrst.object+json')).not.toBe(cacheKey('GET', 'u', 'application/json'));
  });
});
