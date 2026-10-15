/**
 * "숙소 들르기" 정류지에 그 숙소의 실제 장소 정보를 붙인다 — 모바일 표시용.
 *
 * ROUTE의 "숙소 들르기"(짐 두기 등)는 실제 places 행을 가리키지 않는다. 그 순간의 숙소를 복사한
 * 합성 지점이라 **이름과 좌표만**(custom_name/custom_lat/custom_lng) 저장되고 place_id는 비어 있다.
 * 그래서 화면에서는 사진·주소가 없는 빈 카드로 나왔다(실제 버그).
 *
 * 숙소는 이미 우리 DB에 있는 장소(stay_segments.basecamp_place_id)이므로 그 행을 찾아 붙이면
 * 사진·주소·상세 정보를 **지어내지 않고** 보여줄 수 있다. 찾는 순서:
 *   1) 숙소(basecamp)로 지정된 장소 중 이름이 같은 곳
 *   2) 숙소 중 좌표가 100m 안인 가장 가까운 곳 (이름을 나중에 고친 경우)
 *   3) 숙소가 아니어도 이름이 정확히 같은 장소
 * 못 찾으면 그대로 둔다(빈 카드 대신 화면이 숙소 아이콘으로 그린다).
 *
 * 카테고리(`cat`)는 바꾸지 않는다 — 체류시간 기본값이 cat에 달려 있어서, 바꾸면 PC TIMELINE과
 * 일정 시각이 어긋난다. 바꾸는 건 표시용 `place` 하나뿐이다.
 */

import type { TlDay, TlStop } from '../timeline/dayModel';
import { distanceM } from './geo';
import type { Database } from '../types/database';

type Place = Database['public']['Tables']['places']['Row'];

const NEAR_M = 100;

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

export function findRevisitPlace(
  stop: TlStop,
  placeById: Map<string, Place>,
  basecampIds: Set<string>
): Place | null {
  if (!stop.purpose || stop.place) return null;
  const name = norm(stop.customName ?? stop.name);
  const camps = [...basecampIds].map((id) => placeById.get(id)).filter((p): p is Place => !!p);

  const byName = camps.find((p) => name && norm(p.name) === name);
  if (byName) return byName;

  if (stop.lat != null && stop.lng != null) {
    const here = { lat: stop.lat, lng: stop.lng };
    let best: { p: Place; d: number } | null = null;
    for (const p of camps) {
      if (p.lat == null || p.lng == null) continue;
      const d = distanceM(here, { lat: p.lat, lng: p.lng });
      if (d <= NEAR_M && (!best || d < best.d)) best = { p, d };
    }
    if (best) return best.p;
  }

  if (!name) return null;
  for (const p of placeById.values()) if (norm(p.name) === name) return p;
  return null;
}

/** 모든 DAY의 "숙소 들르기" 정류지에 숙소 장소를 붙인 **새 배열**을 돌려준다(원본은 그대로) */
export function attachRevisitPlaces(
  days: TlDay[],
  placeById: Map<string, Place>,
  basecampIds: Set<string>
): TlDay[] {
  return days.map((day) => {
    if (!day.stops.some((st) => st.purpose && !st.place)) return day;
    return {
      ...day,
      stops: day.stops.map((st) => {
        const place = findRevisitPlace(st, placeById, basecampIds);
        return place ? { ...st, place } : st;
      }),
    };
  });
}
