# 다중 여행지 · 다중 숙소 구간 — 설정 (Phase 1: 데이터 토대)

여행지를 2곳 이상 두거나, 한 여행지 안에서 숙소를 나눠 가는 기능의 **토대(스키마)**입니다.
Phase 1은 화면 변화가 없습니다 — 여행지·숙소가 1개인 기존 여행은 지금과 똑같이 보입니다.
(여행지 선택 UI는 Phase 2, 숙소 나누기 UI는 Phase 3에서 올라갑니다.)

## 1. 마이그레이션 실행 (한 번)

Supabase 대시보드 → SQL Editor 에서 [`multi_destination.sql`](./multi_destination.sql) 실행.

이 스크립트는 **여러 번 실행해도 안전**(idempotent)합니다:

1. 새 테이블 `trip_destinations`(여행지), `stay_segments`(숙소 구간) 생성
2. `places` 에 `destination_id` 컬럼 추가
3. 기존 여행을 자동으로 **여행지 1개 + 숙소 구간 1개**로 이관
   - `trips.destinations[0]` / `dest_lat/lng` → 여행지 1행
   - 모든 기존 장소 → 그 여행지에 배정
   - 기존 `shortlist_*`(지역/숙소/확정) 상태 → 숙소 구간 1행

## 2. 실행 안 해도 됨? (Graceful degradation)

**네, 앱은 실행 전에도 정상 동작합니다.** 코드(`src/trips/destinations.ts`)가
새 테이블이 없으면 기존 `trips.destinations[0]` / `shortlist_*` 컬럼으로 자동 폴백합니다.

- 실행 **전**: 기존 컬럼 사용 (지금과 동일)
- 실행 **후**: 새 모델 사용 — 단, 여행지·숙소가 1개면 화면은 동일

다중 여행지/숙소 UI(Phase 2·3)를 쓰려면 이 마이그레이션이 필요합니다.

## 3. 개념

| 테이블 | 의미 |
|---|---|
| `trip_destinations` | 한 여행의 **여행지(도시)**. 방콕+치앙마이면 2행. 각 행에 날짜범위(선택). |
| `stay_segments` | 한 여행지 안의 **숙소 구간**. 숙소를 안 나누면 1행. 각 행 = 독립적인 지역→숙소→확정 상태. |
| `places.destination_id` | 그 장소가 **어느 여행지**의 브레인스토밍인지. |

> 핵심: 지금의 shortlist 상태(지역→숙소→확정)가 정확히 `stay_segments` 1행에 해당합니다.
> 즉 현재 앱은 "여행지 1개 · 숙소 구간 1개"인 특수 케이스이고, 이 스키마는 그걸 일반화합니다.

## 4. RLS

두 테이블 모두 RLS를 켜고 **`trip_members` 기반 멤버 정책**(이 여행의 멤버면 접근 가능)을 겁니다.
기존 `trips`/`places`와 동일한 멤버십 모델을 가정합니다. 만약 프로젝트가 다른 멤버십 판정
방식을 쓴다면 `multi_destination.sql` 4번 섹션의 정책만 그에 맞게 바꾸세요.
