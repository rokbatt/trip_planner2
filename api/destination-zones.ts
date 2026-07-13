/**
 * Vercel 서버리스 함수 — 여행지별 "숙박 생활권" 목록
 *
 * POST /api/destination-zones
 * body: { destination: string }
 * response: { zones: [{ name, features, lat, lng }], source: 'curated' | 'ai_fallback' }
 *
 * 흐름:
 * 1. stay_zones(큐레이션 DB, 조사·검수된 고정 데이터)에서 이 여행지를 먼저 찾음
 * 2. 있으면 그대로 반환 — AI 호출 전혀 안 함 (이게 기본 경로여야 함)
 * 3. 큐레이션 DB에 아직 없는 여행지면, 어쩔 수 없이 Gemini로 폴백
 *    (이 경로는 "관광명소"가 아니라 "실제 숙박 생활권"만 나오도록 프롬프트를 엄격하게 제한함.
 *     단, AI 폴백 결과는 별도 검수 없이 그대로 쓰이므로 큐레이션 데이터보다 신뢰도가 낮음.
 *     장기적으로는 자주 검색되는 여행지를 stay_zones에 수동으로 추가하는 게 맞음.)
 *
 * 필요한 Vercel 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY(폴백용)
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

interface ZoneSeed {
  name: string;
  features: string[];
  lat: number;
  lng: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const destination: string | undefined = req.body?.destination;
  if (!destination || !destination.trim()) {
    res.status(400).json({ error: 'destination이 필요해요.' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: '서버 환경변수(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았어요.' });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // 1. 큐레이션 DB 먼저 조회 (조사·검수된 고정 데이터, AI 아님)
  const { data: curated, error: selectError } = await supabase
    .from('stay_zones')
    .select('name, features, lat, lng')
    .eq('destination', destination)
    .order('sort_order', { ascending: true });

  if (selectError) {
    res.status(500).json({ error: 'DB 조회 실패: ' + selectError.message });
    return;
  }

  if (curated && curated.length > 0) {
    res.status(200).json({ zones: curated, source: 'curated' });
    return;
  }

  // 2. 큐레이션 DB에 없는 여행지 — AI 폴백 (신뢰도가 큐레이션보다 낮음, 프롬프트로 최대한 제한)
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    // 폴백조차 불가능하면 빈 배열 반환 (프론트에서 "지원 안 되는 여행지" 처리)
    res.status(200).json({ zones: [], source: 'unsupported' });
    return;
  }

  const prompt = [
    destination + '에서 여행자가 "숙소를 잡는 기준"으로 삼는 실제 생활권(거주/숙박 지역) 이름을 8~12개 알려줘.',
    '',
    '엄격한 조건:',
    '- 반드시 "동네/생활권" 단위여야 함. 예: 방콕이면 Sukhumvit, Siam, Silom, Riverside, Old Town 같은 것.',
    '- 특정 관광명소, 쇼핑몰, 랜드마크, 건물 이름은 절대 지역명으로 쓰지 마.',
    '  (예: "아이콘시암", "아시아틱", "왓아룬"처럼 하나의 장소/건물 이름은 금지 — 이런 건 생활권이 아니라 그 안의 개별 POI임)',
    '- 실제로 그 동네에 호텔/숙소가 밀집되어 있어서 여행자가 "여기서 묵을까?"라고 고민하는 지역이어야 함',
    '- 행정구역 공식 명칭이 아니라 여행자·현지인이 실제로 부르는 이름으로',
    '- 이름은 한국 여행자들이 실제로 쓰는 한국어 표기로 (번역이 아니라 통용되는 한글 표기, 예: "수쿰빗", "시암")',
    '',
    '각 생활권마다 이름, 대표 특징(2~4글자 단어 2~3개), 그 생활권의 대략적인 중심 위도/경도를 줘.',
    '아래 JSON 배열 형식으로만 응답하고 다른 텍스트는 절대 붙이지 마:',
    '[{"name":"수쿰빗","features":["나이트라이프","맛집","교통 편리"],"lat":13.7356,"lng":100.5562}, ...]',
  ].join('\n');

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

  let zones: ZoneSeed[];
  try {
    zones = JSON.parse(rawText);
  } catch (e) {
    res.status(502).json({ error: 'Gemini 응답 JSON 파싱 실패' });
    return;
  }

  const isValid = Array.isArray(zones) && zones.every(
    (z) => Array.isArray(z.features) && typeof z.name === 'string' && Number.isFinite(z.lat) && Number.isFinite(z.lng)
  );
  if (!isValid) {
    res.status(502).json({ error: 'Gemini 응답 형태가 예상과 달라요.' });
    return;
  }

  // 참고: AI 폴백 결과는 검수 전이라 stay_zones에 자동 저장하지 않음.
  // 이 여행지가 자주 검색되면 관리자가 조사 후 stay_zones에 수동으로 넣는 게 맞음.
  res.status(200).json({ zones, source: 'ai_fallback' });
}
