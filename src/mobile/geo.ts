/**
 * GPS 현재 위치 → "지금 어느 정류지에 있나" 판정.
 *
 * 이 파일의 **판정 부분은 순수 함수**다(네트워크·권한·타이머 없음). GPS가 얽힌 코드는
 * 실기기 없이 돌려보기 어려운데, 틀린 판정은 곧 틀린 도착 기록이 되고 그건 `scheduleFor`를
 * 통해 **그날 남은 일정 전체를 밀어버린다.** 그래서 판정만 떼어 테스트 가능하게 둔다.
 *
 * ── 왜 반경을 하나로 두면 안 되는가 ────────────────────────
 * 공항은 가로세로 몇 km고 편의점은 20m다. 반경을 공항에 맞추면 시내에서 엉뚱한 곳이 잡히고,
 * 편의점에 맞추면 공항 한가운데 서 있어도 "도착"이 안 뜬다. 그래서 **카테고리별 반경**을 쓴다.
 *
 * ── 왜 정확도(accuracy)를 같이 보는가 ──────────────────────
 * 실내·지하에서는 오차가 수백 m까지 벌어진다. 오차가 반경보다 크면 "안에 있다"고 말할 근거가
 * 없으므로, 반경에 오차를 더해 판단하되 **오차가 너무 크면 아예 판정하지 않는다**(원칙 3-1).
 */

import type { CatKey } from '../utils/travelEstimate';

export interface GeoFix {
  lat: number;
  lng: number;
  /** 추정 오차 반경(m). Geolocation API의 coords.accuracy */
  accuracyM: number;
}

export interface GeoCandidate {
  key: string;
  lat: number;
  lng: number;
  cat: CatKey;
}

export interface GeoMatch {
  key: string;
  /** 그 정류지까지의 거리(m) */
  meters: number;
}

/**
 * 카테고리별 "여기 있다"고 볼 반경(m).
 * 공항은 터미널 전체가 하나의 정류지라 크게, 식당·편의점은 좁게 잡는다.
 */
export function radiusFor(cat: CatKey): number {
  switch (cat) {
    case 'AIRPORT': return 2000; // 터미널·주차장까지 포함
    case 'STAY': return 200;     // 호텔 부지
    case 'SHOPPING': return 250; // 백화점·시장은 넓다
    case 'ACTIVITY': return 200;
    case 'VISIT': return 200;    // 사원·공원도 꽤 넓다
    case 'FOOD': return 120;
  }
}

/** 오차가 이보다 크면 판정을 포기한다 — 이쯤 되면 "시내 어딘가" 수준이다 */
export const MAX_ACCURACY_M = 1000;

/** 두 좌표 사이 거리(m) — 하버사인. utils/travelEstimate의 haversineKm와 같은 식이다. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 지금 위치가 어느 정류지인지. **확신이 없으면 null**이다.
 *
 * 판정 규칙:
 *   1. 오차가 MAX_ACCURACY_M를 넘으면 포기한다
 *   2. 각 후보의 (카테고리 반경 + 오차) 안에 드는 것만 남긴다
 *   3. 그중 가장 가까운 하나를 고르되, **2등이 애매하게 가까우면 포기한다** —
 *      나란히 붙은 두 식당을 GPS로 가를 수는 없고, 찍어 맞히면 틀린 기록이 남는다
 */
export function matchStop(fix: GeoFix, candidates: GeoCandidate[]): GeoMatch | null {
  if (!Number.isFinite(fix.accuracyM) || fix.accuracyM > MAX_ACCURACY_M) return null;
  if (!candidates.length) return null;

  const scored = candidates
    .map((c) => ({ c, d: distanceM(fix, c) }))
    .sort((x, y) => x.d - y.d);

  const inside = scored.filter(({ c, d }) => d <= radiusFor(c.cat) + fix.accuracyM);
  if (!inside.length) return null;

  const best = inside[0];
  const second = inside[1];
  // 2등이 1등의 1.6배보다 가까우면 둘을 구분할 근거가 없다고 본다
  if (second && second.d < best.d * 1.6) return null;

  return { key: best.c.key, meters: Math.round(best.d) };
}

/* ══════════════ 위치 구독 (I/O) ══════════════ */

let watchId: number | null = null;

export function isGeoSupported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/**
 * 위치 구독 시작. 권한 요청이 여기서 일어나므로 **반드시 사용자 제스처 안에서** 불러야 한다
 * (버튼 없이 자동으로 물으면 대부분 거절당하고, 그 뒤로는 다시 물을 수도 없다).
 *
 * `enableHighAccuracy: false` — 어느 정류지인지 가리는 데는 수십~수백 m면 충분하고,
 * 고정밀 GPS를 계속 켜 두면 배터리를 많이 먹는다. 여행 중 배터리는 생명줄이다.
 */
export function startWatch(
  onFix: (fix: GeoFix) => void,
  onError: (message: string) => void
): boolean {
  if (!isGeoSupported()) {
    onError('이 브라우저에서는 위치를 쓸 수 없어요');
    return false;
  }
  stopWatch();
  watchId = navigator.geolocation.watchPosition(
    (pos) => onFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
    (err) => {
      onError(
        err.code === err.PERMISSION_DENIED
          ? '위치 권한이 꺼져 있어요'
          : err.code === err.POSITION_UNAVAILABLE
            ? '지금은 위치를 못 찾았어요'
            : '위치 확인이 오래 걸려요'
      );
    },
    { enableHighAccuracy: false, maximumAge: 30_000, timeout: 20_000 }
  );
  return true;
}

export function stopWatch(): void {
  if (watchId != null && isGeoSupported()) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

export function isWatching(): boolean {
  return watchId != null;
}
