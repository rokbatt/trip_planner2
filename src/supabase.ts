import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types/database';

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
    },
  }
);
