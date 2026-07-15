/**
 * Vercel 서버리스 함수 — 숙소 이름으로 추가
 *
 * POST /api/import-hotel
 * body: { name: string, contextHint: string }  // contextHint: "시암 방콕" 같은 지역+도시 힌트
 * response: { place_id, name, address, lat, lng, rating, types, photoUrl } | { error }
 *
 * 예약 사이트 URL은 트래킹 파라미터가 잔뜩 붙어있고 접근 차단도 잦아서 파싱이 불안정함.
 * 대신 사용자가 숙소 이름을 복사해서 붙여넣으면(예: "Pathumwan Princess"),
 * Google Places Text Search(New)로 바로 실제 장소를 찾음 — 훨씬 안정적.
 * 사진이 있으면 즉시 Supabase Storage로 재호스팅.
 *
 * 필요한 Vercel 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_MAPS_SERVER_KEY
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

const BUCKET = 'place-photos';

async function rehostPhotoInline(
  supabase: any,
  photoResourceName: string,
  placeId: string,
  serverMapsKey: string
): Promise<string | null> {
  try {
    const path = 'places/' + placeId + '.jpg';
    const { data: existing } = await supabase.storage.from(BUCKET).list('places', { search: placeId + '.jpg' });
    if (existing && existing.length > 0) {
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      return pub.publicUrl;
    }

    const mediaUrl = 'https://places.googleapis.com/v1/' + photoResourceName + '/media?maxWidthPx=480&maxHeightPx=480&key=' + serverMapsKey;
    const imgRes = await fetch(mediaUrl);
    if (!imgRes.ok) return null;

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const bytes = new Uint8Array(await imgRes.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: true, cacheControl: '2592000' });
    if (uploadError) return null;

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return pub.publicUrl;
  } catch (e) {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const name: string | undefined = req.body?.name;
  const contextHint: string = req.body?.contextHint ?? '';

  if (!name || !name.trim()) {
    res.status(400).json({ error: '숙소 이름을 입력해주세요.' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const serverMapsKey = process.env.GOOGLE_MAPS_SERVER_KEY;

  if (!supabaseUrl || !serviceKey || !serverMapsKey) {
    res.status(500).json({ error: '서버 환경변수가 설정되지 않았어요.' });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  let searchRes: Response;
  try {
    searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': serverMapsKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types,places.photos',
      },
      body: JSON.stringify({
        textQuery: name.trim() + ' ' + contextHint,
        languageCode: 'ko',
      }),
    });
  } catch (e) {
    res.status(502).json({ error: 'Places 검색 요청 실패: ' + (e as Error).message });
    return;
  }

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    res.status(502).json({ error: 'Places 검색 실패(' + searchRes.status + '): ' + errText });
    return;
  }

  const searchData: any = await searchRes.json();
  const top = searchData?.places?.[0];
  if (!top) {
    res.status(404).json({ error: '"' + name + '"에 해당하는 장소를 Google에서 찾지 못했어요.' });
    return;
  }

  let photoUrl: string | null = null;
  const photoName = top.photos?.[0]?.name;
  if (photoName && top.id) {
    photoUrl = await rehostPhotoInline(supabase, photoName, top.id, serverMapsKey);
  }

  res.status(200).json({
    place_id: top.id ?? null,
    name: top.displayName?.text ?? name,
    address: top.formattedAddress ?? null,
    lat: top.location?.latitude ?? null,
    lng: top.location?.longitude ?? null,
    rating: top.rating ?? null,
    types: top.types ?? [],
    photoUrl,
  });
}
