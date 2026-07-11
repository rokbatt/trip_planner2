/**
 * Vercel 서버리스 함수 — 기존 카드 사진 일괄 재호스팅
 *
 * POST /api/backfill-photos
 * headers: { x-admin-secret: string }
 *
 * places / places_db 테이블에서 photo_url이 아직 Google URL 그대로인 행을
 * 전부 찾아서 Storage로 재호스팅하고 DB를 업데이트함.
 * 한 번만 수동으로 실행하면 되는 관리자용 엔드포인트라
 * 아무나 못 부르게 시크릿 헤더로 보호함.
 *
 * 필요한 Vercel 환경변수 (서버 전용):
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - GOOGLE_MAPS_SERVER_KEY
 * - ADMIN_SECRET (아무 임의의 긴 문자열 — 이 엔드포인트 호출을 막는 용도)
 *
 * 실행 방법 (브라우저 콘솔에서 한 번):
 *   fetch('/api/backfill-photos', { method:'POST', headers:{'x-admin-secret':'값'} })
 *     .then(r=>r.json()).then(console.log)
 */

import { createClient } from '@supabase/supabase-js';
import { rehostGooglePhoto } from '../lib/rehostPhoto';

declare const process: { env: Record<string, string | undefined> };

interface VercelRequest {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
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

  const adminSecret = process.env.ADMIN_SECRET;
  const providedSecret = req.headers?.['x-admin-secret'];

  if (!adminSecret || providedSecret !== adminSecret) {
    res.status(401).json({
      error: '인증 실패',
      debug: {
        envVarSet: !!adminSecret,
        envVarLength: adminSecret?.length ?? 0,
        headerReceived: typeof providedSecret === 'string',
        headerLength: typeof providedSecret === 'string' ? providedSecret.length : 0,
        hint: !adminSecret
          ? 'Vercel에 ADMIN_SECRET 환경변수 자체가 안 잡힘 → Production 체크 + 재배포 확인'
          : typeof providedSecret !== 'string'
          ? '헤더가 아예 안 왔음 → fetch 코드의 헤더 이름/문법 확인'
          : 'envVarLength와 headerLength가 다르면 공백/따옴표가 섞여 들어간 것',
      },
    });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const serverMapsKey = process.env.GOOGLE_MAPS_SERVER_KEY;

  if (!supabaseUrl || !serviceKey || !serverMapsKey) {
    res.status(500).json({ error: '서버 환경변수가 설정되지 않았어요.' });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const summary = {
    places_migrated: 0,
    places_failed: 0,
    places_db_migrated: 0,
    places_db_failed: 0,
    errors: [] as string[],
  };

  // 1. places 테이블 — Storage URL이 아닌(=아직 Google URL인) 행만 대상
  const { data: places, error: placesError } = await supabase
    .from('places')
    .select('id, name, photo_url, google_place_id')
    .not('photo_url', 'is', null)
    .not('photo_url', 'ilike', '%supabase.co/storage%');

  if (placesError) {
    res.status(500).json({ error: 'places 조회 실패: ' + placesError.message });
    return;
  }

  for (const p of places ?? []) {
    if (!p.google_place_id || !p.photo_url) continue;
    try {
      const result = await rehostGooglePhoto(supabase, p.photo_url, p.google_place_id, serverMapsKey);
      const { error: updateError } = await supabase
        .from('places')
        .update({ photo_url: result.url })
        .eq('id', p.id);
      if (updateError) throw updateError;
      summary.places_migrated++;
    } catch (e) {
      summary.places_failed++;
      summary.errors.push('places."' + p.name + '": ' + (e as Error).message);
    }
  }

  // 2. places_db 테이블도 동일하게
  const { data: placesDb, error: placesDbError } = await supabase
    .from('places_db')
    .select('id, name, photo_url, google_place_id')
    .not('photo_url', 'is', null)
    .not('photo_url', 'ilike', '%supabase.co/storage%');

  if (placesDbError) {
    res.status(500).json({ error: 'places_db 조회 실패: ' + placesDbError.message, summary });
    return;
  }

  for (const p of placesDb ?? []) {
    if (!p.google_place_id || !p.photo_url) continue;
    try {
      const result = await rehostGooglePhoto(supabase, p.photo_url, p.google_place_id, serverMapsKey);
      const { error: updateError } = await supabase
        .from('places_db')
        .update({ photo_url: result.url })
        .eq('id', p.id);
      if (updateError) throw updateError;
      summary.places_db_migrated++;
    } catch (e) {
      summary.places_db_failed++;
      summary.errors.push('places_db."' + p.name + '": ' + (e as Error).message);
    }
  }

  res.status(200).json(summary);
}
