-- ============================================================
-- 휴대폰 알림 구독 (push_subscriptions)
--
-- 알림을 켠 기기마다 한 줄. 브라우저가 준 "알림 받을 주소(endpoint)"와 암호화 키 두 개를 저장한다.
-- 서버(Cloudflare Worker)가 이 값으로 그 기기에 알림을 보낸다. 위치·메시지 내용은 저장하지 않는다.
-- 이 SQL을 안 돌려도 앱은 동작한다 - 알림 켜기만 "준비 중"으로 실패한다.
--
-- 한 줄에 한 구문으로 썼다. 대시보드 SQL 편집기가 여러 줄 구문을 중간에서 자른 적이 있어서다.
-- 그래서 주석에는 세미콜론도 달러 기호도 넣지 않는다. 통째로 붙여넣고 Run 하면 된다.
--
-- 정책 설계: 본인 기기 줄만 읽고, 넣고, 고치고, 지울 수 있다.
-- 서버는 service_role로 읽어서 RLS를 거치지 않는다(같은 여행 멤버에게 보낼 때 필요).
-- 계정이 삭제되면 on delete cascade 로 함께 지워진다.
-- ============================================================

create table if not exists push_subscriptions ( id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, endpoint text not null unique, p256dh text not null, auth text not null, created_at timestamptz not null default now(), last_ok_at timestamptz );
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;
drop policy if exists "push_subscriptions_own_select" on push_subscriptions;
create policy "push_subscriptions_own_select" on push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists "push_subscriptions_own_insert" on push_subscriptions;
create policy "push_subscriptions_own_insert" on push_subscriptions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "push_subscriptions_own_update" on push_subscriptions;
create policy "push_subscriptions_own_update" on push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "push_subscriptions_own_delete" on push_subscriptions;
create policy "push_subscriptions_own_delete" on push_subscriptions for delete to authenticated using (user_id = auth.uid());
