-- ============================================================
-- "AI 리뷰 요약" 캐시 테이블 (Gemini + Google Search 그라운딩)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
--
-- ⚠️ 이 테이블이 없어도 API는 동작합니다(매번 Gemini 호출).
--    테이블을 만들면 같은 숙소를 다시 조회할 때 재호출을 건너뛰어 비용을 아낍니다.
--    Google Search 그라운딩은 유료 기능(무료 한도 초과 시 1,000회당 $35)이라
--    캐싱이 특히 중요합니다.
--
-- 키가 place_id 하나뿐이라 hotel_infra_cache/hotel_score_cache와 동일하게
-- "실제 존재하는 숙소 수"만큼만 늘어나는 유한한 캐시입니다 — hotel_search_cache와
-- 달리 자유 입력이 키에 섞이지 않으므로 TTL 정리(Claude.md 3-5)는 필요 없습니다.
--
-- 접근은 서버리스 함수(service_role 키)로만 이뤄지므로 RLS를 켜고 정책은 두지 않습니다
-- (service_role은 RLS를 우회함 → 브라우저에서는 접근 불가, 안전).
-- ============================================================

create table if not exists hotel_review_summary_cache (
  place_id   text primary key,
  result     jsonb not null,
  updated_at timestamptz not null default now()
);
alter table hotel_review_summary_cache enable row level security;
