-- ============================================================
-- Step3 "숙소 근처 검색" 캐시 테이블 (마사지·PC방처럼 자유 검색어 기반)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
--
-- ⚠️ 이 테이블이 없어도 API는 동작합니다(매번 Google 호출).
--    테이블을 만들면 같은 숙소에서 같은 검색어로 다시 검색할 때 재호출을 건너뛰어
--    비용/속도가 개선됩니다(hotel_infra_cache와 동일한 DB-first 캐싱 원칙).
--    place_id 기준 전역 캐시라 다른 팀원/다른 트립이 같은 숙소에서 같은 검색을 해도 공유됩니다.
--
-- ⚠️ 캐시 키에 자유 검색어가 섞여 있어(place_id, query) 조합이 무한정 늘어날 수 있습니다
--    (Claude.md 3-5 참고). api/cleanup-search-cache.ts가 Vercel Cron으로 매일 오래된
--    행(90일 이상, updated_at 기준)을 지워 용량을 억제합니다 — 그 정리 쿼리가 빠르게
--    돌도록 updated_at에 인덱스를 걸어둡니다.
--
-- 접근은 서버리스 함수(service_role 키)로만 이뤄지므로 RLS를 켜고 정책은 두지 않습니다
-- (service_role은 RLS를 우회함 → 브라우저에서는 접근 불가, 안전).
-- ============================================================

create table if not exists hotel_search_cache (
  place_id   text not null,
  query      text not null,
  results    jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (place_id, query)
);
alter table hotel_search_cache enable row level security;

create index if not exists hotel_search_cache_updated_at_idx on hotel_search_cache (updated_at);
