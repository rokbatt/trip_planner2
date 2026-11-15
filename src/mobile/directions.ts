/**
 * 길찾기 링크(Google Maps) 만들기 — 출발지는 **기본이 현재 위치**다.
 *
 * Google Maps의 길찾기 주소에서 출발지(origin)를 비우면 링크를 연 기기의 현재 위치가 출발지가 된다.
 * 그래서 기본값은 "넣지 않는다"이고, 사용자가 직접 바꿨을 때만(숙소에서 출발, 이전 장소에서 출발,
 * 직접 입력) origin을 붙인다. 바꾼 출발지는 그 한 번에만 쓴다 — 다음 길찾기는 다시 현재 위치.
 * 주소 조합뿐이라 API 비용이 없다(원칙 3-2).
 */

export type TravelHint = 'walking' | 'transit' | 'driving' | null;

export interface DirPoint {
  name: string;
  lat?: number | null;
  lng?: number | null;
}

export type Origin =
  | { kind: 'here' }
  | { kind: 'point'; label: string; point: DirPoint }
  | { kind: 'text'; text: string };

/** 좌표가 둘 다 있으면 좌표, 아니면 이름 */
export function pointParam(p: DirPoint): string {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) ? p.lat + ',' + p.lng : p.name;
}

export function directionsUrl(dest: DirPoint, mode: TravelHint = null, origin: Origin = { kind: 'here' }): string {
  let url = 'https://www.google.com/maps/dir/?api=1';
  if (origin.kind === 'point') url += '&origin=' + encodeURIComponent(pointParam(origin.point));
  else if (origin.kind === 'text' && origin.text.trim()) url += '&origin=' + encodeURIComponent(origin.text.trim());
  url += '&destination=' + encodeURIComponent(pointParam(dest));
  if (mode) url += '&travelmode=' + mode;
  return url;
}

/**
 * 출발지 후보 — 현재 위치가 항상 첫 번째. 숙소·이전 장소는 **있을 때만**(원칙 3-1).
 * 목적지와 같은 곳은 후보에서 뺀다(숙소로 가는 길에 "숙소에서 출발"은 의미가 없다).
 */
export function originChoices(opts: { dest: DirPoint; prev?: DirPoint | null; stay?: DirPoint | null }): Origin[] {
  const same = (a: DirPoint, b: DirPoint) => pointParam(a) === pointParam(b);
  const out: Origin[] = [{ kind: 'here' }];
  if (opts.stay && !same(opts.stay, opts.dest)) out.push({ kind: 'point', label: '숙소', point: opts.stay });
  if (opts.prev && !same(opts.prev, opts.dest) && !(opts.stay && same(opts.prev, opts.stay))) {
    out.push({ kind: 'point', label: '이전 장소', point: opts.prev });
  }
  return out;
}
