/**
 * 페이지별 제목·대표 주소(canonical).
 *
 * 앱 전체가 index.html 하나라 정적인 <title>·canonical은 랜딩(/) 기준이다. 약관·방침을 `/terms`·`/privacy`
 * 경로로도 열 수 있게 되면서, 그 페이지에서는 제목과 canonical이 그 주소를 가리켜야 검색엔진이
 * "랜딩의 복사본"으로 합치지 않는다. 다른 화면으로 가면 처음 값으로 되돌린다.
 */

import type { PathRoute } from './seoFiles';

const TITLES: Record<PathRoute, string> = {
  terms: '이용약관 — 몽실이',
  privacy: '개인정보처리방침 — 몽실이',
};

let base: { title: string; canonical: string | null } | null = null;

function canonicalEl(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
}

/** 처음 한 번, 렌더 전의 값을 기억해 둔다 */
function remember(): { title: string; canonical: string | null } {
  if (!base) base = { title: document.title, canonical: canonicalEl()?.getAttribute('href') ?? null };
  return base;
}

/** 경로형 공개 페이지에 맞춘 제목·canonical을 건다 */
export function applyPageMeta(route: PathRoute): void {
  const b = remember();
  document.title = TITLES[route];
  const el = canonicalEl();
  if (el && b.canonical !== null) {
    // 빌드가 박아 둔 주소의 origin을 그대로 쓴다(도메인을 코드에 두지 않는다). 상대 주소면 현재 origin.
    const origin = new URL(b.canonical, window.location.href).origin;
    el.setAttribute('href', `${origin}/${route}`);
  }
}

/** 처음 값(랜딩 기준)으로 되돌린다 */
export function restorePageMeta(): void {
  if (!base) return; // 한 번도 바꾼 적 없다
  document.title = base.title;
  const el = canonicalEl();
  if (el && base.canonical !== null) el.setAttribute('href', base.canonical);
}
