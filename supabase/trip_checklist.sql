-- ============================================================
-- MOBILE(Companion) — 여행 준비 체크리스트
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 여러 번 실행해도 안전합니다(idempotent).
--
-- ⚠️ 이 테이블이 없어도 앱은 정상 동작합니다 — 마이그레이션 전에는 MORE 탭의 체크리스트
--    자리에 "준비 중" 안내만 뜨고 나머지 섹션(숙소·예약 링크·멤버)은 그대로 보입니다
--    (route_plan.sql / trip_stop_progress.sql과 같은 graceful degradation).
--
-- ── 왜 "개인 목록"이 아니라 "트립 공유 목록"인가 ────────────
-- 몽실이는 혼자 쓰는 여행 메모가 아니라 여럿이 같은 여행을 준비하는 도구다. 실제로 빠뜨려서
-- 문제가 되는 건 "내 칫솔"이 아니라 "유심 아무도 안 샀네" 쪽이고, 그건 목록이 공유될 때만
-- 막힌다. 그래서 항목은 트립 단위로 공유하고, 누가 체크했는지만 남긴다(checked_by_name).
-- 개인 전용 항목이 필요하면 나중에 assigned_to로 확장하면 되지만, v1에서 목록을 둘로
-- 쪼개면 "어느 쪽에 적었더라"가 생겨 오히려 빠뜨리기 쉬워진다.
--
-- 체크 상태를 boolean이 아니라 checked_at(timestamptz)으로 두는 이유: "체크됨"은
-- checked_at is not null로 그대로 읽히면서, 언제 체크했는지가 공짜로 남는다.
-- ============================================================

create table if not exists trip_checklist (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references trips(id) on delete cascade,
  title            text not null,
  checked_at       timestamptz,             -- null이면 미완료
  checked_by       uuid references auth.users(id) on delete set null,
  checked_by_name  text,                    -- 표시용 스냅샷(멤버 탈퇴 후에도 "누가 했는지" 유지)
  sort_order       int  not null default 0,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists trip_checklist_trip_id_idx on trip_checklist(trip_id);

-- ── RLS ──────────────────────────────────────────────────────
alter table trip_checklist enable row level security;

drop policy if exists "trip_checklist_member_all" on trip_checklist;
create policy "trip_checklist_member_all" on trip_checklist
  for all
  using (exists (select 1 from trip_members m
                 where m.trip_id = trip_checklist.trip_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_members m
                      where m.trip_id = trip_checklist.trip_id and m.user_id = auth.uid()));

-- ── 실시간 동기화 ──────────────────────────────────────────
--    한 명이 "유심 구매"를 체크하면 다른 멤버 화면에서도 즉시 지워지도록 publication에 추가.
--    체크리스트는 여럿이 동시에 만지는 목록이라 이게 없으면 중복 준비가 그대로 발생한다.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'trip_checklist'
    ) then
      alter publication supabase_realtime add table trip_checklist;
    end if;
  end if;
end $$;

-- 완료.
