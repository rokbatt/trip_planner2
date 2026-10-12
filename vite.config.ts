import { defineConfig, loadEnv, type Plugin } from 'vite';
import { resolve } from 'path';

/**
 * index.html의 `%SITE_URL%`을 실제 배포 주소로 치환한다.
 *
 * og:image·canonical은 절대 URL이어야 카카오톡·페이스북이 제대로 읽는다.
 * 도메인을 코드에 박아두면 프리뷰 배포마다 틀어지므로 빌드 시점에 해석한다:
 *   1) VITE_SITE_URL          — 직접 지정(커스텀 도메인을 붙였다면 이걸 쓴다)
 *   2) VERCEL_PROJECT_PRODUCTION_URL — Vercel이 빌드에 자동 주입하는 프로덕션 도메인
 *   3) 둘 다 없으면 상대경로로 남긴다(로컬 dev). 이 경우 공유 미리보기는 보장되지 않음
 */
function siteUrlPlugin(mode: string): Plugin {
  return {
    name: 'mongsil-site-url',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const env = loadEnv(mode, process.cwd(), '');
        const explicit = (env.VITE_SITE_URL ?? '').trim();
        const vercel = (env.VERCEL_PROJECT_PRODUCTION_URL ?? '').trim();

        let origin = '';
        if (explicit) origin = explicit;
        else if (vercel) origin = 'https://' + vercel;

        // 뒤에 붙은 슬래시는 템플릿이 `%SITE_URL%/`로 쓰므로 여기서 떼어낸다
        origin = origin.replace(/\/+$/, '');

        if (!origin && mode === 'production') {
          console.warn(
            '[mongsil] VITE_SITE_URL도 VERCEL_PROJECT_PRODUCTION_URL도 없어서 og:image가 상대경로로 나갑니다. ' +
              '공유 미리보기(카카오톡 등)가 안 뜰 수 있으니 배포 환경변수에 VITE_SITE_URL을 넣어주세요.'
          );
        }

        return html.replaceAll('%SITE_URL%', origin);
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [siteUrlPlugin(mode)],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    proxy: {
      // 로컬 개발 시 Vercel 서버리스 함수 프록시
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
}));
