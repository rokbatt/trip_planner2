-- ============================================================
-- 체크리스트 항목을 "장소"에 연결 — TIMELINE 장소 상세 패널의 "이 장소 준비" 목록용
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 여러 번 실행해도 안전(idempotent)합니다. trip_checklist.sql을 먼저 실행해야 합니다.
--
-- 왜 새 테이블이 아니라 컬럼인가
--   장소별 준비물을 따로 두면 "어디에 적었더라"가 생겨 오히려 빠뜨리기 쉬워진다
--   (trip_checklist.sql 상단의 "트립 공유 목록" 이유와 같음). 그래서 목록은 하나로 두고,
--   TIMELINE에서 넣은 항목에만 어느 장소 것인지 표시를 붙인다. MOBILE 체크리스트에서도
--   같은 항목이 장소 이름과 함께 보인다.
--
-- ⚠️ 이 마이그레이션 전에도 앱은 동작한다 — 컬럼이 없으면 장소 이름을 제목 앞에 붙여
--    ("왓 아룬 · 복장 규정 확인") 저장하고, 화면은 그 접두어로 장소 항목을 알아본다.
-- ============================================================

alter table if exists trip_checklist add column if not exists place_key  text;
alter table if exists trip_checklist add column if not exists place_name text;

-- 완료.
