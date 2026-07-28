/**
 * Vercel 서버리스 함수 — 동선 구간별 실제 길찾기 (Routes API, 모드 비교 지원)
 *
 * POST /api/route-legs
 * body: {
 *   legs:  [{ id, from:{lat,lng}, to:{lat,lng} }],   // 최대 25개
 *   modes: ['WALK','TRANSIT','DRIVE']                 // 생략 시 3개 전부(교통편 비교용)
 * }
 * response: {
 *   results: [{ id, modes: { WALK?: Leg, TRANSIT?: Leg, DRIVE?: Leg } }],
 *   cached: number, fetched: number
 * }
 *   Leg = { meters, seconds, fare?: { units, currency } }
 *
 * route-matrix.ts는 "숙소 1곳 → 여러 장소"(1×N) 전용이라 동선의 각 구간(A→B, B→C …)에는
 * 맞지 않아서, 구간 목록을 그대로 받아 모드별로 조회하는 엔드포인트를 따로 둔다.
 *
 * 캐싱 (Claude.md 3-2 — API 비용 의식):
 *   같은 두 좌표 사이의 경로는 트립이 달라도 동일하므로 route_leg_cache에 전역 캐싱한다.
 *   좌표는 5자리(≈1.1m)로 반올림해 키를 만들어 같은 건물 내 미세 차이를 한 키로 묶는다.
 *   캐시 히트면 Routes API 호출 0회.
 *
 * 필요한 Vercel 환경변수 (전부 서버 전용):
 * - GOOGLE_ROUTES_API_KEY (없으면 GOOGLE_MAPS_SERVER_KEY 재사용) — "Routes API" 활성화 필요
 * - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (캐시용 — 없으면 캐싱 없이 매번 호출)
 */

// 이 프로젝트엔 @types/node를 추가하지 않아서 최소한의 타입만 선언
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

type Mode = 'WALK' | 'TRANSIT' | 'DRIVE';
const ALL_MODES: Mode[] = ['WALK', 'TRANSIT', 'DRIVE'];
const MAX_LEGS = 25;

interface Pt { lat: number; lng: number }
interface LegReq { id: string; from: Pt; to: Pt }
interface LegResult { meters: number; seconds: number; fare?: { units: number; currency: string } }

/** 좌표를 5자리로 반올림해 캐시 키를 만든다 (트립과 무관한 전역 키) */
function cacheKey(from: Pt, to: Pt, mode: Mode): string {
  const r = (n: number) => n.toFixed(5);
  return r(from.lat) + ',' + r(from.lng) + '>' + r(to.lat) + ',' + r(to.lng) + '|' + mode;
}

function isFinitePt(p: any): p is Pt {
  // typeof NaN === 'number' 함정을 피하려면 반드시 Number.isFinite 사용 (Claude.md 알려진 버그 패턴)
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

/** Routes API 단일 구간 조회 */
async function fetchLeg(key: string, from: Pt, to: Pt, mode: Mode): Promise<LegResult | null> {
  const body: any = {
    origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
    destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
    travelMode: mode,
  };
  // TRANSIT은 출발 시각이 필요하고 요금 정보를 함께 받을 수 있다.
  if (mode === 'TRANSIT') {
    body.departureTime = new Date(Date.now() + 60_000).toISOString();
  } else if (mode === 'DRIVE') {
    body.routingPreference = 'TRAFFIC_UNAWARE'; // 미래 시점 교통량은 의미가 없어 비용만 늘어남
  }

  const fieldMask =
    mode === 'TRANSIT'
      ? 'routes.duration,routes.distanceMeters,routes.travelAdvisory.transitFare'
      : 'routes.duration,routes.distanceMeters';

  let apiRes: Response;
  try {
    apiRes = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error('[route-legs] fetch 실패:', e);
    return null;
  }

  if (!apiRes.ok) {
    console.error('[route-legs] Routes API 실패:', mode, apiRes.status, await apiRes.text());
    return null;
  }

  let json: any;
  try {
    json = await apiRes.json();
  } catch {
    return null;
  }

  const route = json?.routes?.[0];
  if (!route) return null; // 해당 모드로 갈 수 있는 경로가 없음(예: 강 건너 도보)

  const meters = typeof route.distanceMeters === 'number' ? route.distanceMeters : null;
  const seconds = typeof route.duration === 'string' ? parseInt(route.duration, 10) : null;
  if (meters == null || seconds == null || Number.isNaN(seconds)) return null;

  const out: LegResult = { meters, seconds };

  const fare = route?.travelAdvisory?.transitFare;
  if (fare && fare.currencyCode) {
    // Money: { currencyCode, units(string|number), nanos }
    const units = Number(fare.units ?? 0) + Number(fare.nanos ?? 0) / 1e9;
    if (Number.isFinite(units) && units > 0) {
      out.fare = { units, currency: fare.currencyCode };
    }
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rawLegs = req.body?.legs;
  if (!Array.isArray(rawLegs) || rawLegs.length === 0) {
    res.status(400).json({ error: 'legs가 필요해요.' });
    return;
  }

  const legs: LegReq[] = rawLegs
    .filter((l: any) => l && typeof l.id === 'string' && isFinitePt(l.from) && isFinitePt(l.to))
    .slice(0, MAX_LEGS);

  if (legs.length === 0) {
    res.status(400).json({ error: '유효한 좌표를 가진 구간이 없어요.' });
    return;
  }

  const reqModes: Mode[] = Array.isArray(req.body?.modes)
    ? (req.body.modes as string[]).filter((m): m is Mode => (ALL_MODES as string[]).includes(m))
    : ALL_MODES;
  const modes = reqModes.length ? reqModes : ALL_MODES;

  const routesKey = process.env.GOOGLE_ROUTES_API_KEY || process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!routesKey) {
    res.status(500).json({ error: 'GOOGLE_ROUTES_API_KEY(또는 GOOGLE_MAPS_SERVER_KEY)가 설정되지 않았어요.' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const db = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

  // 조회해야 할 (구간 × 모드) 전체 목록
  const wanted: Array<{ legId: string; mode: Mode; key: string; from: Pt; to: Pt }> = [];
  legs.forEach((l) => {
    modes.forEach((m) => wanted.push({ legId: l.id, mode: m, key: cacheKey(l.from, l.to, m), from: l.from, to: l.to }));
  });

  // ① 캐시 먼저
  const cache = new Map<string, LegResult>();
  if (db) {
    const keys = [...new Set(wanted.map((w) => w.key))];
    const { data, error } = await db.from('route_leg_cache').select('*').in('cache_key', keys);
    if (error) {
      // 캐시 테이블이 아직 없으면(마이그레이션 전) 조용히 캐시 없이 진행
      console.warn('[route-legs] 캐시 조회 건너뜀:', error.message);
    } else {
      (data ?? []).forEach((row: any) => {
        const r: LegResult = { meters: row.meters, seconds: row.seconds };
        if (row.fare_units != null && row.fare_currency) {
          r.fare = { units: Number(row.fare_units), currency: row.fare_currency };
        }
        cache.set(row.cache_key, r);
      });
    }
  }

  // ② 캐시에 없는 것만 실제 호출 (같은 키가 여러 번 요청돼도 1회만)
  const missing = wanted.filter((w) => !cache.has(w.key));
  const uniqueMissing = new Map<string, (typeof missing)[number]>();
  missing.forEach((m) => { if (!uniqueMissing.has(m.key)) uniqueMissing.set(m.key, m); });

  const fetchedRows: any[] = [];
  const fetchedEntries = await Promise.all(
    [...uniqueMissing.values()].map(async (w) => {
      const r = await fetchLeg(routesKey, w.from, w.to, w.mode);
      return { key: w.key, mode: w.mode, result: r };
    })
  );
  fetchedEntries.forEach((e) => {
    if (!e.result) return;
    cache.set(e.key, e.result);
    fetchedRows.push({
      cache_key: e.key,
      mode: e.mode,
      meters: e.result.meters,
      seconds: e.result.seconds,
      fare_units: e.result.fare?.units ?? null,
      fare_currency: e.result.fare?.currency ?? null,
    });
  });

  // ③ 새로 받은 건 캐시에 적재 (실패해도 응답에는 영향 없음)
  if (db && fetchedRows.length) {
    const { error } = await db.from('route_leg_cache').upsert(fetchedRows, { onConflict: 'cache_key' });
    if (error) console.warn('[route-legs] 캐시 저장 건너뜀:', error.message);
  }

  // ④ 구간별로 묶어서 응답
  const byLeg = new Map<string, Record<string, LegResult>>();
  wanted.forEach((w) => {
    const r = cache.get(w.key);
    if (!r) return;
    const entry = byLeg.get(w.legId) ?? {};
    entry[w.mode] = r;
    byLeg.set(w.legId, entry);
  });

  res.status(200).json({
    results: legs.map((l) => ({ id: l.id, modes: byLeg.get(l.id) ?? {} })),
    cached: wanted.length - uniqueMissing.size,
    fetched: fetchedEntries.filter((e) => e.result).length,
  });
}
