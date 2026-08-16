-- ============================================================
-- MOBILE(Companion) — 여행 중 실제 도착/출발 기록
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 여러 번 실행해도 안전합니다(idempotent).
--
-- ⚠️ 이 테이블이 없어도 앱은 정상 동작합니다 — 마이그레이션 전에는 도착/출발 버튼을 눌러도
--    "세션 메모리 전용" 모드로 조용히 떨어집니다(route_plan.sql과 같은 graceful degradation).
--
-- ── 왜 route_stops에 바로 기록하지 않는가 ──────────────────
-- route_stops는 "계획"이다. 실제 도착 시각으로 덮어써버리면 계획을 되돌릴 수 없고,
-- 무엇보다 route_stops는 ROUTE/TIMELINE에서 하루를 저장할 때마다 **그 DAY 전체를
-- 지우고 다시 넣는 방식**(routeStore.saveRouteDay)이라, 만약 진행 기록이 route_stops.id를
-- FK로 참조했다면 PC에서 그 날 아무거나 하나만 고쳐도(다른 정류지 메모 수정 등) 관련 없는
-- 정류지의 진행 기록까지 CASCADE로 통째로 날아간다. 그래서 route_stops.id를 전혀 참조하지
-- 않고, dayModel.ts가 이미 계산해 쓰는 "그 DAY 안에서 정류지를 가리키는 문자열 키"
-- (TlStop.key = "d{dayIndex}-{순번}-{placeId 또는 customName}")를 그대로 저장한다.
-- 계획(route_stops)은 불변, 실제(trip_stop_progress)만 쌓인다 — 여행 후 리포트가 공짜로 생긴다.
-- ============================================================

create table if not exists trip_stop_progress (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references trips(id) on delete cascade,
  destination_id    uuid references trip_destinations(id) on delete cascade,
  day_index         int  not null,
  stop_key          text not null,          -- dayModel.ts의 TlStop.key와 동일한 문자열
  status            text not null default 'pending', -- 'pending' | 'arrived' | 'departed' | 'skipped'
  actual_arrive_at  timestamptz,
  actual_depart_at  timestamptz,
  recorded_by       uuid references auth.users(id) on delete set null,
  recorded_by_name  text,                    -- 표시용 스냅샷(멤버 탈퇴 후에도 "누가 기록했는지" 유지)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 같은 정류지에 대한 기록은 하나만 — upsert로 갱신한다(destination_id가 있을 때만 유일함 보장,
-- route_plan.sql의 route_days_dest_day_uniq와 같은 이유로 부분 인덱스를 쓴다)
create unique index if not exists trip_stop_progress_dest_day_key_uniq
  on trip_stop_progress(destination_id, day_index, stop_key)
  where destination_id is not null;

create index if not exists trip_stop_progress_trip_id_idx on trip_stop_progress(trip_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trip_stop_progress_status_chk') then
    alter table trip_stop_progress
      add constraint trip_stop_progress_status_chk
      check (status in ('pending', 'arrived', 'departed', 'skipped'));
  end if;
end $$;

-- ── RLS ──────────────────────────────────────────────────────
alter table trip_stop_progress enable row level security;

drop policy if exists "trip_stop_progress_member_all" on trip_stop_progress;
create policy "trip_stop_progress_member_all" on trip_stop_progress
  for all
  using (exists (select 1 from trip_members m
                 where m.trip_id = trip_stop_progress.trip_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_members m
                      where m.trip_id = trip_stop_progress.trip_id and m.user_id = auth.uid()));

-- ── 실시간 동기화 ──────────────────────────────────────────
--    한 멤버가 "도착"을 누르면 같은 트립의 다른 멤버 화면에도 즉시 반영되도록 publication에 추가.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'trip_stop_progress'
    ) then
      alter publication supabase_realtime add table trip_stop_progress;
    end if;
  end if;
end $$;

-- 완료.
