# 몽실이 (Mongsil) — 프로젝트 컨텍스트

코드를 고치기 전에 읽는다. 아래 원칙과 어긋나는 변경은 하지 않는다. 기능 세부는 코드가 기준이고, 이 문서에는 **코드만 봐서는 알 수 없는 이유·규칙·함정**만 둔다.
상업화·결제·개시 작업이면 `docs/LAUNCH_HANDOFF.md`(인계)와 `docs/COMMERCIAL_READINESS.md`(체크리스트)도 읽는다.

---

## 1. 제품

친구끼리 하는 협업 여행 계획. 여행지가 정해진 직후의 **브레인스토밍 에너지**를 담는 게 핵심이다.
흐름: `브레인스토밍(자유 수집) → 지역/숙소 결정 → 동선 → 날짜별 일정`. 타겟은 즉흥적인 "P형" 여행자.

**"인천공항 프리미엄 라운지" 컨셉(여정 = 공항 메타포)은 임의로 바꾸지 않는다.**

| 게이트 | 메타포 | 상태 |
|---|---|---|
| IDEAS (Brainstorm) | 자유 수집 | 완성 |
| STAY (Shortlist) | Step1 지역=Departure Hall / Step2 숙소=Immigration / Step3 확정=Boarding Pass | 완성 |
| ROUTE | 동선 편집·최적화 | 구현됨 |
| TIMELINE | 날짜별 시각표 | 구현됨 |
| Companion(모바일) | 여행 중 화면 | 구현됨 |
| Checklist · Documents · Notes · Expense · Links · Assistant | 보조 게이트 | 구현됨 |

## 2. 디자인 — "Airport Lounge Premium Light"

- 딥네이비 `#0B2A5C`, 스카이블루 `#8FD8F8`, 배경 `#F8FBFE`. 제목 Instrument Serif, 본문 Pretendard/시스템.
- Linear/Notion/Stripe/Airbnb 수준의 미니멀 SaaS. 관리자 페이지처럼 보이면 안 된다.
- 과한 그림자·색·아이콘 금지, 여백 넉넉히, 둥근 카드 + 얇은 테두리, 보딩패스풍 점선 구분선, 유리질감 카드(`rgba(255,255,255,0.82)` + blur).

---

## 3. 절대 원칙

### 3-1. 데이터는 지어내지 않는다
화면의 숫자(평점·이동시간·가격 등)는 실제 데이터여야 한다. 없으면 "추정/참고용"으로 표시하거나 UI에서 뺀다. AI가 쓴 값은 `AI` 표시와 함께 보이고 실제 DB 값과 섞지 않는다.
안 되는 기능을 되는 것처럼 보이게 하지 않는다. 홍보 문구에 없는 기능을 쓰지 않는다.

### 3-2. API 비용을 의식한다
외부 API(Google Maps/Places, Gemini)를 쓰는 기능은 캐싱을 먼저 설계한다. **DB-first**: 캐시 미스일 때만 호출. 새 API를 켜기 전에 무료 한도를 확인해 알린다.
캐시에는 서버가 직접 조회한 값만 저장한다(요청자가 보낸 값을 믿고 캐싱 금지). 캐시 저장이 실패해도 기능은 살아야 한다(로그만 남기고 정상 응답).

### 3-3. hover/클릭
정해진 규칙은 없고 케이스별로 판단한다. 단 hover는 마우스를 떼면 돌아오는 **임시 미리보기**여야 하며 클릭으로 만든 선택 상태를 덮어쓰면 안 된다. 새 선택 UI는 "어떻게 해제하나"를 먼저 설계한다.

### 3-4. 디자인 요청이면 기능을 건드리지 않는다
"디자인만" 요청은 CSS·마크업만 바꾼다. 로직·라우팅·상태관리는 손대지 않는다.

### 3-5. 캐시 테이블의 키 카디널리티
키가 `place_id`처럼 유한하면 괜찮다. 검색어·자유 입력이 섞이면 무한히 늘 수 있으므로 `updated_at` 인덱스 + TTL 정리(90일)를 함께 만든다. 정리는 `api/cleanup-search-cache.ts`(매일 cron)의 대상 목록에 **추가만** 한다(테이블별 정리 함수를 새로 만들지 않는다).

### 3-6. UI 문구
- 사용자가 대화 중 든 예시 문장을 그대로 화면에 넣지 않는다. 짧고 군더더기 없이 새로 쓴다. 제목으로 충분하면 설명은 넣지 않는다. 톤이 갈릴 문구는 2~4개 후보를 보여 주고 확인받는다. 사용자가 문구를 직접 지정하면 그대로 쓴다.
- **진지한 화면**(가입·약관·동의, 탈퇴·삭제, 결제·정산, 오류·권한 안내)은 담백한 서비스 문체(합니다/주세요체). 슬로건·느낌표·영어 장식 라벨 금지.
- **랜딩·마케팅 문구와 가격은 사용자가 정한다. 직접 고치라고 할 때만 고친다**(브랜드 서사는 의도된 톤이다. "담백하게"를 랜딩에 확대 적용하지 않는다).
- 가이드·도움말·환영 안내는 **해요체**(~해요/~해 보세요). ~한다체 금지.
- 법적·사실 필수 문구(동의 거부 권리·불이익 고지, "AI가 분석한 값", "추정")는 문체를 이유로 지우지 않는다.

### 3-7. 서버 함수
- 운영은 **Cloudflare Workers**. `api/*.ts`는 Vercel 형식(`handler(req,res)`)이고 `worker/vercelAdapter.ts`가 실행한다. **새 파일은 `worker/routes.ts`에도 한 줄 추가**(빠지면 `routes.test.ts` 실패).
- Vercel은 롤백용으로 `docs/CLOUDFLARE_MIGRATION.md` 5단계 정리 전까지 유지: 배포당 함수 12개 한도(CI 검사), 각 `api` 파일은 **자립형**(로컬 `lib/` import 금지, 공통 로직은 인라인 복제). 새 엔드포인트는 기존 파일에 `kind` 분기로 합치는 걸 우선한다(예: Gemini 기능은 `api/ai.ts`에 `kind` 추가).
- Workers 무료 플랜 요청당 한도: **CPU 10ms, 외부 호출 50번.** 외부 호출을 반복하면 묶음으로 나눈다(길찾기 12구간씩 — 서버 `MAX_LEGS`와 `src/utils/routeLegs.ts`가 같은 숫자).

---

## 4. 기술 스택 · 서버 설정

- **프론트**: Vite + TypeScript(바닐라). 게이트마다 `src/{module}/module.ts` + `module.css`.
- **DB**: Supabase(Postgres + RLS + Storage + Realtime). **지도**: Google Maps JS(`language=ko&region=KR` 필수). **AI**: Gemini(`gemini-2.5-flash-lite`).
- **배포**: Cloudflare Workers(Static Assets + Worker, `wrangler.jsonc`). `main` 병합 → Workers Builds 자동 배포 → `www.mongsil2.com`(루트는 Redirect Rule로 301). 환경 변수는 Worker 대시보드: 서버 비밀값은 **Secret**, `VITE_` 변수는 **Build** 변수(이름이 한 글자만 틀려도 기능이 조용히 꺼진다). `keep_vars: true`.

바꾸기 전에 이유를 알아야 하는 것:
- `worker/index.ts`: `/api/*` → 핸들러, 매일 정리(`scheduled` 03:00 UTC), 매시 날씨 알림. `run_worker_first`는 `/api/*`만(화면 파일까지 거치면 무료 요청 소모). 없는 주소는 `index.html`(SPA fallback).
- `placement`를 **도쿄 인근으로 고정**: Gemini가 일부 지역(홍콩 등)의 요청을 "User location is not supported"로 거절한다. 지우면 AI 전체가 멈출 수 있다.
- 캐시 헤더는 `public/_headers`(겹치면 이어 붙으니 `! Cache-Control`로 지우고 단다).
- Worker 안에서 직접 처리하는 주소(12개 한도 회피): `/api/notify`(`worker/notify.ts`, 웹 푸시 `webpush.ts` = VAPID + RFC 8291, 외부 라이브러리 없음), `/api/pay/*`(`worker/pay.ts`).
- 결제: 웹훅(`/api/pay/webhook`)만 로그인 예외이고 서명(Standard Webhooks)으로 지킨다. **결제 상태는 포트원 API로 다시 조회한 값만 믿고**, 반영·회수는 DB 함수(`grant_pro_pass`·`revoke_pro_pass`)가 한 번만 한다. 금액·기간은 `src/pay/products.ts` 한 곳. 운영에서는 테스트 채널 결제를 거절한다(`PAY_ALLOW_TEST=true`일 때만).
- 서비스워커는 HTML을 파일로 저장하지 않고, 화면 조각 불러오기에 실패하면 한 번 새로고침한다(`utils/chunkReload.ts`) — 없는 조각도 `index.html`로 대답되기 때문.
- 초대 공유 창(`src/share/shareSheet.ts`)의 카카오톡 버튼은 빌드 변수 `VITE_KAKAO_JS_KEY`가 있을 때만 보인다(바꾸면 재배포).
- 로그는 Cloudflare Observability. 실패한 `/api` 요청은 `[worker] … colo=…` 한 줄이 남는다.

### 반복 버그 패턴
- `typeof x === 'number'`는 NaN도 통과 → `Number.isFinite()`.
- CSS Grid row 높이는 콘텐츠 기준 → 높이 제한은 `max-height: calc(100vh - Npx)` 같은 뷰포트 기준 값.
- `position: sticky`는 실제 스크롤하는 가장 가까운 조상 기준 → 스크롤 컨테이너는 하나로(중첩 `overflow` 금지).
- FK 기본값(RESTRICT)이 삭제를 조용히 막는다 → `on delete set null/cascade`를 명시. 사람을 참조하는 새 컬럼은 `on delete set null`.
- 5초 실행취소 타이머는 화면 이탈 시 **취소가 아니라 커밋**(안 그러면 DB엔 남고 화면에서만 사라진다).
- 버튼 리셋은 `:where(.mb-app button)`처럼 명시도 0으로(`.mb-app button`은 클래스 하나짜리 버튼 규칙을 전부 이겨 배경이 투명해진다). 새 버튼 배경이 안 보이면 명시도부터 의심.
- `.sl-shell`의 `container-type: inline-size`는 fixed 자손의 기준 상자가 된다(전체 화면 지도가 갇힘). 폰에선 `normal`로 끄고 같은 규칙을 미디어쿼리에 다시 적는다.
- `route_stops`는 DAY 저장 때마다 통째로 지우고 다시 넣는다 → **route_stops를 FK로 참조하는 테이블을 만들지 않는다**(CASCADE로 기록이 날아간다). 진행 기록은 `TlStop.key`로 잇는다.

---

## 5. 설계 규칙 (게이트별 — 세부는 코드)

### 단일 기준 파일 — 같은 값이 화면마다 다르면 그 자체가 버그. 계산식은 여기서만 고친다
| 파일 | 담당 |
|---|---|
| `utils/travelEstimate.ts` | 구간 하나의 숫자(직선거리·이동시간·요금·체류시간·시각 파싱) — ROUTE/TIMELINE 공용 |
| `timeline/dayModel.ts` | 하루를 시간축에 올리는 규칙(`scheduleFor`, 실제 도착 기록 > 고정 시각 > 누적) — TIMELINE/Companion 공용 |
| `expense/expenseModel.ts` | 집계·정산·환율 — PC Expense와 폰 지갑 공용. DOM 없음 |
| `pay/products.ts` | 상품·가격(서버도 사용) |
| `route/routeStore.ts` | `route_days`/`route_stops` 저장·실시간. TIMELINE은 새 테이블 없이 이걸 공유한다 |

### STAY
- 권역은 `stay_zones`(큐레이션 DB) 우선, 없는 도시만 AI 폴백(프롬프트로 "숙박 생활권만, 관광지 이름 금지"). 지역명은 AI가 지은 이름이 아니라 여행자가 부르는 한글 표기. 현재 큐레이션된 도시는 방콕뿐.
- 숙소 예약 사이트 평점은 "Claude가 예약 목적으로 매긴 편집 점수"이지 실제 이용자 평점이 아님을 표시. 예산 필터는 1인 1박 입력 → 전송 시 인원수를 곱한다. 사이트별 필터 지원은 `confirmed|best_effort|unsupported`로 투명하게 구분. 숙소는 링크가 아니라 **이름 입력 → Google Places Text Search**(URL 스크래핑 폐기).
- Step3 이동시간은 직선거리 추정치로 먼저 채우고 Distance Matrix로 갱신.

### ROUTE / TIMELINE
- ROUTE가 숙소·공항 앵커까지 순서대로 저장하므로 TIMELINE은 앵커를 다시 계산하지 않고 저장된 순서를 신뢰한다.
- 공항 정류지는 `places` 행이 없다(`customName`만). 사진·평점은 `trip_destinations.arrival/departure_photo_url`(+`_rating/_lat/_lng`)을 읽어 `buildAirportPlaceMap`으로 합성한다 — 빠뜨리면 공항 카드만 사진이 안 뜬다.
- **AI 일정 짜기는 구조를 코드가 정한다**(`route/planModel.ts`). Day 시간 틀(도착·출발: 문서 `trip-anchors` > 여행 설정 > 없으면 온종일, 추측 금지) → 모든 장소를 Day에 배분(그룹은 같은 Day) → 식사 슬롯(식당이 모자라면 "장소 미정" 식사, `stop_purpose='meal:*'`) → 숙소 출발·숙소 복귀(`return:hotel`) / 마지막 날은 다음 이동 출발지. AI(`route-plan-day`)는 Day 안 순서만 맡고, 불완전한 답은 캐시하지 않고 거리순으로 대신한다.
- 장소 상세의 AI 요약·Don't Miss 등은 항상 `AI` 표시, 근거 없으면 옅은 `?`.
- 새 색을 추가할 땐 두 테마 모두에 값을 준다.

### Expense
- `trip_expenses`: `is_paid`(예정↔결제 완료), `split_mode`(SHARED/PERSONAL). **정산은 결제 완료 + 공동 + 미정산(`settled_at` 없음)만** 반영. `settled_at`은 정산 계산에서만 빼고 "실제 쓴 돈"에는 포함(`isSettleable`/`isSettled`).
- `trip_expense_budgets`의 `category='TOTAL'`은 총 예산 sentinel. 외화는 저장 시점에 환율 환산(`amount_krw`+`fx_rate`+`fx_source`). fallback 환율이면 `*`·"참고용", 환산 실패 항목은 합계에서 빠졌다고 밝힌다(3-1).
- 카테고리 색은 색약 검증을 통과한 **고정 순서 팔레트** — 순서 섞지 말 것.
- 실시간 갱신은 데이터 표시 영역만 다시 그린다(입력 중인 폼·설정 탭 값 보호).

### Documents · Notes · Assistant · Checklist
- 개인 문서 PIN(4자리)은 **멤버끼리의 칸막이일 뿐 인증이 아니다.** UI에서 실제 보안인 것처럼 표현하지 않는다. 잠금 전엔 PERSONAL을 조회하지 않고, 잠금 후에도 `owner_id`가 본인인 행만 본다. 잠금 상태는 sessionStorage.
- `visibility`와 `owner_id`는 체크 제약이 한 쌍 → 범위 이동은 **한 번의 UPDATE**. 파일은 옮기지 않는다. `updated_at`을 건드리지 않는다(바뀌면 Assistant가 문서를 다시 읽는다). 공용→개인이면 체크리스트 `linked_doc_id`를 끊는다.
- Assistant는 2단계(`doc-digest`로 파일에서 사실 추출 → `doc-qa`로 답변). 프롬프트에 "주어진 사실 안에서만, 없으면 모른다"를 명시하고, 참고한 자료 제목(`usedTitles`)을 칩으로 보여 주고, "AI가 정리한 답변" 안내를 고정 노출한다. 못 읽은 문서는 조용히 제외하고 "N개 문서는 읽지 못했어요"만 알린다. 개인 문서는 잠금을 푼 본인 것만 쓴다.
- Checklist는 새 테이블 없이 트립 공유 `trip_checklist`를 PC·폰이 함께 쓴다(목록을 화면별로 나누면 "어디에 적었더라"가 생긴다). 추가 컬럼은 전부 null 허용이고, 분류는 제목 키워드로 **추정해서 보여주기만** 한다(저장 안 함). 마이그레이션 전에도 체크·추가는 동작한다.

### 가입 동의 · 탈퇴 · 약관
- 동의는 **계정 단위**, 로그인 직후 서버에 기록이 없는 사람에게만 묻는다. 막는 건 서버가 "기록 없음"이라고 **분명히 답했을 때뿐**(오프라인·테이블 없음·네트워크 오류인 기존 사용자는 통과 — 비행기 안에서 항공권을 꺼내려는 사람을 막으면 안 된다).
- 새 가입자(10분 안)가 거절하면 방금 만든 계정을 탈퇴 함수로 지운다. 기존 사용자가 거절하면 로그아웃만.
- 약관·방침 내용이 바뀌면 `legal/versions.ts` 버전을 올린다(전원 재동의). 지금 문서는 **초안**이다 — 정식 확정 시 반드시 버전을 올린다.
- 탈퇴(`supabase/delete_my_account.sql`, 한 트랜잭션): 혼자 쓰던 여행 삭제 / 공유 여행은 가장 먼저 참여한 멤버에게 방장 이관 / 채팅·댓글·개인 문서 삭제 / 이름·사진 사본 비움 / 계정 삭제. `accountStore.planDeletion`은 이 규칙의 화면용 복제 — **한쪽을 고치면 다른 쪽도**. 문서 **파일**은 SQL로 못 지우므로 클라이언트가 함수 호출 **전에** 지운다(여행 삭제도 같은 순서). 새 사람 참조 컬럼·이름 사본 컬럼을 만들면 이 함수가 비우는지 확인(`deletionDrift.test.ts`). 이 SQL은 `do $$` 블록이 대시보드에서 잘린 전례가 있다.
- **방침은 코드의 사실 기술이다.** 위치·파일·사진·메모·새 외부 API/AI·기기 저장을 건드리면 `src/legal/legal.ts`를 같이 고친다. 방침이 코드와 어긋나는 것 자체가 법 위반.

### Companion(모바일)
- 계획 단계는 PC, 여행 중엔 폰. 스크롤 컨테이너는 `.mb-scroll` 하나(TIMELINE 페이저만 예외).
- 지갑은 `trip_documents`를 읽는다(DOCUMENTS와 같은 자료). 지출은 WALLET을 처음 열 때만 불러온다(3-2). 금액을 못 환산하면 지어내지 않고 "원화 환산 없이 저장돼요"로 밝힌다.
- 길찾기는 Google Maps 딥링크(`directionsHref`, 비용 0). 출발지는 기본 현재 위치, 상세에서 바꿀 수 있다(`mobile/directions.ts`).
- 진행 기록(`trip_stop_progress`)은 낙관적 갱신. 날씨는 Open-Meteo(키 없음). GPS 자동 체크인 `mobile/geo.ts`. 오프라인(서류·일정 열람, 누른 기록은 나중에 전송)은 `offline/`.
- 지도 객체는 만들 때마다 "지도 불러오기"로 청구되므로 탭을 오갈 때 새로 만들지 않는다(`parkMap`).

### IDEAS 도구 (지도 보기 · 펜 · 영역 검색 · 그룹)
- 지도 보기는 우측 게이트 4칸만 지도로 바꾼다(체크인 패널·점선 구분선 유지). 그룹은 맨 위 카드 한 장이 겹침 두께로 보이고, 클릭하면 펼쳐지며 아래에 접기 버튼.
- 펜·영역 검색은 지도 이벤트가 아니라 **브라우저 포인터 이벤트(캡처 단계)** + `mapPixel.ts` 좌표 변환을 쓴다(`draggable:false`는 휠 확대와 핀 클릭을 막는다). 펜은 `board_drawings`(실시간, 멤버별 고유 색, 거리는 직선거리)이고 PC 전용. 영역 검색은 **PRO 전용**이고 하루 20번, 잠금은 UI 수준이다(브라우저가 Google을 직접 부름 — 서버 강제는 미룸). 사용은 `api_usage` kind `pro`로 기록한다(환불 기준).
- 정보창은 hover로 뜨되 지도 위치를 움직이지 않는다(`disableAutoPan`).

### 모바일 웹 최적화 (폭 768px 이하)
- **PC 디자인은 한 픽셀도 바꾸지 않는다**(1280px 스크린샷이 변경 전후 같아야 한다). 모바일 규칙은 전부 `@media (max-width: 768px)` 안에만, 모바일 전용 요소는 PC에서 `display:none`. 기능은 줄이지 않고 터치로 못 하는 조작(끌어 놓기·호버)은 다른 방법으로 대신한다(⋯ 바텀시트, 길게 눌러 끌기 `mobile/reorder.ts`).
- IDEAS: 탭 바 + 탭 하나만 전체 폭, 상태는 `.bd-layout[data-mtab]` 하나. STAY: 목록이 기본, 지도는 전체 화면으로 같은 mapInstance를 키운다(새로 만들지 않음). ROUTE: 일정 보기↔지도 보기. TIMELINE: 지도 기본 접힘, 장소 상세는 바텀시트.
- 입력창 글자는 16px(iOS 확대 방지), 주요 버튼 44px.

### 온보딩 · 가이드 · 도움말 센터
- 상태는 localStorage `mongsil:onboarding:<userId>`(기기를 바꾸면 처음부터). 닫는 방법(건너뛰기·종료·Esc·이동)에 상관없이 본 것으로 기록. 내용을 크게 바꾸면 `WELCOME_VERSION` / `tourContent.ts`의 각 `version`을 올린다.
- 가이드 엔진(`onboarding/tour.ts`): 화면을 막지 않는다. 대상은 **`data-tour="…"`로만** 찾는다 — **화면 코드를 고칠 때 `data-tour`를 지우지 않는다**(조용히 단계가 빠진다). 저절로 뜨는 가이드는 다른 가이드가 떠 있으면 끼어들지 않는다. 폰 전용 단계(`mobileSteps`)는 기록을 `<id>:m`으로 따로 남긴다.
- 도움말 문구(`helpContent.ts`): 글에 `images`(N단계 뒤)와 `badge`('PRO'|'PC')를 달 수 있다. 검색은 AI 없이 정적 비교(`keywords`에 사용자가 칠 법한 말).
- **기능을 추가·변경·삭제하면 `tourContent.ts`·`helpContent.ts`를 같이 고친다**(없어진 기능 안내 = 3-1 위반).

---

## 6. 운영 · 보안 · 비용

### 키와 비밀값
- 브라우저 키(`VITE_GOOGLE_MAPS_KEY`): HTTP 리퍼러 제한 + Maps JavaScript·Places(New)만. 서버 키(`GOOGLE_MAPS_SERVER_KEY`): **리퍼러 제한 없이** API 제한(Places(New)·Routes)만(서버 요청엔 리퍼러가 없어 걸면 전부 거절). `GOOGLE_ROUTES_API_KEY`가 있으면 서버 키보다 우선.
- 브라우저로 나가는 건 `VITE_` 변수뿐. service role·Gemini·`ADMIN_SECRET`·`CRON_SECRET`은 서버에서만. **DB에 Google 키가 붙은 주소를 저장하지 않는다**(사진은 우리 Storage 주소만).
- Gemini 키는 **유료 등급**(무료 등급은 입력이 개선에 쓰일 수 있는데 문서·여권이 들어간다).
- 콘솔 설정(리퍼러·API 제한·예산 알림), 키 교체·폐기, 운영 SQL 실행, 결제·요금 변경은 **사용자가 하거나 먼저 확인받는다.** service role 키는 Claude에게 주지 않는다. 비밀값은 채팅·코드·커밋·PR에 쓰지 않는다(어떤 값이 어디 필요한지만 말한다).

### 서버 함수 규칙
- 새 함수·`kind`는 처음부터: (1) 로그인 토큰 검증 (2) 그 여행 멤버 확인 (3) 입력 개수·길이·형식 제한 (4) 외부 호출 타임아웃 (5) 오류 응답에 외부 원문 비노출. 외부 키가 거절되면(401/403/429) 같은 호출을 반복하지 않고 첫 실패에서 멈춘다.
- 앱에서 `/api/*`는 `fetch`가 아니라 **`utils/apiFetch.ts`의 `apiFetch`**(토큰을 붙임). 토큰이 없으면 Worker 입구(`worker/auth.ts`)가 401(`AUTH_EXEMPT` 예외). 비상시 `API_AUTH=off`.
- **하루 상한**(`supabase/api_usage.sql`): AI 60(PRO 150) · 장소 검색 40 · 주변 시설 20 · 길찾기 60. **돈이 드는 외부 호출 직전에만** 센다(캐시 결과는 세지 않음). 관리자·지인 예외는 `app_roles`(이메일 + `admin`/`unlimited`). 새 유료 호출은 같은 블록을 복사하고 `dailyQuota.test.ts`에 더한다.
- **연타 상한**(`supabase/api_burst.sql`, `spend_api_burst`, `api/ai.ts`의 `BURST_LIMITS`): PRO도 3분 안 몰아치기를 막는다. 관리자·unlimited 제외, 오류 시 열어 둔다(fail open). 이 SQL을 안 돌려도 앱은 동작한다.
- 요금제: 판정은 `api/ai.ts`의 `planFrom`/`userPlan` 한 곳 — `app_roles` admin·unlimited → PRO, `user_plans.plan='pro'`이고 만료 전 → PRO, **표가 없거나 조회 실패면 무료**. 화면 표시는 `kind:'my-plan'`, 실제 허용은 기능마다 서버가 다시 확인. PRO = 30일 이용권. PRO 기능: 어시스턴트 웹 검색(이용권당 100·하루 20), 인생샷 `photo-spots`, 영수증 읽기 `receipt-read`(`RECEIPT_AI_ENABLED=true`일 때만, 지금 꺼짐), 지도 영역 검색. PRO 기능을 쓰면 `recordProUse`/`pro-use`로 `api_usage` kind `pro`에 남긴다(환불 기준). 무료 사용자가 PRO 기능을 누르면 `goPro(feature)`로 `#pro`로 보내고, 돌아왔을 때 요금제는 `planRecheckDue`로 다시 확인한다.

### 비용
- 비싼 호출: Gemini 검색 그라운딩, Places의 **Enterprise 필드**(평점·사진·영업시간·예약 가능), 사진. 필드 마스크로 등급을 관리하고 목록 단계에선 필수 필드만(주변 탐색 목록은 `isReservable`을 받지 않는다, `exploreApi.ts`).
- 무료 한도는 SKU별 월 단위. 숫자를 코드·문서에 박지 않고 공식 가격표로 확인한다. Cloud Console에 **예산 알림과 API별 일일 할당량 상한**을 둔다(사용자가 설정).
- 운영 DB에 반드시 있어야 하는 캐시 테이블: `ai_plan_cache` · `hotel_review_summary_cache` · `hotel_infra_cache` · `hotel_score_cache` · `hotel_search_cache` · `route_leg_cache` · `ai_monthly_picks`. **없으면 캐시 없이 조용히 동작해 비용만 샌다** → 배포 점검에서 확인.

### 데이터 · 권한
- 모든 테이블 RLS 켬, 정책은 "그 여행의 멤버인가". 캐시 테이블은 정책 없이 service role만. Storage: `trip-docs` 비공개, `place-photos`·`link-previews` 공개(클라이언트 쓰기 없음).
- 사용자 입력을 `innerHTML`에 넣을 때 `escapeHtml`은 텍스트용이라 **속성 안의 따옴표를 못 막는다** → 속성은 따옴표까지 이스케이프하고 링크·이미지 주소는 `http(s)`만(`utils/html.ts`).
- SQL 파일은 **한 줄에 한 구문**, 주석에 세미콜론·달러 기호·`do` 블록 금지(대시보드 SQL 편집기가 여러 줄 구문을 중간에서 자른 전례). `MOBILE_SETUP.sql`도 같다. 읽기 좋은 원본은 개별 `.sql`에 둔다.
- 이 저장소에 SQL이 없는 베이스 테이블(`trips`·`trip_members`·`places`·`places_db`)의 RLS 정의는 저장소에 남겨야 한다(미해결).

### 오류 감지
Cloudflare Observability(서버) / `utils/errorReport.ts` → `client_errors`(화면, 30일 뒤 정리) / `/api/health`를 외부 업타임 서비스가 호출(설정은 사용자).

### 상업화 전 필수
- 약관·방침은 초안이고 사업자 정보가 비어 있다 → 확정 후 버전을 올린다. 연락처 `help@mongsil2.com`.
- **가격·요금제·랜딩 문구는 사용자가 정한다.** Claude는 원가 근거 후보만 제안한다.
- 유료화에 필요한 것: 통신판매업 신고, PG, 환불·청약철회 정책, 푸터 사업자 정보, 방침에 결제 위탁사.
- 요청당 CPU 10ms를 넘는 작업이 생기면 월 $5 유료 플랜을 사용자가 정한다(문서 AI 읽기는 측정 전).

### 미해결 (해결하면 지운다)
- 높음: 주소별 "그 여행 멤버인가" 확인 / Vercel 옛 주소(`mongsil2.vercel.app/api/*`) 정리(5단계) / 오류 감지 보강.
- 중간: `cache-photo`·`destination-zones` 오류 원인 / 초대 코드(6자리·만료 없음) 강화 / 보안 헤더(CSP) / Places 필드 등급·자동완성 세션 / 자유 입력 캐시의 정리 대상 누락 / 외부 호출 타임아웃 / 의존성 취약점 / Google 장소 정보 보관 범위 / `google.maps.Marker` → `AdvancedMarkerElement` / 방콕 외 도시 `stay_zones` 큐레이션 / 영역 검색 서버 강제.

---

## 7. 파일 구조 (요약 — 상세는 코드)

```
src/  board/ shortlist/ route/ timeline/ mobile/ checklist/ expense/ docs/ assistant/ links/
      workspace/ (게이트 라우팅·사이드바)  onboarding/  legal/  account/  pay/  share/  offline/  pwa/  utils/  types/
worker/  index.ts(진입·cron) vercelAdapter.ts routes.ts(주소 표) auth.ts notify.ts webpush.ts pay.ts weatherAlert.ts edgeCache.ts
api/     각 파일 자립형. ai.ts = Gemini 묶음(body의 kind로 분기: hotel-review, route-plan, day-detail, place-brief,
         doc-digest, doc-qa, photo-spots, receipt-read, my-plan, pro-use ...)
supabase/  *.sql (구문당 한 줄) / MOBILE_SETUP.sql = 모바일 마이그레이션 합본
docs/    COMMERCIAL_READINESS · LAUNCH_HANDOFF · PAYMENT_DESIGN · PAYMENT_OPERATIONS · CLOUDFLARE_MIGRATION · MOBILE_STRATEGY
```

---

## 8. 작업 전 체크리스트

- [ ] 디자인만 바꾸는 요청인가, 기능을 바꾸는 요청인가
- [ ] 보여줄 데이터가 진짜 데이터인가(3-1) / 외부 API에 캐싱이 있고 무료 한도를 확인했는가(3-2) / 새 캐시 키에 자유 입력이 섞이면 TTL 정리가 있는가(3-5)
- [ ] UI 문구가 대화 중 표현을 그대로 옮긴 건 아닌가, 진지한 화면은 담백한가, 랜딩·가격은 건드리지 않았는가(3-6)
- [ ] hover가 선택 상태를 덮어쓰지 않는가, 해제 수단이 있는가(3-3)
- [ ] 새 `api/*.ts`면 `worker/routes.ts`에 등록했는가, 12개 한도·요청당 외부 호출 50번·CPU 10ms를 지키는가(3-7)
- [ ] 서버 함수·`kind`면 로그인·멤버 확인·입력 제한·타임아웃·일일/연타 상한·외부 원문 비노출을 지켰는가(6장)
- [ ] 새 키·비밀값이 브라우저(`VITE_`)로 나가지 않는가 / 사용자 입력을 HTML 속성·링크에 넣는다면 이스케이프와 `http(s)` 제한
- [ ] 공개 페이지를 만들면 `src/seo/seoFiles.ts`의 `PUBLIC_PATHS`에 더했는가
- [ ] 개인정보를 새로 모으거나 밖으로 보내는가 → `src/legal/legal.ts`를 먼저 맞춘다
- [ ] 사람 참조 컬럼·이름 사본 컬럼을 추가했는가 → `delete_my_account.sql` 확인
- [ ] 기능을 바꿨다면 `tourContent.ts`·`helpContent.ts`가 여전히 사실인가, `data-tour`를 지우지 않았는가
- [ ] 새 테이블·캐시면 RLS와 SQL 파일을 저장소에 넣었고 필수 캐시 목록(6장)을 갱신했는가
- [ ] `expenseModel.ts`·`travelEstimate.ts`·`dayModel.ts` 계산을 건드렸다면 테스트가 통과하는가 — 안 되면 **테스트를 고치기 전에 계산을 먼저 의심**
- [ ] `npx tsc --noEmit && npx vite build && npm test` 통과

---

## 9. Git / PR 워크플로우

- 브랜치 → PR → CI 통과 → 병합. **한 PR에는 한 주제만.** CI(`타입체크 · 빌드`)가 통과하고 `main`과 충돌이 없으면 매번 묻지 않고 병합한다. CI 실패나 충돌이면 병합하지 않고 원인을 설명한다.
- 충돌이 있는 PR은 CI가 시작되지 않는다 → `main`에 rebase.
- `Workers Builds: mongsil`은 PR 브랜치에서 항상 실패한다(`wrangler preview` 설정 문제, 운영 무관). 병합 판단은 `타입체크 · 빌드` 기준.
- 배포는 `main` 병합 시 자동(Workers Builds). Vercel은 롤백용으로만 남아 있다.
- 키 교체·콘솔 설정·운영 SQL 실행·결제·DB 스키마 변경·운영 데이터 삭제는 **사용자에게 먼저 확인**받는다. SQL은 파일로 만들고 실행은 사용자가 Supabase 대시보드에서 한다. 개인정보·약관·가격 문구도 사용자가 정한다.
- 추측으로 단정하지 않는다. 확인한 것과 추정한 것을 구분해서 쓴다.
