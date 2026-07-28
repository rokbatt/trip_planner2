-- ============================================================
-- ROUTE 게이트 — 하루 동선 영속화 + 협업 (Phase 2)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
--
-- 이 스크립트는 "여러 번 실행해도 안전"(idempotent)합니다.
--   1) route_days  — 여행지 안의 DAY (DAY 1, DAY 2 …)
--   2) route_stops — 그 DAY의 방문 순서 (숙소 다음의 정류지들)
--   3) route_leg_cache — 실제 길찾기(Routes API) 결과 캐시 (전역 공유, 트립 무관)
--
-- 실행 전/후 모두 앱은 정상 동작합니다(코드가 graceful degradation).
--   - 실행 전: 테이블이 없으면 기존처럼 세션 메모리에만 유지(새로고침 시 초기화)
--   - 실행 후: 동선이 저장되고, 같은 트립 멤버끼리 실시간으로 동기화됨
--
-- ⚠️ 개념 정리
--   route_days  = 한 여행지(destination)의 하루. day_index 0 = DAY 1.
--   route_stops = 그 하루에 들르는 장소들의 순서.
--                 숙소(basecamp)는 stay_segments에 이미 있으므로 저장하지 않고,
--                 화면에서 항상 맨 앞(순번 1)에 자동으로 붙인다.
-- ============================================================

-- ── 1. DAY ─────────────────────────────────────────────────
create table if not exists route_days (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references trips(id) on delete cascade,
  destination_id uuid references trip_destinations(id) on delete cascade,
  day_index      int  not null,            -- 0-based (0 = DAY 1)
  created_at     timestamptz not null default now()
);
create index if not exists route_days_trip_id_idx on route_days(trip_id);
create index if not exists route_days_destination_id_idx on route_days(destination_id);

-- 같은 여행지 안에서 day_index는 유일해야 함 (동시 편집 시 중복 생성 방지)
create unique index if not exists route_days_dest_day_uniq
  on route_days(destination_id, day_index)
  where destination_id is not null;

-- ── 2. 정류지 ──────────────────────────────────────────────
--    place_id가 있으면 Brainstorm에서 모은 장소, null이면 지도에 직접 찍은 임시 지점
--    (custom_* 컬럼에 이름/좌표를 직접 보관 — places 테이블을 오염시키지 않으려는 의도).
create table if not exists route_stops (
  id           uuid primary key default gen_random_uuid(),
  route_day_id uuid not null references route_days(id) on delete cascade,
  trip_id      uuid not null references trips(id) on delete cascade,  -- RLS 편의용 비정규화
  place_id     uuid references places(id) on delete cascade,
  sort_order   int  not null default 0,
  arrive_time  text,          -- 사용자가 직접 지정한 도착 시각만 저장 ('HH:MM', 24시간)
  memo         text,
  travel_mode  text,          -- **이 정류지로 오는** 구간의 수동 이동수단
                              -- ('WALK'|'TRANSIT'|'TAXI', null이면 거리 기준 자동 추정)
                              -- 도착지 기준으로 잡아야 숙소→첫 정류지 구간도 주인이 생긴다
                              -- (숙소는 route_stops에 저장하지 않으므로).
  custom_name  text,          -- place_id가 null일 때만 사용
  custom_lat   double precision,
  custom_lng   double precision,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists route_stops_day_idx on route_stops(route_day_id);
create index if not exists route_stops_trip_id_idx on route_stops(trip_id);

-- 이동수단 값 검증 (오타/임의 값이 들어가 화면이 깨지지 않도록)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'route_stops_travel_mode_chk') then
    alter table route_stops
      add constraint route_stops_travel_mode_chk
      check (travel_mode is null or travel_mode in ('WALK','TRANSIT','TAXI'));
  end if;
end $$;

-- place_id가 없으면 좌표는 반드시 있어야 함 (지도에 그릴 수 없는 유령 정류지 방지)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'route_stops_location_chk') then
    alter table route_stops
      add constraint route_stops_location_chk
      check (place_id is not null or (custom_lat is not null and custom_lng is not null));
  end if;
end $$;

-- ── 3. RLS ─────────────────────────────────────────────────
alter table route_days  enable row level security;
alter table route_stops enable row level security;

drop policy if exists "route_days_member_all" on route_days;
create policy "route_days_member_all" on route_days
  for all
  using (exists (select 1 from trip_members m
                 where m.trip_id = route_days.trip_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_members m
                      where m.trip_id = route_days.trip_id and m.user_id = auth.uid()));

drop policy if exists "route_stops_member_all" on route_stops;
create policy "route_stops_member_all" on route_stops
  for all
  using (exists (select 1 from trip_members m
                 where m.trip_id = route_stops.trip_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_members m
                      where m.trip_id = route_stops.trip_id and m.user_id = auth.uid()));

-- ── 4. 실시간 동기화 ───────────────────────────────────────
--    같은 트립을 보고 있는 다른 멤버 화면에 변경이 즉시 반영되도록 publication에 추가.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'route_days'
    ) then
      alter publication supabase_realtime add table route_days;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'route_stops'
    ) then
      alter publication supabase_realtime add table route_stops;
    end if;
  end if;
end $$;

-- ── 5. 실제 길찾기 결과 캐시 ───────────────────────────────
--    Claude.md 3-2(API 비용 의식) — 같은 두 지점 사이의 경로는 트립이 달라도 동일하므로
--    좌표를 반올림한 키로 전역 캐싱한다. 캐시 히트면 Routes API 호출 0회.
--    (좌표 5자리 ≈ 1.1m 해상도. 같은 건물 안 미세 차이는 같은 키로 묶여 캐시 적중률이 올라감)
create table if not exists route_leg_cache (
  cache_key   text primary key,   -- '{olat},{olng}>{dlat},{dlng}|{mode}' (좌표 5자리 반올림)
  mode        text not null,      -- 'WALK' | 'TRANSIT' | 'DRIVE'
  meters      int  not null,
  seconds     int  not null,
  fare_units  numeric,            -- 대중교통 요금(있을 때만) — Routes API가 주는 경우만
  fare_currency text,
  created_at  timestamptz not null default now()
);
create index if not exists route_leg_cache_created_idx on route_leg_cache(created_at);

-- 캐시는 서버(service_role)만 읽고 쓰므로 RLS를 켜고 정책은 두지 않는다
-- (service_role 키는 RLS를 우회하므로 서버리스 함수는 정상 동작, 브라우저는 접근 불가).
alter table route_leg_cache enable row level security;

-- 완료.
