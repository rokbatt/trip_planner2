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
 */

export type TravelMode = 'WALK' | 'TRANSIT' | 'TAXI';

export interface Leg {
  mode: TravelMode;
  km: number;
  min: number;
  costTHB: number;
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

export function legForMode(km: number, mode: TravelMode): Leg {
  if (mode === 'WALK') return { mode, km, min: Math.max(2, Math.round(km * 13)), costTHB: 0, real: false };
  if (mode === 'TRANSIT') return { mode, km, min: Math.max(6, Math.round((km / 18) * 60) + 6), costTHB: Math.min(62, 20 + Math.round(km) * 6), real: false };
  return { mode, km, min: Math.max(8, Math.round((km / 24) * 60)), costTHB: 35 + Math.round(km * 6.5), real: false };
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

/** 실측 데이터를 Leg로 변환. 택시 요금은 Routes API가 주지 않으므로 거리 기반 추정 유지 */
export function realToLeg(mode: TravelMode, r: RealLeg): Leg {
  const km = r.meters / 1000;
  const min = Math.max(1, Math.round(r.seconds / 60));
  const path = r.polyline ? decodePolyline(r.polyline) : undefined;
  if (mode === 'TRANSIT') {
    // 실측 요금이 있으면 그 값을, 없으면 거리 기반 추정치를 쓴다(추정 여부는 fare 유무로 구분).
    const costTHB = r.fare ? Math.round(r.fare.units) : Math.min(62, 20 + Math.round(km) * 6);
    return { mode, km, min, costTHB, real: true, fare: r.fare, path };
  }
  if (mode === 'WALK') return { mode, km, min, costTHB: 0, real: true, path };
  return { mode, km, min, costTHB: 35 + Math.round(km * 6.5), real: true, path };
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
  measured?: Record<string, RealLeg>
): Leg {
  const straightKm = haversineKm(from.lat, from.lng, to.lat, to.lng) * STRAIGHT_TO_ROAD;
  const mode: TravelMode = override ?? pickAutoMode(straightKm, measured);
  const r = measured?.[toApiMode(mode)];
  if (r) return realToLeg(mode, r);
  return legForMode(straightKm, mode);
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
