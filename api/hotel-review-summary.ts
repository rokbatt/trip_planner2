/**
 * Vercel 서버리스 함수 — AI 리뷰 요약 (Gemini + Google Search 그라운딩)
 *
 * POST /api/hotel-review-summary
 * body: { placeId?: string, hotelName: string, address?: string, zoneName?: string, destination?: string }
 * response: { pros: string[], cons: string[], tips: string[], sources: {title,uri}[], cached: boolean }
 *
 * 사용자가 "AI 리뷰 요약 보기" 버튼을 눌렀을 때만 호출됨(자동 조회 안 함) — Google Search
 * 그라운딩은 유료 기능이라(Gemini 2.5 계열 기준 일 1,500회 무료, 프로젝트 공유 한도. 초과분은
 * 1,000회당 $35) 반드시 사용자 액션 + DB 캐싱을 통해서만 호출되게 함.
 *
 * 흐름 (DB-first, CLAUDE.md 3-2 캐싱 원칙):
 * 1. hotel_review_summary_cache(placeId 기준) 조회 — 있으면 Gemini 호출 0회
 *    (place_id는 숙소별 전역 키라 유한함 — Claude.md 3-5의 TTL 정리 대상 아님)
 * 2. 없으면 Gemini에 Google Search 툴을 붙여 실제 후기를 검색·종합하게 하고 결과를 캐싱
 *
 * ⚠️ Google Search 그라운딩 + responseMimeType(JSON 강제) 조합은 Gemini 2.x 계열에서
 *    호환성 문제가 보고돼 있어(400 오류) 쓰지 않음 — 대신 프롬프트에 고정 구분자 형식을
 *    요청하고 서버에서 텍스트로 파싱함.
 * ⚠️ 데이터를 지어내지 않기 위해 프롬프트에 "실제로 검색된 내용만 반영"을 명시하고,
 *    그라운딩 출처(sources)를 함께 반환해 화면에서 확인할 수 있게 함(Claude.md 3-1).
 *
 * 필요한 Vercel 환경변수 (서버 전용):
 * - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (캐시; 없거나 테이블 없어도 동작)
 * - GEMINI_API_KEY
 *
 * 캐시 테이블(선택; 없으면 매번 조회): supabase/hotel_review_summary_cache.sql 참고
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

interface ReviewSource {
  title: string;
  uri: string;
}

interface ReviewSummaryResult {
  pros: string[];
  cons: string[];
  tips: string[];
  sources: ReviewSource[];
}

function safeHostname(uri: string): string {
  try {
    return new URL(uri).hostname.replace(/^www\./, '');
  } catch {
    return uri;
  }
}

/** "###MARKER###" 다음 줄부터 다른 마커가 나오기 전까지의 "- " 불릿만 뽑음 */
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
    .slice(0, 6);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { placeId, hotelName, address = '', zoneName = '', destination = '' } = (req.body ?? {}) as Record<string, any>;

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
      .from('hotel_review_summary_cache')
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
    '너는 숙소 리뷰 애널리스트야. Google 검색으로 아래 숙소에 대한 최근 실제 이용자 후기를 찾아서 종합해줘.',
    '',
    '숙소: ' + hotelName,
    address ? '주소: ' + address : '',
    zoneName ? '선택 지역: ' + zoneName : '',
    destination ? '여행지: ' + destination : '',
    '',
    '구글 리뷰, 부킹닷컴, 아고다, 트립어드바이저, 네이버 블로그 및 여행 커뮤니티(게시글/댓글)에서',
    '이 숙소에 대한 최근 실제 후기를 검색해서 찾아줘.',
    '',
    '찾은 내용을 바탕으로 아래 3개 항목에 각각 2~4개의 짧은 불릿(한 줄)으로 요약해줘.',
    '- 장점: 실제 투숙객들이 극찬한 포인트',
    '- 단점 및 주의사항: 소음, 위치 문제, 비추천 이유 등',
    '- 꿀팁: 근처 편의시설, 체크인 팁 등 장단점 외에 도움되는 내용',
    '',
    '실제로 검색된 내용만 반영하고 지어내지 마. 특정 항목에서 관련 후기를 충분히 찾지 못했으면',
    '그 항목엔 "관련 후기를 충분히 찾지 못했어요" 한 줄만 적어.',
    '',
    '다른 설명 없이 정확히 이 형식으로만 응답해:',
    '###PROS###',
    '- ...',
    '###CONS###',
    '- ...',
    '###TIPS###',
    '- ...',
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

  const pros = extractBullets(rawText, '###PROS###', ['###CONS###', '###TIPS###']);
  const cons = extractBullets(rawText, '###CONS###', ['###PROS###', '###TIPS###']);
  const tips = extractBullets(rawText, '###TIPS###', ['###PROS###', '###CONS###']);

  if (pros.length === 0 && cons.length === 0 && tips.length === 0) {
    res.status(502).json({ error: 'Gemini 응답 형식을 해석하지 못했어요.' });
    return;
  }

  const chunks = candidate?.groundingMetadata?.groundingChunks;
  const seen = new Set<string>();
  const sources: ReviewSource[] = Array.isArray(chunks)
    ? chunks
        .map((c: any) => c?.web)
        .filter((w: any) => typeof w?.uri === 'string')
        .filter((w: any) => {
          if (seen.has(w.uri)) return false;
          seen.add(w.uri);
          return true;
        })
        .map((w: any) => ({ title: typeof w.title === 'string' && w.title ? w.title : safeHostname(w.uri), uri: w.uri }))
        .slice(0, 6)
    : [];

  const result: ReviewSummaryResult = { pros, cons, tips, sources };

  if (supabase && placeId) {
    const { error: upsertError } = await supabase
      .from('hotel_review_summary_cache')
      .upsert({ place_id: placeId, result, updated_at: new Date().toISOString() }, { onConflict: 'place_id' });
    if (upsertError) console.error('[hotel-review-summary] 캐싱 실패(응답은 그대로 반환):', upsertError.message);
  }

  res.status(200).json({ ...result, cached: false });
}
