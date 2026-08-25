-- ============================================================
-- 숙소 카드 ↔ 저장된 링크 연동
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
--
-- 숙소 카드마다 예약 사이트를 추측해서 검색 링크를 만들어주는 대신, 이미 채팅/LINKS 탭에
-- 저장해둔 실제 숙소 링크(trip_links) 중 하나를 사용자가 직접 골라 카드에 연결해두고,
-- 이후에는 그 카드를 클릭하면 바로 그 링크로 이동하게 한다.
--
-- linked_url        연동된 링크의 실제 URL. 없으면 아직 연동 안 한 상태
-- linked_url_title  목록/버튼에 보여줄 짧은 이름(링크의 title 또는 site_name을 그대로 복사)
-- ============================================================

alter table if exists places add column if not exists linked_url text;
alter table if exists places add column if not exists linked_url_title text;
