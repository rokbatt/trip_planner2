/**
 * 해시 라우터
 *
 * URL 형식: /#login, /#trips, /#trip/abc123/ideas
 * - 최대 3세그먼트: path / tripId / subPath
 * - 해시가 비어있으면(최초 접속) 'login'을 기본 경로로 사용
 * - 예외: 약관·방침은 검색엔진이 읽을 수 있게 `/terms` · `/privacy` 경로로도 열린다
 *   (해시가 비어 있을 때만. 해시가 있으면 해시가 이긴다 — 기존 `#terms` 링크도 그대로 동작)
 */

import { pathRouteOf } from './seo/seoFiles';
import { applyPageMeta, restorePageMeta } from './seo/pageMeta';

export interface RouteParams {
  tripId?: string;
  subPath?: string;
}

type RenderFn = (params: RouteParams) => void | Promise<void>;

const routes = new Map<string, RenderFn>();
let notFoundRender: RenderFn | null = null;

const DEFAULT_PATH = 'login';

/** 라우트 등록 */
export function addRoute(path: string, render: RenderFn): void {
  routes.set(path, render);
}

/** 404 렌더러 등록 */
export function setNotFound(render: RenderFn): void {
  notFoundRender = render;
}

/**
 * 프로그래밍 방식 이동.
 *
 * `replace: true`면 히스토리에 새 항목을 쌓지 않고 현재 항목을 갈아끼운다. 생략형 주소를
 * 정식 주소로 고쳐 쓸 때(예: `#trip/:id` → `#trip/:id/go`) 꼭 필요하다 — push로 하면
 * 뒤로 가기가 생략형으로 돌아갔다가 다시 정식 주소로 튕겨서 영영 빠져나올 수 없다.
 */
export function navigate(path: string, opts?: { replace?: boolean }): void {
  const hash = '#' + path;
  // 경로형 공개 페이지(/terms)에서 나갈 때 — 주소를 루트로 되돌린다. 안 그러면 `/terms#trips`처럼
  // 주소는 약관인데 화면은 다른 곳이 된다. 약관↔방침 이동은 경로형을 유지한다.
  if (pathRouteOf(window.location.pathname)) {
    const url = pathRouteOf('/' + path) ? '/' + path : '/' + hash;
    history[opts?.replace ? 'replaceState' : 'pushState'](null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  if (window.location.hash === hash) {
    handleRoute();
  } else if (opts?.replace) {
    // hashchange가 안 나므로 라우팅을 직접 한 번 돌린다
    history.replaceState(null, '', hash);
    void handleRoute();
  } else {
    window.location.hash = hash;
  }
}

/** 현재 해시 → path + params (빈 해시는 DEFAULT_PATH로 보정) */
function parseHash(): { path: string; params: RouteParams } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  if (!raw) {
    const route = pathRouteOf(window.location.pathname);
    if (route) return { path: route, params: {} };
  }
  const segments = raw.split('/');
  const path = segments[0] || DEFAULT_PATH;
  const tripId = segments[1] || undefined;
  const subPath = segments[2] || undefined;
  return { path, params: { tripId, subPath } };
}

/** 현재 경로의 첫 세그먼트 반환 */
export function currentPath(): string {
  return parseHash().path;
}

/** 마지막으로 그린 화면의 pathname — 뒤로 가기가 경로를 바꿨는지(popstate) 판단하는 기준 */
let renderedPathname = typeof window === 'undefined' ? '/' : window.location.pathname;

/** 뒤로/앞으로 가기로 pathname이 바뀌었는데 아직 그 화면을 그리지 않았는가.
 *  경로형 공개 페이지(/terms)와 루트(/#login) 사이는 해시만 바뀌는 이동이 아니라서 hashchange가 안 온다. */
export function pathnameChangedSinceRender(): boolean {
  return window.location.pathname !== renderedPathname;
}

/** 현재 해시에 맞는 뷰 렌더 */
async function handleRoute(): Promise<void> {
  renderedPathname = window.location.pathname;
  const { path, params } = parseHash();
  const render = routes.get(path);

  // 약관·방침은 자기 주소를 가리키는 제목·canonical을, 나머지는 처음 값을
  if (path === 'terms' || path === 'privacy') applyPageMeta(path);
  else restorePageMeta();

  if (render) {
    await render(params);
  } else if (notFoundRender) {
    await notFoundRender(params);
  }
}

/** 라우터 시작 */
export function startRouter(): void {
  handleRoute();
}

/** 현재 라우트를 다시 그리기 */
export function rerender(): void {
  handleRoute();
}
