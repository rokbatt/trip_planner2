-- ============================================================
-- STAY Step2 — 숙소 후보 비교(Candidate Pool) 2단계
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
-- (hotel_compare.sql을 먼저 실행하지 않았어도 이 파일만으로 필요한 컬럼이 전부 생깁니다.)
--
-- 숙소는 "제일 좋은 곳을 찾는" 것보다 "이건 아니다 싶은 후보를 하나씩 지워나가는" 방식으로
-- 정하게 된다. 그 과정을 화면 안에서 그대로 할 수 있도록 후보마다 비교에 필요한 값을
-- 직접 적어두고, 탈락시킨 후보는 사유와 함께 남겨둔다(삭제가 아니라 복구 가능한 제외).
--
-- price_note       자유 텍스트 메모(구버전 · 그대로 유지). 아래 구조화된 가격과 별개로 남겨둠
-- price_per_night  1박 가격(숫자). 총 숙박비는 숙박일수를 곱해 화면에서 계산
-- price_currency   가격 통화. 서로 다른 통화끼리는 "가장 저렴" 강조를 하지 않는다(원칙 3-1)
-- room_condition   사용자가 직접 매긴 객실 컨디션 1~5 (구글 평점과 별개 — 본인 기준)
-- is_excluded      소거법으로 탈락시킨 후보
-- excluded_reason  탈락 사유(선택 목록 또는 직접 입력) — 나중에 왜 뺐는지 다시 볼 수 있게
-- ============================================================

alter table if exists places add column if not exists price_note text;
alter table if exists places add column if not exists is_excluded boolean not null default false;
alter table if exists places add column if not exists price_per_night numeric;
alter table if exists places add column if not exists price_currency text;
alter table if exists places add column if not exists room_condition smallint;
alter table if exists places add column if not exists excluded_reason text;
