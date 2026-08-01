-- ============================================================
-- 채팅 — 트립 멤버 간 실시간 메시지 (src/chat/chat.ts)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
--
-- 이 테이블은 원래 대시보드에서 직접 만들어져 저장소에 마이그레이션 파일이 없었다.
-- 이 파일로 스키마를 백필하고, 메시지 수정/삭제 기능에 필요한 edited_at 컬럼과
-- RLS(본인 메시지만 수정/삭제 가능)를 추가한다.
-- ============================================================

create table if not exists chat_messages (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references trips(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  message      text not null,
  created_at   timestamptz not null default now()
);
create index if not exists chat_messages_trip_id_created_at_idx on chat_messages(trip_id, created_at);

-- 수정 기능에 필요한 컬럼 — 이미 존재하는 트립도 안전하게 따라오도록 보강
alter table if exists chat_messages add column if not exists edited_at timestamptz;

-- DELETE 이벤트는 기본적으로 primary key만 old row에 실려서, trip_id로 필터링하는
-- realtime 구독(chat.ts의 filter: 'trip_id=eq.'+tripId)이 DELETE를 아예 못 받는다.
-- FULL로 바꿔야 old row에 trip_id가 포함되어 필터가 정상 동작한다.
alter table chat_messages replica identity full;

-- ── RLS ──────────────────────────────────────────────────────
alter table chat_messages enable row level security;

drop policy if exists "chat_messages_member_select" on chat_messages;
create policy "chat_messages_member_select" on chat_messages
  for select
  using (exists (select 1 from trip_members m
                 where m.trip_id = chat_messages.trip_id and m.user_id = auth.uid()));

drop policy if exists "chat_messages_member_insert" on chat_messages;
create policy "chat_messages_member_insert" on chat_messages
  for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from trip_members m
                where m.trip_id = chat_messages.trip_id and m.user_id = auth.uid())
  );

-- 수정/삭제는 본인 메시지만 — 다른 멤버의 메시지는 절대 건드릴 수 없다(클라이언트에서
-- 버튼을 숨기는 것과 별개로 서버 단에서 강제되어야 하는 부분)
drop policy if exists "chat_messages_owner_update" on chat_messages;
create policy "chat_messages_owner_update" on chat_messages
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "chat_messages_owner_delete" on chat_messages;
create policy "chat_messages_owner_delete" on chat_messages
  for delete
  using (user_id = auth.uid());

-- ── 실시간 동기화 ──────────────────────────────────────────
--    INSERT는 이미 동작 중이었지만, 수정/삭제도 다른 멤버 화면에 바로 반영되려면
--    UPDATE/DELETE 이벤트도 publication에 포함되어 있어야 한다.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'chat_messages'
    ) then
      alter publication supabase_realtime add table chat_messages;
    end if;
  end if;
end $$;
