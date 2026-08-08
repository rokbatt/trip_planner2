/**
 * TIMELINE 장소 상세 패널 — Gemini 기반 "장소 한눈에 보기" 클라이언트.
 *
 * 서버(`/api/ai`, `kind: 'place-brief'`)와 주고받는 형태만 담당하고, 상태 반영은 timeline.ts가 한다.
 * 요약 / 놓치지 말 것 / 가기 전 확인사항을 **한 번의 호출로 같이** 받는다 — 섹션별로 나눠 부르면
 * 같은 장소에 Gemini를 세 번 부르게 되는데 어차피 같은 맥락으로 쓰는 내용이라 나눌 이유가 없다.
 *
 * ⚠️ 캐싱은 전부 서버에서 한다(Claude.md 3-2). 캐시 키가 장소 신원이라, 같은 장소를 여러 DAY에
 *    담아도·다른 멤버가 열어도 Gemini 호출은 처음 한 번뿐이다. 그래서 여기 로컬 캐시를 두지
 *    않는다 — 두면 남이 만든 결과를 못 받고 상태가 갈라진다(route/aiPlan.ts와 같은 이유).
 *
 * ⚠️ 원칙 3-1 — 여기서 오는 값은 전부 **AI가 쓴 참고 정보**다. 실시간 정보가 아니고 요금·운영
 *    정책은 자주 바뀌므로, 화면에서는 반드시 "AI" 표시와 함께 보여주고 우리 DB의 실제 값
 *    (영업시간·주소·평점)과 같은 위계로 섞어 놓지 않는다.
 */

/** 서버에 보내는 장소 정보 — 우리가 이미 갖고 있는 사실만 담는다(지어낸 값 없음) */
export interface PlaceBriefRequest {
  name: string;
  googlePlaceId?: string | null;
  category?: string | null;
  address?: string | null;
  destination?: string | null;
  rating?: number | null;
  /** Google이 준 요일별 영업시간(weekdayDescriptions) */
  hours?: string[] | null;
}

export interface PlaceBriefMissItem {
  title: string;
  detail: string;
}

export interface PlaceBrief {
  summary: string;
  keywords: string[];
  bestTime: string;
  dontMiss: PlaceBriefMissItem[];
  beforeYouGo: {
    booking: string;
    dress: string;
    cash: string;
    tips: string[];
  };
  cached: boolean;
}

/**
 * 캐시 키와 같은 기준으로 만드는 클라이언트 측 장소 식별자 — 화면이 "이 장소의 브리핑을 이미
 * 받아 놨는지"를 판단하는 데 쓴다. 서버의 identity 계산(`googlePlaceId || name|address`)과
 * 같은 규칙이어야 같은 장소를 두 번 부르지 않는다.
 */
export function placeBriefKey(req: PlaceBriefRequest): string {
  return (req.googlePlaceId || '').trim() || req.name + '|' + (req.address ?? '');
}

/**
 * 서버가 준 에러 메시지를 그대로 살려서 던진다(화면에서 사용자에게 보여줌).
 * `refresh`를 주면 서버가 캐시를 건너뛰고 새로 생성한다 — 예전 응답에 일부 항목이 비어 있던
 * 경우(모델이 필드를 빼먹은 결과가 캐시에 박힌 경우) 다시 생성할 수 있어야 하기 때문이다.
 */
export async function requestPlaceBrief(req: PlaceBriefRequest, refresh = false): Promise<PlaceBrief> {
  let res: Response;
  try {
    res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'place-brief', ...req, refresh }),
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

  return {
    summary: String(json?.summary ?? ''),
    keywords: Array.isArray(json?.keywords) ? json.keywords.map((k: any) => String(k)) : [],
    bestTime: String(json?.bestTime ?? ''),
    dontMiss: Array.isArray(json?.dontMiss)
      ? json.dontMiss.map((d: any) => ({ title: String(d?.title ?? ''), detail: String(d?.detail ?? '') }))
      : [],
    beforeYouGo: {
      booking: String(json?.beforeYouGo?.booking ?? ''),
      dress: String(json?.beforeYouGo?.dress ?? ''),
      cash: String(json?.beforeYouGo?.cash ?? ''),
      tips: Array.isArray(json?.beforeYouGo?.tips) ? json.beforeYouGo.tips.map((t: any) => String(t)) : [],
    },
    cached: !!json?.cached,
  };
}
