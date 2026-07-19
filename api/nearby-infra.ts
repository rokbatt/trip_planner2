/**
 * Vercel 서버리스 함수 — 숙소 주변 편의 인프라 (Phase 2)
 *
 * POST /api/nearby-infra
 * body: { placeId?: string, lat: number, lng: number }
 * response: { facilities: [{ key, name, meters, walkMin, lat, lng }], cached: boolean }
 *
 * 흐름 (DB-first, CLAUDE.md 3-2 캐싱 원칙):
 * 1. hotel_infra_cache(placeId 기준)에서 먼저 조회 — 있으면 Google 호출 안 함
 * 2. 없으면 Google Places API(New) Nearby Search로 시설 타입별 "가장 가까운 1곳"을 조회
 * 3. 결과를 DB에 캐싱 후 반환
 *
 * ⚠️ 전세계 공통 시설 타입만 사용 (특정 국가 노선/브랜드 배제).
 * ⚠️ 거리는 숙소↔시설 직선거리(haversine), 도보시간은 그 거리 기반 추정(≈80m/분).
 *    실제 도보 경로 시간이 필요하면 Routes API(Compute Route Matrix)로 승급 가능.
 *
 * 필요한 Vercel 환경변수 (전부 서버 전용):
 * - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (캐시 테이블 접근용; 없거나 테이블이 없어도
 *                                              캐시만 건너뛰고 정상 동작함)
 * - GOOGLE_MAPS_SERVER_KEY   (Places API(New) — "Places API (New)" 활성화 필요)
 *
 * 캐시 테이블(선택; 없으면 매번 조회):
 *   create table if not exists hotel_infra_cache (
 *     place_id text primary key,
 *     facilities jsonb not null,
 *     updated_at timestamptz not null default now()
 *   );
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

/** 시설 타입 1개의 가장 가까운 지점을 Nearby Search로 조회 */
async function findNearest(
  serverKey: string,
  lat: number,
  lng: number,
  entry: { key: string; type: string }
): Promise<Facility | null> {
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

  const meters = Math.round(haversineMeters(lat, lng, loc.latitude, loc.longitude));
  const walkMin = Math.max(1, Math.round(meters / 80)); // 약 4.8km/h

  return {
    key: entry.key,
    name: top.displayName?.text ?? entry.key,
    meters,
    walkMin,
    lat: loc.latitude,
    lng: loc.longitude,
  };
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

  // 캐시는 있으면 쓰고 없으면 조용히 건너뜀 (테이블이 아직 없어도 동작하도록)
  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

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

  const results = await Promise.all(FACILITY_TYPES.map((e) => findNearest(serverKey, lat, lng, e)));
  const facilities: Facility[] = results.filter((f): f is Facility => f !== null);

  if (facilities.length === 0) {
    res.status(200).json({ facilities: [], cached: false });
    return;
  }

  if (supabase && placeId) {
    const { error: upsertError } = await supabase
      .from('hotel_infra_cache')
      .upsert({ place_id: placeId, facilities, updated_at: new Date().toISOString() }, { onConflict: 'place_id' });
    if (upsertError) console.error('[nearby-infra] 캐싱 실패(응답은 그대로 반환):', upsertError.message);
  }

  res.status(200).json({ facilities, cached: false });
}
