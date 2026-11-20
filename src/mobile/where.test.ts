import { describe, it, expect } from 'vitest';
import { parseWhereParams, agoLabel } from './where';

const ID = '22222222-2222-4222-8222-222222222222';

describe('parseWhereParams', () => {
  it('"어디야?" 알림 주소', () => {
    expect(parseWhereParams('?where_from=' + ID + '&where_name=%EC%84%B1%ED%98%84')).toEqual({ kind: 'ask', fromId: ID, name: '성현' });
  });
  it('위치 알림 주소', () => {
    expect(parseWhereParams('?here_lat=13.75&here_lng=100.5&here_name=a&here_at=1000')).toEqual({ kind: 'here', lat: 13.75, lng: 100.5, name: 'a', at: 1000 });
  });
  it('틀린 값은 무시', () => {
    expect(parseWhereParams('')).toBeNull();
    expect(parseWhereParams('?where_from=abc')).toBeNull();
    expect(parseWhereParams('?here_lat=999&here_lng=1')).toBeNull();
    expect(parseWhereParams('?here_lat=x&here_lng=1')).toBeNull();
    expect(parseWhereParams('?code=oauth')).toBeNull();
  });
});

describe('agoLabel', () => {
  it('분·시간', () => {
    expect(agoLabel(1000, 1000)).toBe('방금');
    expect(agoLabel(0, 5 * 60000)).toBe('5분 전');
    expect(agoLabel(0, 3 * 3600000)).toBe('3시간 전');
  });
});
