-- ============================================================
-- 회원 탈퇴 — delete_my_account()
--
-- 로그인한 사용자 본인의 계정을 지운다. 클라이언트는 supabase.rpc('delete_my_account')로 부른다.
-- 이 SQL을 안 돌리면 설정 화면의 탈퇴 버튼이 "준비 중, 이메일로 요청해 주세요"로 바뀐다.
--
-- ⚠️ 이 파일은 함수 본문에 세미콜론이 있어 한 줄 한 구문 형식으로 쓸 수 없다.
--    대시보드 SQL 편집기에서 "Run"이 실패하면(과거에 do 블록이 잘린 적이 있다) 알려 달라.
--
-- 무엇이 일어나는가 - 전부 한 트랜잭션이라 중간에 실패하면 아무것도 바뀌지 않는다
--   1. 내 개인 문서 보관함 프로필을 지운다 (그 안의 개인 문서 행은 FK cascade로 같이 지워진다)
--   2. 내가 방장인 여행
--        - 다른 멤버가 없으면 여행을 지운다
--        - 있으면 가장 먼저 참여한 멤버에게 방장을 넘긴다 (여행은 남는다)
--   3. 내 이름 사본을 지운다 (작성자 FK는 set null 이라 id는 끊기지만 이름 글자는 남기 때문)
--   4. 내가 쓴 댓글과 채팅을 지우고, 모든 여행에서 내 멤버십을 지운다
--   5. 안전망 - auth.users 를 가리키는데 위에서 못 다룬 FK(이 저장소 SQL에 없는 베이스 테이블 등)가
--      삭제를 막지 않게 한다. null 가능한 열은 비우고, null 불가한 열은 그 행을 지운다
--   6. auth.users 에서 내 계정을 지운다 (동의 기록 등은 cascade로 같이 지워진다)
--
-- 이 함수가 하지 않는 것: Storage 파일 삭제. SQL로 storage.objects 행만 지우면 실제 파일은 남는다.
-- 그래서 파일은 클라이언트가 이 함수를 부르기 전에 (아직 멤버일 때) 먼저 지운다 (account/accountStore.ts).
-- ============================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  uid uuid := auth.uid();
  t record;
  c record;
  nxt uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- 1) 개인 문서 보관함 프로필 (trip_documents.owner_id 가 cascade 로 따라 지워진다)
  if to_regclass('public.trip_doc_users') is not null then
    delete from public.trip_doc_users where user_id = uid;
  end if;

  -- 2) 내가 방장인 여행: 혼자면 삭제, 다른 멤버가 있으면 가장 먼저 참여한 사람에게 넘긴다
  for t in select id from public.trips where owner_id = uid loop
    select m.user_id into nxt
      from public.trip_members m
     where m.trip_id = t.id and m.user_id <> uid
     order by m.joined_at asc, m.id asc
     limit 1;

    if nxt is null then
      delete from public.trips where id = t.id;
    else
      update public.trips set owner_id = nxt where id = t.id;
      update public.trip_members set role = 'owner' where trip_id = t.id and user_id = nxt;
    end if;
  end loop;

  -- 3) 이름·사진 사본 지우기 (계정이 지워지면 id 연결은 끊기지만 글자는 남는다)
  if to_regclass('public.trip_stop_progress') is not null then
    update public.trip_stop_progress set recorded_by_name = null where recorded_by = uid;
  end if;
  if to_regclass('public.trip_checklist') is not null then
    update public.trip_checklist set checked_by_name = null where checked_by = uid;
  end if;
  if to_regclass('public.trip_documents') is not null then
    update public.trip_documents set uploaded_by_name = null where uploaded_by = uid;
  end if;
  if to_regclass('public.trip_notes') is not null then
    update public.trip_notes set created_by_name = null where created_by = uid;
  end if;
  if to_regclass('public.trip_expenses') is not null then
    update public.trip_expenses set paid_by_name = '탈퇴한 멤버', paid_by_avatar = null where paid_by = uid;
  end if;
  if to_regclass('public.trip_links') is not null then
    update public.trip_links set display_name = null, avatar_url = null where added_by = uid;
  end if;

  -- 4) 내가 쓴 댓글·채팅, 그리고 모든 여행에서 내 멤버십
  if to_regclass('public.place_comments') is not null then
    delete from public.place_comments where user_id = uid;
  end if;
  if to_regclass('public.chat_messages') is not null then
    delete from public.chat_messages where user_id = uid;
  end if;
  delete from public.trip_members where user_id = uid;

  -- 5) 안전망: 삭제를 막을 수 있는 FK (no action / restrict) 를 찾아 미리 비운다
  for c in
    select cl.oid::regclass as tbl, a.attname as col, a.attnotnull as nn
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
     where con.contype = 'f'
       and con.confrelid = 'auth.users'::regclass
       and con.confdeltype in ('a', 'r')
       and array_length(con.conkey, 1) = 1
       and ns.nspname = 'public'
  loop
    if c.nn then
      execute format('delete from %s where %I = $1', c.tbl, c.col) using uid;
    else
      execute format('update %s set %I = null where %I = $1', c.tbl, c.col, c.col) using uid;
    end if;
  end loop;

  -- 6) 계정 삭제 (user_consents 등 on delete cascade 인 것은 여기서 같이 지워진다)
  delete from auth.users where id = uid;
end
$$;

-- 로그인한 사용자만 부를 수 있다 (anon 이 부르면 auth.uid() 가 null 이라 위에서 막히지만 이중으로 잠근다)
revoke all on function public.delete_my_account() from public;
revoke all on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;
