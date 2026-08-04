-- ============================================================
-- AI 일정 추천 캐시 (Gemini)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 여러 번 실행해도 안전(idempotent)합니다.
--
-- 무엇을 캐싱하나
--   kind='route-plan-macro' : Day별 테마+장소 풀 1차 배분 (AI 일정 짜기 버튼, 1단계)
--   kind='route-plan-day'   : 그 Day의 세부 방문 순서/시각 (AI 일정 짜기 버튼, Day마다 2단계)
--   kind='day-detail'       : 특정 DAY의 세부 일정/예산 추천 (DAY 상세 계획 버튼)
--
-- 왜 캐싱하나 (Claude.md 3-2 — API 비용 의식)
--   Gemini 호출은 유료라 같은 입력으로 반복 호출하면 낭비. 캐시 키에 "입력이 바뀌면
--   달라지는 값"을 전부 녹여서, Brainstorm 장소 목록이나 숙소·요청사항이 그대로면 몇 번을
--   눌러도 Gemini 호출은 0회가 되게 한다.
--     route-plan-macro 키 = 여행지 + DAY 수 + 숙소 + 요청사항 + 장소 id 목록(정렬) 의 해시
--     route-plan-day 키   = 여행지 + DAY 번호 + 그 Day에 배정된 장소 id 목록 + 요청사항 의 해시
--     day-detail 키       = 여행지 + DAY 번호 + 그 DAY 정류지 순서 의 해시
--   → 장소를 담거나 빼거나 숙소·요청사항을 바꾸면 키가 자동으로 달라져 새로 생성됨.
--
-- ⚠️ 캐시 키에 "장소 조합"이 들어가므로 이론상 무한히 늘어날 수 있음(Claude.md 3-5).
--    그래서 api/cleanup-search-cache.ts의 CLEANUP_TARGETS에 등록해 오래된 행을 주기적으로
--    지운다. 오래된 추천이 자연스럽게 갱신되는 효과도 같이 얻는다.
-- ============================================================

create table if not exists ai_plan_cache (
  cache_key  text primary key,   -- '{kind}:{destinationId}:{해시}' — 서버에서만 생성
  kind       text not null,      -- 'route-plan-macro' | 'route-plan-day' | 'day-detail'
  result     jsonb not null,     -- 화면이 그대로 쓰는 추천 결과
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 정리(cleanup) 크론이 오래된 행을 찾을 때 쓰는 인덱스
create index if not exists ai_plan_cache_updated_idx on ai_plan_cache(updated_at);

-- 캐시는 서버(service_role)만 읽고 쓰므로 RLS를 켜고 정책은 두지 않는다
-- (service_role 키는 RLS를 우회하므로 서버리스 함수는 정상 동작, 브라우저는 접근 불가).
alter table ai_plan_cache enable row level security;

-- 완료.
