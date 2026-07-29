/**
 * Vercel 서버리스 함수 — 실제 길찾기 (Routes API). 두 가지 요청 형태를 함께 처리한다.
 *
 * ① 1×N 매트릭스 (shortlist.ts — 숙소 1곳 → 여러 장소, 단일 모드)
 *    POST /api/route-matrix
 *    body: { origin: {lat,lng}, destinations: [{id,lat,lng}], mode: 'WALK'|'DRIVE' }
 *    response: { results: [{ id, meters, seconds }] }
 *
 * ② 구간별 모드 비교 (route.ts — 동선의 각 구간 A→B, B→C …, 모드 여러 개 동시 비교)
 *    POST /api/route-matrix
 *    body: { legs: [{ id, from:{lat,lng}, to:{lat,lng} }], modes?: ['WALK','TRANSIT','DRIVE'] }
 *    response: { results: [{ id, modes: { WALK?: Leg, TRANSIT?: Leg, DRIVE?: Leg } }], cached, fetched }
 *    Leg = { meters, seconds, fare?: { units, currency } }
 *
 * 원래 두 개의 파일(route-matrix.ts / route-legs.ts)이었으나, Vercel Hobby 플랜의
 * "서버리스 함수 12개" 한도를 넘겨 배포가 실패해 한 파일로 합쳤다(요청 바디의 필드로 구분).
 * 새 API를 추가할 때도 이 한도를 넘지 않는지 먼저 확인할 것 — api/*.ts 개수를 12개 이하로 유지.
 *
 * Google Distance Matrix (Legacy) API는 2026-02-25 지원 종료 예정이라 Routes API를 쓴다.
 *
 * 캐싱 (Claude.md 3-2 — API 비용 의식, ②에만 해당):
 *   같은 두 좌표 사이의 경로는 트립이 달라도 동일하므로 route_leg_cache에 전역 캐싱한다.
 *   좌표는 5자리(≈1.1m)로 반올림해 키를 만들어 같은 건물 내 미세 차이를 한 키로 묶는다.
 *
 * 필요한 Vercel 환경변수 (전부 서버 전용):
 * - GOOGLE_ROUTES_API_KEY (없으면 GOOGLE_MAPS_SERVER_KEY 재사용) — "Routes API" 활성화 필요
 * - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (②의 캐시용 — 없으면 캐싱 없이 매번 호출)
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

function isFiniteNum(n: any): n is number {
  // typeof NaN === 'number' 함정을 피하려면 반드시 Number.isFinite 사용 (Claude.md 알려진 버그 패턴)
  return Number.isFinite(n);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (Array.isArray(req.body?.legs)) {
    await handleLegCompare(req, res);
  } else {
    await handleMatrix(req, res);
  }
}

/* ══════════════ ① 1×N 매트릭스 (기존 route-matrix, shortlist.ts) ══════════════ */

interface Dest { id: string; lat: number; lng: number }

async function handleMatrix(req: VercelRequest, res: VercelResponse) {
  const origin = req.body?.origin;
  const destinations: Dest[] | undefined = req.body?.destinations;
  const mode: string = req.body?.mode === 'DRIVE' ? 'DRIVE' : 'WALK';

  if (
    !origin ||
    !isFiniteNum(origin.lat) ||
    !isFiniteNum(origin.lng) ||
    !Array.isArray(destinations) ||
    destinations.length === 0
  ) {
    res.status(400).json({ error: 'origin과 destinations가 필요해요.' });
    return;
  }

  const routesKey = process.env.GOOGLE_ROUTES_API_KEY || process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!routesKey) {
    res.status(500).json({ error: 'GOOGLE_ROUTES_API_KEY(또는 GOOGLE_MAPS_SERVER_KEY)가 설정되지 않았어요.' });
    return;
  }

  let apiRes: Response;
  try {
    apiRes = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': routesKey,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
      },
      body: JSON.stringify({
        origins: [{ waypoint: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } } }],
        destinations: destinations.map((d) => ({
          waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
        })),
        travelMode: mode,
      }),
    });
  } catch (e) {
    res.status(200).json({ results: [] });
    return;
  }

  if (!apiRes.ok) {
    console.error('[route-matrix] Routes API 실패:', apiRes.status, await apiRes.text());
    res.status(200).json({ results: [] });
    return;
  }

  let rows: any;
  try {
    rows = await apiRes.json();
  } catch {
    res.status(200).json({ results: [] });
    return;
  }
  if (!Array.isArray(rows)) {
    res.status(200).json({ results: [] });
    return;
  }

  const results: { id: string; meters: number; seconds: number }[] = [];
  for (const row of rows) {
    if (row?.condition !== 'ROUTE_EXISTS') continue;
    const di = row?.destinationIndex;
    if (typeof di !== 'number' || !destinations[di]) continue;
    const meters = typeof row.distanceMeters === 'number' ? row.distanceMeters : null;
    const seconds = typeof row.duration === 'string' ? parseInt(row.duration, 10) : null;
    if (meters == null || seconds == null || Number.isNaN(seconds)) continue;
    results.push({ id: destinations[di].id, meters, seconds });
  }

  res.status(200).json({ results });
}

/* ══════════════ ② 구간별 모드 비교 (기존 route-legs, route.ts) ══════════════ */

type Mode = 'WALK' | 'TRANSIT' | 'DRIVE';
const ALL_MODES: Mode[] = ['WALK', 'TRANSIT', 'DRIVE'];
const MAX_LEGS = 25;

interface Pt { lat: number; lng: number }
interface LegReq { id: string; from: Pt; to: Pt }
interface LegResult { meters: number; seconds: number; fare?: { units: number; currency: string }; polyline?: string }

/** 좌표를 5자리로 반올림해 캐시 키를 만든다 (트립과 무관한 전역 키) */
function cacheKey(from: Pt, to: Pt, mode: Mode): string {
  const r = (n: number) => n.toFixed(5);
  return r(from.lat) + ',' + r(from.lng) + '>' + r(to.lat) + ',' + r(to.lng) + '|' + mode;
}

function isFinitePt(p: any): p is Pt {
  return !!p && isFiniteNum(p.lat) && isFiniteNum(p.lng);
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

  // polyline.encodedPolyline로 실제 도로를 따라가는 경로 좌표까지 받는다 — 이게 없으면
  // 지도에는 항상 출발지-도착지를 잇는 직선만 그려지고, 실측치는 숫자(시간·거리·요금)로만
  // 반영돼 "실측인데 지도 위 선은 직선"인 불일치가 생긴다.
  const fieldMask =
    mode === 'TRANSIT'
      ? 'routes.duration,routes.distanceMeters,routes.travelAdvisory.transitFare,routes.polyline.encodedPolyline'
      : 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline';

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
    console.error('[route-matrix:legs] fetch 실패:', e);
    return null;
  }

  if (!apiRes.ok) {
    console.error('[route-matrix:legs] Routes API 실패:', mode, apiRes.status, await apiRes.text());
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

  const encoded = route?.polyline?.encodedPolyline;
  if (typeof encoded === 'string' && encoded) out.polyline = encoded;

  return out;
}

async function handleLegCompare(req: VercelRequest, res: VercelResponse) {
  const rawLegs = req.body?.legs;
  const legs: LegReq[] = (Array.isArray(rawLegs) ? rawLegs : [])
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
      console.warn('[route-matrix:legs] 캐시 조회 건너뜀:', error.message);
    } else {
      (data ?? []).forEach((row: any) => {
        const r: LegResult = { meters: row.meters, seconds: row.seconds };
        if (row.fare_units != null && row.fare_currency) {
          r.fare = { units: Number(row.fare_units), currency: row.fare_currency };
        }
        if (row.polyline) r.polyline = row.polyline;
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
      polyline: e.result.polyline ?? null,
    });
  });

  // ③ 새로 받은 건 캐시에 적재 (실패해도 응답에는 영향 없음)
  if (db && fetchedRows.length) {
    const { error } = await db.from('route_leg_cache').upsert(fetchedRows, { onConflict: 'cache_key' });
    if (error) console.warn('[route-matrix:legs] 캐시 저장 건너뜀:', error.message);
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
