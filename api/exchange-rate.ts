/**
 * Vercel 서버리스 함수 — <통화>→KRW 환율 프록시
 *
 * GET /api/exchange-rate?from=USD  (from 생략 시 USD)
 * response: { rate: number | null, source: 'live' | 'reference' | 'fallback' | 'unavailable', from: string }
 *
 *   live        유럽중앙은행(ECB) 기준환율 — Frankfurter. 가장 믿을 만한 값
 *   reference   ECB가 다루지 않는 통화(베트남 동·대만 달러 등)를 보강하는 보조 환율 소스. 참고용
 *   fallback    위 둘이 다 실패했을 때만 쓰는 대략치(USD·THB뿐). 참고용
 *   unavailable 구하지 못함 — 화면이 사용자에게 직접 입력하게 한다
 *
 * 브라우저에서 Frankfurter API를 직접 호출하면 CORS로 막혀서,
 * 서버(우리 Vercel 함수)가 대신 호출해서 결과만 넘겨줌. 서버 대 서버 호출은 CORS 제약이 없음.
 *
 * ECB 기준환율은 약 30개 통화만 있다(베트남 동·대만 달러·UAE 디르함·이집트 파운드 등은 없음).
 * 그 통화로 지출을 적으면 예전에는 원화 환산이 통째로 빠졌다 → 두 번째 소스로 보강한다.
 *
 * ROUTE의 "예상 교통비 원화로 보기" 기능도 이 프록시를 그대로 재사용한다(THB 등 현지 통화 → KRW).
 *
 * 필요한 환경변수: 없음 (두 소스 모두 키 불필요)
 */

interface VercelRequest {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => void;
  json: (body: any) => void;
}

export type RateSource = 'live' | 'reference' | 'fallback' | 'unavailable';
export interface RateResult {
  rate: number | null;
  source: RateSource;
}

// 모든 소스가 실패했을 때만 쓰는 대략치 — 실측 아님을 원칙 3-1대로 source로 구분.
// 이 앱에서 실제로 등장하는 통화(USD/THB)만 채워두고, 그 외는 굳이 지어내지 않는다.
const FALLBACK_RATES: Record<string, number> = { USD: 1495, THB: 40 };

/** 환율이 이 범위를 벗어나면 소스가 이상한 값을 준 것으로 본다(1통화 = 0.0001~1천만 원) */
function sane(rate: unknown): number | null {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0.0001 && rate < 10_000_000 ? rate : null;
}

/** Frankfurter(ECB) 응답 `{ rates: { KRW: 1495.2 } }` */
export function parseFrankfurter(data: any): number | null {
  return sane(data?.rates?.KRW);
}

/** 보조 소스 응답 `{ date: '2026-11-12', vnd: { krw: 0.0569, ... } }` — 키는 통화 코드 소문자 */
export function parseSecondary(data: any, from: string): number | null {
  return sane(data?.[from.toLowerCase()]?.krw);
}

/** 보조 소스 주소들 — 앞 주소가 실패하면 다음 주소를 시도한다(같은 데이터의 미러) */
export function secondaryUrls(from: string): string[] {
  const c = from.toLowerCase();
  return [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${c}.json`,
    `https://latest.currency-api.pages.dev/v1/currencies/${c}.json`,
  ];
}

const TIMEOUT_MS = 4000;

async function getJson(url: string, fetchImpl: typeof fetch): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 통화 코드 → KRW 환율. 순서: ECB → 보조 소스 → 대략치 → 없음 */
export async function lookupRate(from: string, fetchImpl: typeof fetch = fetch): Promise<RateResult> {
  if (from === 'KRW') return { rate: 1, source: 'live' };

  const ecb = parseFrankfurter(await getJson('https://api.frankfurter.app/latest?from=' + encodeURIComponent(from) + '&to=KRW', fetchImpl));
  if (ecb != null) return { rate: ecb, source: 'live' };

  for (const url of secondaryUrls(from)) {
    const rate = parseSecondary(await getJson(url, fetchImpl), from);
    if (rate != null) return { rate, source: 'reference' };
  }

  const fallback = FALLBACK_RATES[from];
  return fallback != null ? { rate: fallback, source: 'fallback' } : { rate: null, source: 'unavailable' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rawFrom = req.query?.from;
  const from = (typeof rawFrom === 'string' && rawFrom.trim() ? rawFrom.trim() : 'USD').toUpperCase();
  // 통화 코드는 영문 세 글자 — 그 밖의 값은 외부 주소에 끼워 넣지 않는다
  if (!/^[A-Z]{3}$/.test(from)) {
    res.status(400).json({ error: '통화 코드는 영문 3글자여야 해요.', rate: null, source: 'unavailable', from });
    return;
  }

  const result = await lookupRate(from);
  // 환율은 하루에 한 번쯤 바뀌는 값이라 같은 통화를 사람마다 다시 부르지 않게 CDN에 잠깐 둔다(원칙 3-2).
  // 실패 결과(unavailable)는 캐시하지 않는다 — 다음 요청이 바로 다시 시도할 수 있게.
  res.setHeader(
    'Cache-Control',
    result.source === 'unavailable' ? 'no-store' : 's-maxage=1800, stale-while-revalidate=21600'
  );
  res.status(200).json({ ...result, from });
}
