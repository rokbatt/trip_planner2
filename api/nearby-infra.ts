/**
 * Vercel 서버리스 함수 — 숙소 주변 편의 인프라 (Phase 2)
 *
 * POST /api/nearby-infra
 * body: { placeId?: string, lat: number, lng: number }
 * response: { facilities: [{ key, name, meters, walkMin, lat, lng }], cached: boolean }
 *
 * 흐름 (DB-first, CLAUDE.md 3-2 캐싱 원칙 — 무료 한도 절약이 목적):
 * 1. hotel_infra_cache(placeId 기준)에서 먼저 조회 — 있으면 Google 호출 0회
 *    (placeId는 숙소별 전역 키라, 다른 팀원/다른 트립이 같은 숙소를 봐도 캐시 공유)
 * 2. 없으면:
 *    a. Places API(New) Nearby Search로 시설 타입별 "가장 가까운 1곳"의 위치 조회 (타입당 1회)
 *    b. Routes API(Compute Route Matrix)로 숙소→시설 8곳의 실제 도보 경로 시간/거리를 1회에 조회
 *       (WALK 모드. Routes 실패 시 직선거리로 폴백)
 * 3. 결과를 DB에 캐싱 후 반환 → 이후 조회는 전부 캐시 히트(호출 0회)
 *
 * ⚠️ 전세계 공통 시설 타입만 사용 (특정 국가 노선/브랜드 배제).
 *
 * 필요한 Vercel 환경변수 (전부 서버 전용):
 * - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (캐시; 없거나 테이블이 없어도 동작)
 * - GOOGLE_MAPS_SERVER_KEY   (Places API(New) — "Places API (New)" 활성화 필요)
 * - GOOGLE_ROUTES_API_KEY    (Routes API — "Routes API" 활성화 필요. 없으면 GOOGLE_MAPS_SERVER_KEY 재사용)
 *
 * 캐시 테이블(선택; 없으면 매번 조회): supabase/phase2_cache.sql 참고
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

interface Facility {
  key: string;
  name: string;
  meters: number;
  walkMin: number;
  lat: number;
  lng: number;
}

/** 전세계 어디서나 존재하는 범용 시설 타입만 (Google Places Table A 기준) */
const FACILITY_TYPES: { key: string; type: string }[] = [
  { key: 'transit', type: 'transit_station' },
  { key: 'convenience', type: 'convenience_store' },
  { key: 'cafe', type: 'cafe' },
  { key: 'pharmacy', type: 'pharmacy' },
  { key: 'hospital', type: 'hospital' },
  { key: 'atm', type: 'atm' },
  { key: 'taxi', type: 'taxi_stand' },
  { key: 'supermarket', type: 'supermarket' },
];

const SEARCH_RADIUS_M = 2000;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 시설 타입 1개의 가장 가까운 지점을 Nearby Search로 조회 (위치만) */
async function findNearest(
  serverKey: string,
  lat: number,
  lng: number,
  entry: { key: string; type: string }
): Promise<{ key: string; name: string; lat: number; lng: number } | null> {
  let res: Response;
  try {
    res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': serverKey,
        // location/displayName만 요청해 SKU 등급·비용 최소화
        'X-Goog-FieldMask': 'places.location,places.displayName',
      },
      body: JSON.stringify({
        includedTypes: [entry.type],
        maxResultCount: 1,
        rankPreference: 'DISTANCE',
        languageCode: 'ko',
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: SEARCH_RADIUS_M },
        },
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data: any = await res.json();
  const top = data?.places?.[0];
  const loc = top?.location;
  if (!loc || typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return null;
  return { key: entry.key, name: top.displayName?.text ?? entry.key, lat: loc.latitude, lng: loc.longitude };
}

/**
 * Routes API Compute Route Matrix — 숙소(출발 1) → 시설들(도착 N)의 실제 도보 경로.
 * 한 번의 호출로 모든 시설을 처리. 결과는 destinationIndex별 { meters, seconds }.
 * 실패하거나 경로가 없는 시설은 결과에서 빠짐 → 호출부에서 직선거리로 폴백.
 */
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
        origins: [
          { waypoint: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } } },
        ],
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
    // duration은 "123s" 형태 문자열
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

  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: '숙소 좌표(lat/lng)가 필요해요.' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const serverKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  const routesKey = process.env.GOOGLE_ROUTES_API_KEY || process.env.GOOGLE_MAPS_SERVER_KEY;

  // 캐시는 있으면 쓰고 없으면 조용히 건너뜀 (테이블이 아직 없어도 동작)
  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

  // 1. 캐시 먼저 — 히트하면 Google 호출 0회
  if (supabase && placeId) {
    const { data: existing } = await supabase
      .from('hotel_infra_cache')
      .select('facilities')
      .eq('place_id', placeId)
      .maybeSingle();
    if (existing?.facilities) {
      res.status(200).json({ facilities: existing.facilities, cached: true });
      return;
    }
  }

  if (!serverKey) {
    res.status(500).json({ error: 'GOOGLE_MAPS_SERVER_KEY가 설정되지 않았어요.' });
    return;
  }

  // 2a. 시설 타입별 최근접 지점(위치) 조회
  const found = (await Promise.all(FACILITY_TYPES.map((e) => findNearest(serverKey, lat, lng, e)))).filter(
    (f): f is { key: string; name: string; lat: number; lng: number } => f !== null
  );

  if (found.length === 0) {
    res.status(200).json({ facilities: [], cached: false });
    return;
  }

  // 2b. Routes API로 실제 도보 시간/거리 (1회 호출), 실패분은 직선거리 폴백
  const matrix = routesKey
    ? await computeWalkMatrix(routesKey, { lat, lng }, found.map((f) => ({ lat: f.lat, lng: f.lng })))
    : new Map<number, { meters: number; seconds: number }>();

  const facilities: Facility[] = found.map((f, i) => {
    const route = matrix.get(i);
    if (route) {
      return { key: f.key, name: f.name, meters: Math.round(route.meters), walkMin: Math.max(1, Math.round(route.seconds / 60)), lat: f.lat, lng: f.lng };
    }
    const meters = Math.round(haversineMeters(lat, lng, f.lat, f.lng));
    return { key: f.key, name: f.name, meters, walkMin: Math.max(1, Math.round(meters / 80)), lat: f.lat, lng: f.lng };
  });

  // 3. 캐싱 — 이후 조회는 전부 캐시 히트
  if (supabase && placeId) {
    const { error: upsertError } = await supabase
      .from('hotel_infra_cache')
      .upsert({ place_id: placeId, facilities, updated_at: new Date().toISOString() }, { onConflict: 'place_id' });
    if (upsertError) console.error('[nearby-infra] 캐싱 실패(응답은 그대로 반환):', upsertError.message);
  }

  res.status(200).json({ facilities, cached: false });
}
