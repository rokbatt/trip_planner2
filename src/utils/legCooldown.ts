/**
 * 실측 이동시간(/api/route-matrix) 조회 실패를 **잠시 기억**한다.
 *
 * 문제: 성공한 구간만 `realLegs`에 저장하다 보니, 서버가 실패하거나 빈 응답을 주면 그 구간은
 * "아직 안 받은 구간"으로 남아 화면을 열거나 DAY를 넘길 때마다 같은 구간 × 모드 3종을 다시 요청했다.
 * 키·권한 문제로 Routes API가 전부 실패하는 상황에서는 이게 그대로 "요청 폭주 + 오류 100%"가 된다
 * (대시보드에서 하루 671건이 찍힌 원인 중 하나).
 *
 * 실패한 구간은 10분간 다시 묻지 않는다. 사용자가 직접 "다시 불러오기"를 누르면 건너뛴다(`force`).
 */

export const LEG_RETRY_COOLDOWN_MS = 10 * 60_000;

const failedAt = new Map<string, number>();

export function isLegCoolingDown(id: string, now: number = Date.now()): boolean {
  const at = failedAt.get(id);
  if (at == null) return false;
  if (now - at >= LEG_RETRY_COOLDOWN_MS) { failedAt.delete(id); return false; }
  return true;
}

export function markLegsFailed(ids: readonly string[], now: number = Date.now()): void {
  ids.forEach((id) => failedAt.set(id, now));
}

export function clearLegFailures(ids?: readonly string[]): void {
  if (!ids) failedAt.clear();
  else ids.forEach((id) => failedAt.delete(id));
}

/** 응답에 서버가 알려 준 원인(키·권한·한도)이 있으면 콘솔에 그대로 남긴다 */
export function reportRouteError(tag: string, json: unknown): void {
  const err = (json as { error?: { status?: number; message?: string } } | null)?.error;
  if (err && typeof err === 'object') {
    console.error('[' + tag + '] Routes API가 거절했어요 (HTTP ' + err.status + '): ' + err.message +
      ' — GOOGLE_ROUTES_API_KEY / GOOGLE_MAPS_SERVER_KEY의 API 제한·결제·한도를 확인하세요.');
  }
}
