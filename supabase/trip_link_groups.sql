-- ============================================================
-- LINKS 그룹 모으기 — 링크를 여행지별/자유 주제별로 묶어서 나중에 다시 보거나 공유
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
--
-- trip_links.category(숙소/관광지/음식...)는 자동분류·아이콘용으로 그대로 두고,
-- 이건 완전히 별개의 사용자 정의 정리축이다 — 이름은 자유 입력, 여행지 연결은
-- 선택사항(trip_destinations 중 하나를 고르거나 안 골라도 됨). 링크 하나가 여러
-- 그룹에 동시에 속할 수 있어(예: "방콕" 그룹 + "맛집" 그룹 둘 다) 다대다 중간
-- 테이블(trip_link_group_links)로 관계를 관리한다.
-- ============================================================

create table if not exists trip_link_groups (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references trips(id) on delete cascade,
  name           text not null,
  destination_id uuid references trip_destinations(id) on delete set null,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists trip_link_groups_trip_id_idx on trip_link_groups(trip_id);

create table if not exists trip_link_group_links (
  group_id   uuid not null references trip_link_groups(id) on delete cascade,
  link_id    uuid not null references trip_links(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, link_id)
);
create index if not exists trip_link_group_links_link_id_idx on trip_link_group_links(link_id);

-- ── RLS ──────────────────────────────────────────────────────
alter table trip_link_groups enable row level security;
alter table trip_link_group_links enable row level security;

drop policy if exists "trip_link_groups_member_all" on trip_link_groups;
create policy "trip_link_groups_member_all" on trip_link_groups
  for all
  using (exists (select 1 from trip_members m
                 where m.trip_id = trip_link_groups.trip_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_members m
                      where m.trip_id = trip_link_groups.trip_id and m.user_id = auth.uid()));

-- trip_link_group_links엔 trip_id가 없어 join으로 확인 — group_id가 속한 그룹의 trip에
-- 이 유저가 멤버인지로 판단한다(그 그룹의 RLS를 통과했다는 건 이미 멤버라는 뜻과 같음).
drop policy if exists "trip_link_group_links_member_all" on trip_link_group_links;
create policy "trip_link_group_links_member_all" on trip_link_group_links
  for all
  using (exists (select 1 from trip_link_groups g
                 join trip_members m on m.trip_id = g.trip_id
                 where g.id = trip_link_group_links.group_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_link_groups g
                      join trip_members m on m.trip_id = g.trip_id
                      where g.id = trip_link_group_links.group_id and m.user_id = auth.uid()));

-- ── 실시간 동기화 ──────────────────────────────────────────
--    같은 트립을 보고 있는 다른 멤버의 LINKS 탭에도 그룹 생성/삭제·링크 담기가
--    즉시 반영되도록 publication에 추가.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'trip_link_groups'
    ) then
      alter publication supabase_realtime add table trip_link_groups;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'trip_link_group_links'
    ) then
      alter publication supabase_realtime add table trip_link_group_links;
    end if;
  end if;
end $$;
