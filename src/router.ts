/**
 * 해시 라우터
 *
 * URL 형식: /#/trips, /#/board/abc123, /#/itinerary/abc123
 * 새로고침·배포 에러 없음 (서버는 항상 index.html만 반환)
 */

export interface Route {
  /** 패턴: 'board/:tripId' 같은 형식 */
  path: string;
  /** 뷰 렌더 함수 — #app 내부를 그린다 */
  render: (params: Record<string, string>) => void | Promise<void>;
}

let routes: Route[] = [];
let notFound: (() => void) | null = null;
let beforeEach: ((to: string) => boolean | string) | null = null;

/**
 * 라우터 초기화
 */
export function createRouter(config: {
  routes: Route[];
  notFound?: () => void;
  beforeEach?: (to: string) => boolean | string;
}): void {
  routes = config.routes;
  notFound = config.notFound ?? null;
  beforeEach = config.beforeEach ?? null;

  // 해시 변경 감지
  window.addEventListener('hashchange', () => resolve());
  // 최초 로드
  resolve();
}

/**
 * 프로그래밍 방식 이동
 */
export function navigate(path: string): void {
  const hash = path.startsWith('#') ? path : `#/${path}`;
  window.location.hash = hash;
  // hashchange 이벤트가 자동으로 resolve() 호출
}

/**
 * 현재 해시에서 매칭되는 라우트 찾아 렌더
 */
function resolve(): void {
  // '#/board/abc123' → 'board/abc123'
  const hash = window.location.hash.replace(/^#\/?/, '');

  // 가드
  if (beforeEach) {
    const result = beforeEach(hash);
    if (result === false) return;
    if (typeof result === 'string' && result !== hash) {
      navigate(result);
      return;
    }
  }

  const segments = hash.split('/').filter(Boolean);

  for (const route of routes) {
    const params = matchRoute(route.path, segments);
    if (params !== null) {
      route.render(params);
      return;
    }
  }

  notFound?.();
}

/**
 * 패턴 매칭: 'board/:tripId' vs ['board', 'abc123']
 * 매칭 시 { tripId: 'abc123' } 반환, 실패 시 null
 */
function matchRoute(
  pattern: string,
  segments: string[]
): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);

  if (patternParts.length !== segments.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(segments[i]);
    } else if (part !== segments[i]) {
      return null;
    }
  }

  return params;
}

/**
 * 현재 라우트 경로 반환 (해시 제거)
 */
export function currentPath(): string {
  return window.location.hash.replace(/^#\/?/, '');
}
