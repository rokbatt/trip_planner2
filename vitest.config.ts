import { defineConfig } from 'vitest/config';

/**
 * 테스트 설정을 vite.config.ts와 분리해 둔다 — 빌드용 플러그인(%SITE_URL% 치환 등)이
 * 테스트에서 돌 이유가 없고, 반대로 테스트용 env가 프로덕션 빌드에 섞여서도 안 된다.
 */
export default defineConfig({
  test: {
    // 대상이 전부 순수 함수라 DOM이 필요 없다 — jsdom을 띄우지 않는다
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      // expenseModel이 supabase.ts를 import하고, 그 모듈은 로드 시점에 환경변수를
      // 검사해서 없으면 throw한다. 테스트는 네트워크를 쓰지 않으므로 더미값이면 충분하다.
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
});
