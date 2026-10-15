/**
 * "숙소 들르기" 정류지 ↔ 숙소 장소 연결 테스트.
 * 이 연결이 없으면 모바일 일정에 사진·주소가 빈 카드가 나온다(실제로 났던 버그).
 */

import { describe, it, expect } from 'vitest';
import { findRevisitPlace, attachRevisitPlaces } from './revisit';
import type { TlDay, TlStop } from '../timeline/dayModel';

const place = (id: string, name: string, lat: number, lng: number) =>
  ({ id, name, lat, lng, photo_url: 'https://x/' + id + '.jpg', address: id + ' 주소' }) as never;

const REMBRANDT = place('p-rem', 'Rembrandt Residences Bangkok', 13.7303, 100.5687);
const GOLDEN = place('p-gold', '골든 포이어 스완나품 에어포트 호텔', 13.7246, 100.7558);
const WAT = place('p-wat', '왓 프라깨우', 13.7516, 100.4927);
const byId = new Map([REMBRANDT, GOLDEN, WAT].map((p: { id: string }) => [p.id, p])) as never;
const camps = new Set(['p-rem', 'p-gold']);

function revisit(name: string, lat: number | null, lng: number | null, purpose = '짐 두기'): TlStop {
  return {
    key: 'd1-1-' + name, placeId: null, customName: name, lat, lng, arriveTime: null, memo: null,
    travelMode: null, purpose, customDwellMin: null, name, cat: 'VISIT', place: null,
  };
}

describe('findRevisitPlace', () => {
  it('숙소 중 이름이 같은 곳을 찾는다', () => {
    expect(findRevisitPlace(revisit('Rembrandt Residences Bangkok', 13.7303, 100.5687), byId, camps)?.id).toBe('p-rem');
  });

  it('이름이 달라도 숙소 좌표 100m 안이면 그 숙소', () => {
    expect(findRevisitPlace(revisit('렘브란트 레지던스', 13.7305, 100.5688), byId, camps)?.id).toBe('p-rem');
  });

  it('100m 밖이면 좌표로는 붙이지 않는다', () => {
    expect(findRevisitPlace(revisit('어딘가', 13.74, 100.58), byId, camps)).toBeNull();
  });

  it('숙소가 아니어도 이름이 정확히 같으면 붙인다', () => {
    expect(findRevisitPlace(revisit('왓 프라깨우', null, null), byId, camps)?.id).toBe('p-wat');
  });

  it('숙소 들르기가 아닌 정류지는 건드리지 않는다', () => {
    expect(findRevisitPlace({ ...revisit('Rembrandt Residences Bangkok', 13.73, 100.56), purpose: null }, byId, camps)).toBeNull();
  });
});

describe('attachRevisitPlaces', () => {
  it('place만 붙이고 cat·key는 그대로 둔다 (PC 일정 시각과 어긋나지 않게)', () => {
    const day = { dayIndex: 1, stops: [revisit('Rembrandt Residences Bangkok', 13.7303, 100.5687)] } as unknown as TlDay;
    const [out] = attachRevisitPlaces([day], byId, camps);
    expect(out.stops[0].place?.id).toBe('p-rem');
    expect(out.stops[0].cat).toBe('VISIT');
    expect(out.stops[0].key).toBe(day.stops[0].key);
    expect(day.stops[0].place).toBeNull(); // 원본은 그대로
  });

  it('붙일 게 없는 날은 같은 객체를 돌려준다', () => {
    const day = { dayIndex: 0, stops: [] } as unknown as TlDay;
    expect(attachRevisitPlaces([day], byId, camps)[0]).toBe(day);
  });
});
