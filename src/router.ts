/**
 * 해시 라우터
 *
 * URL 형식: /#login, /#trips, /#trip/abc123/ideas
 * - 최대 3세그먼트: path / tripId / subPath
 * - 해시가 비어있으면(최초 접속) 'login'을 기본 경로로 사용
 */

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

/** 프로그래밍 방식 이동 */
export function navigate(path: string): void {
  const hash = '#' + path;
  if (window.location.hash === hash) {
    handleRoute();
  } else {
    window.location.hash = hash;
  }
}

/** 현재 해시 → path + params (빈 해시는 DEFAULT_PATH로 보정) */
function parseHash(): { path: string; params: RouteParams } {
  const raw = window.location.hash.replace(/^#\/?/, '');
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

/** 현재 해시에 맞는 뷰 렌더 */
async function handleRoute(): Promise<void> {
  const { path, params } = parseHash();
  const render = routes.get(path);

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
