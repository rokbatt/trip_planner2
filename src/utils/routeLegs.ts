/**
 * 구간별 길찾기(`/api/route-matrix`의 legs 경로)를 여러 번에 나눠 부른다.
 *
 * 서버는 구간 하나 × 이동수단 3개마다 Google을 한 번씩 부른다. Cloudflare Workers 무료 플랜은
 * 요청 하나에서 외부 호출을 50번까지만 허용한다(docs/CLOUDFLARE_MIGRATION.md). 그래서
 * 한 번에 12구간(최대 36번 + 로그인·사용량·캐시 확인 몇 번)씩 보내고, 서버도 12구간까지만 받는다.
 * 숫자를 바꾸면 api/route-matrix.ts의 MAX_LEGS도 같이 바꾼다 — routeLegs.test.ts가 둘을 비교한다.
 */
import { apiFetch } from './apiFetch';

export const LEGS_PER_REQUEST = 12;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function chunk<T>(items: T[], size = LEGS_PER_REQUEST): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface LegResultRow {
  id: string;
  // 모양(RealLeg)은 화면 쪽이 정한다 — 여기서는 그대로 전달만
  modes: Record<string, any>;
}

export type RouteLegsReply =
  | { ok: true; json: { results: LegResultRow[]; error?: { status?: number; message?: string } } }
  | { ok: false; status: number; text: string };

/**
 * 묶음을 차례로 보내고 결과를 합친다.
 * - 첫 묶음부터 실패하면 ok:false(예전 한 번 호출과 같은 모양).
 * - 중간 묶음이 실패하거나 키·한도 문제(error)가 오면 거기서 멈추고, 받은 것까지만 돌려준다.
 *   나머지 구간은 호출한 쪽이 평소처럼 "실패"로 표시해 잠시 뒤 다시 묻는다.
 */
export async function requestRouteLegs<L>(
  pending: L[],
  modes: string[],
  fetchImpl: FetchLike = apiFetch
): Promise<RouteLegsReply> {
  const results: LegResultRow[] = [];
  let error: { status?: number; message?: string } | undefined;

  const batches = chunk(pending);
  for (let i = 0; i < batches.length; i++) {
    const res = await fetchImpl('/api/route-matrix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs: batches[i], modes }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (i === 0) return { ok: false, status: res.status, text };
      console.warn('[routeLegs] 묶음 ' + (i + 1) + '/' + batches.length + ' 실패:', res.status, text);
      break;
    }
    const json = await res.json().catch(() => null);
    if (Array.isArray(json?.results)) results.push(...json.results);
    if (json?.error) {
      error = json.error;
      break;
    }
  }
  return { ok: true, json: error ? { results, error } : { results } };
}
