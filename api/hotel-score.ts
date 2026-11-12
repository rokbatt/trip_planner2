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

// ── 장소 확인 (BEGIN — api/ai.ts·hotel-score.ts·nearby-infra.ts·nearby-search.ts에 같은 내용이 있다. 고치면 넷 다 고친다) ──
/* 캐시 키는 Google 장소 ID인데 내용(이름·주소·좌표)을 화면이 보내면, 누군가 남의 장소 ID에 가짜 값을 넣어
 * 모든 사용자에게 보이는 캐시를 오염시킬 수 있다. 그래서 캐시를 새로 만들 땐 서버가 Google에서 직접 확인한
 * 값만 쓰고, 확인하지 못하면 결과는 돌려주되 캐시에는 남기지 않는다(Claude.md 5-11).
 * 요금: 좌표만 = Place Details Essentials, 이름까지 = Pro. 둘 다 장소당 캐시를 처음 만들 때 1회뿐이다. */
const VERIFY_PLACE_ID_RE = /^[A-Za-z0-9_-]{10,300}$/;

interface VerifiedPlace {
  name: string | null;
  address: string | null;
  lat: number;
  lng: number;
}

export async function lookupPlace(placeId: unknown, serverKey: string | undefined, withName: boolean): Promise<VerifiedPlace | null> {
  if (typeof placeId !== 'string' || !VERIFY_PLACE_ID_RE.test(placeId) || !serverKey) return null;
  const fields = withName ? 'displayName,formattedAddress,location' : 'location';
  try {
    const res = await fetch('https://places.googleapis.com/v1/places/' + placeId + '?languageCode=ko', {
      headers: { 'X-Goog-Api-Key': serverKey, 'X-Goog-FieldMask': fields },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error('[verify-place] Google 장소 확인 실패(' + res.status + ') — 이번 결과는 캐시에 남기지 않음');
      return null;
    }
    const data: any = await res.json();
    const lat = data?.location?.latitude;
    const lng = data?.location?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      name: typeof data?.displayName?.text === 'string' ? data.displayName.text : null,
      address: typeof data?.formattedAddress === 'string' ? data.formattedAddress : null,
      lat,
      lng,
    };
  } catch (e) {
    console.error('[verify-place] Google 장소 확인 오류 — 이번 결과는 캐시에 남기지 않음:', (e as Error).message);
    return null;
  }
}
// ── 장소 확인 (END) ──

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
  const serverKey = process.env.GOOGLE_MAPS_SERVER_KEY;

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

  // 캐시(placeId 기준, 모든 사용자 공유)를 새로 만들 땐 숙소 이름·주소를 Google에서 직접 확인한 값으로 쓴다.
  // 화면이 보내는 나머지 값은 여행마다 다른 맥락이라 그대로 쓰되, 길이·범위를 제한한다.
  const verified = await lookupPlace(placeId, serverKey, true);
  const canCache = !!verified;
  const short = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
  const num = (v: unknown, min: number, max: number): number | null => {
    const n = Number(v);
    return v == null || v === '' || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, Math.round(n * 10) / 10));
  };
  const vName = verified?.name || short(hotelName, 120);
  const vAddress = verified?.address || short(address, 200);
  const vZone = short(zoneName, 60);
  const vDest = short(destination, 60);
  const vBudget = short(budgetLabel, 60);
  const vRating = num(googleRating, 0, 5);
  const vWalkable = num(nearby?.walkableCount, 0, 500);
  const vAvgWalk = num(nearby?.avgWalkMin, 0, 300);
  const vFacilities = num(nearby?.facilityCount, 0, 50);

  const prompt = [
    '너는 여행 숙소를 "여행 거점(base)"으로서 얼마나 적합한지 평가하는 애널리스트야.',
    '아래 숙소를 여행 거점 관점에서 정형화된 기준으로 채점해줘.',
    '',
    '숙소: ' + vName,
    vAddress ? '주소: ' + vAddress : '',
    vZone ? '선택 지역: ' + vZone : '',
    vDest ? '여행지: ' + vDest : '',
    vRating != null ? 'Google 평점: ' + vRating : '',
    vBudget ? '예산대: ' + vBudget : '',
    vWalkable != null ? '도보권(15분 내) 장소 수: ' + vWalkable : '',
    vAvgWalk != null ? '주변 장소 평균 이동시간(분): ' + vAvgWalk : '',
    vFacilities != null ? '주변 편의시설 종류 수: ' + vFacilities : '',
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

  if (canCache && supabase && placeId) {
    const { error: upsertError } = await supabase
      .from('hotel_score_cache')
      .upsert({ place_id: placeId, result, updated_at: new Date().toISOString() }, { onConflict: 'place_id' });
    if (upsertError) console.error('[hotel-score] 캐싱 실패(응답은 그대로 반환):', upsertError.message);
  }

  res.status(200).json({ ...result, cached: false });
}
