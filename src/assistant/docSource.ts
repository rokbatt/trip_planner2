/**
 * 어시스턴트가 문서 하나를 어떤 글로 읽을지 정하는 순수 규칙(import 없음 — 테스트가 Supabase 없이 돈다).
 *
 * 파일이 있는 문서의 요약(digest)은 **파일에서 뽑은 사실**이다. 그런데 사용자는 파일을 다시 올리지
 * 않고 세부내용·예약번호만 고쳐 쓰는 일이 많다(예: 항공편 시간이 바뀌어 설명에 새 시간을 적는다).
 * 그 직접 입력한 내용을 빼면 AI는 원본 파일의 옛 값으로 답한다. 그래서 사용자가 입력한 정보를
 * 파일 요약 **앞에** 붙이고, 서버(doc-qa)가 충돌할 때 이쪽을 우선하도록 라벨로 알린다.
 */

/** 서버 doc-qa 프롬프트가 이 라벨을 보고 "직접 입력한 쪽이 최신"으로 취급한다 — 바꾸면 api/ai.ts도 같이 */
export const USER_INFO_LABEL = '직접 입력한 정보';

interface DocInfoLike {
  description: string | null;
  reference_code: string | null;
}

/** 문서에 사용자가 직접 적어 둔 내용을 한 줄로. 없으면 null */
export function userEnteredParts(doc: DocInfoLike): string[] {
  const description = (doc.description ?? '').trim();
  const reference = (doc.reference_code ?? '').trim();
  return [description, reference ? '예약번호 ' + reference : ''].filter((v) => v.length > 0);
}

/**
 * 파일이 있는 문서의 최종 글 — 직접 입력한 정보(있으면) + 파일에서 뽑은 사실.
 * 둘 다 없으면 null(그 문서는 자료에서 뺀다).
 */
export function composeFileDocDigest(doc: DocInfoLike, facts: readonly string[]): string | null {
  const parts = userEnteredParts(doc);
  const lines: string[] = [];
  if (parts.length) lines.push(USER_INFO_LABEL + '(파일 내용과 다르면 이쪽이 최신): ' + parts.join(' · '));
  lines.push(...facts.map((f) => f.trim()).filter(Boolean));
  return lines.length ? lines.join('\n') : null;
}

/**
 * 문서·메모 자료를 다시 불러와야 하나.
 * - 문서/메모를 고쳤다는 신호를 받았으면(stale) 바로
 * - 신호가 없어도 오래됐으면 — 다른 멤버가 고친 것은 이 탭이 신호를 받지 못한다
 */
export function needsSourceRefresh(input: { stale: boolean; lastLoadedAt: number; now: number; maxAgeMs: number }): boolean {
  return input.stale || input.now - input.lastLoadedAt > input.maxAgeMs;
}
