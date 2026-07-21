/**
 * Vercel 서버리스 함수 — 숙소 기준 실제 길찾기 (Routes API)
 *
 * POST /api/route-matrix
 * body: { origin: {lat,lng}, destinations: [{id,lat,lng}], mode: 'WALK'|'DRIVE' }
 * response: { results: [{ id, meters, seconds }] }
 *
 * Google Distance Matrix (Legacy) API는 2026-02-25 지원 종료 예정이며, 레거시 API가
 * 활성화되지 않은 프로젝트에서는 즉시 REQUEST_DENIED를 반환한다. 이를 클라이언트에서
 * google.maps.DistanceMatrixService로 직접 호출하던 방식(shortlist.ts)을 대체해,
 * api/nearby-infra.ts와 동일하게 서버에서 Routes API(computeRouteMatrix)를 호출한다.
 *
 * 필요한 Vercel 환경변수:
 * - GOOGLE_ROUTES_API_KEY (없으면 GOOGLE_MAPS_SERVER_KEY 재사용) — "Routes API" 활성화 필요
 */

declare const process: { env: Record<string, string | undefined> };

interface VercelRequest {
  method?: string;
  body?: any;
}
interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (body: any) => void;
}

interface Dest {
  id: string;
  lat: number;
  lng: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const origin = req.body?.origin;
  const destinations: Dest[] | undefined = req.body?.destinations;
  const mode: string = req.body?.mode === 'DRIVE' ? 'DRIVE' : 'WALK';

  if (
    !origin ||
    typeof origin.lat !== 'number' ||
    typeof origin.lng !== 'number' ||
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
