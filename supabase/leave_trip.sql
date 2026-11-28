-- ============================================================
-- 여행에서 나가기 — leave_trip(p_trip_id)
--
-- 로그인한 사용자가 이 여행의 멤버에서 빠진다. 계정은 그대로이고 다른 여행에는 영향이 없다.
-- 클라이언트는 supabase.rpc('leave_trip', { p_trip_id }) 로 부른다.
-- 이 SQL을 안 돌리면 여행 안의 "이 여행에서 나가기" 버튼이 "준비 중"으로 바뀐다.
--
-- ⚠️ 함수 본문에 세미콜론이 있어 한 줄 한 구문 형식으로 쓸 수 없다(delete_my_account.sql 과 같다).
--    대시보드 SQL 편집기에서 Run 이 실패하면 알려 달라.
--
-- 무엇이 일어나는가 - 한 트랜잭션이라 중간에 실패하면 아무것도 바뀌지 않는다
--   1. 내가 이 여행의 멤버가 아니면 아무것도 하지 않고 오류를 낸다 (not_member)
--   2. 멤버가 나 하나뿐이면 나가지 않고 오류를 낸다 (only_member) - 여행 통째 삭제는 별도 기능이다(데이터 삭제를 부르지 않는다)
--   3. 내가 방장이면 가장 먼저 참여한 다른 멤버에게 방장을 넘긴다
--   4. 이 여행의 내 개인 문서 보관함과 그 안의 개인 문서를 지운다 (파일은 SQL로 못 지우므로 클라이언트가 먼저 지운다)
--   5. 내 이름 사본을 이 여행의 기록에서 지운다 (도착 기록·체크리스트·서류·메모·지출·링크)
--   6. 나를 멤버 id 로 가리키는 것(체크리스트 담당자 등)을 비우고 이 여행의 내 멤버십을 지운다
--
-- 남기는 것: 같이 만든 장소·일정·지출·공용 서류·채팅·댓글 (함께 만든 여행 기록이라 그대로 둔다. 이름만 지운다)
-- 이 함수가 하지 않는 것: Storage 파일 삭제(위 4), 다른 여행·계정 삭제.
-- ============================================================

create or replace function public.leave_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  uid uuid := auth.uid();
  my_member uuid;
  nxt uuid;
  n_members int;
  c record;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select id into my_member from public.trip_members where trip_id = p_trip_id and user_id = uid;
  if my_member is null then
    raise exception 'not_member' using errcode = 'P0001';
  end if;

  select count(*) into n_members from public.trip_members where trip_id = p_trip_id;
  if n_members <= 1 then
    raise exception 'only_member' using errcode = 'P0001';
  end if;

  -- 3) 방장이면 가장 먼저 참여한 다른 멤버에게
  if exists (select 1 from public.trips where id = p_trip_id and owner_id = uid) then
    select m.user_id into nxt
      from public.trip_members m
     where m.trip_id = p_trip_id and m.user_id <> uid
     order by m.joined_at asc, m.id asc
     limit 1;
    update public.trips set owner_id = nxt where id = p_trip_id;
    update public.trip_members set role = 'owner' where trip_id = p_trip_id and user_id = nxt;
  end if;

  -- 4) 이 여행의 내 개인 문서 보관함 (그 안의 개인 문서는 FK cascade 로 같이 지워진다)
  if to_regclass('public.trip_doc_users') is not null then
    delete from public.trip_doc_users where trip_id = p_trip_id and user_id = uid;
  end if;

  -- 5) 이름·사진 사본 지우기 (이 여행 것만)
  if to_regclass('public.trip_stop_progress') is not null then
    update public.trip_stop_progress set recorded_by_name = null where recorded_by = uid and trip_id = p_trip_id;
  end if;
  if to_regclass('public.trip_checklist') is not null then
    update public.trip_checklist set checked_by_name = null where checked_by = uid and trip_id = p_trip_id;
  end if;
  if to_regclass('public.trip_documents') is not null then
    update public.trip_documents set uploaded_by_name = null where uploaded_by = uid and trip_id = p_trip_id;
  end if;
  if to_regclass('public.trip_notes') is not null then
    update public.trip_notes set created_by_name = null where created_by = uid and trip_id = p_trip_id;
  end if;
  if to_regclass('public.trip_expenses') is not null then
    update public.trip_expenses set paid_by_name = '나간 멤버', paid_by_avatar = null where paid_by = uid and trip_id = p_trip_id;
  end if;
  if to_regclass('public.trip_links') is not null then
    update public.trip_links set display_name = null, avatar_url = null where added_by = uid and trip_id = p_trip_id;
  end if;

  -- 6) 내 멤버십 행(trip_members.id)을 가리키는 FK 중 삭제를 막을 수 있는 것(체크리스트 담당자 등)을 비운 뒤 멤버십을 지운다.
  --    이 저장소 SQL 에 없는 베이스 테이블이 어떻게 참조하는지는 볼 수 없으므로 pg_constraint 에서 찾는다(delete_my_account 와 같다)
  for c in
    select cl.oid::regclass as tbl, a.attname as col, a.attnotnull as nn
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
     where con.contype = 'f'
       and con.confrelid = 'public.trip_members'::regclass
       and con.confdeltype in ('a', 'r')
       and array_length(con.conkey, 1) = 1
       and ns.nspname = 'public'
  loop
    if c.nn then
      execute format('delete from %s where %I = $1', c.tbl, c.col) using my_member;
    else
      execute format('update %s set %I = null where %I = $1', c.tbl, c.col, c.col) using my_member;
    end if;
  end loop;

  delete from public.trip_members where id = my_member;
end
$$;

revoke all on function public.leave_trip(uuid) from public;
revoke all on function public.leave_trip(uuid) from anon;
grant execute on function public.leave_trip(uuid) to authenticated;
