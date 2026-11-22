-- ============================================================
-- 요금제 (user_plans) — 무료 / PRO
--
-- PRO 사용자를 한 줄씩 적는 표다. 줄이 없거나 plan이 'free'면 무료.
-- 지금은 관리자가 아래 예시처럼 SQL로 넣고, 나중에 결제(토스·카카오페이·카드)를 붙이면 결제 서버가 같은 표에 쓴다.
--   source     : 'manual'(관리자) · 결제 수단 이름 등 — PRO가 어디서 왔는지
--   expires_at : 비우면 만료 없음. 구독이면 다음 결제일까지
-- app_roles의 admin · unlimited(운영자·지인)도 PRO 기능을 쓴다(따로 넣지 않아도 된다).
--
-- 한 줄에 한 구문으로 썼다. 대시보드 SQL 편집기가 여러 줄 구문을 중간에서 자른 적이 있어서다.
-- 그래서 주석에는 세미콜론도 달러 기호도 넣지 않는다. 통째로 붙여넣고 Run 하면 된다.
--
-- 정책 설계: 본인 줄을 읽을 수만 있다. 쓰기는 서버(service_role)와 관리자 SQL만 — 사용자가 스스로 PRO가 될 수 없다.
-- 계정이 삭제되면 on delete cascade 로 함께 지워진다.
-- ============================================================

create table if not exists user_plans ( user_id uuid primary key references auth.users(id) on delete cascade, plan text not null default 'free' check (plan in ('free', 'pro')), source text not null default 'manual', expires_at timestamptz, note text, updated_at timestamptz not null default now() );
alter table user_plans enable row level security;
drop policy if exists "user_plans_own_select" on user_plans;
create policy "user_plans_own_select" on user_plans for select to authenticated using (user_id = auth.uid());

-- ── 사용 예시(실행할 때만 주석을 풀고, 이메일을 바꿔서) ──
-- PRO로 넣기(만료 없음):
-- insert into user_plans (user_id, plan, source, note) select id, 'pro', 'manual', '지인' from auth.users where email = 'friend@example.com' on conflict (user_id) do update set plan = 'pro', source = 'manual', expires_at = null, updated_at = now();
-- 30일만 PRO:
-- insert into user_plans (user_id, plan, source, expires_at) select id, 'pro', 'manual', now() + interval '30 days' from auth.users where email = 'friend@example.com' on conflict (user_id) do update set plan = 'pro', expires_at = excluded.expires_at, updated_at = now();
-- 무료로 되돌리기:
-- update user_plans set plan = 'free', updated_at = now() where user_id = (select id from auth.users where email = 'friend@example.com');
-- 지금 PRO 목록 보기:
-- select u.email, p.plan, p.source, p.expires_at from user_plans p join auth.users u on u.id = p.user_id order by p.updated_at desc;
