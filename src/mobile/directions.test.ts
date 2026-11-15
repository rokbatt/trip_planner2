import { describe, it, expect } from 'vitest';
import { directionsUrl, originChoices, pointParam } from './directions';

const tower = { name: 'Eiffel Tower', lat: 48.8584, lng: 2.2945 };
const hotel = { name: 'Hotel A', lat: 48.87, lng: 2.33 };
const cafe = { name: 'Cafe B', lat: 48.86, lng: 2.31 };

describe('directionsUrl', () => {
  it('기본은 출발지를 넣지 않는다 — 구글맵이 현재 위치를 출발지로 잡는다', () => {
    const url = directionsUrl(tower);
    expect(url).not.toContain('origin=');
    expect(url).toContain('destination=48.8584%2C2.2945');
  });

  it('출발지를 바꾸면 그 좌표가 origin으로 들어간다', () => {
    const url = directionsUrl(tower, 'walking', { kind: 'point', label: '숙소', point: hotel });
    expect(url).toContain('origin=48.87%2C2.33');
    expect(url).toContain('&travelmode=walking');
  });

  it('직접 입력은 글자 그대로, 빈 입력은 현재 위치로', () => {
    expect(directionsUrl(tower, null, { kind: 'text', text: ' 파리 북역 ' })).toContain('origin=' + encodeURIComponent('파리 북역'));
    expect(directionsUrl(tower, null, { kind: 'text', text: '   ' })).not.toContain('origin=');
  });

  it('좌표가 없으면 이름으로', () => {
    expect(pointParam({ name: '루브르', lat: null, lng: null })).toBe('루브르');
    expect(pointParam({ name: 'x', lat: NaN, lng: 1 })).toBe('x');
  });
});

describe('originChoices', () => {
  it('현재 위치가 항상 첫 번째, 숙소·이전 장소는 있을 때만', () => {
    expect(originChoices({ dest: tower })).toEqual([{ kind: 'here' }]);
    const all = originChoices({ dest: tower, prev: cafe, stay: hotel });
    expect(all.map((o) => (o.kind === 'point' ? o.label : o.kind))).toEqual(['here', '숙소', '이전 장소']);
  });

  it('목적지와 같은 곳·숙소와 같은 이전 장소는 빼서 중복을 없앤다', () => {
    expect(originChoices({ dest: hotel, stay: hotel })).toEqual([{ kind: 'here' }]);
    expect(originChoices({ dest: tower, prev: hotel, stay: hotel }).length).toBe(2);
  });
});
