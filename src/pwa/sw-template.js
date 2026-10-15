/**
 * 서비스워커 — 앱 화면(HTML/JS/CSS)과 장소 사진을 이 기기에 저장해 **오프라인에서도 열리게** 한다.
 *
 * ⚠️ 이 파일은 그대로 배포되지 않는다. 빌드 때 vite.config.ts의 swPlugin이 아래 두 자리를 채워
 *    dist/sw.js로 내보낸다.
 *      VERSION  : 빌드 파일 목록의 해시 — 배포가 바뀌면 sw.js 내용이 바뀌어 브라우저가 새 버전을 설치한다
 *      PRECACHE : 이번 빌드의 JS/CSS/아이콘 목록
 *
 * 전략 (오래된 화면을 보여주는 일을 최소로)
 *   · 페이지(내비게이션) : 네트워크 먼저. 4초 안에 안 오거나 실패하면 저장된 index.html
 *   · /assets/*          : 파일 이름에 해시가 있어 내용이 절대 안 바뀐다 → 저장본 먼저
 *   · 아이콘·manifest     : 저장본으로 바로 대답하고 뒤에서 갱신
 *   · /api/*             : 건드리지 않는다(항상 네트워크)
 *   · 장소 사진           : Supabase Storage 공개 사진만 저장(최대 400장). 지도 타일 등 다른 이미지는
 *                          저장하지 않는다(Google 지도는 약관상 저장 불가)
 * 여행 데이터(일정·장소·서류 목록)는 여기서 다루지 않는다 — 앱 쪽 offline/restCache.ts가
 * IndexedDB에 저장한다. 사용자별 데이터라 로그아웃 때 지울 수 있어야 하기 때문이다.
 */

const VERSION = '__SW_VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL = 'mongsil-shell-' + VERSION;
const IMG = 'mongsil-img-v1';
const IMG_MAX = 400;
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // 하나가 실패해도 나머지는 저장한다(addAll은 하나만 실패해도 전부 버린다)
      await Promise.all(PRECACHE.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => undefined)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('mongsil-shell-') && n !== SHELL).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__offline-docs/')) return;
    if (req.mode === 'navigate') { event.respondWith(navigation(req)); return; }
    if (url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirst(req)); return; }
    if (PRECACHE.includes(url.pathname)) { event.respondWith(staleWhileRevalidate(req)); return; }
    return;
  }

  if (req.destination === 'image' && url.hostname.endsWith('.supabase.co') && url.pathname.includes('/storage/v1/object/public/')) {
    event.respondWith(photo(req));
  }
});

async function navigation(req) {
  const cache = await caches.open(SHELL);
  const network = fetch(req).then((res) => {
    // 해시 라우터라 앱 화면은 언제나 index.html 하나다 — '/'로 저장해 두고 어느 주소든 그걸로 띄운다
    if (res.ok) cache.put('/', res.clone());
    return res;
  });
  try {
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    const cached = await cache.match('/');
    if (cached) { network.catch(() => undefined); return cached; }
    return await network;
  } catch (e) {
    const cached = await cache.match('/');
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  const network = fetch(req)
    .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => undefined);
  return hit || (await network) || Response.error();
}

async function photo(req) {
  const cache = await caches.open(IMG);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    // CSS 배경 이미지는 no-cors 요청이라 불투명 응답이 된다 — 불투명 응답은 용량이 크게 잡히므로
    // CORS로 다시 받아 저장한다(Supabase Storage는 CORS를 허용한다)
    const res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
    if (res.ok) {
      await cache.put(req.url, res.clone());
      trim(cache);
    }
    return res;
  } catch {
    try { return await fetch(req); } catch { return Response.error(); }
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= IMG_MAX) return;
  await Promise.all(keys.slice(0, keys.length - IMG_MAX).map((k) => cache.delete(k)));
}
