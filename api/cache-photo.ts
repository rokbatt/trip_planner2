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

// link-preview 경로는 여러 User-Agent를 순서대로 시도하고(PREVIEW_USER_AGENTS) 이미지까지
// 재호스팅할 수 있어, 모든 단계가 각자의 최대 타임아웃까지 다 채우는 최악의 경우 40초
// 안팎이 걸릴 수 있다(각 단계는 이제 withTimeout으로 확실히 끊기지만, 그 합산 시간
// 자체는 여전히 길 수 있음) — Hobby 플랜에서 설정 가능한 한도까지 여유를 둠.
export const config = {
  maxDuration: 50,
};

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

/** fetch()에 넘기는 AbortSignal.timeout()만으로는 못 끊는 경우가 실제로 있다(리다이렉트
 * 체인 중간이나 body 스트림을 읽는 단계에서 신호가 전파 안 되는 케이스, 응답을 아예 안
 * 주고 연결만 붙잡아두는 봇 차단 등) — 트립닷컴에서 실제로 Vercel 함수 25초 타임아웃까지
 * 그대로 매달린 사례가 있었다. AbortSignal과는 별개로 자바스크립트 레벨에서 강제로 끊는
 * 이중 안전장치. 원래 프라미스가 안 끝나도 이 함수는 반드시 ms 안에 reject된다. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ' 타임아웃(' + ms + 'ms)')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    // 숫자 문자 참조(&#44032; / &#xB791;) — Booking.com 등 일부 사이트가 한글 제목을
    // 이름 붙은 엔티티 대신 이 형식으로 내려줘서, 위의 이름 엔티티만으로는 못 잡고
    // 화면에 "&#xB791;..." 그대로 노출되는 문제가 있었다.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)));
}

/** <meta property="og:xxx" content="..."> 형태를 속성 순서 상관없이 찾는다.
 * 따옴표 문자를 캡처해 백레퍼런스로 짝을 맞춘다 — content="Tom's Cafe"처럼 큰따옴표
 * 안에 작은따옴표(어퍼스트로피)가 섞여도 거기서 끊기지 않는다. */
function extractMeta(html: string, prop: string): string | null {
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp('<meta[^>]+(?:property|name)=["\']' + escaped + '["\'][^>]+content=(["\'])([\\s\\S]*?)\\1', 'i');
  const m1 = html.match(re1);
  if (m1) return decodeHtmlEntities(m1[2]).trim() || null;
  const re2 = new RegExp('<meta[^>]+content=(["\'])([\\s\\S]*?)\\1[^>]+(?:property|name)=["\']' + escaped + '["\']', 'i');
  const m2 = html.match(re2);
  return m2 ? decodeHtmlEntities(m2[2]).trim() || null : null;
}

/** og:title/<title>가 사이트 이름·도메인만 담은 "쓸모없는" 제목인지 판정한다. 예약
 * 사이트는 봇 차단 시 실제 콘텐츠 대신 <title>Agoda.com</title> 같은 껍데기만 내려주는
 * 경우가 있는데, 이때는 스크래핑 자체는 "성공"하지만 제목으로 쓸 가치가 없다 — 이런
 * 경우엔 og:title이 있어도 URL 슬러그 폴백을 대신 쓴다. */
function isGenericTitle(title: string, targetUrl: string): boolean {
  let host = '';
  try {
    host = new URL(targetUrl).hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanTitle = clean(title);
  if (!cleanTitle) return true;
  const hostRoot = host.split('.')[0];
  return cleanTitle === clean(host) || cleanTitle === clean(hostRoot);
}

/** 네이버 블로그(blog.naver.com/{아이디}/{글번호})는 요청하면 실제 글 내용이 없는 겉포장
 * 페이지만 내려주고, 진짜 og:title/og:image는 그 안의 iframe(id="mainFrame", PostView.naver)에
 * 들어있다. 겉포장 페이지의 <title>은 그 블로그의 모든 글에서 "{블로그 이름} : 네이버
 * 블로그"로 항상 똑같고 og:image는 아예 없어서, 이 iframe의 src를 찾아 한 번 더 따라간다. */
function extractMainFrameSrc(html: string): string | null {
  const m =
    html.match(/<iframe[^>]+id=["']mainFrame["'][^>]+src=(["'])([\s\S]*?)\1/i) ||
    html.match(/<iframe[^>]+src=(["'])([\s\S]*?)\1[^>]+id=["']mainFrame["']/i);
  return m ? decodeHtmlEntities(m[2]) : null;
}

/**
 * og 스크래핑이 막혔을 때의 최후 폴백 — Agoda/Booking 같은 예약 사이트는 URL 경로에
 * 이미 실제 이름을 슬러그로 담고 있다(예: /eastin-grand-hotel-sathorn/hotel/...).
 * 대시(-)가 가장 많은 세그먼트를 "이름"으로 보고 단어별로 대문자화한다. 지어내는 게
 * 아니라 그 사이트가 URL에 넣어둔 실제 텍스트를 읽기 좋게 바꾸는 것뿐이다.
 */
function titleFromUrlSlug(targetUrl: string): string | null {
  try {
    const segments = new URL(targetUrl).pathname
      .split('/')
      .filter(Boolean)
      .map((s) => s.replace(/\.[a-z0-9]+$/i, '')); // 끝의 .html 등 확장자 제거
    if (segments.length === 0) return null;

    const best = segments.reduce((a, b) => (b.split('-').length > a.split('-').length ? b : a));
    const words = best.split(/[-_]+/).filter(Boolean);
    if (words.length < 2) return null; // 대시가 거의 없으면 이름 슬러그가 아닐 가능성이 높아 폐기

    return words
      .map((w) => (/^[a-z0-9]+$/i.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(' ');
  } catch {
    return null;
  }
}

/** og:image 등 미리보기 이미지를 받아 link-previews 버킷에 재호스팅. 실패하면 null(치명적이지 않음).
 * 실패 사유는 전부 console.error로 남긴다 — 화면에는 그냥 카테고리 아이콘으로 조용히
 * 대체되기 때문에, 원인(버킷 미생성/이미지 차단/업로드 실패 등)은 Vercel 함수 로그로만 구분 가능하다. */
async function rehostArbitraryImage(supabase: any, imgUrl: string, linkId: string): Promise<string | null> {
  const path = linkId + '.jpg';
  try {
    const { data: existing, error: listError } = await withTimeout(
      supabase.storage.from(LINK_PREVIEW_BUCKET).list('', { search: linkId }),
      5000,
      'Storage list()'
    );
    if (listError) {
      // link-previews 버킷이 아직 없을 때 가장 흔히 나는 에러 — supabase/trip_links.sql 마지막 블록 참고
      console.error('[link-preview] link-previews 버킷 조회 실패(버킷 미생성 가능성):', listError.message);
      return null;
    }
    if (existing && existing.length > 0) {
      const { data: pub } = supabase.storage.from(LINK_PREVIEW_BUCKET).getPublicUrl(path);
      return pub.publicUrl;
    }

    const imgRes = await withTimeout(fetch(imgUrl, { signal: AbortSignal.timeout(6000) }), 6500, 'og:image 다운로드');
    if (!imgRes.ok) {
      console.error('[link-preview] og:image 다운로드 실패(' + imgRes.status + '):', imgUrl);
      return null;
    }
    const contentType = imgRes.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      // og:image가 실제로는 이미지가 아니면 스킵 — 봇 차단 시 HTML(로그인/캡차 페이지)이 오는 경우가 많음
      console.error('[link-preview] og:image가 이미지가 아님(content-type=' + contentType + '):', imgUrl);
      return null;
    }

    const arrayBuffer = await withTimeout(imgRes.arrayBuffer(), 6500, 'og:image 바디 읽기');
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.byteLength > 5_000_000) return null; // 비정상적으로 큰 이미지는 스킵(안전장치)

    const { error: uploadError } = await withTimeout(
      supabase.storage.from(LINK_PREVIEW_BUCKET).upload(path, bytes, { contentType, upsert: true, cacheControl: '2592000' }),
      5000,
      'Storage upload()'
    );
    if (uploadError) {
      console.error('[link-preview] Storage 업로드 실패:', uploadError.message);
      return null;
    }

    const { data: pub } = supabase.storage.from(LINK_PREVIEW_BUCKET).getPublicUrl(path);
    return pub.publicUrl;
  } catch (e) {
    console.error('[link-preview] 이미지 재호스팅 중 예외:', (e as Error).message);
    return null;
  }
}

/** 텔레그램/카카오톡/페이스북 같은 메신저·SNS의 링크 미리보기 봇은 자신을 "일반
 * 브라우저인 척"하지 않고 잘 알려진 크롤러라고 UA에 그대로 밝힌다. 사이트 입장에서는
 * 자기 링크가 그런 앱에서 예쁘게 보이길 원해서 이런 UA는 따로 허용 목록에 넣어 서버
 * 렌더링된 og 태그를 그대로 내려주는 경우가 있다 — 반대로 일반 데스크톱 브라우저인 척하는
 * 요청은 Akamai/Cloudflare 같은 봇 차단에 걸리기 쉽다(트립닷컴에서 실제로 확인 — 텔레그램
 * 봇 UA는 통과하는데 카카오/페이스북 UA와 일반 브라우저 UA는 막힘. 반대로 아고다는
 * 카카오/페이스북 UA에서만 통과. 사이트마다 허용 목록이 달라서 여러 개를 순서대로
 * 시도하는 수밖에 없다). 다만 이건 만능은 아니다 — UA 문자열뿐 아니라 발신 IP까지
 * 실제 크롤러 대역인지 검증하는 사이트에는 UA만 바꿔서는 못 뚫는다(우리 서버는 Vercel의
 * 평범한 클라우드 IP라서). */
const PREVIEW_USER_AGENTS = [
  'TelegramBot (like TwitterBot)',
  'Mozilla/5.0 (compatible; KakaoTalk-Scrap/1.0; +https://devtalk.kakao.com/t/scrap/33984)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

function previewHeaders(userAgent: string): Record<string, string> {
  return {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  };
}

/** 여러 User-Agent를 순서대로 시도해 og:title/og:image가 담긴 응답을 받아온다. 그 중 하나가
 * og 태그를 담은 응답을 주면 바로 반환하고 나머지는 시도하지 않는다. 끝까지 못 찾으면
 * 그나마 마지막으로 받은 HTML(있다면)을 반환 — 완전히 접속 자체가 안 됐을 때만 예외를 던진다.
 * Vercel 서버리스 함수 시간 제한(3-7 참고) 안에 들어오도록 시도별 타임아웃을 짧게 잡는다. */
async function fetchPreviewHtml(targetUrl: string): Promise<string> {
  let lastHtml: string | null = null;
  let lastError: Error | null = null;

  for (const ua of PREVIEW_USER_AGENTS) {
    const started = Date.now();
    try {
      // AbortSignal.timeout()만으로는 리다이렉트 체인 도중이나 body 스트림 단계에서
      // 못 끊는 경우가 실제로 있었다(트립닷컴에서 Vercel 함수 자체가 타임아웃될 때까지
      // 매달린 사례) — withTimeout으로 fetch+본문 읽기 전체를 자바스크립트 레벨에서
      // 한 번 더 강제로 끊는다.
      const html = await withTimeout(
        (async () => {
          const res = await fetch(targetUrl, {
            redirect: 'follow',
            headers: previewHeaders(ua),
            signal: AbortSignal.timeout(4000),
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return (await res.text()).slice(0, 300000); // og 태그는 보통 <head> 안, 문서 앞쪽에 있어 앞부분만으로 충분
        })(),
        4500,
        'fetch(' + ua.slice(0, 24) + ')'
      );
      lastHtml = html;
      if (extractMeta(html, 'og:title') || extractMeta(html, 'og:image')) return html;
    } catch (e) {
      lastError = e as Error;
      console.error('[link-preview] UA 시도 실패(' + (Date.now() - started) + 'ms, ' + ua.slice(0, 24) + '):', lastError.message);
    }
  }

  if (lastHtml !== null) return lastHtml;
  throw lastError ?? new Error('모든 User-Agent 시도 실패');
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
  // 실패했을 때만 로그를 남기면 "로그가 없다"가 성공인지 아예 요청이 서버까지 안 왔는지
  // 구분이 안 된다 — 요청이 실제로 여기까지 들어왔다는 것 자체를 확인할 수 있도록 시작 로그를 남김
  const startedAt = Date.now();
  console.error('[link-preview] 요청 시작:', targetUrl);
  let html = '';
  try {
    html = await fetchPreviewHtml(targetUrl);

    const host = new URL(targetUrl).hostname.replace(/^www\./, '');
    if (host === 'blog.naver.com') {
      const frameSrc = extractMainFrameSrc(html);
      if (frameSrc) {
        try {
          const frameUrl = new URL(frameSrc, targetUrl).toString();
          html = await fetchPreviewHtml(frameUrl);
        } catch (e) {
          console.error('[link-preview] 네이버 블로그 mainFrame 요청 실패(무시):', (e as Error).message);
        }
      } else {
        console.error('[link-preview] 네이버 블로그 mainFrame iframe을 못 찾음:', targetUrl);
      }
    }
  } catch (e) {
    console.error('[link-preview] 페이지를 못 읽음(' + (Date.now() - startedAt) + 'ms, URL 슬러그로 대체):', (e as Error).message);
    return { title: titleFromUrlSlug(targetUrl), imageUrl: null, siteName: null, ogType: null };
  }

  const rawTitle = extractMeta(html, 'og:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null);
  const cleanedTitle = rawTitle ? decodeHtmlEntities(rawTitle).trim().slice(0, 200) || null : null;
  // og:title/<title>이 없거나 도메인 이름만 담은 껍데기 값이면(봇 차단 가능성) URL 슬러그로 폴백
  const title =
    cleanedTitle && !isGenericTitle(cleanedTitle, targetUrl) ? cleanedTitle : titleFromUrlSlug(targetUrl) || cleanedTitle;
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
  } else {
    // og:image/twitter:image 자체가 없는 페이지 — 봇 차단으로 빈 껍데기만 받았을 가능성이 큼
    console.error('[link-preview] og:image 메타 태그를 못 찾음:', targetUrl);
  }

  console.error(
    '[link-preview] 요청 완료(' + (Date.now() - startedAt) + 'ms) — title=' + (title ? 'O' : 'X') + ' image=' + (imageUrl ? 'O' : 'X') + ':',
    targetUrl
  );
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
