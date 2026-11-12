/**
 * 검색엔진용 파일(sitemap.xml · robots.txt 한 줄 · 소유확인 메타 태그) 만드는 순수 함수.
 *
 * vite.config.ts(빌드 때)가 쓰고, 테스트가 같은 함수를 검증한다. 브라우저 코드가 아니다.
 *
 * 사이트맵에는 "로그인 없이 볼 수 있는 페이지"만 넣는다. 트립 안쪽(#trip/…)은 해시 라우터 위에 있어
 * 크롤러가 구분하지 못하고, 초대받은 멤버만 보는 공간이라 색인 대상도 아니다.
 */

/** 색인할 공개 페이지. 새 공개 페이지(예: 목적지 소개)를 만들면 여기에 더한다 */
export const PUBLIC_PATHS = ['/', '/terms', '/privacy'] as const;

/** 뒤에 붙은 슬래시를 뗀다 — 템플릿이 `%SITE_URL%/`처럼 슬래시를 직접 붙이기 때문 */
export function normalizeOrigin(raw: string | undefined | null): string {
  return (raw ?? '').trim().replace(/\/+$/, '');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * sitemap.xml 본문. 주소는 절대 URL이어야 하므로 origin이 없으면 null(만들지 않는다).
 * `lastmod`는 일부러 넣지 않는다 — 빌드 날짜는 "내용이 바뀐 날"이 아니고, 틀린 값은 없는 것보다 나쁘다.
 */
export function buildSitemap(origin: string, paths: readonly string[] = PUBLIC_PATHS): string | null {
  const base = normalizeOrigin(origin);
  if (!base) return null;
  const urls = paths.map((p) => `  <url><loc>${escapeXml(base + p)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** robots.txt 끝에 Sitemap 줄을 붙인다. 이미 있으면 다시 붙이지 않는다 */
export function appendSitemapLine(robots: string, origin: string): string {
  const base = normalizeOrigin(origin);
  if (!base || /^sitemap:/im.test(robots)) return robots;
  return robots.replace(/\s*$/, '\n') + `\nSitemap: ${base}/sitemap.xml\n`;
}

/**
 * 검색엔진 소유확인 메타 태그. 값은 구글 서치 콘솔·네이버 서치어드바이저가 계정마다 발급하는 코드라
 * 저장소에 박지 않고 배포 환경변수(VITE_GOOGLE_SITE_VERIFICATION · VITE_NAVER_SITE_VERIFICATION)로 받는다.
 */
export function verificationTags(opts: { google?: string; naver?: string }): string {
  const tag = (name: string, value: string | undefined) => {
    const v = (value ?? '').trim();
    // 코드 문자열 말고는 들어올 수 없게 — 따옴표·꺾쇠가 있으면 태그를 깨뜨리므로 버린다
    return v && /^[A-Za-z0-9_\-=.:]+$/.test(v) ? `<meta name="${name}" content="${v}" />` : '';
  };
  return [tag('google-site-verification', opts.google), tag('naver-site-verification', opts.naver)]
    .filter(Boolean)
    .join('\n  ');
}

/** 경로형 공개 페이지 — 해시 없이 `/terms` 로 직접 열리는 주소 */
export const PATH_ROUTES = ['terms', 'privacy'] as const;
export type PathRoute = (typeof PATH_ROUTES)[number];

/** `/terms`, `/privacy/`, `/Terms` 같은 pathname이 경로형 공개 페이지면 그 이름을, 아니면 null */
export function pathRouteOf(pathname: string): PathRoute | null {
  const p = pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  return (PATH_ROUTES as readonly string[]).includes(p) ? (p as PathRoute) : null;
}
