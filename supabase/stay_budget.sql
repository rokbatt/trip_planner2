-- Step3 "여행 중심 요약" 총 숙박 예산 입력 기능에 필요한 컬럼 추가
-- Supabase SQL Editor에서 한 번 실행하면 됩니다.
--
-- 총 숙박 예산(전체 인원 · 전체 숙박일 기준, 원)을 저장합니다.
-- 화면에는 이 값을 (숙박일 수 × 인원수)로 나눈 "1박 1인" 금액으로 표시합니다.
--
--  - 실제 여행지(멀티 데스티네이션, multi_destination.sql 적용됨) → stay_segments.total_budget_krw
--  - 합성 여행지(단일 여행지, 아직 멀티 데스티네이션 마이그레이션 전) → trips.shortlist_total_budget_krw

alter table if exists trips
  add column if not exists shortlist_total_budget_krw bigint;

-- multi_destination.sql을 아직 실행하지 않아 stay_segments 테이블이 없어도 에러 없이 건너뜀
alter table if exists stay_segments
  add column if not exists total_budget_krw bigint;
