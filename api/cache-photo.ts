/**
 * Vercel 서버리스 함수 — 장소 사진 재호스팅
 *
 * POST /api/cache-photo
 * body: { photoUrl: string, placeId: string }
 *
 * Google Place Photo URL(getURI() 결과)을 서버에서 딱 한 번만 다운로드해서
 * 우리 Supabase Storage에 저장하고, 그 공개 URL을 돌려줌.
 * 이후로는 이 URL을 계속 재사용하므로 카드를 아무리 많이 보여줘도
 * Google Photo API가 추가로 호출되지 않음.
 *
 * base64 인코딩은 쓰지 않음 — 바이너리(Uint8Array) 그대로 업로드해서
 * 용량 증가(약 33%) 없이 저장. 용량 자체는 클라이언트에서 이미
 * getURI({maxWidth:480})로 작게 요청했기 때문에 Google이 그 크기로
 * 압축해서 준 이미지를 그대로 재업로드하는 것만으로 충분히 작음
 * (별도 이미지 리사이즈 라이브러리 없이 처리).
 *
 * 필요한 Vercel 환경변수 (서버 전용):
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
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

const BUCKET = 'place-photos';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const photoUrl: string | undefined = req.body?.photoUrl;
  const placeId: string | undefined = req.body?.placeId;

  if (!photoUrl || !placeId) {
    res.status(400).json({ error: 'photoUrl, placeId가 필요해요.' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: '서버 환경변수(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았어요.' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, serviceKey);

  const path = 'places/' + placeId + '.jpg';

  // 이미 재호스팅된 사진이 있으면 재다운로드/재업로드 없이 바로 그 URL 반환
  const { data: existing } = await supabase.storage.from(BUCKET).list('places', {
    search: placeId + '.jpg',
  });
  if (existing && existing.length > 0) {
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    res.status(200).json({ url: pub.publicUrl, cached: true });
    return;
  }

  // Google 사진을 서버에서 다운로드 (딱 한 번)
  let imgRes: Response;
  try {
    imgRes = await fetch(photoUrl);
  } catch (e) {
    res.status(502).json({ error: '사진 다운로드 네트워크 오류: ' + (e as Error).message });
    return;
  }

  if (!imgRes.ok) {
    res.status(502).json({ error: '사진 다운로드 실패 (' + imgRes.status + ')' });
    return;
  }

  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await imgRes.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType,
      upsert: true,
      cacheControl: '2592000', // 30일 — 브라우저/CDN 캐시 활용해 트래픽도 절감
    });

  if (uploadError) {
    res.status(500).json({ error: 'Storage 업로드 실패: ' + uploadError.message });
    return;
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  res.status(200).json({ url: pub.publicUrl, cached: false, sizeBytes: bytes.byteLength });
}
