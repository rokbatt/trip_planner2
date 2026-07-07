// src/router.ts
/**
 * 해시 라우터
 *
 * URL 형식: /#login, /#trips, /#board/abc123
 * - 새로고침 안전 (서버는 항상 index.html만 반환하면 됨)
 * - Vercel rewrite 설정 불필요
 * - 빈 해시('/' 또는 '')는 항상 'login'으로 취급 (가드 로직과 반드시 일치시킬 것)
 */

export interface RouteParams {
  tripId?: string;
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
  const hash = `#${path}`;
  if (window.location.hash === hash) {
    handleRoute();
  } else {
    window.location.hash = hash;
  }
}

/** 현재 해시 파싱 → { path, params } — 빈 값이면 DEFAULT_PATH로 통일 */
function parseHash(): { path: string; params: RouteParams } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [rawPath = '', tripId] = raw.split('/');
  const path = rawPath === '' ? DEFAULT_PATH : rawPath;
  return { path, params: tripId ? { tripId } : {} };
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

/** 현재 경로 문자열 반환 (main.ts 가드에서 사용, parseHash와 동일 기준) */
export function currentPath(): string {
  return parseHash().path;
}

/** 라우터 시작 — main.ts가 자체 가드를 통과시킨 뒤 최초 1회 호출 */
export function startRouter(): void {
  handleRoute();
}

/** 현재 라우트를 다시 그리기 (auth 상태 바뀌었을 때 사용) */
export function rerender(): void {
  handleRoute();
}
