-- ============================================================
-- Brainstorm 게이트 — 장소 그룹핑(Group) 기능
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
--
-- 같은 게이트(mood) 안에서 여러 장소를 하나의 그룹으로 묶어 카드에 테두리를 둘러
-- "이 장소들끼리 한 세트"임을 표시하는 기능. 별도 테이블 없이 places 테이블에
-- 컬럼만 추가한다 — 그룹은 "장소 여러 개가 공유하는 값"일 뿐이고(이름·생성순서 포함),
-- places가 이미 realtime publication에 있으므로 조인 없이 카드 렌더링에 필요한 정보가
-- 그대로 실시간으로 온다.
--
-- group_id    같은 그룹 멤버끼리 공유하는 임의 문자열 id (클라이언트에서 생성)
-- group_name  선택적 그룹 이름(예: "2일차 숙소"). 멤버 전원에게 동일하게 저장(비정규화)
-- group_order 그룹 생성 시각(epoch ms). 게이트 안에서 그룹들을 이 값 오름차순으로
--             맨 위에 두고(먼저 만든 그룹이 위), 그 아래에 그룹 없는 장소를 둔다
-- ============================================================

alter table if exists places add column if not exists group_id text;
alter table if exists places add column if not exists group_name text;
alter table if exists places add column if not exists group_order bigint;

create index if not exists places_group_id_idx on places(group_id) where group_id is not null;
