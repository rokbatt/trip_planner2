/**
 * 검색엔진 파일 생성 테스트.
 * 도메인을 아직 모르는 빌드(origin 없음)에서 깨진 사이트맵을 내보내지 않는 것,
 * 소유확인 값에 태그를 깨는 문자가 못 들어오는 것, 경로형 공개 페이지 판정이 정확한 것을 본다.
 */
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_PATHS,
  appendSitemapLine,
  buildSitemap,
  normalizeOrigin,
  pathRouteOf,
  verificationTags,
} from './seoFiles';

describe('buildSitemap', () => {
  it('공개 페이지를 절대 주소로 나열한다', () => {
    const xml = buildSitemap('https://mongsil.app')!;
    for (const p of PUBLIC_PATHS) expect(xml).toContain(`<loc>https://mongsil.app${p}</loc>`);
    expect(xml.startsWith('<?xml')).toBe(true);
  });

  it('주소 뒤 슬래시는 정리한다 — 루트가 //로 나오면 안 된다', () => {
    const xml = buildSitemap('https://mongsil.app///')!;
    expect(xml).toContain('<loc>https://mongsil.app/</loc>');
    expect(xml).not.toContain('app//');
  });

  it('도메인을 모르면 만들지 않는다 (상대 주소 사이트맵은 검색엔진이 거부한다)', () => {
    expect(buildSitemap('')).toBeNull();
    expect(buildSitemap('   ')).toBeNull();
  });

  it('틀릴 수 있는 lastmod는 넣지 않는다', () => {
    expect(buildSitemap('https://mongsil.app')).not.toContain('lastmod');
  });

  it('XML에서 의미가 있는 문자는 이스케이프한다', () => {
    expect(buildSitemap('https://a.test', ['/x?a=1&b=2'])).toContain('/x?a=1&amp;b=2');
  });
});

describe('appendSitemapLine', () => {
  const robots = 'User-agent: *\nDisallow: /api/\n';

  it('robots.txt 끝에 사이트맵 줄을 붙인다', () => {
    expect(appendSitemapLine(robots, 'https://mongsil.app')).toMatch(/\nSitemap: https:\/\/mongsil\.app\/sitemap\.xml\n$/);
  });

  it('이미 있으면 다시 붙이지 않는다 (빌드를 두 번 돌려도 한 줄)', () => {
    const once = appendSitemapLine(robots, 'https://mongsil.app');
    expect(appendSitemapLine(once, 'https://mongsil.app')).toBe(once);
  });

  it('도메인을 모르면 그대로 둔다', () => {
    expect(appendSitemapLine(robots, '')).toBe(robots);
  });

  it('기존 규칙은 건드리지 않는다', () => {
    expect(appendSitemapLine(robots, 'https://mongsil.app')).toContain('Disallow: /api/');
  });
});

describe('verificationTags', () => {
  it('값이 있는 것만 태그로 만든다', () => {
    expect(verificationTags({ google: 'abc_DEF-123' })).toBe('<meta name="google-site-verification" content="abc_DEF-123" />');
    expect(verificationTags({ naver: 'n4v3r' })).toBe('<meta name="naver-site-verification" content="n4v3r" />');
  });

  it('둘 다 있으면 두 줄', () => {
    expect(verificationTags({ google: 'g', naver: 'n' }).split('\n').length).toBe(2);
  });

  it('비어 있으면 아무것도 내보내지 않는다 — 빈 태그를 남기지 않는다', () => {
    expect(verificationTags({})).toBe('');
    expect(verificationTags({ google: '  ', naver: undefined })).toBe('');
  });

  it('태그를 깨뜨리는 값은 버린다', () => {
    expect(verificationTags({ google: '"><script>alert(1)</script>' })).toBe('');
    expect(verificationTags({ naver: 'a b' })).toBe('');
  });
});

describe('pathRouteOf', () => {
  it('경로형 공개 페이지를 알아본다', () => {
    expect(pathRouteOf('/terms')).toBe('terms');
    expect(pathRouteOf('/privacy')).toBe('privacy');
    expect(pathRouteOf('/privacy/')).toBe('privacy');
    expect(pathRouteOf('/Terms')).toBe('terms');
  });

  it('그 밖의 주소는 null — 루트, 앱 경로, 비슷한 이름', () => {
    expect(pathRouteOf('/')).toBeNull();
    expect(pathRouteOf('')).toBeNull();
    expect(pathRouteOf('/trips')).toBeNull();
    expect(pathRouteOf('/terms-of-use')).toBeNull();
    expect(pathRouteOf('/api/terms')).toBeNull();
  });
});
