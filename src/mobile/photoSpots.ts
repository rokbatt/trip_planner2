/**
 * 주변 탭 "인생샷" — AI가 웹 검색으로 찾은 사진 명소 이름을 **실제 Google 장소로 확인**해 보여 준다.
 *
 * 1) 서버(`/api/ai` kind 'photo-spots')가 이름·이유·출처를 준다(웹 검색, 14일 캐시).
 * 2) 이름마다 Google 장소 검색(브라우저, 기준점 근처)으로 실제 장소를 찾는다 — 못 찾거나 너무 멀면 버린다(원칙 3-1).
 * 3) 사진·거리·영업 정보는 Google 장소 값 그대로, "왜 인생샷인지"는 AI 설명이라고 밝혀서 보여 준다.
 * 인스타그램은 공식 API로 위치 검색을 할 수 없어서, 장소 이름 해시태그 화면을 여는 링크만 준다.
 */
import { apiFetch } from '../utils/apiFetch';
import { searchText, type ExplorePlace } from './exploreApi';
import { straightMeters } from './explore';

export interface SpotInfo {
  reason: string;
}
export interface SpotSource {
  title: string;
  uri: string;
}
export interface PhotoSpotResult {
  places: ExplorePlace[];
  info: Map<string, SpotInfo>;
  sources: SpotSource[];
}

/** AI가 준 이름이 이만큼보다 멀리 있는 장소로 잡히면 같은 이름의 다른 곳이다 — 버린다 */
export const SPOT_MAX_METERS = 6000;

/** 장소 이름 → 인스타그램 해시태그 화면(글자·숫자만 남긴다). 남는 글자가 없으면 null */
export function instagramTagUrl(name: string): string | null {
  const tag = name.normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '');
  if (!tag) return null;
  return 'https://www.instagram.com/explore/tags/' + encodeURIComponent(tag) + '/';
}

export async function searchPhotoSpots(center: { lat: number; lng: number }, city: string, keyword = ''): Promise<PhotoSpotResult> {
  const res = await apiFetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'photo-spots', lat: center.lat, lng: center.lng, city, keyword }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || '인생샷 장소를 찾지 못했어요.');

  const spots: Array<{ name: string; reason: string }> = Array.isArray(json?.spots) ? json.spots : [];
  const sources: SpotSource[] = Array.isArray(json?.sources) ? json.sources : [];
  const places: ExplorePlace[] = [];
  const info = new Map<string, SpotInfo>();

  for (const s of spots) {
    if (typeof s?.name !== 'string' || !s.name.trim()) continue;
    try {
      const found = await searchText('spot:' + s.name + ':' + center.lat.toFixed(3) + ',' + center.lng.toFixed(3), s.name, center, 3000);
      const near = found
        .map((p) => ({ p, d: straightMeters(center, p) }))
        .filter((x) => x.d <= SPOT_MAX_METERS)
        .sort((a, b) => a.d - b.d)[0];
      if (!near || info.has(near.p.id)) continue;
      places.push({ ...near.p, meters: near.d });
      info.set(near.p.id, { reason: String(s.reason ?? '').slice(0, 80) });
    } catch {
      // 하나 못 찾아도 나머지는 보여 준다
    }
  }
  return { places, info, sources };
}
