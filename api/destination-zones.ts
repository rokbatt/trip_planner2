/**
 * Vercel 서버리스 함수 — 여행지별 유명 지역 목록 (캐싱)
 *
 * POST /api/destination-zones
 * body: { destination: string }
 * response: { zones: [{ name, keyword, lat, lng }], cached: boolean }
 *
 * 흐름:
 * 1. destination_zones 테이블에서 이 여행지가 이미 있는지 먼저 확인
 * 2. 있으면 그대로 반환 (Gemini 호출 안 함) — 다른 트립이 같은 여행지를 가도 재사용됨
 * 3. 없으면 Gemini에 "이 도시의 유명 지역 5~8개 + 대략적인 중심 좌표"를 한 번만 물어보고 캐싱
 *
 * 주의: 좌표는 Gemini의 학습 지식 기반 근사치임 (정밀 측량 좌표 아님).
 * 장소를 "가장 가까운 유명 지역"에 배정하는 용도로는 충분하지만,
 * 정밀한 경계선이 필요한 용도로는 쓰면 안 됨.
 *
 * 필요한 Vercel 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY
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
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: '서버 환경변수(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았어요.' });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // 1. DB 먼저 조회
  const { data: existing, error: selectError } = await supabase
    .from('destination_zones')
    .select('zones')
    .eq('destination', destination)
    .maybeSingle();

  if (selectError) {
    res.status(500).json({ error: 'DB 조회 실패: ' + selectError.message });
    return;
  }

  if (existing) {
    res.status(200).json({ zones: existing.zones, cached: true });
    return;
  }

  // 2. 캐시 없음 → Gemini 호출 (이 여행지에 대해 딱 한 번만)
  if (!geminiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았어요.' });
    return;
  }

  const prompt = [
    destination + '를 여행하는 사람들이 흔히 구분해서 부르는 유명 지역/동네를 5~8개 알려줘.',
    '각 지역마다 그 지역다운 짧은 이름(5글자 이내), 그 지역의 특징을 나타내는 키워드 2~4개(각 2~5글자, 예: "맛집 천국","쇼핑","나이트라이프","교통 편리"), 대략적인 중심 위도/경도를 줘.',
    '행정구역 공식 명칭이 아니라 여행자들이 실제로 부르는 지역 이름으로.',
    '아래 JSON 배열 형식으로만 응답하고 다른 텍스트는 절대 붙이지 마:',
    '[{"name":"올드타운","features":["역사·문화","전통","관광 명소"],"lat":13.75,"lng":100.49}, ...]',
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
    (z) => typeof z.name === 'string' && Array.isArray(z.features) && typeof z.lat === 'number' && typeof z.lng === 'number'
  );
  if (!isValid) {
    res.status(502).json({ error: 'Gemini 응답 형태가 예상과 달라요.' });
    return;
  }

  // 3. DB에 캐싱 (동시 요청 경쟁 대비 upsert)
  const { error: upsertError } = await supabase
    .from('destination_zones')
    .upsert({ destination, zones }, { onConflict: 'destination' });

  if (upsertError) {
    console.error('캐싱 실패(응답은 그대로 반환):', upsertError.message);
  }

  res.status(200).json({ zones, cached: false });
}
