/**
 * Vercel 서버리스 함수 — USD→KRW 환율 프록시
 *
 * GET /api/exchange-rate
 * response: { rate: number, source: 'live' | 'fallback' }
 *
 * 브라우저에서 Frankfurter API를 직접 호출하면 CORS로 막혀서,
 * 서버(우리 Vercel 함수)가 대신 호출해서 결과만 넘겨줌.
 * 서버 대 서버 호출은 CORS 제약이 없음.
 *
 * 필요한 환경변수: 없음 (Frankfurter는 키 불필요)
 */

interface VercelRequest {
  method?: string;
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (body: any) => void;
}

const FALLBACK_RATE = 1495;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const fxRes = await fetch('https://api.frankfurter.app/latest?from=USD&to=KRW');
    if (!fxRes.ok) {
      res.status(200).json({ rate: FALLBACK_RATE, source: 'fallback' });
      return;
    }
    const data: any = await fxRes.json();
    const rate = data?.rates?.KRW;
    if (typeof rate === 'number' && rate > 0) {
      res.status(200).json({ rate, source: 'live' });
      return;
    }
    res.status(200).json({ rate: FALLBACK_RATE, source: 'fallback' });
  } catch (e) {
    res.status(200).json({ rate: FALLBACK_RATE, source: 'fallback' });
  }
}
