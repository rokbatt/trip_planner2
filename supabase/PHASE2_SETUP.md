# Phase 2 설정 (Step3 실데이터 연동)

Step3의 **주변 편의 인프라**와 **여행 효율 점수**를 예시가 아닌 실데이터로 채우려면 아래를 설정하세요.
설정 전에도 화면은 정상 동작하며(예시 + "곧 연동" 안내), 설정을 마치면 자동으로 실데이터로 바뀝니다.

## 1. 캐시 테이블 생성 (선택이지만 권장)

Supabase 대시보드 → SQL Editor 에서 [`phase2_cache.sql`](./phase2_cache.sql) 실행.
(테이블이 없어도 동작하지만, 있으면 같은 숙소 재조회 시 Google/Gemini 재호출을 건너뜁니다.)

## 2. Vercel 환경변수 (이미 있으면 그대로)

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — 캐시 접근용 (없으면 캐시만 생략)
- `GOOGLE_MAPS_SERVER_KEY` — 주변 편의 인프라(Places Nearby Search)용, 서버 전용 무제한 키
- `GEMINI_API_KEY` — 여행 효율 점수(Gemini 채점)용

## 3. Google Cloud Console

- **Places API (New)** 활성화 (Nearby Search는 New API 사용).
- 무료 한도(2025-03 이후): Pro SKU 월 5,000건 무료. 숙소 1곳당 시설 타입 8개 = 8건 호출이며,
  캐시가 있으면 숙소당 1회만 발생합니다. 실사용 전 GCP 예산 알림 설정을 권장합니다.

## 동작 방식 / 신뢰도

- **주변 편의 인프라**: 전세계 공통 시설 타입(대중교통/편의점/카페/약국/병원/ATM/택시/슈퍼)만 사용.
  거리는 숙소↔시설 **직선거리**, 도보시간은 그 거리 기반 추정(≈80m/분). 실제 도보 경로 시간이
  필요하면 `api/nearby-infra.ts`를 Routes API(Compute Route Matrix)로 승급하면 됩니다.
- **여행 효율 점수**: Gemini가 위치·평점·주변 요약 등 입력을 종합해 매기는 **AI 평가**이며
  이용자 리뷰 점수가 아닙니다(화면에도 그렇게 표기). 안전도(야간)는 신뢰 가능한 실측 소스가
  없어 채점 항목에서 제외했습니다.
