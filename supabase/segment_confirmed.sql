-- Step3에서 "이 숙소를 여행 중심으로 확정하기" 버튼을 실제로 눌렀는지 저장하는 컬럼 추가
-- Supabase SQL Editor에서 한 번 실행하면 됩니다.
--
-- 기존엔 basecamp_place_id(Step2에서 숙소 후보를 고르기만 해도 저장됨)만으로 "확정 여부"를
-- 판단해서, Step2에서 후보만 고르고 Step3로 넘어가기만 해도 화면에 "확정됨"으로 보이는
-- 문제가 있었음. 실제로 확정 버튼을 누른 시각을 별도 컬럼에 저장해, 이 값이 있을 때만
-- "확정됨"으로 표시하도록 함.
--
--  - 실제 여행지(멀티 데스티네이션, multi_destination.sql 적용됨) → stay_segments.basecamp_confirmed_at
--  - 합성 여행지(단일 여행지, 아직 멀티 데스티네이션 마이그레이션 전) → trips.shortlist_basecamp_confirmed_at

alter table if exists trips
  add column if not exists shortlist_basecamp_confirmed_at timestamptz;

-- multi_destination.sql을 아직 실행하지 않아 stay_segments 테이블이 없어도 에러 없이 건너뜀
alter table if exists stay_segments
  add column if not exists basecamp_confirmed_at timestamptz;

-- 일부러 백필하지 않음: basecamp_place_id가 있다고 해서 실제로 확정 버튼을 눌렀는지는
-- (이 버그 자체가 그 둘을 구분 못 해서 생긴 문제라) 알 수 없음. 기존 구간은 모두 null로
-- 시작하고, Step3에서 확정 버튼을 한 번 더 누르면 "확정됨"으로 표시됨(데이터 손실 없음 —
-- 실제 숙소 선택은 basecamp_place_id에 그대로 남아있어 route/일정에는 영향 없음).
