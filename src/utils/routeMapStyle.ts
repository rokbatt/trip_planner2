/**
 * 지도 위 "하루 동선" 그리기 — ROUTE · TIMELINE · 휴대폰 지도가 함께 쓰는 단일 기준.
 *
 * 세 화면이 같은 하루를 보여 주므로 선과 핀도 똑같아야 한다(한 곳만 바꾸면 화면마다 달라진다).
 * 여기엔 색·굵기·모양과 SVG 마커 생성만 있고, 지도 API는 호출부가 넘기는 `g`(window.google)로만 쓴다.
 *
 *  - 경로선: 일렉트릭 블루 6.8px + 한 톤 진한 테두리 + 흰 진행 방향 화살표
 *  - 출발(그날 첫 정류지) 초록 핀 / 도착(마지막) 빨강 핀 — 흰 테두리, 아래 흰 점이 실제 위치를 짚는다
 *  - 중간 경유지: 흰 원 + 진한 파랑 테두리·번호
 *  - "숙소 들르기": 위치와 상관없이 바이올렛 원 + 숙소 아이콘
 */

import type { CatKey } from './travelEstimate';

export const ROUTE_LINE_COLOR = '#1E7BFF';
export const ROUTE_LINE_CASING = '#0A4FB8';
// 8px에서 15% 줄인 값(사용자 요청)
export const ROUTE_LINE_WEIGHT = 6.8;
/** 경로선 바깥 테두리 두께(선 양쪽 합) */
export const ROUTE_CASING_EXTRA = 2.55;
export const START_GREEN = '#16A34A';
export const END_RED = '#E5383B';
export const STOP_RING = '#0A4FB8';
export const ROUTE_GRAY = '#9AA7B8';
/** "숙소 들르기"(짐 두기 등 목적만 있는 재방문 스탑) 전용 — 다른 강조색과 안 겹치는 바이올렛 */
export const LODGING_REVISIT_COLOR = '#7C5CFC';
/** 지도 핀 꼬리 길이 / 머리 반지름 */
export const PIN_TAIL_RATIO = 1.5;

/** 그날 동선 안에서의 자리 — 첫 정류지(출발) / 마지막(도착) / 그 사이(경유). 정류지가 하나면 출발 */
export type StopRole = 'start' | 'end' | 'mid';
export function stopRole(index: number, count: number): StopRole {
  if (index === 0) return 'start';
  if (index === count - 1) return 'end';
  return 'mid';
}
export function stopRoleColor(role: StopRole): string {
  return role === 'start' ? START_GREEN : role === 'end' ? END_RED : STOP_RING;
}

/* ── 아이콘 (24×24 선 아이콘) ── */
const svg24 = (body: string, extra = '') =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"' + extra + '>' + body + '</svg>';
export const MAP_ICON_LODGING = svg24(
  '<path d="M4 21V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15"/><path d="M15 21v-8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v8"/><path d="M7.5 7.5h1M7.5 11h1M7.5 14.5h1M11.5 7.5h1M11.5 11h1M11.5 14.5h1M17.5 14.5h1M17.5 17.5h1"/><path d="M2 21h20"/>'
);
/** 출발·도착 핀 안에 들어가는 장소 종류 아이콘 */
export const MAP_CAT_ICON: Record<CatKey, string> = {
  VISIT: svg24('<path d="M3 21h18M4 21V10M20 21V10M2 10l10-6 10 6M6 10v7M10 10v7M14 10v7M18 10v7"/>'),
  FOOD: svg24('<path d="M7 2v7a2 2 0 0 0 2 2v11M7 2v7M9 2v7M11 2v7M16 2c-1.5 0-3 1.5-3 4s1.5 4 3 4v10"/>'),
  ACTIVITY: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
  SHOPPING: svg24('<path d="M6 8h12l1 12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  STAY: svg24('<path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 18v2M21 18v2M3 12V8a2 2 0 0 1 2-2h4v6"/>'),
  AIRPORT: svg24('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>'),
};

/* ── SVG 조각 ── */
export function iconInner(svg: string): string {
  return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
}

/** 반지름 r인 원(중심 cx,cy)에 외부 접선 두 개를 그어 tip에서 만나는 "물방울(핀)" 윤곽 경로 */
export function pinTearPath(cx: number, cy: number, r: number, tipY: number): string {
  const d = tipY - cy;
  const phi = Math.acos(r / d);
  const t1x = cx + r * Math.cos(Math.PI / 2 - phi);
  const t1y = cy + r * Math.sin(Math.PI / 2 - phi);
  const t2x = cx + r * Math.cos(Math.PI / 2 + phi);
  const t2y = cy + r * Math.sin(Math.PI / 2 + phi);
  return 'M' + t1x + ' ' + t1y + ' A' + r + ' ' + r + ' 0 1 0 ' + t2x + ' ' + t2y + ' L' + cx + ' ' + tipY + ' Z';
}

/** 24×24 선 아이콘을 (cx,cy) 중심, 한 변 size 픽셀로 그린다 */
export function markerIconSvg(icon: string, cx: number, cy: number, size: number, color: string, strokeWidth: number): string {
  return '<g transform="translate(' + (cx - size / 2) + ',' + (cy - size / 2) + ') scale(' + size / 24 + ')" color="' + color +
    '" fill="none" stroke="currentColor" stroke-width="' + strokeWidth + '" stroke-linecap="round" stroke-linejoin="round">' +
    iconInner(icon) + '</g>';
}

/** 선택된 마커만 같은 색의 옅은 동심원으로 강조 */
export function markerHaloSvg(cx: number, cy: number, r: number, color: string): string {
  return '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r + 9) + '" fill="' + color + '" fill-opacity="0.12"/>' +
    '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r + 4.5) + '" fill="' + color + '" fill-opacity="0.1"/>';
}

/** 핀 실루엣 + 바깥쪽에만 흰 테두리(흰 실루엣을 굵은 선으로 먼저 깔고 그 위에 색 핀). outline 0이면 테두리 없음 */
export function outlinedPinSvg(cx: number, headCy: number, r: number, tipY: number, fill: string, outline: number): string {
  const d = pinTearPath(cx, headCy, r, tipY);
  const under = outline > 0
    ? '<path d="' + d + '" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="' + outline * 2 + '" stroke-linejoin="round"/>'
    : '';
  return under + '<path d="' + d + '" fill="' + fill + '"/>';
}

/* ── 마커 ── */
export interface SvgMarker {
  svg: string;
  w: number;
  h: number;
  /** 지도 좌표가 가리키는 점(앵커) */
  ax: number;
  ay: number;
}

/** 지도 API Marker의 icon 옵션으로 */
export function svgMarkerIcon(g: any, m: SvgMarker): any {
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(m.svg),
    scaledSize: new g.maps.Size(m.w, m.h),
    anchor: new g.maps.Point(m.ax, m.ay),
  };
}

function wrap(body: string, w: number, h: number): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + body + '</svg>';
}

/** 출발·도착 핀 — 흰 아이콘 + 흰 테두리 핀이 실제 위치를 짚는 흰 점 위에 살짝 떠 있다(경로선은 점에 닿는다).
 *  scale은 줌·선택에 따른 배율(1 = 기준 크기) */
export function endpointPinMarker(opts: { color: string; icon: string; scale: number; highlighted?: boolean }): SvgMarker {
  const pad = opts.highlighted ? 26 : 6;
  const r = 15 * 1.12 * opts.scale;
  const outline = r * 0.16;
  const tail = r * PIN_TAIL_RATIO;
  const gap = r * 0.3;
  const dotR = r * 0.38;
  const dotRing = r * 0.18;
  const w = Math.ceil((r + outline) * 2 + pad);
  const ax = w / 2;
  const headCy = pad / 2 + outline + r;
  const tipY = headCy + tail;
  const ay = tipY + gap + dotR;
  const h = Math.ceil(ay + dotR + pad / 2);
  const body =
    (opts.highlighted ? markerHaloSvg(ax, headCy, r, opts.color) : '') +
    outlinedPinSvg(ax, headCy, r, tipY, opts.color, outline) +
    markerIconSvg(opts.icon, ax, headCy, r * 0.9, '#FFFFFF', 2.6) +
    '<circle cx="' + ax + '" cy="' + ay + '" r="' + (dotR - dotRing / 2) + '" fill="#FFFFFF" stroke="' + opts.color +
    '" stroke-width="' + dotRing + '"/>';
  return { svg: wrap(body, w, h), w, h, ax, ay };
}

/** 중간 경유지 원 — 흰 원 + 색 테두리·번호. icon을 주면(숙소 들르기) 색을 채운 원 + 흰 아이콘 */
export function stopCircleMarker(opts: { color: string; num?: number | null; icon?: string; scale: number; highlighted?: boolean }): SvgMarker {
  const pad = opts.highlighted ? 26 : 6;
  const rc = 15 * 0.75 * opts.scale;
  const ring = Math.max(2, rc * 0.3);
  const outerR = rc + ring / 2;
  const w = Math.ceil(outerR * 2 + pad);
  const ax = w / 2;
  const fontSize = Math.round(rc * 1.05);
  const body =
    (opts.highlighted ? markerHaloSvg(ax, ax, outerR, opts.color) : '') +
    (opts.icon
      ? '<circle cx="' + ax + '" cy="' + ax + '" r="' + outerR + '" fill="#FFFFFF"/>' +
        '<circle cx="' + ax + '" cy="' + ax + '" r="' + (outerR - 1.5) + '" fill="' + opts.color + '"/>' +
        markerIconSvg(opts.icon, ax, ax, rc * 1.1, '#FFFFFF', 2.2)
      : '<circle cx="' + ax + '" cy="' + ax + '" r="' + rc + '" fill="#FFFFFF" stroke="' + opts.color + '" stroke-width="' + ring + '"/>' +
        '<text x="' + ax + '" y="' + (ax + fontSize * 0.36) + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="' +
        fontSize + '" font-weight="800" fill="' + opts.color + '">' + (opts.num ?? '') + '</text>');
  return { svg: wrap(body, w, w), w, h: w, ax, ay: ax };
}

/** 하루 동선 한 정류지의 마커 — 자리(출발/도착/경유)와 숙소 들르기 여부로 모양·색을 고른다 */
export function routeStopMarker(opts: {
  role: StopRole;
  /** 자리 기본색 대신 쓸 색(진행 상태 강조 등). 없으면 stopRoleColor(role) */
  color?: string;
  catIcon: string;
  num?: number | null;
  isRevisit?: boolean;
  scale: number;
  highlighted?: boolean;
}): SvgMarker {
  const color = opts.isRevisit ? LODGING_REVISIT_COLOR : opts.color ?? stopRoleColor(opts.role);
  if (opts.role !== 'mid') {
    return endpointPinMarker({ color, icon: opts.isRevisit ? MAP_ICON_LODGING : opts.catIcon, scale: opts.scale, highlighted: opts.highlighted });
  }
  return stopCircleMarker({
    color,
    num: opts.num,
    icon: opts.isRevisit ? MAP_ICON_LODGING : undefined,
    scale: opts.scale,
    highlighted: opts.highlighted,
  });
}

/* ── 경로선 ── */
export type LatLngLit = { lat: number; lng: number };

/**
 * 추정 구간(실제 도로 경로가 없는 직선)을 부드러운 호로 바꾼다.
 * 실측 경로에는 절대 적용하지 않는다 — 실제 도로 좌표를 곡선으로 다듬으면 없는 길을 지나가는
 * 것처럼 보여 데이터를 왜곡한다(원칙 3-1). @param bend 구간 길이 대비 최대 부풀림 비율. 0이면 직선.
 */
export function arcBetween(a: LatLngLit, b: LatLngLit, bend: number): LatLngLit[] {
  const SEGMENTS = 24;
  const latScale = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180) || 1;
  const dx = (b.lng - a.lng) * latScale;
  const dy = b.lat - a.lat;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [a, b];
  const mx = (a.lng + b.lng) / 2;
  const my = (a.lat + b.lat) / 2;
  const off = len * bend;
  const cx = mx + ((-dy / len) * off) / latScale;
  const cy = my + (dx / len) * off;
  const pts: LatLngLit[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const u = 1 - t;
    pts.push({
      lng: u * u * a.lng + 2 * u * t * cx + t * t * b.lng,
      lat: u * u * a.lat + 2 * u * t * cy + t * t * b.lat,
    });
  }
  return pts;
}

/** 실측 도로 경로가 있으면 그대로, 없으면 두 점을 잇는 부드러운 호 */
export function legPathOrArc(from: LatLngLit, to: LatLngLit, realPath?: LatLngLit[] | null): LatLngLit[] {
  return realPath && realPath.length >= 2 ? realPath : arcBetween(from, to, 0.12);
}

/**
 * 경로선 한 구간 = 진한 테두리 선 위에 굵은 본선 + 흰 진행 방향 화살표(Polyline icons repeat).
 * 화살표는 지도 API가 선을 따라 직접 그리는 기호라 추가 요청·비용이 없다.
 * 클릭은 본선(main)만 받는다 — 테두리는 clickable:false.
 */
export function drawRouteLeg(
  g: any,
  map: any,
  path: LatLngLit[],
  opts: { selected?: boolean; dimmed?: boolean; zIndex?: number } = {}
): { casing: any; main: any } {
  const opacity = opts.dimmed ? 0.45 : 1;
  const weight = opts.selected ? ROUTE_LINE_WEIGHT + 1 : ROUTE_LINE_WEIGHT;
  const z = opts.zIndex ?? (opts.selected ? 12 : 10);
  const casing = new g.maps.Polyline({
    map,
    path,
    geodesic: true,
    strokeColor: opts.dimmed ? ROUTE_GRAY : ROUTE_LINE_CASING,
    strokeOpacity: opacity,
    strokeWeight: weight + ROUTE_CASING_EXTRA,
    clickable: false,
    zIndex: z - 1,
  });
  const main = new g.maps.Polyline({
    map,
    path,
    geodesic: true,
    strokeColor: opts.dimmed ? ROUTE_GRAY : ROUTE_LINE_COLOR,
    strokeOpacity: opacity,
    strokeWeight: weight,
    zIndex: z,
    // 흐려진(포커스 밖) 구간엔 화살표를 빼서 강조된 구간이 더 또렷하게
    icons: opts.dimmed
      ? []
      : [{
          icon: { path: g.maps.SymbolPath.FORWARD_OPEN_ARROW, scale: 2, strokeColor: '#FFFFFF', strokeOpacity: 0.95, strokeWeight: 2 },
          offset: '24px',
          repeat: '56px',
        }],
  });
  return { casing, main };
}
