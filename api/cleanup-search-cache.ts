/**
 * Vercel Cron 함수 — 캐시 테이블 중 "키가 자유 입력이라 무한 증식할 수 있는" 캐시를 주기적으로 정리
 *
 * GET /api/cleanup-search-cache (Vercel Cron이 vercel.json 스케줄대로 자동 호출, 매일 03:00 UTC)
 *
 * 왜 필요한가:
 * - hotel_infra_cache/hotel_score_cache는 키가 place_id 하나뿐이라 "실제 존재하는 숙소 수"만큼만
 *   늘어나 사실상 유한함.
 * - hotel_search_cache는 키가 (place_id, 검색어) 조합이라 "숙소 수 × 사용자가 입력하는 검색어
 *   종류"만큼 늘어남 — 상한이 없어 방치하면 Supabase 저장 용량을 계속 잠식함(Claude.md 3-5).
 * - updated_at 기준으로 오래된 행을 주기적으로 지워 크기를 억제하고, 오래돼서 실제와 달라졌을
 *   수 있는 결과(가게 폐업/평점 변경 등)도 자연스럽게 새로 고침되게 함.
 *
 * 나중에 같은 문제(자유 입력이 캐시 키에 들어가는 새 캐시 테이블)가 생기면 CLEANUP_TARGETS에
 * 한 줄만 추가하면 됨.
 *
 * 필요한 Vercel 환경변수:
 * - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (없으면 정리할 게 없다고 보고 그냥 종료)
 * - CRON_SECRET (선택 — 설정하면 Vercel Cron이 보내는 Authorization 헤더와 대조해 외부에서
 *   함부로 호출 못 하게 막음. 안 설정해도 동작은 함)
 */

import { createClient } from '@supabase/supabase-js';

declare const process: { env: Record<string, string | undefined> };

interface VercelRequest {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
}
interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (body: any) => void;
}

/** 캐시 키에 자유 입력(검색어 등)이 섞여 무한 증식 가능한 테이블만 여기 등록 */
const CLEANUP_TARGETS: { table: string; retentionDays: number }[] = [{ table: 'hotel_search_cache', retentionDays: 90 }];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers?.authorization;
    if (auth !== 'Bearer ' + cronSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(200).json({ skipped: true, reason: 'Supabase 설정 없음' });
    return;
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const deleted: Record<string, number> = {};
  for (const target of CLEANUP_TARGETS) {
    const cutoff = new Date(Date.now() - target.retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const { error, count } = await supabase
      .from(target.table)
      .delete({ count: 'exact' })
      .lt('updated_at', cutoff);
    if (error) {
      console.error('[cleanup-search-cache] ' + target.table + ' 정리 실패:', error.message);
      continue;
    }
    deleted[target.table] = count ?? 0;
  }

  res.status(200).json({ deleted });
}
