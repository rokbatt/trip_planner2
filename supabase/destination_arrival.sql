-- ============================================================
-- 여행지 도착/출발 정보 (공항 + 좌표 + 시각) — DAY 1은 공항에서 시작, 마지막 DAY는 공항에서 끝남
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 여러 번 실행해도 안전(idempotent)합니다.
--
-- 왜 필요한가
--   ROUTE의 하루는 지금까지 "숙소에서 09:00 출발 → 숙소로 안 돌아옴"으로만 짜여 있었음.
--   실제로는 DAY 1은 비행기가 도착한 뒤 공항에서 시작하고, 마지막 DAY는 공항에서
--   출국하며 끝남 — 둘 다 지도 위의 진짜 "정류지"로 다뤄야 이동시간·비용이 실측/추정
--   구간으로 자연스럽게 이어진다(원칙 3-1 — 추정 구간은 추정이라고 표시하되, 좌표
--   자체는 사용자가 자동완성에서 실제로 고른 공항의 실제 좌표를 쓴다. 지어내지 않음).
--
--   좌표(lat/lng)는 사용자가 자동완성 드롭다운에서 실제 공항을 선택했을 때만 채워진다.
--   이름만 직접 타이핑하고 목록에서 고르지 않으면 좌표 없이 이름만 저장되고, 그 경우엔
--   지도 위의 실제 정류지로는 취급하지 않는다(좌표 없이 지어낼 수 없으므로).
-- ============================================================

alter table if exists trip_destinations add column if not exists arrival_airport text;
alter table if exists trip_destinations add column if not exists arrival_time text; -- 'HH:MM', 24시간
alter table if exists trip_destinations add column if not exists arrival_lat double precision;
alter table if exists trip_destinations add column if not exists arrival_lng double precision;

alter table if exists trip_destinations add column if not exists departure_airport text;
alter table if exists trip_destinations add column if not exists departure_time text; -- 'HH:MM', 24시간
alter table if exists trip_destinations add column if not exists departure_lat double precision;
alter table if exists trip_destinations add column if not exists departure_lng double precision;

-- 완료.
