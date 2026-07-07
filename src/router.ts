/**
 * 해시 라우터
 *
 * URL 형식: /#login, /#trips, /#board/abc123
 * - 새로고침 안전 (서버는 항상 index.html만 반환하면 됨)
 * - Vercel rewrite 설정 불필요
 */

export interface RouteParams {
  tripId?: string;
}

type RenderFn = (params: RouteParams) => void | Promise<void>;

const routes = new Map<string, RenderFn>();
let notFoundRender: RenderFn | null = null;

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
    // 같은 경로면 해시 이벤트가 안 터지므로 직접 재실행
    handleRoute();
  } else {
    window.location.hash = hash;
  }
}

/** 현재 해시 파싱 → { path, params } */
function parseHash(): { path: string; params: RouteParams } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path = '', tripId] = raw.split('/');
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

/** 라우터 시작 — main.ts가 자체 가드를 통과시킨 뒤 최초 1회 호출 */
export function startRouter(): void {
  handleRoute();
}

/** 현재 라우트를 다시 그리기 (auth 상태 바뀌었을 때 사용) */
export function rerender(): void {
  handleRoute();
}
