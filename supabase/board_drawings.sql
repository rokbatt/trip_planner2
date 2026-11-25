-- ============================================================
-- IDEAS 보드 지도 위 펜 그림 (board_drawings)
--
-- PC의 IDEAS 지도에서 펜으로 그은 선 하나가 한 줄이다. 선은 화면 좌표가 아니라 지도 좌표(위도·경도 배열)로
-- 저장해서 확대·축소해도 같은 자리에 붙어 있다. 같은 여행 멤버끼리 실시간으로 공유된다.
-- 이 SQL을 안 돌려도 앱은 동작한다 - 펜으로 그린 선이 그 화면에서만 보이고 저장·공유는 되지 않는다.
--
-- 한 줄에 한 구문으로 썼다. 대시보드 SQL 편집기가 여러 줄 구문을 중간에서 자른 적이 있어서다.
-- 그래서 주석에는 세미콜론도 달러 기호도 넣지 않는다. 통째로 붙여넣고 Run 하면 된다. 여러 번 돌려도 안전하다.
--
-- 정책 설계: 같은 여행 멤버는 모두 읽을 수 있다. 넣기는 본인 이름으로만, 지우기는 본인 선만 가능하다(고치기는 없음).
-- 여행이나 계정이 지워지면 on delete cascade 로 함께 지워진다.
-- path 는 [[위도, 경도], ...] 배열이고 앱이 점을 줄여서 보낸다(2점 이상 500점 이하).
-- color 는 그린 사람에게 자동 배정된 색의 스냅샷이다(멤버가 나간 뒤에도 선 색을 유지하려고).
-- ============================================================

create table if not exists board_drawings ( id uuid primary key default gen_random_uuid(), trip_id uuid not null references trips(id) on delete cascade, destination_id uuid references trip_destinations(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'), path jsonb not null check (jsonb_typeof(path) = 'array' and jsonb_array_length(path) between 2 and 500), distance_m integer, created_at timestamptz not null default now() );
create index if not exists board_drawings_trip_idx on board_drawings (trip_id, destination_id);
alter table board_drawings enable row level security;
drop policy if exists "board_drawings_member_select" on board_drawings;
create policy "board_drawings_member_select" on board_drawings for select to authenticated using (exists (select 1 from trip_members m where m.trip_id = board_drawings.trip_id and m.user_id = auth.uid()));
drop policy if exists "board_drawings_member_insert" on board_drawings;
create policy "board_drawings_member_insert" on board_drawings for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from trip_members m where m.trip_id = board_drawings.trip_id and m.user_id = auth.uid()));
drop policy if exists "board_drawings_own_delete" on board_drawings;
create policy "board_drawings_own_delete" on board_drawings for delete to authenticated using (user_id = auth.uid());
do $$ begin if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'board_drawings') then alter publication supabase_realtime add table board_drawings; end if; end $$;
alter table board_drawings replica identity full;
