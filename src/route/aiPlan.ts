/**
 * ROUTE — Gemini 기반 AI 일정 추천 클라이언트.
 *
 * 서버(/api/ai)와 주고받는 형태만 담당하고, 상태 반영은 route.ts가 한다.
 * 세 가지 기능:
 *   requestRoutePlan  — Brainstorm 장소들을 DAY별로 배분(무료) — 매크로→Day별 세부 2단계로
 *                        오케스트레이션(아래 설명)
 *   requestDayDetail  — 특정 DAY의 세부 일정·예산(참고용, 추후 프리미엄)
 *
 * ⚠️ 캐싱은 전부 서버에서 한다(Claude.md 3-2). 클라이언트는 매번 호출해도 되고,
 *    입력이 그대로면 서버가 캐시로 답해 Gemini 호출은 0회다. 그래서 여기서 별도로
 *    로컬 캐시를 두지 않는다 — 두면 "다른 멤버가 만든 추천"을 못 받아오고 상태가 갈라진다.
 *
 * requestRoutePlan이 매크로→세부로 나뉜 이유 — 예전엔 여행 전체를 프롬프트 1번에 다 몰아서
 * 짰는데, 그러면 Day마다 다른 사정(도착일이라 일정 없음, 마사지는 저녁에 등)을 반영할 여지가
 * 뭉개졌다. 이제 먼저 매크로 호출 1번으로 Day별 테마+장소 풀을 겹치지 않게 나누고, 그 다음
 * Day마다 그 풀만 보고 세부 배치를 병렬로 호출한다 — 장소 풀이 서로 안 겹치니 병렬이어도
 * 중복 배치가 안 생기고, 각 Day 호출은 훨씬 짧고 구체적인 프롬프트를 받는다.
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

/** 숙소를 나눈 여행 — 어느 DAY 구간(0-based, inclusive)에 어느 숙소를 쓰는지 */
export interface AiStaySegment {
  startDayIndex: number;
  endDayIndex: number;
  basecamp: AiPlanPlace | null;
}

export interface RoutePlanRequest {
  destinationId: string;
  destinationName: string;
  dayCount: number;
  startDate: string | null;
  /** DAY별 숙소 — 숙소를 안 나눴으면 구간 1개. 반드시 dayIndex 오름차순, 빈틈/중복 없이 이어져야 함 */
  staySegments: AiStaySegment[];
  /** DAY 1의 진짜 시작점(공항) — 없으면 DAY 1도 기존처럼 숙소에서 시작하는 것으로 취급 */
  arrivalAirport: string | null;
  arrivalTime: string | null;
  /** 마지막 DAY의 진짜 종료점(공항) — 있으면 그 시각 전에 여유 있게 일정을 마무리하도록 함 */
  departureAirport: string | null;
  departureTime: string | null;
  places: AiPlanPlace[];
  /** 사용자가 직접 남긴 자유 텍스트 요청사항(여행 컨셉/니즈/특정 Day 지시 등) — 원문 그대로 프롬프트에 전달됨 */
  planNotes: string | null;
}

interface RoutePlanMacroDay {
  dayIndex: number;
  theme: string;
  empty: boolean;
  placeIds: string[];
}

interface RoutePlanMacroResult {
  days: RoutePlanMacroDay[];
  notes: string;
  cached: boolean;
}

interface RoutePlanDayResult {
  dayIndex: number;
  summary: string;
  stops: Array<{ placeId: string; arriveTime: string | null }>;
  cached: boolean;
}

/** 이 dayIndex가 속한 숙소 구간의 숙소(basecamp) — 서버 handleRoutePlanDay가 "오늘 여기서 출발/도착"으로 씀 */
function basecampForDayIndex(segments: AiStaySegment[], dayIndex: number): AiPlanPlace | null {
  const seg = segments.find((s) => dayIndex >= s.startDayIndex && dayIndex <= s.endDayIndex);
  return seg?.basecamp ?? null;
}

/** 진행 상황 콜백 — "Day 2/6 짜는 중…" 같은 UI 표시용. done은 매크로 포함 완료된 호출 수 */
export type RoutePlanProgress = (done: number, total: number) => void;

export async function requestRoutePlan(req: RoutePlanRequest, onProgress?: RoutePlanProgress): Promise<AiRoutePlanResult> {
  const placeById = new Map(req.places.map((p) => [p.id, p]));

  const macro = await postAi<RoutePlanMacroResult>({
    kind: 'route-plan-macro',
    destinationId: req.destinationId,
    destinationName: req.destinationName,
    dayCount: req.dayCount,
    startDate: req.startDate,
    staySegments: req.staySegments,
    arrivalAirport: req.arrivalAirport,
    arrivalTime: req.arrivalTime,
    departureAirport: req.departureAirport,
    departureTime: req.departureTime,
    places: req.places,
    planNotes: req.planNotes,
  });

  const dayCalls = macro.days.filter((d) => !d.empty && d.placeIds.length > 0);
  const total = 1 + dayCalls.length;
  let done = 1;
  onProgress?.(done, total);

  const dayResults = await Promise.all(
    dayCalls.map(async (d): Promise<RoutePlanDayResult> => {
      const isArrivalDay = d.dayIndex === 0 && !!(req.arrivalAirport || req.arrivalTime);
      const isDepartureDay = d.dayIndex === req.dayCount - 1 && !!(req.departureAirport || req.departureTime);
      const places = d.placeIds.map((id) => placeById.get(id)).filter((p): p is AiPlanPlace => !!p);
      try {
        const r = await postAi<{ dayIndex: number; summary: string; stops: Array<{ placeId: string; arriveTime: string | null }>; cached: boolean }>({
          kind: 'route-plan-day',
          destinationId: req.destinationId,
          destinationName: req.destinationName,
          dayIndex: d.dayIndex,
          dayCount: req.dayCount,
          theme: d.theme,
          basecamp: basecampForDayIndex(req.staySegments, d.dayIndex),
          isArrivalDay,
          isDepartureDay,
          arrivalAirport: isArrivalDay ? req.arrivalAirport : null,
          arrivalTime: isArrivalDay ? req.arrivalTime : null,
          departureAirport: isDepartureDay ? req.departureAirport : null,
          departureTime: isDepartureDay ? req.departureTime : null,
          places,
          planNotes: req.planNotes,
        });
        return { dayIndex: d.dayIndex, summary: r.summary, stops: r.stops, cached: r.cached };
      } finally {
        done += 1;
        onProgress?.(done, total);
      }
    })
  );

  // 매크로가 Day별로 이미 겹치지 않게 나눴지만, 혹시 모를 오류에 대비해 전역으로 한 번 더 중복 제거
  const usedGlobal = new Set<string>();
  const days: AiRoutePlanDay[] = macro.days.map((md) => {
    const dr = dayResults.find((r) => r.dayIndex === md.dayIndex);
    if (!dr) return { dayIndex: md.dayIndex, summary: md.theme, stops: [] };
    const stops = dr.stops.filter((s) => {
      if (usedGlobal.has(s.placeId)) return false;
      usedGlobal.add(s.placeId);
      return true;
    });
    return { dayIndex: md.dayIndex, summary: dr.summary || md.theme, stops };
  });

  const unusedPlaceIds = req.places.map((p) => p.id).filter((id) => !usedGlobal.has(id));
  const cached = macro.cached && dayResults.every((r) => r.cached);

  return { days, notes: macro.notes, unusedPlaceIds, cached };
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
