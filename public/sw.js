/**
 * 서비스워커 — 지금은 "설치 가능한 앱"으로 인정받기 위한 최소 구현만 한다.
 *
 * ⚠️ 캐싱을 하지 않는다. 오프라인 팩(출국 전 일정·주소·사진 프리캐시)은
 *    docs/MOBILE_STRATEGY.md의 M2 항목이고, 무엇을 얼마나 담을지 설계가 끝난 뒤에 넣는다.
 *    근거 없이 캐시부터 깔면 "화면은 뜨는데 내용이 옛날 것"인 상태가 만들어지는데,
 *    그건 아무것도 안 뜨는 것보다 나쁘다.
 *
 * 크롬은 fetch 핸들러가 있는 서비스워커가 등록돼 있어야 홈 화면 추가(설치)를 제안한다.
 * 아래 핸들러는 respondWith를 부르지 않으므로 브라우저 기본 네트워크 동작 그대로다.
 */

self.addEventListener('install', () => {
  // 이전 버전을 기다리지 않고 바로 교체 — 캐시가 없으니 갈아끼워도 잃을 게 없다
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // 의도적으로 비어 있음 (위 주석 참고)
});
