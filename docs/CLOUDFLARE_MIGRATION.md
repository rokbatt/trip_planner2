# Vercel → Cloudflare 이전 체크리스트

진행 상황을 세션이 바뀌어도 이어 가려고 만든 문서예요. 칸을 채울 때마다 이 파일을 함께 고쳐요.
표시: `[x]` 완료 · `[ ]` 할 일 · 👤 사용자가 콘솔에서 할 일 · 🤖 Claude가 PR로 할 일

원칙
- 전환(4단계) 전까지 **운영(www.mongsil2.com, Vercel)은 그대로** 둬요. 1~3단계는 운영에 영향이 없어요.
- 비밀값은 Cloudflare 대시보드에만 넣어요. 채팅·코드·커밋·PR에는 쓰지 않아요.
- 외부 콘솔 설정, DNS 변경, 결제 관련 변경은 하기 전에 사용자 확인을 받아요.
- 롤백 길은 끝까지 남겨요. Vercel 프로젝트는 5단계 전까지 지우지 않아요.

## 지금 코드에서 확인한 사실 (2026-11-13, main 4b05731)

| 항목 | 확인 내용 | 이전 때 할 일 |
|---|---|---|
| 서버 함수 | `api/` 12개, 모두 Vercel 형식 `handler(req, res)` | 변환 층 하나로 감싸기 |
| 정기 작업 | `vercel.json` cron 1개(`/api/cleanup-search-cache`, 매일 03:00 UTC) | Worker cron으로 옮기기 |
| 캐시 헤더 | `vercel.json` headers(`/assets/*` 1년, 나머지 no-store) | Worker에서 같은 헤더 붙이기 |
| 경로 라우트 | `/terms`, `/privacy` → index.html | SPA fallback으로 해결 |
| DNS 조회 | `api/cache-photo.ts` 링크 미리보기 SSRF 검사가 `node:dns/promises` 사용 | Workers에서 동작 확인 필요, 안 되면 DoH로 대체 |
| Buffer | `api/ai.ts`에서 사용 | `nodejs_compat`로 해결 예상 |
| 외부 호출 수 | `route-matrix` 구간 비교가 최대 25구간 × 3수단 = 75번 Google 호출 | 무료 Worker 한도(요청당 50번)를 넘어요. 나눠 부르기 필요 |
| 사이트 주소 | `vite.config.ts`가 `VITE_SITE_URL` 또는 `VERCEL_PROJECT_PRODUCTION_URL`을 씀 | Cloudflare 빌드에는 `VITE_SITE_URL` 필수 |
| 서버 환경 변수 | `SUPABASE_URL`, `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GOOGLE_MAPS_SERVER_KEY`, `GOOGLE_ROUTES_API_KEY`(있으면), `CRON_SECRET`, `ADMIN_SECRET` | Worker 비밀값으로 옮기기 |
| 빌드 환경 변수 | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_MAPS_KEY`, `VITE_SITE_URL` | Workers Builds 빌드 변수로 넣기 |

## 0단계. 첫 단추(결정)

- [x] 👤 플랫폼: **Workers + Static Assets** (2026-11-13 결정)
- [x] 👤 배포 방식: **Workers Builds Git 연동** (2026-11-13 결정)

## 1단계. 코드 준비 (운영 영향 없음, 주제별 PR)

- [x] 🤖 PR-1 변환 층: `worker/vercelAdapter.ts` + 테스트
- [x] 🤖 PR-2 Worker 진입점 + `wrangler.jsonc`(assets `dist`, SPA fallback, `/api/*` 먼저 실행, `nodejs_compat`, cron, 캐시 헤더 `public/_headers`, 환율 캐시)
  - 로컬(`npx wrangler dev`)에서 확인: `/`·`/terms`·`/privacy` 200, 캐시 헤더 규칙, 없는 `/api/*` 404, 깨진 JSON 400
  - 로컬에서 확인 못 함: `node:dns`(작업 환경 네트워크가 막음) → 2단계 실제 배포에서 링크 미리보기로 확인
- [ ] 🤖 PR-3 링크 미리보기 DNS 검사를 Workers에서도 되게(시험 결과에 따라)
- [x] 🤖 PR-4 route-matrix 호출을 요청당 50번 아래로 나누기 (서버 12구간, 브라우저 `src/utils/routeLegs.ts`가 12구간씩 차례로 요청)
  - 2단계에서 다른 함수의 외부 호출 수도 실측(특히 관리자용 `backfill-photos`는 사진 여러 장을 한 요청에서 처리)
- [x] 🤖 CI에 Worker 빌드 확인(`wrangler deploy --dry-run`) 추가

## 2단계. 시험 배포 (workers.dev 주소)

- [ ] 👤 Cloudflare에서 Worker 만들고 GitHub 저장소 연결
- [ ] 👤 빌드 변수 4개, 서버 비밀값 입력(값은 Vercel 환경 변수에서 복사)
- [ ] 👤 Supabase Redirect URLs에 시험 주소 추가
- [ ] 👤 Maps 브라우저 키 리퍼러에 시험 주소 추가
- [ ] 👤🤖 화면별 시험: 로그인, 여행 목록·보드, 장소 검색·추가, 사진, 길찾기, 호텔 점수, 어시스턴트, 문서, 환율, 약관 페이지, 새로고침, PWA
- [ ] 🤖 CPU 시간·외부 호출 수 측정 → 무료로 충분한지 판단
- [ ] 👤 유료(월 $5) 필요 여부 결정

## 3단계. 전환 준비

- [ ] 🤖 cron 동작 확인(정리 작업 1회 수동 실행 후 결과 확인)
- [ ] 🤖 개인정보 처리방침 위탁사 Vercel → Cloudflare, 약관 버전 올리기(연락처 이메일 변경과 한 PR)
- [ ] 👤 전환 날짜 정하기(S2 2단계와 다른 날, 사용자가 적은 시간대)

## 4단계. 전환 (DNS)

- [ ] 👤 Cloudflare DNS에서 Vercel을 가리키는 CNAME 2개(apex, www) 기록해 두고 삭제
- [ ] 👤 Worker → Custom Domains에 `www.mongsil2.com`, `mongsil2.com` 추가(레코드는 Cloudflare가 자동 생성)
- [ ] 👤 apex → www 리다이렉트 규칙
- [ ] 👤🤖 전환 직후 시험(2단계 목록 그대로)
- 롤백: Custom Domains 해제 → 기록해 둔 CNAME 2개 복구 → 몇 분 안에 Vercel로 돌아가요.

## 5단계. 정리 (2주 안정 후)

- [ ] 👤 `mongsil2.vercel.app` → `www.mongsil2.com` 리다이렉트, Vercel cron 끄기
- [ ] 🤖 `vercel.json`, CI 함수 12개 검사 제거, `Claude.md` 배포 문구 갱신
- [ ] 👤 Supabase·Maps 허용 목록에서 시험 주소 제거
- [ ] 🤖 첫 달 비용·오류 점검
