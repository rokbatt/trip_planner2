/**
 * Vercel 서버리스 함수 — Gemini 기반 AI 기능 모음
 *
 * POST /api/ai — 요청 body의 `kind`로 분기한다.
 *   kind 생략 | 'hotel-review' : 숙소 AI 리뷰 요약 (Google Search 그라운딩)
 *   kind 'route-plan'          : Brainstorm 장소들을 DAY별로 배분하는 일정 추천
 *   kind 'day-detail'          : 특정 DAY의 세부 일정·예산 추천(참고용)
 *
 * ⚠️ 왜 한 파일에 다 들어있나 — Vercel Hobby 플랜은 **배포당 서버리스 함수 12개**가 한도라
 *    (Claude.md 3-7) 새 엔드포인트 파일을 만들 수 없다. 그래서 route-matrix.ts가 body 형태로
 *    분기하는 것과 같은 방식으로, Gemini를 쓰는 기능을 이 파일에 모아 `kind`로 분기한다.
 *    (destination-zones/monthly-picks/hotel-score도 Gemini를 쓰므로, 나중에 함수 슬롯이
 *     더 필요해지면 같은 방식으로 여기에 합칠 수 있다.)
 *
 * 공통 원칙
 * - 전부 **사용자가 버튼을 눌렀을 때만** 호출된다(자동 호출 없음).
 * - 전부 DB-first 캐싱(Claude.md 3-2) — 캐시가 있으면 Gemini 호출 0회.
 * - 추천/추정값은 응답에 그대로 "AI 추천"임을 드러내고, 화면에서도 사실과 구분해 표시한다
 *   (Claude.md 3-1 — 지어낸 값을 확정 정보처럼 보여주지 않는다).
 *
 * 필요한 Vercel 환경변수 (서버 전용):
 * - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (캐시; 없거나 테이블 없어도 동작)
 * - GEMINI_API_KEY
 *
 * 캐시 테이블(선택; 없으면 매번 조회):
 *   supabase/hotel_review_summary_cache.sql  (hotel-review)
 *   supabase/ai_plan_cache.sql               (route-plan, day-detail)
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

declare const process: { env: Record<string, string | undefined> };

interface VercelRequest {
  method?: string;
  body?: any;
}
interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (body: any) => void;
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

/**
 * 캐시 키용 결정적 해시. Node 내장 crypto를 쓰지 않는 이유 — 이 프로젝트는 api/를
 * tsconfig에서 제외해 @types/node가 없어서, 내장 모듈을 import하면 타입이 깨진다.
 * 32bit 해시 2개를 이어 붙여 충돌 확률을 낮춘 값이면 캐시 키로는 충분하다.
 */
function stableHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xc2b2ae35;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

// ReturnType<typeof createClient>로 쓰면 테이블 행 타입이 never로 좁혀져 select 결과를
// 못 읽는다(이 프로젝트는 api/에 Database 타입을 물리지 않으므로 느슨한 형태로 둔다).
type SupabaseLike = SupabaseClient<any, 'public', any>;

function makeSupabase(): SupabaseLike | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}

/** ai_plan_cache 조회 — 테이블이 없거나 오류면 조용히 무시하고 새로 생성하게 둔다 */
async function readPlanCache(supabase: SupabaseLike | null, cacheKey: string): Promise<any | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('ai_plan_cache').select('result').eq('cache_key', cacheKey).maybeSingle();
  if (error) return null;
  return data?.result ?? null;
}

async function writePlanCache(
  supabase: SupabaseLike | null,
  cacheKey: string,
  kind: string,
  result: any
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('ai_plan_cache')
    .upsert({ cache_key: cacheKey, kind, result, updated_at: new Date().toISOString() }, { onConflict: 'cache_key' });
  if (error) console.error('[ai] ' + kind + ' 캐싱 실패(응답은 그대로 반환):', error.message);
}

/** Gemini 호출 + JSON 응답 파싱. 실패 사유는 문자열로 돌려 호출부가 상태코드를 정한다 */
async function callGeminiJson(
  model: string,
  geminiKey: string,
  prompt: string,
  responseSchema: any
): Promise<{ data?: any; error?: string }> {
  let geminiRes: Response;
  try {
    geminiRes = await fetch(GEMINI_ENDPOINT + model + ':generateContent?key=' + geminiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0.4 },
      }),
    });
  } catch (e) {
    return { error: 'Gemini 요청 네트워크 오류: ' + (e as Error).message };
  }
  if (!geminiRes.ok) {
    return { error: 'Gemini 요청 실패 (' + geminiRes.status + '): ' + (await geminiRes.text()) };
  }
  const payload: any = await geminiRes.json();
  const text: string | undefined = payload?.candidates?.[0]?.content?.parts
    ?.map((p: any) => p?.text)
    .filter((t: any) => typeof t === 'string')
    .join('');
  if (!text) return { error: 'Gemini 응답에서 텍스트를 찾지 못했어요.' };
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { error: 'Gemini가 JSON 형식으로 응답하지 않았어요.' };
  }
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

  // kind 생략 = 기존 숙소 리뷰 요약 (이 파일이 hotel-review-summary.ts였을 때의 호출 형태 호환)
  const kind = String((req.body ?? {}).kind ?? 'hotel-review');
  if (kind === 'route-plan') return handleRoutePlan(req, res);
  if (kind === 'day-detail') return handleDayDetail(req, res);
  return handleHotelReview(req, res);
}

/* ══════════════════ 1. 숙소 AI 리뷰 요약 (기존 기능) ══════════════════ */

async function handleHotelReview(req: VercelRequest, res: VercelResponse) {
  const { placeId, hotelName, address = '', zoneName = '', destination = '' } = (req.body ?? {}) as Record<string, any>;

  if (!hotelName || !String(hotelName).trim()) {
    res.status(400).json({ error: 'hotelName이 필요해요.' });
    return;
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const supabase = makeSupabase();

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

/* ══════════════════ 2. AI 일정 짜기 (DAY별 장소 배분) ══════════════════ */

/** 프롬프트가 무한정 커지지 않도록 하는 상한 — 초과분은 평점 높은 순으로 자른다 */
const MAX_PLAN_PLACES = 80;

interface PlanPlaceIn {
  id: string;
  name: string;
  category?: string | null;
  mood?: string | null;
  rating?: number | null;
  lat?: number | null;
  lng?: number | null;
  hours?: string[] | null;
}

/** 장소 한 줄 요약 — 토큰을 아끼려고 있는 정보만 짧게 붙인다 */
function planPlaceLine(tag: string, p: PlanPlaceIn): string {
  const bits = [tag + ' ' + p.name];
  if (p.category) bits.push('분류:' + p.category);
  if (p.mood) bits.push('사용자태그:' + p.mood);
  if (typeof p.rating === 'number') bits.push('평점:' + p.rating);
  if (p.lat != null && p.lng != null) bits.push('좌표:' + p.lat.toFixed(4) + ',' + p.lng.toFixed(4));
  if (Array.isArray(p.hours) && p.hours.length) bits.push('영업시간:' + p.hours.join(' / '));
  return bits.join(' | ');
}

const ROUTE_PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    days: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          dayIndex: { type: 'INTEGER' },
          summary: { type: 'STRING' },
          stops: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { id: { type: 'STRING' }, arriveTime: { type: 'STRING' } },
              required: ['id'],
            },
          },
        },
        required: ['dayIndex', 'stops'],
      },
    },
    notes: { type: 'STRING' },
  },
  required: ['days'],
};

interface StaySegmentIn {
  startDayIndex: number;
  endDayIndex: number;
  basecamp: PlanPlaceIn | null;
}

async function handleRoutePlan(req: VercelRequest, res: VercelResponse) {
  const body = (req.body ?? {}) as Record<string, any>;
  const destinationId = String(body.destinationId ?? '');
  const destinationName = String(body.destinationName ?? '');
  const dayCount = Number(body.dayCount);
  const startDate = body.startDate ? String(body.startDate) : '';
  const rawSegments: StaySegmentIn[] = Array.isArray(body.staySegments) ? body.staySegments : [];
  const arrivalAirport = body.arrivalAirport ? String(body.arrivalAirport).trim() : '';
  const arrivalTime = body.arrivalTime ? String(body.arrivalTime).trim() : '';
  const rawPlaces: PlanPlaceIn[] = Array.isArray(body.places) ? body.places : [];

  if (!destinationId || !Number.isFinite(dayCount) || dayCount < 1) {
    res.status(400).json({ error: 'destinationId와 dayCount가 필요해요.' });
    return;
  }
  if (rawPlaces.length < 2) {
    res.status(400).json({ error: '일정을 짜려면 장소가 2곳 이상 필요해요.' });
    return;
  }

  // 구간이 하나도 없이 오면(옛 클라이언트 방어) 숙소 없음 구간 1개로 취급
  const segments: StaySegmentIn[] =
    rawSegments.length > 0 ? rawSegments : [{ startDayIndex: 0, endDayIndex: dayCount - 1, basecamp: null }];

  // 상한을 넘으면 평점 높은 순으로 자른다(자르는 기준이 매번 같아야 캐시 키도 안정적)
  const places = [...rawPlaces]
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.id.localeCompare(b.id))
    .slice(0, MAX_PLAN_PLACES);

  // 캐시 키 — 장소 목록/숙소 구간/DAY 수/도착 정보가 그대로면 몇 번을 눌러도 Gemini 호출 0회.
  // 숙소를 나눈 여행은 "어느 구간에 어느 숙소인지"까지 키에 들어가야 숙소를 바꿨을 때 새로 생성된다.
  const signature = [
    dayCount,
    arrivalAirport,
    arrivalTime,
    segments.map((s) => s.startDayIndex + '-' + s.endDayIndex + ':' + (s.basecamp?.id ?? 'none')).join(','),
    places.map((p) => p.id).sort().join(','),
  ].join('|');
  const cacheKey = 'route-plan:' + destinationId + ':' + stableHash(signature);

  const supabase = makeSupabase();
  const cached = await readPlanCache(supabase, cacheKey);
  if (cached) {
    res.status(200).json({ ...cached, cached: true });
    return;
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았어요.' });
    return;
  }

  // 짧은 태그(P1, P2…)로 부르게 해서 장소 이름을 지어내거나 오타 내는 걸 원천 차단한다.
  // (응답의 id가 이 목록에 없으면 서버에서 버림)
  const tagToId = new Map<string, string>();
  const lines = places.map((p, i) => {
    const tag = 'P' + (i + 1);
    tagToId.set(tag, p.id);
    return planPlaceLine(tag, p);
  });

  // 숙소 구간 안내 — 나뉘어 있으면 "이 DAY 범위엔 이 숙소" 형태로 전부 나열해서, 하루하루
  // 어디서 출발해 어디로 돌아가는지 Gemini가 명확히 알게 한다. 매일 첫 stop을 이 숙소 근처로
  // 시작해 이 숙소 근처로 마무리하는 게 자연스럽다는 점도 규칙에서 다시 강조한다.
  const segmentLines = segments.map((s) => {
    const dayLabel = s.startDayIndex === s.endDayIndex ? 'DAY ' + (s.startDayIndex + 1) : 'DAY ' + (s.startDayIndex + 1) + '~' + (s.endDayIndex + 1);
    if (!s.basecamp) return dayLabel + ': 숙소 정보 없음';
    const coord = s.basecamp.lat != null && s.basecamp.lng != null ? ' (좌표:' + s.basecamp.lat.toFixed(4) + ',' + s.basecamp.lng.toFixed(4) + ')' : '';
    return dayLabel + ': ' + s.basecamp.name + coord;
  });
  const hasMultipleSegments = segments.length > 1;

  const prompt = [
    '너는 여행 동선 설계 전문가야. 아래 정보를 보고 ' + dayCount + '일치 일정을 짜줘.',
    '',
    destinationName ? '여행지: ' + destinationName : '',
    startDate ? '첫날 날짜: ' + startDate : '',
    '일수: ' + dayCount + '일 (dayIndex는 0부터 시작. 0 = 첫째 날)',
    '',
    hasMultipleSegments ? '숙소 — 여행 중 숙소를 옮긴다(구간별로 다름):' : '숙소(매일 여기서 출발/도착):',
    ...segmentLines,
    hasMultipleSegments
      ? '⚠️ 숙소를 옮기는 마지막 날(각 구간의 마지막 DAY)에는 밤 늦게 그 숙소에서 멀리 떨어진 곳에 있지 않도록,' +
        ' 다음 숙소 방향이나 이동이 편한 동선으로 마무리해. 숙소가 바뀌었는데 이전 숙소 근처로 계속 도는 일정은 안 된다.'
      : '',
    '',
    arrivalTime || arrivalAirport
      ? '⚠️ DAY 1은 숙소가 아니라 공항에서 시작한다.' +
        (arrivalAirport ? ' 도착 공항: ' + arrivalAirport + '.' : '') +
        (arrivalTime ? ' 비행기 도착 예정 시각: ' + arrivalTime + '.' : '') +
        ' 입국심사·수하물 수취·공항에서 숙소까지 이동 시간을 감안해 도착 시각보다 최소 1시간 30분 이후부터' +
        ' 일정을 시작해. DAY 1 첫 stop은 공항에서 숙소로 가는 동선에서 크게 벗어나지 않는 곳으로 골라.'
      : '',
    '',
    '후보 장소 목록 (반드시 아래 대괄호 앞의 태그 P숫자로만 지칭할 것):',
    ...lines,
    '',
    '다음 우선순위를 **이 순서 그대로** 지켜서 배분해줘.',
    '1순위 — 영업시간: 영업시간 정보가 주어진 곳은 반드시 문 여는 시간대에 방문하도록 배치해.',
    '   정기 휴무가 있으면 그 요일을 피해. 영업시간 정보가 없는 곳은 그 장소 종류의 일반적인',
    '   운영시간을 상식선에서 가정하되, 확실하지 않으면 시간대에 유연한 위치에 배치해.',
    '2순위 — 실제 여행객이 많이 택하는 동선: 실제로 그 도시를 여행할 때 자연스럽게 묶어서 도는',
    '   조합(같은 지역/같은 테마/야경은 저녁 등)을 우선해. 교과서적 최단거리보다 현실적인 흐름이 중요해.',
    '3순위 — 이동 효율: 같은 날 안에서는 그날의 숙소를 기준으로 좌표상 가까운 곳끼리 묶고,',
    '   하루 안에서 왔다 갔다 되돌아가는 동선이 생기지 않게 순서를 정해.',
    '',
    '규칙:',
    '- 하루에 3~5곳 정도가 적당해. 무리하게 다 넣지 말고, 남는 장소는 빼도 돼.',
    '- 같은 장소를 두 번 넣지 마. 각 태그는 전체 일정에서 최대 한 번만 쓴다.',
    '- 끼니때(점심 12시 전후, 저녁 18시 전후)에는 가능하면 음식점 성격의 장소를 배치해.',
    '- arriveTime은 24시간 "HH:MM" 형식으로, 그 장소에 도착하는 시각을 적어.',
    '  그날의 숙소(또는 DAY 1은 공항)에서 출발하는 시간과 장소 간 이동시간을 현실적으로 감안해.',
    '- summary는 그날 동선을 한 문장(40자 이내)으로 설명해.',
    '- notes에는 일정을 짤 때 사용자가 알아두면 좋은 주의사항을 2~3문장으로 적어',
    (hasMultipleSegments ? '(숙소를 옮기는 날이 있다면 그것도 짚어줘)' : '') + '.',
    '- 숙소는 stops에 넣지 마. 화면에서 자동으로 매일 출발지로 붙는다.',
  ]
    .filter(Boolean)
    .join('\n');

  const { data, error } = await callGeminiJson('gemini-2.5-flash-lite', geminiKey, prompt, ROUTE_PLAN_SCHEMA);
  if (error) {
    res.status(502).json({ error });
    return;
  }

  // Gemini가 없는 태그를 지어내거나 같은 장소를 중복 배치할 수 있으므로 서버에서 정리한다.
  const used = new Set<string>();
  const daysOut: Array<{ dayIndex: number; summary: string; stops: Array<{ placeId: string; arriveTime: string | null }> }> = [];
  const rawDays = Array.isArray(data?.days) ? data.days : [];

  for (const d of rawDays) {
    const dayIndex = Number(d?.dayIndex);
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= dayCount) continue;
    if (daysOut.some((x) => x.dayIndex === dayIndex)) continue; // 같은 DAY를 두 번 준 경우

    const stops: Array<{ placeId: string; arriveTime: string | null }> = [];
    for (const s of Array.isArray(d?.stops) ? d.stops : []) {
      const placeId = tagToId.get(String(s?.id ?? '').trim());
      if (!placeId || used.has(placeId)) continue; // 없는 태그 / 이미 쓴 장소는 버림
      used.add(placeId);
      const t = String(s?.arriveTime ?? '').trim();
      stops.push({ placeId, arriveTime: /^\d{1,2}:\d{2}$/.test(t) ? t.padStart(5, '0') : null });
    }
    daysOut.push({ dayIndex, summary: String(d?.summary ?? '').slice(0, 120), stops });
  }

  if (daysOut.every((d) => d.stops.length === 0)) {
    res.status(502).json({ error: 'AI가 배치할 장소를 찾지 못했어요. 잠시 후 다시 시도해 주세요.' });
    return;
  }

  const result = {
    days: daysOut.sort((a, b) => a.dayIndex - b.dayIndex),
    notes: String(data?.notes ?? '').slice(0, 600),
    unusedPlaceIds: places.map((p) => p.id).filter((id) => !used.has(id)),
  };

  await writePlanCache(supabase, cacheKey, 'route-plan', result);
  res.status(200).json({ ...result, cached: false });
}

/* ══════════════════ 3. DAY 세부 계획 (참고용 · 추후 프리미엄) ══════════════════ */

const DAY_DETAIL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    overview: { type: 'STRING' },
    stops: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          stayMinutes: { type: 'INTEGER' },
          highlights: { type: 'ARRAY', items: { type: 'STRING' } },
          tip: { type: 'STRING' },
          costText: { type: 'STRING' },
        },
        required: ['id'],
      },
    },
    extras: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { time: { type: 'STRING' }, title: { type: 'STRING' }, detail: { type: 'STRING' } },
        required: ['title'],
      },
    },
    budget: {
      type: 'OBJECT',
      properties: {
        lines: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { label: { type: 'STRING' }, amountText: { type: 'STRING' } },
            required: ['label', 'amountText'],
          },
        },
        totalText: { type: 'STRING' },
      },
    },
    cautions: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['overview', 'stops'],
};

async function handleDayDetail(req: VercelRequest, res: VercelResponse) {
  const body = (req.body ?? {}) as Record<string, any>;
  const destinationId = String(body.destinationId ?? '');
  const destinationName = String(body.destinationName ?? '');
  const dayIndex = Number(body.dayIndex);
  const dayLabel = String(body.dayLabel ?? '');
  const date = body.date ? String(body.date) : '';
  const currency = String(body.currency ?? 'THB');
  const headcount = Number(body.headcount);
  const stops: Array<PlanPlaceIn & { arriveTime?: string | null }> = Array.isArray(body.stops) ? body.stops : [];

  if (!destinationId || !Number.isInteger(dayIndex) || dayIndex < 0) {
    res.status(400).json({ error: 'destinationId와 dayIndex가 필요해요.' });
    return;
  }
  if (stops.length === 0) {
    res.status(400).json({ error: '이 DAY에 담긴 장소가 없어요.' });
    return;
  }

  // 캐시 키 — 그 DAY의 정류지 "순서"까지 반영(순서를 바꾸면 세부 계획도 달라져야 하므로 정렬하지 않는다)
  const signature = [currency, stops.map((s) => s.id + '@' + (s.arriveTime ?? '')).join(',')].join('|');
  const cacheKey = 'day-detail:' + destinationId + ':' + dayIndex + ':' + stableHash(signature);

  const supabase = makeSupabase();
  const cached = await readPlanCache(supabase, cacheKey);
  if (cached) {
    res.status(200).json({ ...cached, cached: true });
    return;
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았어요.' });
    return;
  }

  const tagToId = new Map<string, string>();
  const lines = stops.map((s, i) => {
    const tag = 'S' + (i + 1);
    tagToId.set(tag, s.id);
    return planPlaceLine(tag, s) + (s.arriveTime ? ' | 도착예정:' + s.arriveTime : '');
  });

  const prompt = [
    '너는 여행 플래너야. 아래는 사용자가 이미 확정한 하루 동선이야. 이 순서를 바꾸지 말고,',
    '각 장소에서 무엇을 하면 좋은지 세부 계획과 예상 예산을 짜줘.',
    '',
    destinationName ? '여행지: ' + destinationName : '',
    dayLabel ? '일차: ' + dayLabel : '',
    date ? '날짜: ' + date : '',
    Number.isFinite(headcount) && headcount > 0 ? '인원: ' + headcount + '명' : '',
    '',
    '방문 순서 (반드시 아래 태그 S숫자로만 지칭할 것):',
    ...lines,
    '',
    '요청 사항:',
    '- overview: 이 하루가 어떤 흐름인지 2~3문장으로 설명.',
    '- stops: 각 장소마다 추천 체류시간(stayMinutes, 분 단위), 놓치면 아쉬운 것 2~3개(highlights),',
    '  현장에서 유용한 팁 한 줄(tip), 그 장소에서 드는 예상 비용(costText, ' + currency + ' 기준).',
    '  입장료가 없으면 "무료"라고 적어.',
    '- extras: 위 장소들 사이에 넣으면 좋은 것(식사, 카페 휴식, 이동 중 들를 곳 등)을 시간과 함께 2~4개.',
    '- budget: 교통/식사/입장료/기타로 나눈 1인 기준 예상 지출(lines)과 합계(totalText). ' + currency + ' 기준으로 적고,',
    '  범위로 적어도 좋아(예: "300~500 THB").',
    '- cautions: 이 일정에서 주의할 점(더위, 드레스코드, 혼잡 시간, 현금만 받는 곳 등) 2~4개.',
    '',
    '중요: 비용과 체류시간은 일반적인 수준의 **추정치**야. 확실하지 않은 걸 확정된 사실처럼 쓰지 마.',
    '요금이 자주 바뀌거나 확실치 않으면 그 점을 costText나 cautions에 함께 적어.',
  ]
    .filter(Boolean)
    .join('\n');

  const { data, error } = await callGeminiJson('gemini-2.5-flash-lite', geminiKey, prompt, DAY_DETAIL_SCHEMA);
  if (error) {
    res.status(502).json({ error });
    return;
  }

  const stopsOut = (Array.isArray(data?.stops) ? data.stops : [])
    .map((s: any) => {
      const placeId = tagToId.get(String(s?.id ?? '').trim());
      if (!placeId) return null;
      const stay = Number(s?.stayMinutes);
      return {
        placeId,
        stayMinutes: Number.isFinite(stay) && stay > 0 ? Math.round(stay) : null,
        highlights: (Array.isArray(s?.highlights) ? s.highlights : []).map((h: any) => String(h)).slice(0, 4),
        tip: String(s?.tip ?? ''),
        costText: String(s?.costText ?? ''),
      };
    })
    .filter(Boolean);

  if (stopsOut.length === 0) {
    res.status(502).json({ error: 'AI 응답을 해석하지 못했어요. 잠시 후 다시 시도해 주세요.' });
    return;
  }

  const result = {
    overview: String(data?.overview ?? ''),
    stops: stopsOut,
    extras: (Array.isArray(data?.extras) ? data.extras : [])
      .map((e: any) => ({ time: String(e?.time ?? ''), title: String(e?.title ?? ''), detail: String(e?.detail ?? '') }))
      .filter((e: any) => e.title)
      .slice(0, 6),
    budget: {
      lines: (Array.isArray(data?.budget?.lines) ? data.budget.lines : [])
        .map((l: any) => ({ label: String(l?.label ?? ''), amountText: String(l?.amountText ?? '') }))
        .filter((l: any) => l.label)
        .slice(0, 8),
      totalText: String(data?.budget?.totalText ?? ''),
    },
    cautions: (Array.isArray(data?.cautions) ? data.cautions : []).map((c: any) => String(c)).slice(0, 5),
  };

  await writePlanCache(supabase, cacheKey, 'day-detail', result);
  res.status(200).json({ ...result, cached: false });
}
