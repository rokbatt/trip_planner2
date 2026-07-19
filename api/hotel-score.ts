/**
 * Vercel 서버리스 함수 — 여행 효율 점수 (Phase 2, Gemini 정형 채점)
 *
 * POST /api/hotel-score
 * body: {
 *   placeId?: string,
 *   hotelName: string,
 *   address?: string,
 *   zoneName?: string,
 *   destination?: string,
 *   googleRating?: number | null,
 *   budgetLabel?: string,
 *   nearby?: { walkableCount?: number, avgWalkMin?: number, facilityCount?: number }
 * }
 * response: { score, grade, ratings: {이동편의성,관광접근성,편의시설,위치만족도,가성비}, cached }
 *
 * 흐름 (DB-first):
 * 1. hotel_score_cache(placeId 기준) 조회 — 있으면 Gemini 호출 안 함
 * 2. 없으면 Gemini로 "정형화된 채점표" 산출 → 검증 → 캐싱 → 반환
 *
 * ⚠️ 이 점수는 AI가 입력 정보(위치·평점·주변 시설 요약 등)를 바탕으로 평가한 값이며,
 *    실제 이용자 리뷰 점수가 아님. 화면에도 "AI 분석"으로 표기함.
 * ⚠️ 안전도(야간)는 신뢰할 수 있는 실측 소스가 없어 채점 항목에서 제외함.
 *
 * 필요한 Vercel 환경변수 (서버 전용):
 * - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (캐시; 없거나 테이블 없어도 동작)
 * - GEMINI_API_KEY
 *
 * 캐시 테이블(선택):
 *   create table if not exists hotel_score_cache (
 *     place_id text primary key,
 *     result jsonb not null,
 *     updated_at timestamptz not null default now()
 *   );
 */

import { createClient } from '@supabase/supabase-js';

declare const process: { env: Record<string, string | undefined> };

interface VercelRequest {
  method?: string;
  body?: any;
}
interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (body: any) => void;
}

const RATING_KEYS = ['이동편의성', '관광접근성', '편의시설', '위치만족도', '가성비'] as const;

interface ScoreResult {
  score: number;
  grade: string;
  ratings: Record<(typeof RATING_KEYS)[number], number>;
}

function clampInt(n: any, min: number, max: number, fallback: number): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function gradeFor(score: number): string {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 55) return 'Fair';
  return 'Basic';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const {
    placeId,
    hotelName,
    address = '',
    zoneName = '',
    destination = '',
    googleRating = null,
    budgetLabel = '',
    nearby = {},
  } = (req.body ?? {}) as Record<string, any>;

  if (!hotelName || !String(hotelName).trim()) {
    res.status(400).json({ error: 'hotelName이 필요해요.' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

  if (supabase && placeId) {
    const { data: existing } = await supabase
      .from('hotel_score_cache')
      .select('result')
      .eq('place_id', placeId)
      .maybeSingle();
    if (existing?.result) {
      res.status(200).json({ ...existing.result, cached: true });
      return;
    }
  }

  if (!geminiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았어요.' });
    return;
  }

  const prompt = [
    '너는 여행 숙소를 "여행 거점(base)"으로서 얼마나 적합한지 평가하는 애널리스트야.',
    '아래 숙소를 여행 거점 관점에서 정형화된 기준으로 채점해줘.',
    '',
    '숙소: ' + hotelName,
    address ? '주소: ' + address : '',
    zoneName ? '선택 지역: ' + zoneName : '',
    destination ? '여행지: ' + destination : '',
    googleRating != null ? 'Google 평점: ' + googleRating : '',
    budgetLabel ? '예산대: ' + budgetLabel : '',
    nearby?.walkableCount != null ? '도보권(15분 내) 장소 수: ' + nearby.walkableCount : '',
    nearby?.avgWalkMin != null ? '주변 장소 평균 이동시간(분): ' + nearby.avgWalkMin : '',
    nearby?.facilityCount != null ? '주변 편의시설 종류 수: ' + nearby.facilityCount : '',
    '',
    '채점 기준(각 1~5 정수, 5가 가장 좋음):',
    '- 이동편의성: 대중교통·도보로 다른 장소에 가기 얼마나 편한가',
    '- 관광접근성: 주요 관광지·명소와 얼마나 가까운가',
    '- 편의시설: 편의점·카페·마트·약국 등 생활 인프라가 얼마나 가까운가',
    '- 위치만족도: 여행 거점으로서 위치가 얼마나 만족스러운가',
    '- 가성비: 예산대 대비 위치·조건이 합리적인가',
    '',
    '그리고 종합점수(score)는 0~100 정수로, 위 5개 항목을 종합해서 매겨줘.',
    '주어진 정보가 부족하면 무리하게 확신하지 말고 보수적으로(중간값 쪽으로) 채점해.',
    '아래 JSON 형식으로만 응답하고 다른 텍스트는 절대 붙이지 마:',
    '{"score": 0~100, "ratings": {"이동편의성":1~5,"관광접근성":1~5,"편의시설":1~5,"위치만족도":1~5,"가성비":1~5}}',
  ]
    .filter(Boolean)
    .join('\n');

  let geminiRes: Response;
  try {
    geminiRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + geminiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      }
    );
  } catch (e) {
    res.status(502).json({ error: 'Gemini 요청 네트워크 오류: ' + (e as Error).message });
    return;
  }

  if (!geminiRes.ok) {
    const errText = await geminiRes.text();
    res.status(502).json({ error: 'Gemini 요청 실패 (' + geminiRes.status + '): ' + errText });
    return;
  }

  const geminiData: any = await geminiRes.json();
  const rawText: string | undefined = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    res.status(502).json({ error: 'Gemini 응답에서 텍스트를 찾지 못했어요.' });
    return;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    res.status(502).json({ error: 'Gemini 응답 JSON 파싱 실패' });
    return;
  }

  const ratings = {} as ScoreResult['ratings'];
  for (const k of RATING_KEYS) ratings[k] = clampInt(parsed?.ratings?.[k], 1, 5, 3);
  const score = clampInt(parsed?.score, 0, 100, 60);

  const result: ScoreResult = { score, grade: gradeFor(score), ratings };

  if (supabase && placeId) {
    const { error: upsertError } = await supabase
      .from('hotel_score_cache')
      .upsert({ place_id: placeId, result, updated_at: new Date().toISOString() }, { onConflict: 'place_id' });
    if (upsertError) console.error('[hotel-score] 캐싱 실패(응답은 그대로 반환):', upsertError.message);
  }

  res.status(200).json({ ...result, cached: false });
}
