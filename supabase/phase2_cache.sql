-- ============================================================
-- Phase 2 캐시 테이블 (Step3 주변 편의 인프라 · 여행 효율 점수)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
--
-- ⚠️ 이 테이블이 없어도 API는 동작합니다(매번 Google/Gemini 호출).
--    테이블을 만들면 같은 숙소를 다시 볼 때 재호출을 건너뛰어 비용/속도가 개선됩니다.
--    (CLAUDE.md 3-2 "DB-first 캐싱 원칙")
--
-- 접근은 서버리스 함수(service_role 키)로만 이뤄지므로 RLS를 켜고 정책은 두지 않습니다
-- (service_role은 RLS를 우회함 → 브라우저에서는 접근 불가, 안전).
-- ============================================================

create table if not exists hotel_infra_cache (
  place_id   text primary key,
  facilities jsonb not null,
  updated_at timestamptz not null default now()
);
alter table hotel_infra_cache enable row level security;

create table if not exists hotel_score_cache (
  place_id   text primary key,
  result     jsonb not null,
  updated_at timestamptz not null default now()
);
alter table hotel_score_cache enable row level security;
