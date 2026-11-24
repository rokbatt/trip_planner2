# 결제 설계 (확정안 — 포트원 V2)

PRO 30일 이용권을 팔기 위한 결제 설계예요. 체크리스트 `docs/COMMERCIAL_READINESS.md` 3단계 C-1의 결과물이고,
C-2~C-7 PR은 이 문서를 기준으로 만들어요. 바꿀 땐 이 문서부터 고쳐요.
구분: **확인** = 포트원 공식 문서·이 저장소 코드로 본 것 · **확인 필요** = 계약·콘솔·실제 응답으로 확인할 것

마지막 갱신: 2026-11-24

## 0. 정해진 것 (사용자 결정)

| 항목 | 값 |
|---|---|
| 상품 | `pro_30d` — PRO 30일 이용권, **4,900원**(부가세 포함), 자동 갱신 없음 |
| PRO 기능 | AI 어시스턴트 웹 검색(하루 20번 · 이용권당 총 100번) · 인생샷 · 영수증 AI 입력 · AI 하루 상한 150번 |
| 받는 사람 | 결제한 사람 1명 |
| 다시 사면 | 남은 기간에 30일을 더하고, 남은 웹 검색에 100번을 더해요 |
| 환불 | 결제 후 7일 이내이고 **PRO 전용 기능(웹 검색·인생샷·영수증 AI)을 하나도 쓰지 않았으면** 전액 환불. 그 외에는 결제 전에 고지한 대로 청약철회 제한(11-24 확정) |
| 결제자 이메일 | 탈퇴해도 결제 기록에 사본을 5년 보관(분쟁 대응, 방침에 고지 — 11-24 확정) |
| PG 경로 | 포트원 추천패키지. 결제 수단은 카드 · 토스페이 · 카카오페이 |
| 미성년자 | 결제 화면에서 따로 확인하지 않음. 약관 조항과 환불 절차로 처리 |

## 1. 결제 흐름 한눈에

```
 [요금제 화면]──①prepare──▶ Worker: 주문 만들기(금액·상품은 서버가 정함) ─▶ payments 행(status=ready)
      │
      ②포트원 결제창(PortOne.requestPayment, redirectUrl 지정)
      │
 [결제 완료 화면 /pro/done?paymentId=…]──③complete──▶ Worker: 포트원에 결제 조회
      │                                                   → PAID · 금액 4,900 · KRW · 우리 상점인지 확인
      │                                                   → grant_pro_pass(paymentId)  (한 번만 반영)
      │
 포트원 ──④웹훅(Transaction.Paid / Cancelled)──▶ Worker: 서명 확인 → 다시 포트원에 조회 → 같은 반영 함수
```

- ③과 ④ 중 **먼저 도착한 쪽이 반영**하고, 나중에 온 쪽은 "이미 반영됨"으로 끝나요.
  브라우저가 중간에 닫혀도 ④가 메워 줘요(포트원 문서가 웹훅을 권장하는 이유, 확인).
- 웹훅 내용은 믿지 않아요. 서명을 확인한 뒤에도 **결제 상태는 항상 포트원 API로 다시 조회한 값만** 써요(포트원 문서의 두 전략을 둘 다 적용).

## 2. 상업 결제의 10단계와 몽실이 구현

| 단계 | 출시 때 | 나중 |
|---|---|---|
| 1. 상품 | 서버 상수 `PRODUCTS = { pro_30d: { amount: 4900, days: 30, web: 100, name: 'PRO 30일 이용권' } }`. 화면이 보낸 금액은 쓰지 않아요 | 쿠폰·할인 |
| 2. 결제 전 고지 | 결제 버튼 바로 위: 가격·기간·자동 갱신 없음·환불 기준·약관 링크 + "주문 내용을 확인했고 결제에 동의합니다" 체크 | — |
| 3. 결제 | 포트원 브라우저 SDK, 카드 / 토스페이 / 카카오페이 버튼 3개 | 정기결제 |
| 4. 서버 확인 | complete + 웹훅 둘 다. 같은 결제는 한 번만 반영(아래 4장) | — |
| 5. 이용권 부여 | `user_plans`의 만료일·남은 웹 검색 수를 DB 함수 하나로 원자적으로 갱신 | — |
| 6. 영수증 | 카드 매출전표·현금영수증은 PG가 발행. 앱은 결제 내역(날짜·금액·수단·상태·만료일)만 보여 줘요 | PG 영수증 링크(응답에 주소가 있는지 **확인 필요**) |
| 7. 환불 | 지갑/메뉴의 "환불 요청" → help@mongsil2.com 메일 → 관리자가 환불 주소 호출 → 포트원 취소 → 이용권 회수 | 앱 안 자동 환불 |
| 8. 기록 보관 | `payments`는 탈퇴해도 남기고 5년 뒤 정리(아래 5장) | — |
| 9. 대사·감시 | 결제 실패·금액 불일치·웹훅 서명 실패는 Worker 로그에 `[pay]` 한 줄. 주 1회 포트원 콘솔과 `payments`를 사용자가 비교(SQL 제공) | 매일 자동 대사(예약 작업 — 만들기 전에 확인) |
| 10. 세금·정산 | 포트원/PG 정산 내역이 매출 장부. 부가세·종합소득세 신고는 사용자 | 세무 대리 |

## 3. 서버 주소 (Worker 안, `worker/pay.ts`)

`api/` 파일은 12개 한도라 알림(`/api/notify`)처럼 **Worker 안에서 직접** 처리해요(Claude.md 3-7). 주소는 `worker/routes.ts`에 등록해요.

| 주소 | 로그인 | 하는 일 |
|---|---|---|
| `POST /api/pay/prepare` `{ product }` | 필요 | 상품 확인 → `paymentId` 서버 생성(영문·숫자·하이픈, 예: `mongsil-<랜덤 24자>`) → `payments` 행 `ready` → `{ paymentId, orderName, amount }` 반환. 한 사람이 1시간에 만들 수 있는 주문은 10개까지 |
| `POST /api/pay/complete` `{ paymentId }` | 필요 | 그 주문이 **요청자 것인지** 확인 → 포트원 조회 → 검증 → `grant_pro_pass` → `{ plan, expiresAt, webLeft }` |
| `POST /api/pay/webhook` | **예외**(`AUTH_EXEMPT`) | Standard Webhooks 서명 확인 → `Transaction.Paid`면 조회·반영, `Transaction.Cancelled`·`PartialCancelled`면 조회·회수. 모르는 `type`은 200으로 무시(포트원 안내, 확인) |
| `GET /api/pay/history` | 필요 | 내 결제 내역(최근 20건) |
| `POST /api/pay/refund` `{ paymentId, reason }` | 관리자(`app_roles` admin) | 환불 판단 자료(결제일, 그 뒤 PRO 기능 사용 횟수)를 먼저 보여 주고, `confirm: true`로 다시 부르면 포트원 취소 API 호출 → 회수 |

**검증 규칙(complete·webhook 공통)** — 하나라도 어긋나면 반영하지 않고 로그만 남겨요.
1. 포트원 `GET https://api.portone.io/payments/{paymentId}`, 헤더 `Authorization: PortOne {API_SECRET}` (확인)
2. `status === 'PAID'` (확인)
3. `amount.total === payments.amount`(4,900) 그리고 통화 KRW (금액 비교는 포트원 예제와 같음, 확인)
4. 상점 ID가 우리 것(`PORTONE_STORE_ID`)
5. 운영 환경에서는 테스트 채널 결제를 거절(`PAY_ALLOW_TEST=true`일 때만 허용) — 응답에서 채널 종류를 읽는 필드는 **확인 필요**(C-3에서 실제 응답으로 확인)

**웹훅 서명** — 포트원은 Standard Webhooks 방식을 따라요(확인).
- 헤더 `webhook-id` · `webhook-timestamp` · `webhook-signature`.
- `{id}.{timestamp}.{원문 본문}`을 웹훅 시크릿으로 HMAC-SHA256 해서 비교해요. 시각이 5분 넘게 차이 나면 거절해요.
- 포트원 서버 SDK(`@portone/server-sdk`) 대신 **WebCrypto로 직접** 구현해요. `webpush.ts`처럼 외부 라이브러리 없이 작게 만들고, 명세의 예제로 시험해요. 원문 본문을 그대로 써야 해서 JSON 파싱 전에 검증해요.

**비밀값·설정값**(값은 채팅·코드에 쓰지 않음)

| 이름 | 종류 | 어디에 |
|---|---|---|
| `PORTONE_API_SECRET` | 비밀 | Cloudflare Worker **Secret** |
| `PORTONE_WEBHOOK_SECRET` | 비밀 | Cloudflare Worker **Secret** |
| `PORTONE_STORE_ID` | 공개 | Worker 변수 |
| `VITE_PORTONE_STORE_ID` | 공개 | Build 변수(위와 같은 값) |
| `VITE_PORTONE_CHANNEL_CARD` · `VITE_PORTONE_CHANNEL_TOSSPAY` · `VITE_PORTONE_CHANNEL_KAKAOPAY` | 공개 | Build 변수. 결제 수단별 채널이 따로인지 하나인지는 계약에 따라 달라요(**확인 필요**). 하나면 같은 값을 넣어요 |
| `PAY_ALLOW_TEST` | 설정 | 개발 중에만 `true` |

## 4. 데이터 (C-2 `supabase/payments.sql`, 실행은 사용자)

**`payments`** — 결제 한 건이 한 줄
- `payment_id text primary key`(포트원에 보낸 ID) · `user_id uuid references auth.users on delete set null`
- `buyer_email text`(분쟁 대응용 사본, 5장) · `product text` · `amount int` · `currency text`
- `status text`(`ready` → `paid` → `cancelled` / `failed`) · `pay_method text`(카드·토스페이·카카오페이)
- `pg_tx_id text` · `granted_at` · `period_end`(이 결제로 늘어난 만료일) · `cancelled_at` · `cancel_reason` · `created_at`
- RLS: 본인 줄 읽기만. 쓰기는 서버(service_role)만
- 카드 번호 같은 결제 수단 정보는 **저장하지 않아요**(포트원·PG가 가지고 있어요)

**`user_plans`에 칸 하나 추가** — `web_left int`
- PRO 웹 검색 남은 수예요. `null`이면 제한 없음(관리자가 넣은 PRO·`app_roles`).

**DB 함수**(security definer, service_role만 실행)
- `grant_pro_pass(payment_id)`: 행 잠금 → 이미 `paid`면 아무것도 안 함(멱등) → `paid`로 바꿈 →
  - 만료일 = `max(지금, 남은 만료일) + 30일`
  - `web_left`는 이용권이 살아 있으면 +100, 끝났으면 100으로 새로 시작
  - `source='portone'`
  - 관리자가 넣은 만료 없는 PRO는 줄이지 않아요
- `revoke_pro_pass(payment_id)`: 이미 `cancelled`면 아무것도 안 함 → 만료일 −30일, `web_left` −100(0 아래로 안 감) → 만료일이 지났으면 무료
- `spend_web_left(user)`: 웹 검색 직전에 1 줄여요. 0이면 거절하고, `null`이면 통과해요. 지금 있는 하루 20번 상한은 그대로 둬요

## 5. 탈퇴 · 기록 보관

- 전자상거래법상 **대금 결제·청약철회 기록은 5년, 분쟁 처리 기록은 3년** 보관해야 해요(제6조·시행령 제6조, 확인 필요 → 국가법령정보센터).
- 그래서 탈퇴할 때 `payments`는 **지우지 않고** 이렇게 처리해요.
  - `user_id`만 비워요(`on delete set null`).
  - `buyer_email` 사본은 남겨요. 분쟁이 나면 결제자를 찾을 수 있어야 하기 때문이에요.
  - 개인정보 방침에 "관계 법령에 따른 보관"으로 적어요(C-7).
- 5년이 지난 행은 기존 매일 정리 작업(`api/cleanup-search-cache.ts`) 대상에 더해서 지워요. 정리 작업은 이미 있으므로 새 예약 작업은 아니에요.
- 탈퇴 화면에는 "남은 이용권은 환불되지 않아요(환불 기준에 해당하면 탈퇴 전에 요청)"를 표시해요(C-5).
- `deletionDrift.test.ts`가 새 사용자 칸을 잡아내므로, `payments`는 "보관 대상"으로 예외 처리해요(C-2).

## 6. 화면 (C-5)

- **요금제 화면**: 메뉴(☰) → "PRO"에서 열려요. 앱 곳곳의 PRO 배지를 눌러도 이 화면으로 와요. PC·휴대폰 같은 화면이에요.
  - 무료·PRO 비교 표(체크리스트의 표와 같은 내용)
  - 결제 전 고지와 동의 체크
  - 결제 수단 버튼 3개
- **결제 완료 화면** `/pro/done`: complete를 부르는 동안 "확인 중"을 보여 주고, 결과로 만료일과 남은 웹 검색 수를 보여 줘요.
  - 웹훅이 먼저 반영했으면 "이미 반영됨"도 성공으로 보여 줘요.
  - 실패하면 결제 ID와 문의 메일을 보여 줘요.
- **내 이용권**: 만료일, 남은 웹 검색, 결제 내역, "환불 요청"(메일 작성 화면으로 연결, 결제 ID가 미리 들어가게)
- 문구는 진지한 화면 문체로 써요(Claude.md 3-6: 담백하게, 결제 고지는 합니다/주세요체).

## 7. 실패·예외 대응

| 상황 | 처리 |
|---|---|
| 결제창에서 취소·실패 | 결제 ID를 `failed`로 기록하고 "결제가 완료되지 않았어요" 안내. 같은 주문 ID로는 다시 결제할 수 없어서(포트원 안내, 확인) 다시 시도하면 새 주문을 만들어요 |
| 결제는 됐는데 브라우저가 닫힘 | 웹훅이 반영해요. 다음에 앱을 열면 `my-plan`이 PRO로 나와요 |
| complete와 웹훅이 동시에 도착 | `grant_pro_pass`의 행 잠금과 상태 확인으로 한 번만 반영돼요 |
| 금액·상점·상태 불일치 | 반영하지 않고 `[pay] mismatch` 로그를 남겨요. 사용자에게는 "확인이 필요해요, 문의해 주세요" |
| 포트원 API 장애 | complete는 실패로 응답하고 웹훅 재시도에 맡겨요. 사용자에게는 "잠시 뒤 자동 반영" |
| 포트원 콘솔에서 직접 취소 | 웹훅 `Transaction.Cancelled` → 조회 → 회수 |
| PG사 쪽에서 직접 취소 | **금지**(포트원과 상태가 어긋나요, 포트원 안내 확인). 운영 절차 문서에 적어요 |
| 테스트 결제가 운영에 들어옴 | 검증 5번에서 거절 |

## 8. 결정과 남은 확인

- [x] 환불의 "사용" 기준 = PRO 전용 기능 3개 중 하나라도 사용(11-24). 구현: 세 기능이 쓰일 때 `api_usage`에 `pro` 종류로 기록만 해요(상한 없음, C-4).
  `api_usage`는 7일 보관이라 7일 환불 기간과 맞아요. 관리자 환불 주소(C-6)가 결제일 이후 `pro` 기록 수를 보여 줘요
- [x] 결제자 이메일 5년 보관(11-24) → `payments.buyer_email`. 방침 고지는 C-7
- [ ] 포트원 테스트 계정(상점 ID·채널 키·API 시크릿·웹훅 시크릿) — 사업자등록 없이 되는지 **확인 필요**
- [ ] `supabase/payments.sql` 실행(사용자) — C-3 시험 전에

## 9. 다음 PR 순서

C-2 `payments.sql`(+ `user_plans.web_left`, DB 함수 3개, 탈퇴 예외) → C-3 `worker/pay.ts`(+ 서명 검증 테스트) → C-4 웹 검색 100번(`spend_web_left`)
→ C-5 요금제·결제·내 이용권 화면(브라우저 SDK `@portone/browser-sdk` — 결제 화면에서만 불러와요) → C-6 관리자 환불 주소·운영 절차 문서
→ C-7 약관·방침·사업자 정보

참고: [포트원 V2 결제 연동](https://developers.portone.io/opi/ko/integration/start/v2/checkout?v=v2) ·
[웹훅 연동](https://developers.portone.io/opi/ko/integration/webhook/readme-v2?v=v2) ·
[결제 취소](https://developers.portone.io/opi/ko/integration/cancel/v2/readme?v=v2) · [Standard Webhooks](https://www.standardwebhooks.com/)
