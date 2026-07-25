/**
 * Vercel 서버리스 함수 — 숙소 근처 자유 검색 ("마사지", "PC방", "편의점" 등)
 *
 * POST /api/nearby-search
 * body: { placeId?: string, lat: number, lng: number, query: string }
 * response: { results: [{ name, meters, walkMin, lat, lng, placeId?, rating?, address? }], cached: boolean }
 *
 * api/nearby-infra.ts는 고정된 8개 카테고리(대중교통/편의점/...)만 찾지만, 이건 사용자가
 * 구글맵 검색창처럼 아무 키워드나 입력할 수 있게 해주는 기능이라 Nearby Search(타입 기반)
 * 대신 Places API(New) Text Search(자유 텍스트 기반)를 씀.
 *
 * 흐름 (DB-first 캐싱 — nearby-infra.ts와 동일한 원칙):
 * 1. hotel_search_cache(place_id + 정규화한 검색어)에서 먼저 조회 — 있으면 Google 호출 0회
 *    (place_id는 숙소별 전역 키라, 다른 팀원/다른 트립이 같은 숙소에서 같은 검색을 해도 캐시 공유)
 * 2. 없으면:
 *    a. Places API(New) Text Search로 검색어 결과 최대 10곳 조회 (1회 호출, rankPreference: DISTANCE)
 *    b. Routes API(Compute Route Matrix)로 숙소→결과 최대 10곳의 실제 도보 시간/거리를 1회에 조회
 *       (WALK 모드. Routes 실패 시 직선거리로 폴백)
 * 3. 결과를 DB에 캐싱 후 반환 → 같은 숙소+검색어 조합은 이후 전부 캐시 히트(호출 0회)
 *
 * 필요한 Vercel 환경변수 (전부 서버 전용):
 * - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (캐시; 없거나 테이블이 없어도 동작)
 * - GOOGLE_MAPS_SERVER_KEY   (Places API(New) — "Places API (New)" 활성화 필요)
 * - GOOGLE_ROUTES_API_KEY    (Routes API — 없으면 GOOGLE_MAPS_SERVER_KEY 재사용)
 *
 * 캐시 테이블(선택; 없으면 매번 조회): supabase/nearby_search_cache.sql 참고
 */

import { createClient } from '@supabase/supabase-js';

declare const process: { env: Record<string, string | undefined> };

interface VercelRequest {
  method?: string;
  body?: any;
}
interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (body: any) => void;
}

interface SearchResult {
  name: string;
  meters: number;
  walkMin: number;
  lat: number;
  lng: number;
  placeId?: string;
  rating?: number;
  address?: string;
}

const SEARCH_RADIUS_M = 3000;
const MAX_RESULTS = 10;
/** 너무 긴 검색어로 캐시 키/쿼리가 비대해지는 걸 막기 위한 상한 */
const MAX_QUERY_LEN = 40;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 캐시 키 정규화 — 공백 차이(앞뒤·중복)만으로 캐시가 갈라지지 않게 함 */
function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, MAX_QUERY_LEN);
}

/** Places API(New) Text Search — 자유 검색어로 최대 MAX_RESULTS곳 조회 (1회 호출) */
async function textSearch(
  serverKey: string,
  lat: number,
  lng: number,
  query: string
): Promise<{ name: string; lat: number; lng: number; placeId?: string; rating?: number; address?: string }[]> {
  let res: Response;
  try {
    res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': serverKey,
        'X-Goog-FieldMask': 'places.location,places.displayName,places.id,places.rating,places.formattedAddress',
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: 'ko',
        rankPreference: 'DISTANCE',
        maxResultCount: MAX_RESULTS,
        locationBias: {
          circle: { center: { latitude: lat, longitude: lng }, radius: SEARCH_RADIUS_M },
        },
      }),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const data: any = await res.json();
  const places = Array.isArray(data?.places) ? data.places : [];
  return places
    .map((p: any) => {
      const loc = p?.location;
      if (!loc || typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return null;
      return {
        name: p.displayName?.text ?? query,
        lat: loc.latitude,
        lng: loc.longitude,
        placeId: typeof p.id === 'string' ? p.id : undefined,
        rating: typeof p.rating === 'number' ? p.rating : undefined,
        address: typeof p.formattedAddress === 'string' ? p.formattedAddress : undefined,
      };
    })
    .filter((p: any): p is NonNullable<typeof p> => p !== null);
}

/** Routes API Compute Route Matrix — 숙소(출발 1) → 결과들(도착 N)의 실제 도보 경로 (1회 호출) */
async function computeWalkMatrix(
  routesKey: string,
  origin: { lat: number; lng: number },
  dests: { lat: number; lng: number }[]
): Promise<Map<number, { meters: number; seconds: number }>> {
  const out = new Map<number, { meters: number; seconds: number }>();
  if (dests.length === 0) return out;

  let res: Response;
  try {
    res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': routesKey,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
      },
      body: JSON.stringify({
        origins: [{ waypoint: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } } }],
        destinations: dests.map((d) => ({
          waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
        })),
        travelMode: 'WALK',
      }),
    });
  } catch {
    return out;
  }
  if (!res.ok) return out;

  let rows: any;
  try {
    rows = await res.json();
  } catch {
    return out;
  }
  if (!Array.isArray(rows)) return out;

  for (const row of rows) {
    if (row?.condition !== 'ROUTE_EXISTS') continue;
    const di = row?.destinationIndex;
    if (typeof di !== 'number') continue;
    const meters = typeof row.distanceMeters === 'number' ? row.distanceMeters : null;
    const seconds = typeof row.duration === 'string' ? parseInt(row.duration, 10) : null;
    if (meters == null || seconds == null || Number.isNaN(seconds)) continue;
    out.set(di, { meters, seconds });
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const placeId: string | undefined = req.body?.placeId;
  const lat: number | undefined = req.body?.lat;
  const lng: number | undefined = req.body?.lng;
  const rawQuery: string | undefined = req.body?.query;

  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: '숙소 좌표(lat/lng)가 필요해요.' });
    return;
  }
  if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
    res.status(400).json({ error: '검색어가 필요해요.' });
    return;
  }

  const query = normalizeQuery(rawQuery);

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const serverKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  const routesKey = process.env.GOOGLE_ROUTES_API_KEY || process.env.GOOGLE_MAPS_SERVER_KEY;

  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

  // 1. 캐시 먼저 — 같은 숙소+검색어 조합이면 Google 호출 0회
  if (supabase && placeId) {
    const { data: existing } = await supabase
      .from('hotel_search_cache')
      .select('results')
      .eq('place_id', placeId)
      .eq('query', query)
      .maybeSingle();
    if (existing?.results) {
      res.status(200).json({ results: existing.results, cached: true });
      return;
    }
  }

  if (!serverKey) {
    res.status(500).json({ error: 'GOOGLE_MAPS_SERVER_KEY가 설정되지 않았어요.' });
    return;
  }

  // 2a. 자유 검색어로 최대 MAX_RESULTS곳 조회
  const found = await textSearch(serverKey, lat, lng, query);
  if (found.length === 0) {
    res.status(200).json({ results: [], cached: false });
    return;
  }

  // 2b. Routes API로 실제 도보 시간/거리 (1회 호출), 실패분은 직선거리 폴백
  const matrix = routesKey
    ? await computeWalkMatrix(routesKey, { lat, lng }, found.map((f) => ({ lat: f.lat, lng: f.lng })))
    : new Map<number, { meters: number; seconds: number }>();

  const results: SearchResult[] = found
    .map((f, i) => {
      const base = { name: f.name, lat: f.lat, lng: f.lng, placeId: f.placeId, rating: f.rating, address: f.address };
      const route = matrix.get(i);
      if (route) {
        return { ...base, meters: Math.round(route.meters), walkMin: Math.max(1, Math.round(route.seconds / 60)) };
      }
      const meters = Math.round(haversineMeters(lat, lng, f.lat, f.lng));
      return { ...base, meters, walkMin: Math.max(1, Math.round(meters / 80)) };
    })
    .sort((a, b) => a.meters - b.meters);

  // 3. 캐싱 — 같은 숙소+검색어 조합은 이후 전부 캐시 히트
  if (supabase && placeId) {
    const { error: upsertError } = await supabase
      .from('hotel_search_cache')
      .upsert({ place_id: placeId, query, results, updated_at: new Date().toISOString() }, { onConflict: 'place_id,query' });
    if (upsertError) console.error('[nearby-search] 캐싱 실패(응답은 그대로 반환):', upsertError.message);
  }

  res.status(200).json({ results, cached: false });
}
