/**
 * 이동 추정·시각 계산 테스트.
 *
 * ROUTE와 TIMELINE이 같은 구간을 두고 다른 숫자를 보여주면 그 자체가 버그이므로
 * (travelEstimate.ts 머리말), 여기 있는 순수 함수들이 이 앱의 "숫자 원본"이다.
 *
 * 추정치 자체가 맞는지는 검증할 수 없다(원칙 3-1 — 애초에 추정치다). 대신 검증하는 건
 * **규칙이 일관되게 적용되는가**다: 실측이 있으면 반드시 실측을 쓰는가, 하한 클램프가
 * 걸리는가, 파싱이 쓰레기 입력을 조용히 통과시키지 않는가.
 */

import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  legForMode,
  realToLeg,
  pickAutoMode,
  estimateLegBetween,
  decodePolyline,
  toApiMode,
  legKey,
  catKeyFor,
  dwellMinutes,
  modeLabel,
  fmtMin,
  fmtKm,
  minToHHMM,
  hhmmToMin,
  parseTimeInput,
  STRAIGHT_TO_ROAD,
} from './travelEstimate';

/* ══════════════ 거리 ══════════════ */

describe('haversineKm', () => {
  it('같은 지점은 0km', () => {
    expect(haversineKm(13.7563, 100.5018, 13.7563, 100.5018)).toBe(0);
  });

  it('알려진 거리를 실제 값 근처로 계산한다', () => {
    // 서울시청 ↔ 부산시청 — 실제 대권거리 약 325km
    const km = haversineKm(37.5665, 126.978, 35.1796, 129.0756);
    expect(km).toBeGreaterThan(320);
    expect(km).toBeLessThan(330);
  });

  it('방향이 바뀌어도 같은 거리다', () => {
    const a = haversineKm(13.7563, 100.5018, 13.7466, 100.5347);
    const b = haversineKm(13.7466, 100.5347, 13.7563, 100.5018);
    expect(a).toBeCloseTo(b, 10);
  });

  it('날짜변경선을 건너도 지구 반대편으로 돌지 않는다', () => {
    // 경도 179 ↔ -179는 붙어 있는 2도 차이지 358도 차이가 아니다
    const km = haversineKm(0, 179, 0, -179);
    expect(km).toBeLessThan(250);
  });
});

/* ══════════════ 구간 추정 ══════════════ */

describe('legForMode', () => {
  it('아주 짧은 거리에도 모드별 최소 소요시간이 걸린다', () => {
    // 0km라고 "0분"이라고 쓰면 화면이 거짓말을 한다 — 하한을 둔 이유
    expect(legForMode(0, 'WALK').min).toBe(2);
    expect(legForMode(0, 'TRANSIT').min).toBe(6);
    expect(legForMode(0, 'TAXI').min).toBe(8);
  });

  it('거리가 멀수록 오래 걸린다', () => {
    for (const mode of ['WALK', 'TRANSIT', 'TAXI'] as const) {
      expect(legForMode(10, mode).min).toBeGreaterThan(legForMode(1, mode).min);
    }
  });

  it('도보는 요금이 없고, 대중교통 요금엔 상한이 있다', () => {
    expect(legForMode(5, 'WALK').costTHB).toBe(0);
    expect(legForMode(500, 'TRANSIT').costTHB).toBe(62);
  });

  it('추정치는 전부 real=false로 표시된다 (원칙 3-1)', () => {
    for (const mode of ['WALK', 'TRANSIT', 'TAXI'] as const) {
      expect(legForMode(3, mode).real).toBe(false);
    }
  });
});

describe('realToLeg', () => {
  it('실측을 쓰면 real=true이고 미터·초를 km·분으로 바꾼다', () => {
    const leg = realToLeg('TAXI', { meters: 5400, seconds: 900 });
    expect(leg.real).toBe(true);
    expect(leg.km).toBeCloseTo(5.4, 6);
    expect(leg.min).toBe(15);
  });

  it('실측이 0초여도 1분 미만으로 내려가지 않는다', () => {
    expect(realToLeg('WALK', { meters: 10, seconds: 0 }).min).toBe(1);
  });

  it('실측 대중교통 요금이 있으면 추정 요금 대신 그 값을 쓴다', () => {
    const leg = realToLeg('TRANSIT', { meters: 8000, seconds: 1200, fare: { units: 44, currency: 'THB' } });
    expect(leg.costTHB).toBe(44);
    expect(leg.fare).toEqual({ units: 44, currency: 'THB' });
  });

  it('실측 요금이 없으면 거리 기반 추정 요금으로 채우되 fare는 비워 둔다', () => {
    // fare 유무가 "이 요금이 실측인가"의 구분 기준이다 (원칙 3-1)
    const leg = realToLeg('TRANSIT', { meters: 8000, seconds: 1200 });
    expect(leg.fare).toBeUndefined();
    expect(leg.costTHB).toBeGreaterThan(0);
  });

  it('택시 요금은 실측 구간에서도 항상 추정이다', () => {
    // Routes API가 택시 요금을 주지 않으므로 거리 기반 추정을 유지한다
    const leg = realToLeg('TAXI', { meters: 10000, seconds: 1500 });
    expect(leg.fare).toBeUndefined();
    expect(leg.costTHB).toBe(35 + Math.round(10 * 6.5));
  });

  it('폴리라인이 있으면 좌표 배열로 풀어 둔다', () => {
    const leg = realToLeg('WALK', { meters: 500, seconds: 400, polyline: '_p~iF~ps|U_ulLnnqC' });
    expect(leg.path).toHaveLength(2);
    expect(leg.path![0].lat).toBeCloseTo(38.5, 5);
  });
});

describe('pickAutoMode', () => {
  it('실측이 없으면 직선거리로 고른다', () => {
    expect(pickAutoMode(0.5)).toBe('WALK');
    expect(pickAutoMode(3)).toBe('TRANSIT');
    expect(pickAutoMode(20)).toBe('TAXI');
  });

  it('도보 15분 이내면 걷는다 — 거리가 멀게 나와도 실측이 우선', () => {
    expect(pickAutoMode(99, { WALK: { meters: 900, seconds: 14 * 60 } })).toBe('WALK');
  });

  it('대중교통이 택시보다 심하게 느리지 않으면 대중교통을 고른다', () => {
    const measured = {
      WALK: { meters: 4000, seconds: 50 * 60 },
      TRANSIT: { meters: 5000, seconds: 20 * 60 },
      DRIVE: { meters: 4500, seconds: 15 * 60 },
    };
    expect(pickAutoMode(5, measured)).toBe('TRANSIT');
  });

  it('대중교통이 택시보다 심하게 느리면 택시로 넘어간다', () => {
    const measured = {
      WALK: { meters: 4000, seconds: 50 * 60 },
      TRANSIT: { meters: 5000, seconds: 60 * 60 },
      DRIVE: { meters: 4500, seconds: 15 * 60 },
    };
    expect(pickAutoMode(5, measured)).toBe('TAXI');
  });

  it('실측 객체가 비어 있으면 거리 기준으로 되돌아간다', () => {
    expect(pickAutoMode(0.5, {})).toBe('WALK');
    expect(pickAutoMode(20, {})).toBe('TAXI');
  });
});

describe('estimateLegBetween', () => {
  const seoul = { lat: 37.5665, lng: 126.978 };
  const nearby = { lat: 37.5705, lng: 126.982 };

  it('실측이 있으면 실측을 쓴다', () => {
    const leg = estimateLegBetween(seoul, nearby, 'TAXI', { DRIVE: { meters: 3000, seconds: 600 } });
    expect(leg.real).toBe(true);
    expect(leg.min).toBe(10);
  });

  it('실측이 없으면 추정으로 폴백한다', () => {
    const leg = estimateLegBetween(seoul, nearby, 'TAXI');
    expect(leg.real).toBe(false);
  });

  it('요청한 모드의 실측이 없으면 다른 모드 실측을 끌어 쓰지 않는다', () => {
    // TAXI를 물었는데 WALK 실측을 쓰면 화면에 엉뚱한 숫자가 뜬다
    const leg = estimateLegBetween(seoul, nearby, 'TAXI', { WALK: { meters: 3000, seconds: 2400 } });
    expect(leg.real).toBe(false);
    expect(leg.mode).toBe('TAXI');
  });

  it('직선거리에 도로 보정 계수를 곱한다', () => {
    const straight = haversineKm(seoul.lat, seoul.lng, nearby.lat, nearby.lng);
    const leg = estimateLegBetween(seoul, nearby, 'WALK');
    expect(leg.km).toBeCloseTo(straight * STRAIGHT_TO_ROAD, 6);
  });

  it('수동 지정 모드가 자동 판단을 이긴다', () => {
    expect(estimateLegBetween(seoul, nearby, 'TAXI').mode).toBe('TAXI');
    expect(estimateLegBetween(seoul, nearby, 'WALK').mode).toBe('WALK');
  });
});

describe('decodePolyline', () => {
  it('구글 공식 예제를 정확히 푼다', () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(pts).toHaveLength(3);
    expect(pts[0].lat).toBeCloseTo(38.5, 5);
    expect(pts[0].lng).toBeCloseTo(-120.2, 5);
    expect(pts[1].lat).toBeCloseTo(40.7, 5);
    expect(pts[2].lat).toBeCloseTo(43.252, 5);
    expect(pts[2].lng).toBeCloseTo(-126.453, 5);
  });

  it('빈 문자열은 빈 배열', () => {
    expect(decodePolyline('')).toEqual([]);
  });
});

describe('toApiMode / legKey', () => {
  it('TAXI만 DRIVE로 바꾸고 나머지는 그대로 보낸다', () => {
    expect(toApiMode('TAXI')).toBe('DRIVE');
    expect(toApiMode('WALK')).toBe('WALK');
    expect(toApiMode('TRANSIT')).toBe('TRANSIT');
  });

  it('구간 키는 방향을 구분한다', () => {
    expect(legKey('a', 'b')).toBe('a>b');
    expect(legKey('a', 'b')).not.toBe(legKey('b', 'a'));
  });
});

/* ══════════════ 방문 유형 · 체류시간 ══════════════ */

describe('catKeyFor', () => {
  it('숙소·공항이 다른 무엇보다 우선한다', () => {
    expect(catKeyFor('먹고싶어', 'restaurant', { isBasecamp: true })).toBe('STAY');
    expect(catKeyFor('먹고싶어', 'restaurant', { isAirport: true })).toBe('AIRPORT');
  });

  it('쇼핑 키워드가 mood보다 우선한다', () => {
    expect(catKeyFor('먹고싶어', 'shopping_mall')).toBe('SHOPPING');
    expect(catKeyFor(null, '짜뚜짝 주말시장')).toBe('SHOPPING');
  });

  it('mood로 맛집·액티비티를 가른다', () => {
    expect(catKeyFor('먹고싶어', 'cafe')).toBe('FOOD');
    expect(catKeyFor('하고싶어', 'spa')).toBe('ACTIVITY');
  });

  it('아무 단서가 없으면 관광으로 둔다', () => {
    expect(catKeyFor(null, null)).toBe('VISIT');
    expect(catKeyFor('가고싶어', 'point_of_interest')).toBe('VISIT');
  });

  it('카테고리 대소문자를 가리지 않는다', () => {
    expect(catKeyFor(null, 'SHOPPING_MALL')).toBe('SHOPPING');
  });
});

describe('dwellMinutes', () => {
  it('숙소는 체류시간을 더하지 않는다', () => {
    // 숙소는 하루의 시작·끝이라 체류를 더하면 일정이 통째로 밀린다
    expect(dwellMinutes('STAY')).toBe(0);
  });

  it('유형마다 값이 있고 음수는 없다', () => {
    for (const key of ['VISIT', 'FOOD', 'ACTIVITY', 'SHOPPING', 'STAY', 'AIRPORT'] as const) {
      expect(dwellMinutes(key)).toBeGreaterThanOrEqual(0);
    }
  });
});

/* ══════════════ 표기 ══════════════ */

describe('fmtMin / fmtKm / modeLabel', () => {
  it('60분 경계에서 시간 표기로 넘어간다', () => {
    expect(fmtMin(59)).toBe('59분');
    expect(fmtMin(60)).toBe('1시간');
    expect(fmtMin(90)).toBe('1시간 30분');
    expect(fmtMin(120)).toBe('2시간');
  });

  it('1km 경계에서 m 표기로 내려간다', () => {
    expect(fmtKm(1)).toBe('1.0km');
    expect(fmtKm(0.5)).toBe('500m');
    expect(fmtKm(12.34)).toBe('12.3km');
  });

  it('대중교통 라벨은 도시에 안 묶인 일반 명칭이다', () => {
    // 예전엔 방콕 기준 "BTS·지하철"이 박혀 있어 다른 도시에서도 그대로 나왔다
    expect(modeLabel('TRANSIT')).toBe('대중교통');
    expect(modeLabel('WALK')).toBe('도보');
    expect(modeLabel('TAXI')).toBe('택시');
  });
});

/* ══════════════ 시각 ══════════════ */

describe('minToHHMM', () => {
  it('자정 기준 분을 HH:MM으로 쓴다', () => {
    expect(minToHHMM(0)).toBe('00:00');
    expect(minToHHMM(9 * 60 + 5)).toBe('09:05');
    expect(minToHHMM(23 * 60 + 59)).toBe('23:59');
  });

  it('자정을 넘겨도 24시간 안으로 접는다', () => {
    // 일정이 밤 늦게까지 밀리면 1440분을 넘는 값이 들어온다
    expect(minToHHMM(1440)).toBe('00:00');
    expect(minToHHMM(1500)).toBe('01:00');
  });

  it('음수도 접어서 정상 시각을 만든다', () => {
    expect(minToHHMM(-60)).toBe('23:00');
  });
});

describe('hhmmToMin', () => {
  it('정상 입력을 분으로 바꾼다', () => {
    expect(hhmmToMin('09:30')).toBe(570);
    expect(hhmmToMin('9:30')).toBe(570);
    expect(hhmmToMin('  09:30  ')).toBe(570);
    expect(hhmmToMin('00:00')).toBe(0);
  });

  it('범위를 벗어나거나 형식이 아니면 null', () => {
    expect(hhmmToMin('24:00')).toBeNull();
    expect(hhmmToMin('09:60')).toBeNull();
    expect(hhmmToMin('930')).toBeNull();
    expect(hhmmToMin('')).toBeNull();
    expect(hhmmToMin('abc')).toBeNull();
  });

  it('minToHHMM과 왕복해도 값이 유지된다', () => {
    for (const min of [0, 1, 570, 719, 1439]) {
      expect(hhmmToMin(minToHHMM(min))).toBe(min);
    }
  });
});

describe('parseTimeInput', () => {
  it('사람이 치는 여러 형태를 24시간 표기로 모은다', () => {
    expect(parseTimeInput('930')).toBe('09:30');
    expect(parseTimeInput('0930')).toBe('09:30');
    expect(parseTimeInput('9:30')).toBe('09:30');
    expect(parseTimeInput('09:30')).toBe('09:30');
    expect(parseTimeInput('1830')).toBe('18:30');
  });

  it('시각만 친 경우 정시로 본다', () => {
    expect(parseTimeInput('9')).toBe('09:00');
    expect(parseTimeInput('18')).toBe('18:00');
    expect(parseTimeInput('0')).toBe('00:00');
  });

  it('숫자가 없는 입력을 0시로 통과시키지 않는다', () => {
    // Number('')이 0이라 그냥 두면 "abc"가 00:00으로 저장돼 버린다
    expect(parseTimeInput('abc')).toBeNull();
    expect(parseTimeInput('')).toBeNull();
    expect(parseTimeInput('   ')).toBeNull();
    expect(parseTimeInput(':')).toBeNull();
  });

  it('범위를 벗어나면 null로 돌려 호출부가 계산값을 쓰게 한다', () => {
    expect(parseTimeInput('2500')).toBeNull();
    expect(parseTimeInput('24:00')).toBeNull();
    expect(parseTimeInput('9:99')).toBeNull();
  });

  it('숫자 사이의 구분자는 무엇이든 걷어낸다', () => {
    // 콜론이 없으면 숫자만 남겨서 읽는다. "9-30"·"9시30분"처럼 쳐도 통하고,
    // 그 대가로 "-1"은 부호가 아니라 그냥 1시로 읽힌다.
    expect(parseTimeInput('9시30분')).toBe('09:30');
    expect(parseTimeInput('-1')).toBe('01:00');
  });

  it('자리수가 안 맞는 숫자 뭉치는 거절한다', () => {
    expect(parseTimeInput('123456')).toBeNull();
  });

  it('출력은 항상 hhmmToMin이 읽을 수 있는 형식이다', () => {
    for (const raw of ['930', '0930', '9:30', '9', '18', '2359']) {
      const parsed = parseTimeInput(raw);
      expect(parsed).not.toBeNull();
      expect(hhmmToMin(parsed!)).not.toBeNull();
    }
  });
});
