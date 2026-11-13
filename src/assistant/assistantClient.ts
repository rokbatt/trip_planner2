/**
 * DOCUMENTS 기반 AI 어시스턴트 — 서버(`/api/ai`, kind: 'doc-digest' | 'doc-qa')와 주고받는
 * 형태만 담당한다. 상태 반영은 assistant.ts가 한다(placeBrief.ts와 같은 역할 분리).
 *
 * ⚠️ 캐싱은 전부 서버에서 한다(Claude.md 3-2) — doc-digest는 문서당 1회만 Gemini를
 *    부르고(ai_plan_cache, updated_at이 바뀌면 재생성), doc-qa는 같은 질문+자료 조합이면
 *    캐시를 그대로 쓴다. 여기 로컬 캐시를 따로 두지 않는다(placeBrief.ts와 같은 이유 —
 *    두면 다른 멤버가 이미 만들어둔 결과를 못 받고 상태가 갈라진다).
 *
 * ⚠️ 원칙 3-1 — 여기서 오는 답변은 전부 "문서/메모 내용을 바탕으로 AI가 정리한 것"이다.
 *    화면에서는 반드시 그렇게 표시하고, 실제로 참고한 자료 제목(usedTitles)을 같이 보여줘서
 *    사용자가 원본으로 다시 확인할 수 있게 한다.
 */

import { apiFetch } from '../utils/apiFetch';

async function postAi<T>(payload: Record<string, unknown>): Promise<T> {
  // apiFetch가 로그인 토큰을 붙인다 — 서버가 "누가 어떤 문서를 읽는지" 확인한다(doc-digest는 토큰이 없으면 401)
  let res: Response;
  try {
    res = await apiFetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('네트워크 연결을 확인해 주세요.');
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* 본문이 JSON이 아닌 경우(게이트웨이 오류 등) — 아래에서 상태코드로 처리 */
  }
  if (!res.ok) {
    throw new Error(typeof json?.error === 'string' ? json.error : 'AI 요청에 실패했어요. (' + res.status + ')');
  }
  return json as T;
}

/** 서버는 documentId만 믿는다 — 파일 경로·종류·수정 시각은 서버가 DB에서 다시 읽는다(남의 파일을 지목하지 못하게) */
export interface DocDigestRequest {
  documentId: string;
  title: string;
  category: string;
  filePath: string;
  fileType: string;
  updatedAt: string;
}

export interface DocDigestResult {
  readable: boolean;
  facts: string[];
  /** 서버에 저장돼 있던 요약인지(true) AI가 방금 새로 읽었는지(false) */
  cached: boolean;
}

/** 문서 파일 하나를 읽어 핵심 사실 몇 줄로 요약받는다 — 문서당 보통 세션 중 1회만 호출 */
export async function requestDocDigest(req: DocDigestRequest): Promise<DocDigestResult> {
  const json = await postAi<{ readable?: boolean; facts?: unknown[]; cached?: boolean }>({ kind: 'doc-digest', ...req });
  return {
    cached: json.cached === true,
    readable: json.readable !== false,
    facts: Array.isArray(json.facts) ? json.facts.map((f) => String(f)) : [],
  };
}

/** 어시스턴트가 참고하는 자료 하나 — 파일에서 뽑아낸 digest거나(문서), 사용자가 직접 쓴
 *  메모 본문이거나, 파일 없이 메타데이터만 있는 문서의 필드 조합이다 */
export interface AssistantSource {
  title: string;
  category: string;
  kind: 'document' | 'note';
  digest: string;
}

export interface AssistantAnswer {
  answer: string;
  usedTitles: string[];
}

export async function requestAssistantAnswer(
  tripId: string,
  question: string,
  sources: AssistantSource[]
): Promise<AssistantAnswer> {
  const json = await postAi<{ answer?: string; usedTitles?: unknown[] }>({
    kind: 'doc-qa',
    tripId,
    question,
    sources,
  });
  return {
    answer: String(json.answer ?? ''),
    usedTitles: Array.isArray(json.usedTitles) ? json.usedTitles.map((t) => String(t)) : [],
  };
}
