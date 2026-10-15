import { defineConfig, loadEnv, type Plugin } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';

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

/**
 * 서비스워커를 빌드 때 만든다 — 원본은 src/pwa/sw-template.js.
 *
 * 앱 화면을 오프라인에서도 열려면 이번 빌드의 JS/CSS 파일 이름(해시 포함)을 SW가 알아야 한다.
 * public/에 둔 고정 파일로는 알 수 없어서, 번들이 다 만들어진 뒤 목록과 버전을 채워 내보낸다.
 * 버전은 파일 목록의 해시라 배포가 바뀌면 sw.js 내용도 바뀌고, 브라우저가 새 SW를 설치한다.
 */
function swPlugin(): Plugin {
  const PUBLIC_FILES = ['/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
  return {
    name: 'mongsil-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => /\.(js|css|woff2?|svg|png|webp|jpg)$/.test(f) && f !== 'sw.js')
        .map((f) => '/' + f)
        .sort();
      const version = createHash('sha1').update(files.join('|')).digest('hex').slice(0, 12);
      const precache = ['/', ...files, ...PUBLIC_FILES];
      const template = readFileSync(resolve(__dirname, 'src/pwa/sw-template.js'), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace('__SW_VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache)),
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [siteUrlPlugin(mode), swPlugin()],
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
