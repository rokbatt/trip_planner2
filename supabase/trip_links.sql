-- ============================================================
-- LINKS 게이트 — 채팅에 공유된 링크를 자동으로 모아두는 탭
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
--
-- 채팅 메시지에 링크(http/https)가 있으면, "보낸 사람"의 화면에서 그 메시지를
-- 딱 한 번만 이 테이블에 저장한다(여러 멤버가 동시에 채팅을 보고 있어도, 저장은
-- 받는 쪽이 아니라 보내는 쪽에서 1회만 하므로 중복 저장이 생기지 않는다).
-- 이 스크립트를 실행하기 전에는 LINKS 탭이 플레이스홀더로 남아있고,
-- 실행 후에는 채팅에 링크를 보내는 순간부터 자동으로 쌓인다.
-- ============================================================

create table if not exists trip_links (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references trips(id) on delete cascade,
  chat_message_id uuid references chat_messages(id) on delete set null,
  url             text not null,
  message         text,          -- 링크가 포함된 채팅 메시지 원문(맥락 표시용)
  added_by        uuid references auth.users(id) on delete set null,
  display_name    text,
  avatar_url      text,
  created_at      timestamptz not null default now()
);
create index if not exists trip_links_trip_id_idx on trip_links(trip_id);

-- ── RLS ──────────────────────────────────────────────────────
alter table trip_links enable row level security;

drop policy if exists "trip_links_member_all" on trip_links;
create policy "trip_links_member_all" on trip_links
  for all
  using (exists (select 1 from trip_members m
                 where m.trip_id = trip_links.trip_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_members m
                      where m.trip_id = trip_links.trip_id and m.user_id = auth.uid()));

-- ── 실시간 동기화 ──────────────────────────────────────────
--    같은 트립을 보고 있는 다른 멤버의 LINKS 탭에도 즉시 반영되도록 publication에 추가.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'trip_links'
    ) then
      alter publication supabase_realtime add table trip_links;
    end if;
  end if;
end $$;
