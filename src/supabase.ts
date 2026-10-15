import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types/database';
import { offlineFetch, initOfflineRest } from './offline/restCache';
import { createOfflineAwareStorage } from './offline/auth';
import { offlineState } from './offline/status';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '환경변수 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY가 필요합니다.\n' +
    '.env 파일을 확인해주세요.'
  );
}

export const supabase: SupabaseClient<Database> = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      // 탭 간 세션 동기화 — 멀티탭에서 토큰 경쟁 방지
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      // 오프라인에서 만료된 토큰 때문에 요청이 30초씩 멈추지 않게(offline/auth.ts)
      storage: createOfflineAwareStorage(() => offlineState().offline),
    },
    // 오프라인 대비 — REST 읽기는 저장본으로 대답하고, 여행 중 쓰기는 대기열에 넣는다(offline/restCache.ts)
    global: { fetch: offlineFetch },
  }
);

export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseAnonKey;

initOfflineRest({
  getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
});
