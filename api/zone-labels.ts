/**
 * Vercel 서버리스 함수 — Shortlist 권역 이름 생성 (AI)
 *
 * POST /api/zone-labels
 * body: { destination: string, zones: [{ id: string, placeNames: string[] }] }
 * response: { labels: [{ id: string, name: string, keyword: string }] }
 *
 * 행정구역명(예: Khet Bang Kho Laem) 대신, 그 권역 안에 실제로 있는 장소들을
 * 보고 여행자가 알아볼 수 있는 별명 + 대표 키워드를 붙임.
 * (예: "올드타운" / "왕궁·왓포")
 *
 * 필요한 Vercel 환경변수: GEMINI_API_KEY
 */

declare const process: { env: Record<string, string | undefined> };

interface VercelRequest {
  method?: string;
  body?: any;
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (body: any) => void;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const destination: string | undefined = req.body?.destination;
  const zones: Array<{ id: string; placeNames: string[] }> | undefined = req.body?.zones;

  if (!destination || !Array.isArray(zones) || zones.length === 0) {
    res.status(400).json({ error: 'destination, zones가 필요해요.' });
    return;
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았어요.' });
    return;
  }

  const zoneListText = zones
    .map((z, i) => (i + 1) + '. [' + z.placeNames.join(', ') + ']')
    .join('\n');

  const prompt = [
    destination + ' 여행 중, 지도에서 가까운 장소끼리 자동으로 묶인 권역들이야.',
    '각 권역에 속한 실제 장소 목록을 보고, 그 지역에 처음 가보는 여행자도 바로 이해할 수 있는',
    '별명과 대표 키워드를 붙여줘.',
    '',
    '조건:',
    '- 행정구역명(구/동/시 단위 공식 지명)은 절대 쓰지 마',
    '- 실제 여행자들이 부르는 지역 이름이나, 그 권역의 랜드마크·성격을 반영한 이름을 써',
    '- keyword는 그 권역에서 뭘 할 수 있는지 2~4글자 단어 1~2개로 (예: "왕궁·왓포", "쇼핑", "야경")',
    '- 이름은 5글자 이내로 짧게',
    '',
    '권역 목록:',
    zoneListText,
    '',
    '아래 JSON 배열 형식으로만 응답하고 다른 텍스트는 절대 붙이지 마:',
    '[{"index":1,"name":"올드타운","keyword":"왕궁·왓포"}, {"index":2,"name":"...","keyword":"..."}]',
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

  let parsed: Array<{ index: number; name: string; keyword: string }>;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    res.status(502).json({ error: 'Gemini 응답 JSON 파싱 실패' });
    return;
  }

  const labels = parsed
    .map((p) => {
      const zone = zones[p.index - 1];
      if (!zone) return null;
      return { id: zone.id, name: p.name, keyword: p.keyword };
    })
    .filter((x): x is { id: string; name: string; keyword: string } => x !== null);

  res.status(200).json({ labels });
}
