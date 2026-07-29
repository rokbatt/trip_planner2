/**
 * ROUTE — Gemini 기반 AI 일정 추천 클라이언트.
 *
 * 서버(/api/ai)와 주고받는 형태만 담당하고, 상태 반영은 route.ts가 한다.
 * 두 가지 기능:
 *   requestRoutePlan  — Brainstorm 장소들을 DAY별로 배분(무료)
 *   requestDayDetail  — 특정 DAY의 세부 일정·예산(참고용, 추후 프리미엄)
 *
 * ⚠️ 캐싱은 전부 서버에서 한다(Claude.md 3-2). 클라이언트는 매번 호출해도 되고,
 *    입력(장소 목록/숙소/DAY 수)이 그대로면 서버가 캐시로 답해 Gemini 호출은 0회다.
 *    그래서 여기서 별도로 로컬 캐시를 두지 않는다 — 두면 "다른 멤버가 만든 추천"을
 *    못 받아오고 상태가 두 곳으로 갈라진다.
 */

/** 서버에 보내는 장소 한 건 — 우리가 이미 갖고 있는 사실 정보만 담는다(지어낸 값 없음) */
export interface AiPlanPlace {
  id: string;
  name: string;
  category?: string | null;
  mood?: string | null;
  rating?: number | null;
  lat?: number | null;
  lng?: number | null;
  /** Google이 준 요일별 영업시간(weekday_text). AI가 "운영시간 우선"으로 배치하는 근거 */
  hours?: string[] | null;
  /** day-detail 요청에서만 사용 — 화면이 계산한 도착 예정 시각 */
  arriveTime?: string | null;
}

export interface AiRoutePlanDay {
  dayIndex: number;
  summary: string;
  stops: Array<{ placeId: string; arriveTime: string | null }>;
}

export interface AiRoutePlanResult {
  days: AiRoutePlanDay[];
  notes: string;
  /** AI가 일정에 넣지 않은 장소들 — "왜 빠졌나"를 화면에서 알려주기 위해 */
  unusedPlaceIds: string[];
  cached: boolean;
}

export interface AiDayDetailResult {
  overview: string;
  stops: Array<{
    placeId: string;
    stayMinutes: number | null;
    highlights: string[];
    tip: string;
    costText: string;
  }>;
  extras: Array<{ time: string; title: string; detail: string }>;
  budget: { lines: Array<{ label: string; amountText: string }>; totalText: string };
  cautions: string[];
  cached: boolean;
}

/** 서버가 준 에러 메시지를 그대로 살려서 던진다(화면에서 사용자에게 보여줌) */
async function postAi<T>(body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

export interface RoutePlanRequest {
  destinationId: string;
  destinationName: string;
  dayCount: number;
  startDate: string | null;
  basecamp: AiPlanPlace | null;
  places: AiPlanPlace[];
}

export function requestRoutePlan(req: RoutePlanRequest): Promise<AiRoutePlanResult> {
  return postAi<AiRoutePlanResult>({ kind: 'route-plan', ...req });
}

export interface DayDetailRequest {
  destinationId: string;
  destinationName: string;
  dayIndex: number;
  dayLabel: string;
  date: string;
  currency: string;
  headcount: number | null;
  stops: AiPlanPlace[];
}

export function requestDayDetail(req: DayDetailRequest): Promise<AiDayDetailResult> {
  return postAi<AiDayDetailResult>({ kind: 'day-detail', ...req });
}
