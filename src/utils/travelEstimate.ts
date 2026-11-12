/**
 * 이동 구간(leg) 추정 · 체류시간 · 카테고리 판정의 **단일 기준**.
 *
 * ROUTE(동선 편집)와 TIMELINE(날짜별 일정)은 같은 route_days/route_stops 데이터를 보고
 * 같은 숫자를 화면에 보여줘야 한다 — 같은 구간인데 ROUTE는 "18분", TIMELINE은 "20분"으로
 * 보이면 그 자체가 버그다. 그래서 "화면에 뜨는 숫자를 만들어내는 순수 함수"는 전부 여기 모으고
 * 두 모듈이 이걸 import 한다. 아이콘·색·마크업 같은 표현 계층은 각 모듈이 따로 가진다.
 *
 * 원칙 3-1(데이터를 지어내지 않는다): 여기서 만드는 값은 대부분 **추정치**다.
 *   - Routes API 실측이 있으면 `real: true`  → 화면에서 그대로 실측으로 표기
 *   - 없으면 직선거리(Haversine) 기반 추정   → 화면에서 반드시 "추정"으로 표기
 *   - 택시 요금은 Routes API가 주지 않으므로 실측 구간에서도 항상 추정치다
 *   - **요금 추정은 그 나라 실제 요금표를 확인한 통화에서만 한다**(아래 FARE_MODELS). 예전에는 방콕 기준
 *     공식(35 + 6.5×km)을 어느 나라에나 써서, 도쿄 택시 5km가 "¥68"로 나왔다. 모델이 없는 곳은
 *     요금을 지어내지 않고 null — 화면이 "요금 정보 없음"이라고 적는다. 새 나라는 요금표를 확인하고 한 줄씩 더한다.
 */

import { fmtAmountWithCode } from './currencies';

export type TravelMode = 'WALK' | 'TRANSIT' | 'TAXI';

/** 구간 요금 — 실측(대중교통 요금) 또는 요금 모델이 있는 통화의 추정치 */
export interface LegCost {
  amount: number;
  currency: string;
  /** true면 추정(택시 요금은 항상 추정), false면 Routes API가 준 실측 요금 */
  estimated: boolean;
}

export interface Leg {
  mode: TravelMode;
  km: number;
  min: number;
  /** 이 구간에 드는 돈. 도보는 무료라 null이 아니라 `mode === 'WALK'`로 구분하고,
   *  유료 구간인데 요금을 모르면 null이다("무료"와 "모름"을 섞지 않는다). */
  cost: LegCost | null;
  /** true면 Routes API 실측, false면 직선거리 기반 추정치 (원칙 3-1 — 화면에 구분 표기) */
  real: boolean;
  /** 실측 대중교통 요금이 있을 때만 (통화 포함) */
  fare?: { units: number; currency: string };
  /** 실제 도로를 따라가는 좌표(있을 때만) — 없으면 두 지점을 잇는 직선으로 대체 */
  path?: Array<{ lat: number; lng: number }>;
}

/** /api/route-matrix(구간 비교 모드) 응답의 모드별 실측값 */
export interface RealLeg {
  meters: number;
  seconds: number;
  fare?: { units: number; currency: string };
  polyline?: string;
}

/** 직선거리 → 실제 주행거리 보정 계수 */
export const STRAIGHT_TO_ROAD = 1.25;

/* ══════════════ 거리 ══════════════ */

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ══════════════ 구간 추정 ══════════════ */

/**
 * 요금 추정 모델 — **검증된 통화만** 둔다. 값을 아는 나라가 생길 때 한 줄씩 더한다
 * (그 나라 실제 요금표를 확인한 뒤에). 없는 통화는 estimateCost가 null을 돌려준다.
 *
 * THB: 방콕에서 실제로 탄 구간들에 맞춰 잡은 값(택시 기본 35 + km당 6.5, 대중교통 20 + km당 6·상한 62).
 */
interface FareModel {
  /** 택시: 기본요금(포함 거리까지) + 포함 거리를 넘은 만큼 km당 요금 */
  taxiBase: number;
  /** 기본요금에 포함된 거리(km). 생략하면 0 */
  taxiIncludedKm?: number;
  taxiPerKm: number;
  /** 이 거리(km)를 넘으면 요금 체계가 바뀌는 곳 — 확인하지 못한 구간은 추정하지 않는다 */
  taxiMaxKm?: number;
  /** 대중교통: 거리에 비례하는 요금 체계가 확인된 곳만. 없으면 구글이 준 실제 요금만 쓴다 */
  transit?: { base: number; perKm: number; cap: number };
}
const FARE_MODELS: Record<string, FareModel> = {
  THB: { taxiBase: 35, taxiPerKm: 6.5, transit: { base: 20, perKm: 6, cap: 62 } },
  // 일본: 도쿄 23구 택시 — 2026-04 개정 기본 ¥500(1km), 이후 232m마다 ¥100(≈¥431/km). 심야 할증 제외.
  //   다른 도시는 기본요금·증분이 조금 다르다(예: 오사카 ¥600/1.3km). 대중교통은 노선·구간별 요금이라 추정하지 않는다.
  JPY: { taxiBase: 500, taxiIncludedKm: 1, taxiPerKm: 431 },
  // 홍콩: 시내(urban) 택시 — 2024-07 기준 첫 2km HK$29, 이후 200m마다 HK$2.1(≈10.5/km, 9km까지만 확인된 구간).
  HKD: { taxiBase: 29, taxiIncludedKm: 2, taxiPerKm: 10.5, taxiMaxKm: 9 },
  // 대만: 택시 — 첫 1.25km NT$85, 이후 200m마다 NT$5(=25/km). 안내 사이트마다 증분 거리가 달라 참고용. 야간 할증 제외.
  TWD: { taxiBase: 85, taxiIncludedKm: 1.25, taxiPerKm: 25 },
};

/** 이 통화에 요금 추정 모델이 있는가 */
export function hasFareModel(currency: string | null | undefined): boolean {
  return !!currency && currency in FARE_MODELS;
}

/**
 * 요금 모델이 있는 통화에서만 추정 요금을 돌려준다. 도보는 무료라 null.
 * 택시는 모델이 있으면 항상, 대중교통은 거리 비례 모델이 확인된 통화에서만 추정한다.
 */
export function estimateCost(mode: TravelMode, km: number, currency: string | null | undefined): LegCost | null {
  if (mode === 'WALK' || !currency) return null;
  const m = FARE_MODELS[currency];
  if (!m) return null;
  let amount: number;
  if (mode === 'TRANSIT') {
    if (!m.transit) return null;
    amount = Math.min(m.transit.cap, m.transit.base + Math.round(km) * m.transit.perKm);
  } else {
    if (m.taxiMaxKm != null && km > m.taxiMaxKm) return null;
    amount = m.taxiBase + Math.round(Math.max(0, km - (m.taxiIncludedKm ?? 0)) * m.taxiPerKm);
  }
  return { amount, currency, estimated: true };
}

/** 금액을 소수 둘째 자리까지만(2.5유로를 3으로 뭉개지 않는다) */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** `currency`는 이 여행지의 현지 통화(모르면 생략) — 요금 모델이 있을 때만 추정 요금이 붙는다 */
export function legForMode(km: number, mode: TravelMode, currency?: string | null): Leg {
  if (mode === 'WALK') return { mode, km, min: Math.max(2, Math.round(km * 13)), cost: null, real: false };
  if (mode === 'TRANSIT') return { mode, km, min: Math.max(6, Math.round((km / 18) * 60) + 6), cost: estimateCost(mode, km, currency), real: false };
  return { mode, km, min: Math.max(8, Math.round((km / 24) * 60)), cost: estimateCost(mode, km, currency), real: false };
}

/** 앱 내부 모드 ↔ Routes API travelMode */
export function toApiMode(mode: TravelMode): string {
  return mode === 'TAXI' ? 'DRIVE' : mode;
}

/**
 * Google 인코딩 폴리라인(base64 유사 가변길이 인코딩) 디코딩 — 표준 알고리즘.
 * google.maps의 geometry 라이브러리를 추가로 로드하지 않기 위해 직접 구현.
 */
export function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/** 실측 데이터를 Leg로 변환. 택시 요금은 Routes API가 주지 않으므로 요금 모델이 있는 통화에서만 추정한다 */
export function realToLeg(mode: TravelMode, r: RealLeg, currency?: string | null): Leg {
  const km = r.meters / 1000;
  const min = Math.max(1, Math.round(r.seconds / 60));
  const path = r.polyline ? decodePolyline(r.polyline) : undefined;
  if (mode === 'TRANSIT') {
    // 실측 요금이 있으면 그 값과 **그 통화**를 그대로 쓰고(여행지가 어디든 정확), 없으면 요금 모델이 있을 때만 추정
    const cost: LegCost | null = r.fare
      ? { amount: round2(r.fare.units), currency: r.fare.currency, estimated: false }
      : estimateCost(mode, km, currency);
    return { mode, km, min, cost, real: true, fare: r.fare, path };
  }
  if (mode === 'WALK') return { mode, km, min, cost: null, real: true, path };
  return { mode, km, min, cost: estimateCost(mode, km, currency), real: true, path };
}

/* ══════════════ 요금 합계 ══════════════ */

export interface CostSummary {
  amount: number;
  currency: string;
  /** 요금을 아는 구간만 더했다 — 요금을 모르는 유료 구간이 남아 있다 */
  partial: boolean;
  /** 요금을 모르는 유료(도보가 아닌) 구간 수 */
  unknownLegs: number;
  /** 합계에 추정 요금이 하나라도 섞여 있다 */
  estimated: boolean;
}

/**
 * 하루 교통비 합계. **요금을 아는 구간만** 더하고, 모르는 구간이 있으면 partial로 표시한다 —
 * 모르는 구간을 0으로 쳐서 "총 0원"처럼 보이게 하지 않는다. 아는 요금이 하나도 없거나 통화가 섞여
 * 더할 수 없으면 null(화면이 "요금 정보 없음"이라고 적는다).
 */
export function summarizeCosts(legs: ReadonlyArray<Leg | null>): CostSummary | null {
  const paid = legs.filter((l): l is Leg => !!l && l.mode !== 'WALK');
  const known = paid.filter((l) => l.cost != null);
  if (!known.length) return null;
  const currencies = new Set(known.map((l) => l.cost!.currency));
  if (currencies.size > 1) return null;
  const unknownLegs = paid.length - known.length;
  return {
    amount: round2(known.reduce((sum, l) => sum + l.cost!.amount, 0)),
    currency: known[0].cost!.currency,
    partial: unknownLegs > 0,
    unknownLegs,
    estimated: known.some((l) => l.cost!.estimated),
  };
}

/**
 * 이동수단 자동 선택. 실측이 있으면 "도보 15분 이내면 걷고, 아니면 대중교통이 택시보다
 * 심하게 느리지 않은 한 대중교통"이라는 실제 여행자 기준으로 고른다.
 */
export function pickAutoMode(straightKm: number, measured?: Record<string, RealLeg>): TravelMode {
  if (!measured) return straightKm <= 1.0 ? 'WALK' : straightKm <= 6 ? 'TRANSIT' : 'TAXI';
  const walk = measured.WALK;
  const transit = measured.TRANSIT;
  const drive = measured.DRIVE;
  if (walk && walk.seconds <= 15 * 60) return 'WALK';
  if (transit && (!drive || transit.seconds <= drive.seconds * 1.6)) return 'TRANSIT';
  if (drive) return 'TAXI';
  if (transit) return 'TRANSIT';
  if (walk) return 'WALK';
  return straightKm <= 1.0 ? 'WALK' : straightKm <= 6 ? 'TRANSIT' : 'TAXI';
}

/**
 * 두 좌표 사이의 이동 leg.
 * 실측 데이터(Routes API)가 도착해 있으면 그걸 쓰고, 없으면 직선거리 기반 추정치로 폴백한다.
 * 모드는 수동 지정이 있으면 그것을, 없으면 실측 소요시간(없으면 거리)으로 자동 판단한다.
 */
export function estimateLegBetween(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  override?: TravelMode,
  measured?: Record<string, RealLeg>,
  currency?: string | null
): Leg {
  const straightKm = haversineKm(from.lat, from.lng, to.lat, to.lng) * STRAIGHT_TO_ROAD;
  const mode: TravelMode = override ?? pickAutoMode(straightKm, measured);
  const r = measured?.[toApiMode(mode)];
  if (r) return realToLeg(mode, r, currency);
  return legForMode(straightKm, mode, currency);
}

export function legKey(fromId: string, toId: string): string {
  return fromId + '>' + toId;
}

/* ══════════════ 방문 유형 · 체류시간 ══════════════ */

export type CatKey = 'VISIT' | 'FOOD' | 'ACTIVITY' | 'SHOPPING' | 'STAY' | 'AIRPORT';

export const CAT_COLOR: Record<CatKey, string> = {
  VISIT: '#E24B4A', FOOD: '#1D9E75', ACTIVITY: '#7F77DD', SHOPPING: '#F5A623', STAY: '#0B2A5C', AIRPORT: '#2E86C1',
};

export const CAT_LABEL: Record<CatKey, string> = {
  VISIT: '관광', FOOD: '맛집', ACTIVITY: '액티비티', SHOPPING: '쇼핑', STAY: '숙소', AIRPORT: '공항',
};

const SHOPPING_KEYWORDS = ['쇼핑', '마켓', '시장', '백화점', 'mall', 'market', 'shopping'];

/** Brainstorm 게이트(mood) + 구글 카테고리 문자열로 방문 유형을 판정 */
export function catKeyFor(
  mood: string | null,
  category: string | null,
  opts: { isBasecamp?: boolean; isAirport?: boolean } = {}
): CatKey {
  if (opts.isBasecamp) return 'STAY';
  if (opts.isAirport) return 'AIRPORT';
  const cat = (category || '').toLowerCase();
  if (SHOPPING_KEYWORDS.some((k) => cat.includes(k))) return 'SHOPPING';
  if (mood === '먹고싶어') return 'FOOD';
  if (mood === '하고싶어') return 'ACTIVITY';
  return 'VISIT';
}

/** 방문 유형별 기본 체류시간(분) — 실제 데이터가 아니라 참고용 추정치(원칙 3-1) */
export function dwellMinutes(key: CatKey): number {
  switch (key) {
    case 'FOOD': return 75;
    case 'ACTIVITY': return 120;
    case 'SHOPPING': return 60;
    case 'STAY': return 0;
    // 입국심사·수하물 수취(도착) 또는 체크인·보안검색(출발) 여유 — 추정치
    case 'AIRPORT': return 60;
    default: return 60;
  }
}

/* ══════════════ 표기 ══════════════ */

export function modeLabel(mode: TravelMode): string {
  // TRANSIT은 예전에 방콕 기준으로 "BTS·지하철"이라 박혀 있었는데, 다른 여행지에서도
  // 그대로 나오던 버그였다 — 도시마다 실제 수단(지하철/트램/버스 등)이 다르니 무난한
  // 일반 명칭으로 통일.
  return mode === 'WALK' ? '도보' : mode === 'TRANSIT' ? '대중교통' : '택시';
}

export function modeColorClass(mode: TravelMode): string {
  return mode === 'WALK' ? 'walk' : mode === 'TRANSIT' ? 'transit' : 'taxi';
}

/** 구간 요금 한 줄 — "약 276 THB"(추정) / "2.5 EUR"(실측). 도보·요금 모름이면 빈 문자열 */
export function fmtLegCost(cost: LegCost | null): string {
  if (!cost) return '';
  return (cost.estimated ? '약 ' : '') + fmtAmountWithCode(cost.amount, cost.currency);
}

/** 하루 교통비 한 줄. 요금을 모르면 "요금 정보 없음"(0으로 쓰지 않는다), 일부만 알면 모르는 구간 수를 밝힌다 */
export function fmtCostSummary(c: CostSummary | null): string {
  if (!c) return '요금 정보 없음';
  const base = (c.estimated ? '약 ' : '') + fmtAmountWithCode(c.amount, c.currency);
  return c.partial ? base + ' + ' + c.unknownLegs + '구간 미확인' : base;
}

export function fmtMin(min: number): string {
  if (min < 60) return min + '분';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? h + '시간' : h + '시간 ' + m + '분';
}

export function fmtKm(km: number): string {
  return km >= 1 ? km.toFixed(1) + 'km' : Math.round(km * 1000) + 'm';
}

/* ══════════════ 시각 ══════════════ */

/** 자정을 넘어가도 24시간 안으로 접어 "HH:MM"으로 */
export function minToHHMM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

/** "HH:MM" → 자정 기준 분. 형식이 아니면 null */
export function hhmmToMin(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi) || h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/**
 * 사용자가 친 시각 문자열을 24시간 "HH:MM"으로 정규화. "930"·"9:30"·"09:30" 모두 허용하고,
 * 범위를 벗어나거나 해석할 수 없으면 null(→ 호출부가 계산값으로 되돌림).
 */
export function parseTimeInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const digits = s.replace(/[^0-9]/g, '');
  if (!digits) return null; // "abc"처럼 숫자가 하나도 없으면 Number('')===0에 걸리지 않도록 먼저 차단
  let h: number;
  let m: number;
  if (s.includes(':')) {
    const [hs, ms] = s.split(':');
    h = Number(hs);
    m = Number(ms);
  } else if (digits.length === 3) {
    h = Number(digits.slice(0, 1));
    m = Number(digits.slice(1));
  } else if (digits.length === 4) {
    h = Number(digits.slice(0, 2));
    m = Number(digits.slice(2));
  } else if (digits.length <= 2) {
    h = Number(digits);
    m = 0;
  } else {
    return null;
  }
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/**
 * 체류시간 자유 입력 → 분. 화면이 보여준 형식("1시간 30분")을 그대로 다시 입력해도,
 * "90"(분으로 해석)이나 "1:30"(시:분)으로 입력해도 받아준다.
 * 형식이 안 맞으면 null — 호출부가 조용히 되돌린다(.tl-time과 같은 관례).
 */
export function parseDwellInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.includes(':')) {
    const [hs, ms] = s.split(':');
    const h = Number(hs);
    const m = Number(ms);
    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0 || m > 59) return null;
    return Math.round(h * 60 + m);
  }
  const hourMatch = s.match(/(\d+)\s*시간/);
  const minMatch = s.match(/(\d+)\s*분/);
  if (hourMatch || minMatch) {
    const h = hourMatch ? Number(hourMatch[1]) : 0;
    const m = minMatch ? Number(minMatch[1]) : 0;
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    const total = h * 60 + m;
    return total >= 0 && total <= 1440 ? total : null;
  }
  // 다른 단위 표시가 전혀 없으면 순수 숫자를 "분"으로 해석 (예: "90" → 90분)
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 1440 ? n : null;
}
