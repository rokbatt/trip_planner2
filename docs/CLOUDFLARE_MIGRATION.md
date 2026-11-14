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
- [x] 🤖 PR-3 링크 미리보기 DNS 검사 — 시험 배포에서 링크 미리보기가 정상 동작해서 변경 불필요(2026-11-13)
- [x] 🤖 PR-4 route-matrix 호출을 요청당 50번 아래로 나누기 (서버 12구간, 브라우저 `src/utils/routeLegs.ts`가 12구간씩 차례로 요청)
  - 2단계에서 다른 함수의 외부 호출 수도 실측(특히 관리자용 `backfill-photos`는 사진 여러 장을 한 요청에서 처리)
- [x] 🤖 CI에 Worker 빌드 확인(`wrangler deploy --dry-run`) 추가

## 2단계. 시험 배포 (workers.dev 주소)

- [x] 👤 Cloudflare에서 Worker 만들고 GitHub 저장소 연결 (`mongsil`, `https://mongsil.samueloh555.workers.dev`)
  - 첫 빌드는 잠금 파일(rollup 플랫폼 패키지 24개 누락)로 실패 → #269로 해결
  - PR 브랜치 빌드는 `wrangler preview` 명령이 `previews` 설정을 요구해 실패(운영 영향 없음, 미해결·낮은 우선순위)
- [x] 👤 빌드 변수 4개, 서버 비밀값 입력(값은 Vercel 환경 변수에서 복사)
  - 비밀값은 **Runtime variables and secrets**(서버용), `VITE_` 4개는 **Build** 칸(빌드용). 이름 오타 주의(`SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `CRON_SECRET`)
- [x] 👤 Supabase Redirect URLs에 시험 주소 추가
- [x] 👤 Maps 브라우저 키 리퍼러에 시험 주소 추가
- [x] 👤🤖 화면별 시험(시험 주소 `workers.dev`에서, 2026-11-14 Metrics로 확인)
  - 확인됨: 로그인, 지도, 장소(Places 30건)·길찾기(Routes 17건), Supabase 연결(17건), 환율, 저장된 문서 요약 불러오기, 오류 0·CPU 한도 초과 0
  - 앞서 2026-11-13의 "모두 이상 없음"은 Vercel(`www.mongsil2.com`)에서 한 시험이라 Cloudflare 검증이 아니었어요
  - **미확인**: 새 AI 답변·문서를 AI로 읽기(Gemini 호출이 429로 실패 — 키 한도 문제, 사용자가 나중에 유료 요금제로 전환 예정), 약관 페이지·새로고침·PWA
  - 이 과정에서 고친 것: 로그인 복귀 주소(Supabase Redirect URLs에 시험 주소), 환경 변수 이름 오타(`SUPABASE_URL`), 새 배포 뒤 옛 탭 오류(#273), 변수 누락 진단·`keep_vars`(#274)
- [ ] 🤖 CPU 시간·외부 호출 수 측정 → 무료로 충분한지 판단
  - 지금까지: 가벼운 요청 중간값 약 2ms(새 배포 직후 첫 실행은 약 7ms), 요청당 외부 호출 한 자릿수, 한도 초과 0건
  - **가장 무거운 작업(문서 파일을 AI에 보내 읽히기)은 Gemini가 되어야 측정돼요** → Gemini 유료 전환 뒤 문서 요약 1회 시험하고 Metrics 확인
- [ ] 👤 유료(월 $5) 필요 여부 결정 — 위 측정 뒤에(결제는 사용자가 직접)

## 3단계. 전환 준비

- [x] 🤖 cron 동작 확인 — 2026-11-14 03:00 UTC에 실행됨(`[cron] cleanup-search-cache 200`). 그때는 `SUPABASE_URL` 오타로 "Supabase 설정 없음"이라 건너뜀 → 오타 수정 뒤 다음 실행(11-15 03:00 UTC)에서 실제 정리 확인 필요
- [x] 🤖 개인정보 처리방침 위탁사 Vercel → Cloudflare(+Google Gmail), 연락처 `help@mongsil2.com`, 약관·방침 버전 draft2 (#277, 전환 당일 병합)
  - `help@mongsil2.com` → `mongsil2.help@gmail.com`: Cloudflare Email Routing(받기 전용), catch-all은 Drop
- [x] 👤 전환 날짜: 2026-11-14(사용자 결정, 사용자가 본인·지인 몇 명뿐)
- [x] 🤖 Gemini 지역 차단(`User location is not supported`) 해결 — Worker 실행 지역을 도쿄 인근으로 고정(#276, `placement.region = aws:ap-northeast-1`)

## 4단계. 전환 (DNS) — 2026-11-14 완료

- [x] 👤 Cloudflare DNS에서 Vercel을 가리키는 CNAME 2개(apex, www) 캡처 후 삭제
- [x] 👤 Worker → Domains 탭 → Custom domain(Route 아님)에 `www.mongsil2.com`, `mongsil2.com` 추가
- [x] 👤 Redirect Rule(Single Redirect, Wildcard): `https://mongsil2.com/*` → `https://www.mongsil2.com/${1}`, 301, 쿼리 유지
- [x] 👤🤖 전환 직후 시험: 동의 창(새 버전), 로그인, 지도, 장소, 길찾기, AI, `/privacy` 내용, `mongsil2.com/terms` → `www` 이동, Metrics Invocations 증가 확인
- 롤백(필요할 때): Worker Custom domains 2개 제거 → 캡처해 둔 CNAME 2개(DNS only) 복구 → 몇 분 안에 Vercel로 돌아가요. Vercel 프로젝트는 5단계 전까지 유지

## 남은 확인(전환과 별개)

- [ ] 👤🤖 Gemini 유료 전환 뒤 새 문서를 AI로 읽혀 CPU 측정 → 무료 플랜(요청당 CPU 10ms)로 충분한지 판단, 필요하면 월 $5 결정(사용자)
- [ ] 🤖 `cache-photo`, `destination-zones` 오류(2026-11-14 Observability) 원인 확인
- [ ] 🤖 PR 브랜치 미리보기 빌드 실패(`wrangler preview`가 `previews` 설정 요구) 정리 — 운영 영향 없음
- [ ] 🤖 여행 화면에서 모르는 메뉴 주소(`#trip/:id/privacy` 등)가 "다음 단계에서 구현 예정" 빈 화면을 보여 줌 → 기본 화면으로 이동하게
- [ ] 🤖 11-15 03:00 UTC 정리 작업이 실제로 지웠는지 Observability에서 확인

## 5단계. 정리 (2주 안정 후, 2026-11-28 무렵)

- [ ] 👤 Vercel cron 끄기(지금은 Vercel과 Cloudflare가 같은 정리 작업을 둘 다 돌림 — 같은 오래된 행을 지우는 일이라 해는 없음)
- [ ] 👤 `mongsil2.vercel.app` → `www.mongsil2.com` 리다이렉트 또는 Vercel 프로젝트 정리
- [ ] 🤖 `vercel.json`, CI 함수 12개 검사 제거, `Claude.md` 배포·호스팅 문구 갱신
- [ ] 👤 Supabase Redirect URLs·Maps 브라우저 키에서 시험 주소(`mongsil.samueloh555.workers.dev`) 제거
- [ ] 🤖 첫 달 비용·오류 점검
