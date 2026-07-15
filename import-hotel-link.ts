/**
 * Vercel 서버리스 함수 — 숙소 예약 사이트 링크로 숙소 추가
 *
 * POST /api/import-hotel-link
 * body: { url: string, contextHint: string }  // contextHint: "시암 방콕" 같은 지역+도시 힌트
 * response: { place_id, name, address, lat, lng, rating, types, photoUrl } | { error }
 *
 * 흐름:
 * 1. 붙여넣은 링크(Booking/Agoda/Airbnb/Google Hotels 등)를 서버에서 직접 열어서
 *    <title> / og:title 메타태그로 숙소 이름을 추출
 * 2. 그 이름 + 지역 힌트로 Google Places Text Search(New)를 호출해서 실제 장소를 찾음
 *    (사이트에 적힌 이름이 100% Google 등록명과 일치하지 않을 수 있어서, 검색으로 매칭)
 * 3. 사진이 있으면 바로 Supabase Storage로 재호스팅해서 만료되지 않는 URL로 반환
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

/** 사이트별로 title 뒤에 붙는 상투적인 접미사를 제거해서 순수 숙소명만 남김 */
function cleanHotelTitle(raw: string): string {
  return raw
    .replace(/\s*[-|·–]\s*(Booking\.com|Agoda|Airbnb|Google (Hotels|Travel)).*$/i, '')
    .replace(/\s*\|\s*.*$/, '')
    .trim();
}

async function extractTitleFromUrl(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: {
      // 일부 예약 사이트는 봇으로 보이는 요청을 차단해서, 일반 브라우저처럼 보이는 UA를 붙임
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
  });
  if (!res.ok) return null;
  const html = await res.text();

  const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (ogMatch?.[1]) return cleanHotelTitle(decodeHtmlEntities(ogMatch[1]));

  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) return cleanHotelTitle(decodeHtmlEntities(titleMatch[1]));

  return null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

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

  const url: string | undefined = req.body?.url;
  const contextHint: string = req.body?.contextHint ?? '';

  if (!url || !/^https?:\/\//.test(url)) {
    res.status(400).json({ error: '올바른 URL이 아니에요.' });
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

  // 1. 링크에서 숙소 이름 추출
  let hotelName: string | null;
  try {
    hotelName = await extractTitleFromUrl(url);
  } catch (e) {
    res.status(502).json({ error: '링크를 열지 못했어요: ' + (e as Error).message });
    return;
  }
  if (!hotelName) {
    res.status(422).json({ error: '이 링크에서 숙소 이름을 찾지 못했어요. 사이트가 접근을 막았을 수 있어요.' });
    return;
  }

  // 2. Google Places Text Search(New)로 실제 장소 매칭
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
        textQuery: hotelName + ' ' + contextHint,
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
    res.status(404).json({ error: '"' + hotelName + '"에 해당하는 장소를 Google에서 찾지 못했어요.', extractedName: hotelName });
    return;
  }

  // 3. 사진 있으면 즉시 재호스팅
  let photoUrl: string | null = null;
  const photoName = top.photos?.[0]?.name;
  if (photoName && top.id) {
    photoUrl = await rehostPhotoInline(supabase, photoName, top.id, serverMapsKey);
  }

  res.status(200).json({
    place_id: top.id ?? null,
    name: top.displayName?.text ?? hotelName,
    address: top.formattedAddress ?? null,
    lat: top.location?.latitude ?? null,
    lng: top.location?.longitude ?? null,
    rating: top.rating ?? null,
    types: top.types ?? [],
    photoUrl,
  });
}
