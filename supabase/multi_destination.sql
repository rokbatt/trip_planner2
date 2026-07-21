-- ============================================================
-- 다중 여행지 · 다중 숙소 구간 (Phase 1: 데이터 토대)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
--
-- 이 스크립트는 "여러 번 실행해도 안전"(idempotent)하도록 작성했습니다.
--   1) 새 테이블 2개(trip_destinations, stay_segments) 생성
--   2) places 에 destination_id 컬럼 추가
--   3) 기존 여행들을 "여행지 1개 + 숙소 구간 1개"로 자동 마이그레이션
--
-- 실행 전/후 모두 앱은 정상 동작합니다(코드가 graceful degradation).
--   - 실행 전: 새 테이블이 없으면 코드가 trips.destinations[0] / shortlist_* 컬럼으로 폴백
--   - 실행 후: 새 모델을 사용하되, 여행지·숙소가 1개면 화면은 기존과 동일
--
-- ⚠️ 개념 정리
--   trip_destinations = 한 여행의 여행지(도시). 여행지 2곳이면 2행.
--   stay_segments     = 한 여행지 안의 "숙소 구간"(1개 이상).
--                       기존 shortlist_*(zone→hotel→confirm) 상태가 정확히 이 1행에 해당.
-- ============================================================

-- ── 1. 여행지(leg) ──────────────────────────────────────────
create table if not exists trip_destinations (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips(id) on delete cascade,
  name       text not null,
  lat        double precision,
  lng        double precision,
  start_date date,               -- 이 여행지에 머무는 기간(선택 — 강제 아님)
  end_date   date,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists trip_destinations_trip_id_idx on trip_destinations(trip_id);

-- ── 2. 숙소 구간(stay segment) ─────────────────────────────
--    한 여행지 안에서 숙소를 나눠 갈 때 각 구간 = 독립적인 zone→hotel→confirm 상태.
--    숙소를 안 나누는 여행지는 이 테이블에 1행만 갖는다.
create table if not exists stay_segments (
  id                  uuid primary key default gen_random_uuid(),
  trip_id             uuid not null references trips(id) on delete cascade,
  destination_id      uuid references trip_destinations(id) on delete cascade,
  sort_order          int  not null default 0,
  start_date          date,          -- 이 숙소가 커버하는 날짜(선택)
  end_date            date,
  zone_name           text,          -- Step1 결과(선택 지역)
  zone_place_ids      uuid[],        -- Step1 결과(그 지역에 배정된 장소들)
  basecamp_place_id   uuid,          -- Step2 결과(중심 숙소)
  confirmed_place_ids uuid[],        -- Step3 결과(확정 장소들)
  created_at          timestamptz not null default now()
);
create index if not exists stay_segments_trip_id_idx on stay_segments(trip_id);
create index if not exists stay_segments_destination_id_idx on stay_segments(destination_id);

-- ── 3. places → 여행지 연결 ────────────────────────────────
--    ON DELETE SET NULL: 여행지를 지워도 장소는 남고 미분류(inbox 성격)로 돌아감.
alter table places add column if not exists destination_id uuid
  references trip_destinations(id) on delete set null;
create index if not exists places_destination_id_idx on places(destination_id);

-- ── 4. RLS ─────────────────────────────────────────────────
--    브라우저(멤버 인증)에서 직접 읽고 쓰므로 trip_members 기반 멤버 정책을 건다.
--    (기존 places/trips 와 동일한 "이 여행의 멤버면 접근 가능" 모델)
alter table trip_destinations enable row level security;
alter table stay_segments     enable row level security;

drop policy if exists "trip_destinations_member_all" on trip_destinations;
create policy "trip_destinations_member_all" on trip_destinations
  for all
  using (exists (select 1 from trip_members m
                 where m.trip_id = trip_destinations.trip_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_members m
                      where m.trip_id = trip_destinations.trip_id and m.user_id = auth.uid()));

drop policy if exists "stay_segments_member_all" on stay_segments;
create policy "stay_segments_member_all" on stay_segments
  for all
  using (exists (select 1 from trip_members m
                 where m.trip_id = stay_segments.trip_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_members m
                      where m.trip_id = stay_segments.trip_id and m.user_id = auth.uid()));

-- ── 5. 기존 데이터 마이그레이션 (idempotent) ───────────────
-- 5a. 여행마다 여행지 1개 생성 (아직 없을 때만)
insert into trip_destinations (trip_id, name, lat, lng, start_date, end_date, sort_order)
select t.id,
       coalesce(nullif(t.destinations[1], ''), nullif(t.name, ''), '여행지'),
       t.dest_lat, t.dest_lng,
       t.start_date, t.end_date,
       0
from trips t
where not exists (select 1 from trip_destinations d where d.trip_id = t.id);

-- 5b. 기존 장소를 그 여행의 (첫) 여행지에 배정 (아직 미배정인 것만)
update places p
set destination_id = d.id
from trip_destinations d
where d.trip_id = p.trip_id
  and d.sort_order = 0
  and p.destination_id is null;

-- 5c. 기존 shortlist_* 상태를 숙소 구간 1개로 이관 (여행마다 아직 구간이 없을 때만)
insert into stay_segments (trip_id, destination_id, sort_order, start_date, end_date,
                           zone_name, zone_place_ids, basecamp_place_id, confirmed_place_ids)
select t.id, d.id, 0, t.start_date, t.end_date,
       t.shortlist_zone_name,
       t.shortlist_zone_place_ids::uuid[],
       t.shortlist_basecamp_place_id::uuid,
       t.shortlist_confirmed_place_ids::uuid[]
from trips t
join trip_destinations d on d.trip_id = t.id and d.sort_order = 0
where not exists (select 1 from stay_segments s where s.trip_id = t.id);

-- 완료. 기존 trips.shortlist_* / destinations 컬럼은 폴백/전환용으로 당분간 그대로 둡니다.
