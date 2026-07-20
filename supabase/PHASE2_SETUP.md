# Phase 2 설정 (Step3 실데이터 연동)

Step3의 **주변 편의 인프라**와 **여행 효율 점수**를 예시가 아닌 실데이터로 채우려면 아래를 설정하세요.
설정 전에도 화면은 정상 동작하며(예시 + "곧 연동" 안내), 설정을 마치면 자동으로 실데이터로 바뀝니다.

## 1. 캐시 테이블 생성 (선택이지만 권장)

Supabase 대시보드 → SQL Editor 에서 [`phase2_cache.sql`](./phase2_cache.sql) 실행.
(테이블이 없어도 동작하지만, 있으면 같은 숙소 재조회 시 Google/Gemini 재호출을 건너뜁니다.)

## 2. Vercel 환경변수 (이미 있으면 그대로)

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — 캐시 접근용 (없으면 캐시만 생략)
- `GOOGLE_MAPS_SERVER_KEY` — 주변 편의 인프라(Places Nearby Search)용, 서버 전용 무제한 키
- `GOOGLE_ROUTES_API_KEY` — 도보 경로 시간(Routes API)용. 안 넣으면 `GOOGLE_MAPS_SERVER_KEY`를 재사용
- `GEMINI_API_KEY` — 여행 효율 점수(Gemini 채점)용

## 3. Google Cloud Console

- **Places API (New)** 활성화 (Nearby Search).
- **Routes API** 활성화 (Compute Route Matrix — 실제 도보 시간/거리).
- 무료 한도(2025-03 이후): 각 SKU가 월 단위 무료 건수를 가짐(Pro 5,000 등). 숙소 1곳당
  Nearby Search 8건 + Route Matrix 1회(8 element)가 발생하지만, **캐시가 있으면 숙소당 딱 1번**만
  호출되고 이후엔 DB에서 읽습니다. 실사용 전 GCP 예산 알림 설정을 권장합니다.

## 캐싱 (무료 한도 절약의 핵심)

- 두 엔드포인트 모두 **`place_id` 기준으로 DB를 먼저 조회**하고, 없을 때만 Google/Gemini를 호출한 뒤
  결과를 저장합니다. `place_id`는 숙소별 전역 키라 **다른 팀원이 들어오거나, 같은 숙소를 다시 골라
  Step3에 가도 재호출 없이 DB에서** 바로 읽습니다.
- 캐시 테이블(`hotel_infra_cache`, `hotel_score_cache`)이 없으면 캐싱만 생략하고 정상 동작하므로,
  무료 한도를 아끼려면 1번의 SQL을 꼭 실행하세요.

## 동작 방식 / 신뢰도

- **주변 편의 인프라**: 전세계 공통 시설 타입(대중교통/편의점/카페/약국/병원/ATM/택시/슈퍼)만 사용.
  거리·도보시간은 **Routes API의 실제 도보 경로** 기준(경로가 없으면 직선거리로 폴백).
  지도 위 아이콘을 클릭하면 기본정보(이름/평점/주소)와 "숙소 → 이곳" 길찾기 버튼이 뜨는데,
  이 정보는 Nearby Search 1회 호출에 이미 포함해 함께 캐싱한 값이라 **클릭할 때 추가 API 호출은 없음**
  (길찾기 버튼도 좌표 기반 Google 지도 딥링크라 호출 없음). 단, rating/formattedAddress 필드를
  요청에 추가했으므로 Places API(New)의 SKU 등급이 기존보다 한 단계 높아질 수 있어요
  (여전히 숙소당 1회만 호출되고 캐시됨).
- **여행 효율 점수**: Gemini가 위치·평점·주변 요약 등 입력을 종합해 매기는 **AI 평가**이며
  이용자 리뷰 점수가 아닙니다(화면에도 그렇게 표기). 안전도(야간)는 신뢰 가능한 실측 소스가
  없어 채점 항목에서 제외했습니다.
