/**
 * IDEAS 지도 펜 — DOM·지도를 모르는 계산만 모았다(penModel.test.ts).
 *
 *  · 사람마다 고유색: 여행에 들어온 순서대로 팔레트에서 하나씩. 8명까지 겹치지 않는다.
 *    (보드의 게이트 핀 색 빨강·초록·보라·파랑과 헷갈리지 않는 색으로 골랐다)
 *  · 선은 지도 좌표로 저장한다 — 그대로면 마우스 이동마다 점이 생겨 수백 개가 되므로 모양을 유지하며 줄인다.
 *  · 거리는 사용자 결정대로 **직선거리**(그은 선의 시작점 ↔ 끝점)다. 실제 길 거리가 아니다.
 */

export type LatLng = [number, number];

export const PEN_PALETTE = ['#F97316', '#0EA5E9', '#DB2777', '#65A30D', '#7C3AED', '#0F766E', '#CA8A04', '#475569'] as const;

/** 고정 선 두께(px) */
export const PEN_WIDTH = 4;

/** 저장할 수 있는 최대 점 수(SQL 체크와 같다) */
export const PEN_MAX_POINTS = 500;

export interface MemberLike {
  user_id: string | null;
  joined_at?: string | null;
}

/** 멤버 → 색. 들어온 순서(joined_at) 기준이라 모든 사람 화면에서 같은 색이 나온다 */
export function memberColors(members: readonly MemberLike[]): Map<string, string> {
  const sorted = [...members]
    .filter((m): m is MemberLike & { user_id: string } => !!m.user_id)
    .sort((a, b) => (a.joined_at ?? '').localeCompare(b.joined_at ?? '') || a.user_id.localeCompare(b.user_id));
  const out = new Map<string, string>();
  sorted.forEach((m) => {
    if (!out.has(m.user_id)) out.set(m.user_id, PEN_PALETTE[out.size % PEN_PALETTE.length]);
  });
  return out;
}

/** 두 좌표 사이 직선거리(m) — 하버사인 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 선의 직선거리 — 시작점과 끝점 사이 */
export function straightDistance(path: readonly LatLng[]): number {
  if (path.length < 2) return 0;
  return haversineMeters(path[0], path[path.length - 1]);
}

/** 거리 표시 — 1km 미만은 10m 단위, 그 이상은 0.1km(10km 넘으면 1km) */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '0m';
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)}m`;
  if (m < 10_000) return `${(m / 1000).toFixed(1)}km`;
  return `${Math.round(m / 1000)}km`;
}

/** 점과 선분 사이 거리(평면 근사, 단위는 입력과 같다) */
function segDist(p: LatLng, a: LatLng, b: LatLng, kx: number): number {
  const ax = a[1] * kx, ay = a[0], bx = b[1] * kx, by = b[0], px = p[1] * kx, py = p[0];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * 모양을 유지하며 점을 줄인다(Douglas–Peucker). tolerance는 위도 기준 도(°) 단위 —
 * 그리는 순간의 지도 확대 수준에 맞춰 화면 1~2px 정도로 넘긴다. 경도는 위도에 따라 줄어드는 만큼 보정한다.
 * 그래도 너무 많으면 tolerance를 키워 PEN_MAX_POINTS 이하로 맞춘다.
 */
export function simplifyPath(path: readonly LatLng[], tolerance: number): LatLng[] {
  const pts = path.filter((p, i) => i === 0 || p[0] !== path[i - 1][0] || p[1] !== path[i - 1][1]);
  if (pts.length <= 2) return pts.map((p) => [p[0], p[1]] as LatLng);
  const kx = Math.cos((pts[0][0] * Math.PI) / 180);
  const run = (tol: number): LatLng[] => {
    const keep = new Uint8Array(pts.length);
    keep[0] = 1;
    keep[pts.length - 1] = 1;
    const stack: Array<[number, number]> = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop()!;
      let maxD = -1, idx = -1;
      for (let i = s + 1; i < e; i++) {
        const d = segDist(pts[i], pts[s], pts[e], kx);
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (idx !== -1 && maxD > tol) {
        keep[idx] = 1;
        stack.push([s, idx], [idx, e]);
      }
    }
    return pts.filter((_, i) => keep[i]).map((p) => [round6(p[0]), round6(p[1])] as LatLng);
  };
  let tol = Math.max(tolerance, 0);
  let out = run(tol);
  while (out.length > PEN_MAX_POINTS) {
    tol = tol > 0 ? tol * 2 : 1e-6;
    out = run(tol);
  }
  return out;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** 서버에서 받은 path가 올바른 모양인가 — 깨진 행은 그리지 않는다 */
export function isValidPath(v: unknown): v is LatLng[] {
  return Array.isArray(v) && v.length >= 2 && v.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
}
