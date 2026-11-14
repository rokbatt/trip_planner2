import { describe, it, expect } from 'vitest';
import { missingSupabaseEnv } from '../../api/ai';

describe('missingSupabaseEnv', () => {
  it('둘 다 있으면 빈 배열', () => {
    expect(missingSupabaseEnv({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' })).toEqual([]);
  });
  it('URL은 VITE_ 이름으로도 인정한다(코드의 대체 규칙과 같게)', () => {
    expect(missingSupabaseEnv({ VITE_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' })).toEqual([]);
  });
  it('빠진 이름만 알려 준다', () => {
    expect(missingSupabaseEnv({ SUPABASE_SERVICE_ROLE_KEY: 'k' })).toEqual(['SUPABASE_URL']);
    expect(missingSupabaseEnv({ SUPABASE_URL: 'u' })).toEqual(['SUPABASE_SERVICE_ROLE_KEY']);
    expect(missingSupabaseEnv({})).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  });
  it('빈 문자열도 없는 것으로 본다', () => {
    expect(missingSupabaseEnv({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' })).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  });
});
