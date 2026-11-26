/**
 * ROUTE — AI 일정 클라이언트. 서버(/api/ai)와 주고받는 형태만 담당하고, 상태 반영은 route.ts가 한다.
 *   requestDayOrder   — 코드(planModel.ts)가 정한 Day의 장소들을 방문 순서로(route-plan-day)
 *   requestTripAnchors — 사용자 문서에서 이 여행지 도착·출발 찾기(trip-anchors)
 *   requestDayDetail  — 특정 DAY의 세부 일정·예산(참고용)
 * 캐싱은 전부 서버에서 한다(Claude.md 3-2).
 */

import { apiFetch } from '../utils/apiFetch';

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
    res = await apiFetch('/api/ai', {
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

export interface PlanPoint {
  name: string;
  lat: number | null;
  lng: number | null;
}

export interface DayOrderRequest {
  destinationId: string;
  destinationName: string;
  dayIndex: number;
  startTime: string;
  endTime: string;
  start: PlanPoint | null;
  end: PlanPoint | null;
  places: AiPlanPlace[];
  planNotes: string | null;
}

export interface DayOrderResult {
  summary: string;
  order: string[];
  /** 모든 장소가 순서에 들어왔는지 — 아니면 화면이 거리순으로 대신한다 */
  complete: boolean;
  cached: boolean;
}

export function requestDayOrder(req: DayOrderRequest): Promise<DayOrderResult> {
  return postAi<DayOrderResult>({ kind: 'route-plan-day', ...req });
}

export type AnchorMode = 'FLIGHT' | 'TRAIN' | 'BUS' | 'OTHER';
export interface TripAnchor {
  date: string;
  time: string | null;
  place: string | null;
  mode: AnchorMode;
  /** 근거 문서 제목 */
  source: string;
}

export interface TripAnchorsRequest {
  destinationName: string;
  startDate: string;
  endDate: string;
  prevDestinationName: string | null;
  nextDestinationName: string | null;
  docs: Array<{ title: string; lines: string[] }>;
}

export function requestTripAnchors(req: TripAnchorsRequest): Promise<{ arrival: TripAnchor | null; departure: TripAnchor | null }> {
  return postAi({ kind: 'trip-anchors', ...req });
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
