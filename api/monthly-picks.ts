/**
 * Vercel 서버리스 함수 — AI Monthly Picks
 *
 * POST /api/monthly-picks
 * body: { destination: string }
 *
 * 흐름:
 * 1. Supabase(ai_monthly_picks)에서 [destination + 이번 달] 캐시 먼저 조회
 * 2. 있으면 그대로 반환 (Gemini 호출 안 함)
 * 3. 없으면 Gemini + Google Search 그라운딩 호출 → 텍스트 파싱 → DB에 캐싱 → 반환
 *
 * ⚠️ Google Search 그라운딩 없이(모델 학습 지식만으로) 이 프롬프트를 실행하면 "마사지",
 *    "루프탑 바"처럼 실제 장소명이 아니라 카테고리/업종명만 지어내는 경우가 있었음(실사용
 *    보고). 그래서 hotel-review-summary.ts와 동일하게 Google Search 그라운딩 툴을 붙여
 *    실제 검색된 장소만 적게 함. 그라운딩 + JSON 강제 응답(responseMimeType) 조합은
 *    Gemini 2.x 계열에서 호환성 문제(400 오류)가 보고돼 있어, 고정 구분자 텍스트 포맷을
 *    요청하고 서버에서 파싱함.
 * ⚠️ Google Search 그라운딩은 유료 기능(Gemini 2.5 계열 기준 일 1,500회 무료, 프로젝트
 *    공유 한도, 초과분은 1,000회당 $35)이지만, destination+월 단위로 DB 캐싱되므로 같은
 *    달에 같은 여행지를 보는 모든 사용자가 캐시를 공유해 호출이 매우 드묾.
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
const GATE_MARKERS: Record<(typeof GATE_KEYS)[number], string> = {
  가고싶어: '###가고싶어###',
  먹고싶어: '###먹고싶어###',
  하고싶어: '###하고싶어###',
  숙소: '###숙소###',
};

/** "###MARKER###" 다음 줄부터 다른 마커가 나오기 전까지의 "- " 불릿만 뽑음 (최대 5개) */
function extractBullets(text: string, marker: string, otherMarkers: string[]): string[] {
  const startIdx = text.indexOf(marker);
  if (startIdx === -1) return [];
  let section = text.slice(startIdx + marker.length);
  for (const m of otherMarkers) {
    const idx = section.indexOf(m);
    if (idx !== -1) section = section.slice(0, idx);
  }
  return section
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-'))
    .map((l) => l.replace(/^-+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5);
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

  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const prompt = [
    '너는 여행 컨시어지야. Google 검색으로 실제 정보를 확인하고 답해.',
    '',
    destination + ' 여행, ' + year + '년 ' + month + '월 기준으로 방문객에게 추천할 장소를 골라줘.',
    '',
    '조건(검색해서 확인):',
    '- 실제 운영 중인 곳만 (폐업/휴업 제외)',
    '- 최근 평판과 리뷰 경향을 반영',
    '- 한국 관광객들 사이에서 만족도가 높거나 인기 있는 곳 우선 (블로그·인기도 고려)',
    '- ' + month + '월 계절/날씨에 적합한 곳',
    '- 대중교통이나 도보로 접근 가능한 곳',
    '- 혼잡도가 지나치게 높지 않은 곳 우선 고려',
    '- 현재 공사/리모델링 중인 곳 제외',
    '- 카테고리 간 중복 장소 없이',
    '',
    '⚠️ 반드시 검색해서 찾은 구체적인 장소명(가게 상호명/관광지 고유명사)만 적어.',
    '⚠️ "마사지", "루프탑 바", "카페"처럼 업종/카테고리 이름만 쓰면 안 됨 — 예를 들어',
    '   "루프탑 바"가 아니라 검색으로 찾은 실제 상호명(예: "옥토버 루프탑 바")을 적어.',
    '',
    '카테고리별로 정확히 5개씩. 다른 설명 없이 정확히 이 형식으로만 응답해:',
    GATE_MARKERS.가고싶어,
    '- 장소1',
    '- 장소2',
    '- 장소3',
    '- 장소4',
    '- 장소5',
    GATE_MARKERS.먹고싶어,
    '- (5개)',
    GATE_MARKERS.하고싶어,
    '- (5개)',
    GATE_MARKERS.숙소,
    '- (5개)',
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
          tools: [{ google_search: {} }],
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
  const candidate = geminiData?.candidates?.[0];
  const rawText: string | undefined = Array.isArray(candidate?.content?.parts)
    ? candidate.content.parts
        .map((p: any) => p?.text)
        .filter((t: any) => typeof t === 'string')
        .join('\n')
    : undefined;

  if (!rawText) {
    res.status(502).json({ error: 'Gemini 응답에서 텍스트를 찾지 못했어요.' });
    return;
  }

  const allMarkers = Object.values(GATE_MARKERS);
  const picks: Record<string, string[]> = {};
  for (const key of GATE_KEYS) {
    const marker = GATE_MARKERS[key];
    picks[key] = extractBullets(rawText, marker, allMarkers.filter((m) => m !== marker));
  }

  // 응답 형태 최소 검증 (게이트 4개 전부 최소 1곳 이상)
  const isValid = GATE_KEYS.every((k) => picks[k].length > 0);
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
