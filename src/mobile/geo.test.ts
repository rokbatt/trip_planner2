/**
 * GPS 정류지 판정 테스트.
 *
 * 이 판정이 틀리면 **틀린 도착 기록**이 남고, 그 기록은 `scheduleFor`를 통해 그날 남은
 * 일정 전체를 밀어버린다. 그래서 검증하는 건 "잘 맞히는가"보다 **틀릴 상황에서 확실히
 * 포기하는가**다 — 못 맞히면 사용자가 직접 누르면 되지만, 잘못 맞히면 일정이 깨진다.
 *
 * 좌표는 실제 방콕 지점들을 쓴다(수완나품 공항 / 시내 호텔 / 왓 포 / 바로 옆 식당 두 곳).
 */

import { describe, it, expect } from 'vitest';
import { matchStop, distanceM, radiusFor, MAX_ACCURACY_M } from './geo';
import type { GeoCandidate } from './geo';

const AIRPORT: GeoCandidate = { key: 'air', lat: 13.6900, lng: 100.7501, cat: 'AIRPORT' };
const HOTEL: GeoCandidate = { key: 'hotel', lat: 13.7230, lng: 100.5280, cat: 'STAY' };
const WATPO: GeoCandidate = { key: 'watpo', lat: 13.7465, lng: 100.4927, cat: 'VISIT' };
const DAY = [AIRPORT, HOTEL, WATPO];

describe('distanceM', () => {
  it('같은 점은 0', () => {
    expect(distanceM({ lat: 13.75, lng: 100.5 }, { lat: 13.75, lng: 100.5 })).toBe(0);
  });

  it('방콕 공항 ↔ 시내는 대략 30km', () => {
    const d = distanceM(AIRPORT, HOTEL) / 1000;
    expect(d).toBeGreaterThan(24);
    expect(d).toBeLessThan(34);
  });
});

describe('radiusFor', () => {
  // 반경을 하나로 두면 공항이나 식당 중 하나는 반드시 망가진다
  it('공항이 식당보다 훨씬 넓다', () => {
    expect(radiusFor('AIRPORT')).toBeGreaterThan(radiusFor('FOOD') * 10);
  });
});

describe('matchStop', () => {
  it('공항 터미널 안에 있으면 공항으로 잡는다', () => {
    // 터미널에서 1km 남짓 떨어진 지점(공항 부지 안)
    const m = matchStop({ lat: 13.6980, lng: 100.7501, accuracyM: 60 }, DAY);
    expect(m?.key).toBe('air');
  });

  it('호텔 앞에 있으면 호텔로 잡는다', () => {
    const m = matchStop({ lat: 13.7231, lng: 100.5281, accuracyM: 30 }, DAY);
    expect(m?.key).toBe('hotel');
    expect(m!.meters).toBeLessThan(50);
  });

  it('아무 데도 안 가까우면 null', () => {
    // 치앙마이 — 그날 일정 어디와도 멀다
    expect(matchStop({ lat: 18.7883, lng: 98.9853, accuracyM: 40 }, DAY)).toBeNull();
  });

  // 핵심 성질 ①: 오차가 크면 "안에 있다"고 말할 근거가 없다
  it('오차가 한계를 넘으면 판정을 포기한다', () => {
    expect(matchStop({ lat: 13.7231, lng: 100.5281, accuracyM: MAX_ACCURACY_M + 1 }, DAY)).toBeNull();
  });

  it('accuracy가 숫자가 아니면 포기한다', () => {
    expect(matchStop({ lat: 13.7231, lng: 100.5281, accuracyM: NaN }, DAY)).toBeNull();
  });

  // 핵심 성질 ②: 붙어 있는 두 곳은 GPS로 가를 수 없다 — 찍어 맞히지 않는다
  it('나란히 붙은 두 식당은 둘 다 포기한다', () => {
    const a: GeoCandidate = { key: 'a', lat: 13.7465, lng: 100.4927, cat: 'FOOD' };
    const b: GeoCandidate = { key: 'b', lat: 13.7466, lng: 100.4929, cat: 'FOOD' };
    expect(matchStop({ lat: 13.74655, lng: 100.4928, accuracyM: 20 }, [a, b])).toBeNull();
  });

  it('한 곳이 뚜렷하게 더 가까우면 그 곳으로 잡는다', () => {
    const near: GeoCandidate = { key: 'near', lat: 13.7465, lng: 100.4927, cat: 'FOOD' };
    const far: GeoCandidate = { key: 'far', lat: 13.7480, lng: 100.4960, cat: 'FOOD' };
    const m = matchStop({ lat: 13.7465, lng: 100.4927, accuracyM: 15 }, [near, far]);
    expect(m?.key).toBe('near');
  });

  it('후보가 없으면 null', () => {
    expect(matchStop({ lat: 13.7, lng: 100.5, accuracyM: 20 }, [])).toBeNull();
  });

  // 오차가 반경을 넓혀 주지만, 그래도 멀면 안 잡힌다
  it('오차를 감안해도 멀면 안 잡는다', () => {
    // 호텔에서 2km 밖 — STAY 반경 200m + 오차 300m로도 못 닿는다
    expect(matchStop({ lat: 13.7410, lng: 100.5280, accuracyM: 300 }, [HOTEL])).toBeNull();
  });
});
