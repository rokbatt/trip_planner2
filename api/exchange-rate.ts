/**
 * Vercel 서버리스 함수 — <통화>→KRW 환율 프록시
 *
 * GET /api/exchange-rate?from=USD  (from 생략 시 USD)
 * response: { rate: number | null, source: 'live' | 'fallback' | 'unavailable', from: string }
 *
 * 브라우저에서 Frankfurter API를 직접 호출하면 CORS로 막혀서,
 * 서버(우리 Vercel 함수)가 대신 호출해서 결과만 넘겨줌.
 * 서버 대 서버 호출은 CORS 제약이 없음.
 *
 * ROUTE의 "예상 교통비 원화로 보기" 기능도 이 프록시를 그대로 재사용한다(THB 등 현지
 * 통화 → KRW). from을 안 받던 예전 버전은 항상 USD만 처리했는데, 쿼리 파라미터로
 * 넓혔다 — 기존 호출부(파라미터 없이 호출)는 그대로 USD로 동작해 하위 호환된다.
 *
 * 필요한 환경변수: 없음 (Frankfurter는 키 불필요)
 */

interface VercelRequest {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (body: any) => void;
}

// Frankfurter가 실패했을 때만 쓰는 대략치 — 실측 아님을 반드시 원칙 3-1대로 source로 구분.
// 이 앱에서 실제로 등장하는 통화(USD/THB)만 채워두고, 그 외는 굳이 지어내지 않는다.
const FALLBACK_RATES: Record<string, number> = { USD: 1495, THB: 40 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rawFrom = req.query?.from;
  const from = (typeof rawFrom === 'string' && rawFrom.trim() ? rawFrom.trim() : 'USD').toUpperCase();

  if (from === 'KRW') {
    res.status(200).json({ rate: 1, source: 'live', from });
    return;
  }

  const fallback = () => {
    const rate = FALLBACK_RATES[from] ?? null;
    res.status(200).json({ rate, source: rate == null ? 'unavailable' : 'fallback', from });
  };

  try {
    const fxRes = await fetch('https://api.frankfurter.app/latest?from=' + encodeURIComponent(from) + '&to=KRW');
    if (!fxRes.ok) {
      fallback();
      return;
    }
    const data: any = await fxRes.json();
    const rate = data?.rates?.KRW;
    if (typeof rate === 'number' && rate > 0) {
      res.status(200).json({ rate, source: 'live', from });
      return;
    }
    fallback();
  } catch (e) {
    fallback();
  }
}
