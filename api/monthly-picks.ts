/**
 * Vercel 서버리스 함수 — AI Monthly Picks
 *
 * POST /api/monthly-picks
 * body: { destination: string }
 *
 * 흐름:
 * 1. Supabase(ai_monthly_picks)에서 [destination + 이번 달] 캐시 먼저 조회
 * 2. 있으면 그대로 반환 (Gemini 호출 안 함)
 * 3. 없으면 Gemini 호출 → JSON 응답 파싱 → DB에 캐싱 → 반환
 *
 * 필요한 Vercel 환경변수 (전부 서버 전용, VITE_ 접두사 아님 — 브라우저에 노출 안 됨):
 * - SUPABASE_URL               (기존 VITE_SUPABASE_URL과 같은 값이어도 됨)
 * - SUPABASE_SERVICE_ROLE_KEY  (Supabase 대시보드 → Settings → API → service_role 키)
 * - GEMINI_API_KEY             (Google AI Studio에서 발급)
 */

// 이 프로젝트엔 @types/node를 추가하지 않아서 최소한의 타입만 선언
// (Vercel 배포 환경에는 실제 Node.js process 객체가 있음)
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

const GATE_KEYS = ['가고싶어', '먹고싶어', '하고싶어', '숙소'] as const;

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

  const now = new Date();
  const yearMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

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
    .from('ai_monthly_picks')
    .select('picks')
    .eq('destination', destination)
    .eq('year_month', yearMonth)
    .maybeSingle();

  if (selectError) {
    res.status(500).json({ error: 'DB 조회 실패: ' + selectError.message });
    return;
  }

  if (existing) {
    res.status(200).json({ picks: existing.picks, cached: true });
    return;
  }

  // 2. 캐시 없음 → Gemini 호출
  if (!geminiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았어요.' });
    return;
  }

  const prompt = [
    destination + ' 여행 시 ' + now.getFullYear() + '년 ' + (now.getMonth() + 1) + '월에 방문하기 좋은 실제 장소를 추천해줘.',
    '카테고리별로 정확히 5개씩, 실제로 존재하는 구체적인 장소명(가게명/관광지명)만 골라줘. 설명 없이 이름만.',
    '아래 JSON 형식으로만 응답하고 다른 텍스트는 절대 붙이지 마:',
    '{"가고싶어": ["장소1","장소2","장소3","장소4","장소5"], "먹고싶어": ["...5개"], "하고싶어": ["...5개"], "숙소": ["...5개"]}',
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

  let picks: Record<string, string[]>;
  try {
    picks = JSON.parse(rawText);
  } catch (e) {
    res.status(502).json({ error: 'Gemini 응답 JSON 파싱 실패' });
    return;
  }

  // 응답 형태 최소 검증 (게이트 4개 키 + 배열)
  const isValid = GATE_KEYS.every((k) => Array.isArray(picks[k]));
  if (!isValid) {
    res.status(502).json({ error: 'Gemini 응답 형태가 예상과 달라요.' });
    return;
  }

  // 3. DB에 캐싱 (동시 요청 경쟁 대비 upsert)
  const { error: upsertError } = await supabase
    .from('ai_monthly_picks')
    .upsert(
      { destination, year_month: yearMonth, picks },
      { onConflict: 'destination,year_month' }
    );

  if (upsertError) {
    console.error('캐싱 실패(응답은 그대로 반환):', upsertError.message);
  }

  res.status(200).json({ picks, cached: false });
}
