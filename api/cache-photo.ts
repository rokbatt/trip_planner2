/**
 * Vercel 서버리스 함수 — 장소 사진 재호스팅 (단건)
 *
 * POST /api/cache-photo
 * body: { photoUrl: string, placeId: string }
 *
 * 필요한 Vercel 환경변수 (서버 전용):
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - GOOGLE_MAPS_SERVER_KEY (referrer 제한 없는 서버 전용 키)
 */

import { createClient } from '@supabase/supabase-js';
import { rehostGooglePhoto } from '../lib/rehostPhoto';

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

  const photoUrl: string | undefined = req.body?.photoUrl;
  const placeId: string | undefined = req.body?.placeId;

  if (!photoUrl || !placeId) {
    res.status(400).json({ error: 'photoUrl, placeId가 필요해요.' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const serverMapsKey = process.env.GOOGLE_MAPS_SERVER_KEY;

  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: '서버 환경변수(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았어요.' });
    return;
  }
  if (!serverMapsKey) {
    res.status(500).json({ error: 'GOOGLE_MAPS_SERVER_KEY가 설정되지 않았어요.' });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const result = await rehostGooglePhoto(supabase, photoUrl, placeId, serverMapsKey);
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
}
