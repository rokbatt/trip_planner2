/**
 * 실패한 /api 요청 한 줄 기록 — Cloudflare Observability 로그에서 "어느 데이터센터(colo)에서 돌았는지" 보려는 용도.
 * Gemini가 "User location is not supported"로 거절할 때 Worker가 실행된 위치를 알아야 해서 넣었다.
 * 주소의 쿼리 부분(검색어 등)은 기록하지 않는다. 성공(<400)은 기록하지 않는다.
 */
export function edgeNote(request: Request, status: number): string | null {
  if (status < 400) return null;
  const cf = ((request as unknown as { cf?: { colo?: string; country?: string } }).cf) ?? {};
  const path = new URL(request.url).pathname;
  return `[worker] ${request.method} ${path} -> ${status} (colo=${cf.colo ?? '?'}, country=${cf.country ?? '?'})`;
}
