/**
 * Vercel 서버리스 함수 — 사진/링크 미리보기 재호스팅
 *
 * POST /api/cache-photo
 * body(기본, kind 생략): { photoUrl: string, placeId: string } — 장소 사진 재호스팅
 * body(kind: 'link-preview'): { kind: 'link-preview', url: string, linkId: string }
 *   — LINKS 탭용: 그 페이지의 og:title/og:image/og:site_name을 가져오고, 이미지는
 *     우리 Storage(link-previews 버킷)로 재호스팅해서 반환. 실패해도 채팅 링크 저장
 *     자체는 막지 않도록 항상 최선을 다한 값만 반환(Claude.md 3-2 — 있으면 좋고 없어도 동작).
 *
 * 두 kind 모두 12개 서버리스 함수 한도(Claude.md 3-7) 때문에 새 파일 대신 이 파일에
 * 합쳐 body의 kind로 분기한다 — "외부 리소스를 가져와 우리 Storage에 재호스팅한다"는
 * 점에서 둘의 성격이 같다.
 *
 * 다른 로컬 파일을 import하지 않고 이 파일 안에 로직을 전부 포함시킴
 * (lib/*.ts를 따로 두고 import하면 Vercel 배포 시 해당 파일이
 *  번들에서 누락되는 문제가 있어서, 파일 간 의존을 아예 없앰)
 *
 * 필요한 Vercel 환경변수 (서버 전용):
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - GOOGLE_MAPS_SERVER_KEY (referrer 제한 없는 서버 전용 키) — link-preview 경로는 안 씀
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

async function fetchFreshPhotoUrl(placeId: string, serverMapsKey: string): Promise<string | null> {
  try {
    const detailsRes = await fetch(
      'https://places.googleapis.com/v1/places/' + placeId + '?fields=photos&key=' + serverMapsKey
    );
    if (!detailsRes.ok) return null;
    const data: any = await detailsRes.json();
    const photoName = data?.photos?.[0]?.name;
    if (!photoName) return null;
    return 'https://places.googleapis.com/v1/' + photoName + '/media?maxWidthPx=480&maxHeightPx=480&key=' + serverMapsKey;
  } catch (e) {
    return null;
  }
}

async function rehostGooglePhoto(
  supabase: any,
  photoUrl: string,
  placeId: string,
  serverMapsKey: string
): Promise<{ url: string; cached: boolean; sizeBytes?: number }> {
  const path = 'places/' + placeId + '.jpg';

  const { data: existing } = await supabase.storage.from(BUCKET).list('places', {
    search: placeId + '.jpg',
  });
  if (existing && existing.length > 0) {
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { url: pub.publicUrl, cached: true };
  }

  const urlObj = new URL(photoUrl);
  urlObj.searchParams.set('key', serverMapsKey);
  const fetchUrl = urlObj.toString();

  let imgRes = await fetch(fetchUrl);

  if (!imgRes.ok) {
    const freshUrl = await fetchFreshPhotoUrl(placeId, serverMapsKey);
    if (freshUrl) {
      imgRes = await fetch(freshUrl);
    }
  }

  if (!imgRes.ok) {
    throw new Error('사진 다운로드 실패 (' + imgRes.status + ') — 원본 URL 만료 + 재발급도 실패');
  }

  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await imgRes.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: true, cacheControl: '2592000' });

  if (uploadError) {
    throw new Error('Storage 업로드 실패: ' + uploadError.message);
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: pub.publicUrl, cached: false, sizeBytes: bytes.byteLength };
}

/* ── 링크 미리보기 (LINKS 탭) ── */

const LINK_PREVIEW_BUCKET = 'link-previews';

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

/** <meta property="og:xxx" content="..."> 형태를 속성 순서 상관없이 찾는다 */
function extractMeta(html: string, prop: string): string | null {
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp('<meta[^>]+(?:property|name)=["\']' + escaped + '["\'][^>]+content=["\']([^"\']*)["\']', 'i');
  const m1 = html.match(re1);
  if (m1) return decodeHtmlEntities(m1[1]).trim() || null;
  const re2 = new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]+(?:property|name)=["\']' + escaped + '["\']', 'i');
  const m2 = html.match(re2);
  return m2 ? decodeHtmlEntities(m2[1]).trim() || null : null;
}

/** og:image 등 미리보기 이미지를 받아 link-previews 버킷에 재호스팅. 실패하면 null(치명적이지 않음) */
async function rehostArbitraryImage(supabase: any, imgUrl: string, linkId: string): Promise<string | null> {
  const path = linkId + '.jpg';
  try {
    const { data: existing } = await supabase.storage.from(LINK_PREVIEW_BUCKET).list('', { search: linkId });
    if (existing && existing.length > 0) {
      const { data: pub } = supabase.storage.from(LINK_PREVIEW_BUCKET).getPublicUrl(path);
      return pub.publicUrl;
    }

    const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(8000) });
    if (!imgRes.ok) return null;
    const contentType = imgRes.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return null; // og:image가 실제로는 이미지가 아니면 스킵

    const arrayBuffer = await imgRes.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.byteLength > 5_000_000) return null; // 비정상적으로 큰 이미지는 스킵(안전장치)

    const { error: uploadError } = await supabase.storage
      .from(LINK_PREVIEW_BUCKET)
      .upload(path, bytes, { contentType, upsert: true, cacheControl: '2592000' });
    if (uploadError) return null;

    const { data: pub } = supabase.storage.from(LINK_PREVIEW_BUCKET).getPublicUrl(path);
    return pub.publicUrl;
  } catch {
    return null;
  }
}

interface LinkPreviewResult {
  title: string | null;
  imageUrl: string | null;
  siteName: string | null;
  ogType: string | null;
}

/** 대상 페이지의 og 메타 태그를 읽어 제목/이미지/사이트명을 뽑는다. 페이지를 못 읽어도
 * 빈 값으로 채워 반환할 뿐 절대 throw하지 않는다 — 링크 저장 자체를 막으면 안 되므로. */
async function buildLinkPreview(supabase: any, targetUrl: string, linkId: string): Promise<LinkPreviewResult> {
  let html = '';
  try {
    const pageRes = await fetch(targetUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MongsilBot/1.0; +https://mongsil.app)' },
      signal: AbortSignal.timeout(8000),
    });
    const text = await pageRes.text();
    html = text.slice(0, 300000); // og 태그는 보통 <head> 안, 문서 앞쪽에 있어 앞부분만으로 충분
  } catch (e) {
    console.error('[link-preview] 페이지를 못 읽음(제목/도메인만으로 대체):', (e as Error).message);
    return { title: null, imageUrl: null, siteName: null, ogType: null };
  }

  const rawTitle = extractMeta(html, 'og:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null);
  const title = rawTitle ? decodeHtmlEntities(rawTitle).trim().slice(0, 200) || null : null;
  const siteName = extractMeta(html, 'og:site_name');
  const ogType = extractMeta(html, 'og:type');
  const ogImageRaw = extractMeta(html, 'og:image') || extractMeta(html, 'og:image:url') || extractMeta(html, 'twitter:image');

  let imageUrl: string | null = null;
  if (ogImageRaw) {
    try {
      const absoluteImg = new URL(ogImageRaw, targetUrl).toString();
      imageUrl = await rehostArbitraryImage(supabase, absoluteImg, linkId);
    } catch (e) {
      console.error('[link-preview] 이미지 URL 처리 실패(무시):', (e as Error).message);
    }
  }

  return { title, imageUrl, siteName, ogType };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: '서버 환경변수(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았어요.' });
    return;
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  if (req.body?.kind === 'link-preview') {
    const url: string | undefined = req.body?.url;
    const linkId: string | undefined = req.body?.linkId;
    if (!url || !linkId) {
      res.status(400).json({ error: 'url, linkId가 필요해요.' });
      return;
    }
    const result = await buildLinkPreview(supabase, url, linkId);
    res.status(200).json(result);
    return;
  }

  const photoUrl: string | undefined = req.body?.photoUrl;
  const placeId: string | undefined = req.body?.placeId;

  if (!photoUrl || !placeId) {
    res.status(400).json({ error: 'photoUrl, placeId가 필요해요.' });
    return;
  }

  const serverMapsKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!serverMapsKey) {
    res.status(500).json({ error: 'GOOGLE_MAPS_SERVER_KEY가 설정되지 않았어요.' });
    return;
  }

  try {
    const result = await rehostGooglePhoto(supabase, photoUrl, placeId, serverMapsKey);
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
}
