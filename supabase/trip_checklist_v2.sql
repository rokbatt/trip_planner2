-- ============================================================
-- PC CHECKLIST 게이트 — 체크리스트 항목에 분류·중요도·담당자·마감일·메모·연결 문서를 붙인다
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 여러 번 실행해도 안전(idempotent)합니다. trip_checklist.sql을 먼저 실행해야 합니다.
--
-- 왜 새 테이블이 아니라 컬럼인가
--   MOBILE(MORE 탭)·TIMELINE(장소 상세)·PC CHECKLIST가 **같은 목록 하나**를 본다.
--   PC에서 담당자를 정하거나 체크하면 모바일에도 그대로 보여야 하고, 반대도 마찬가지다.
--   목록을 화면별로 나누면 "어디에 적었더라"가 다시 생긴다(trip_checklist.sql 상단 이유와 같음).
--
-- 모든 컬럼은 null 허용이다 — 모바일에서 제목만 적어 넣은 기존 항목도 그대로 유효하고,
-- 화면은 비어 있는 값을 "분류는 제목으로 추정 / 중요도는 일반 / 담당자 미지정"으로 읽는다.
--
-- ⚠️ 이 마이그레이션 전에도 앱은 동작한다 — PC 화면은 추가 정보 입력칸만 숨기고, 체크·추가·
--    삭제·순서 바꾸기(이미 있는 sort_order)는 그대로 된다.
-- ============================================================

-- 분류: ESSENTIAL(필수품) | GEAR(여행 용품) | HEALTH(건강·안전) | BOOKING(예약·일정) | TIP(여행 팁)
alter table if exists trip_checklist add column if not exists category text;

-- 중요도: REQUIRED(필수) | RECOMMENDED(추천) | NORMAL(일반)
alter table if exists trip_checklist add column if not exists priority text;

-- 담당자: 특정 멤버(trip_members.id) 또는 "공동"(assignee_all) 또는 미지정(둘 다 비어 있음)
alter table if exists trip_checklist add column if not exists assignee_member_id uuid references trip_members(id) on delete set null;
alter table if exists trip_checklist add column if not exists assignee_all boolean not null default false;

alter table if exists trip_checklist add column if not exists due_date date;
alter table if exists trip_checklist add column if not exists memo text;

-- 연결 문서(trip_documents.id) — 공용(SHARED) 문서만 연결한다(체크리스트는 멤버 모두가 보는 목록이라
-- 개인 문서 제목이 다른 사람에게 보이면 안 된다). FK를 걸지 않는 이유: trip_documents.sql을 아직
-- 안 돌린 프로젝트에서도 이 파일이 실패하지 않게. 문서가 지워지면 화면은 그 링크를 그냥 안 그린다.
alter table if exists trip_checklist add column if not exists linked_doc_id uuid;

-- 스마트 추천에서 넣은 항목이면 그 추천의 키 — 제목을 고쳐도 같은 추천이 다시 뜨지 않게
alter table if exists trip_checklist add column if not exists suggestion_key text;

-- 완료.
