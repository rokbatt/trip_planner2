-- ============================================================
-- 결제 기록 (payments) + 이용권 반영·회수 함수 — docs/PAYMENT_DESIGN.md 4장
--
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- 먼저 supabase/user_plans.sql 과 supabase/api_usage.sql 이 실행돼 있어야 합니다(user_plans 표에 칸을 더합니다).
-- 안 돌려도 앱은 그대로 동작합니다(결제 기능만 열리지 않습니다).
--
-- 한 줄에 한 구문으로 썼습니다. 대시보드 편집기가 여러 줄 구문을 중간에서 자른 적이 있어서입니다.
-- 그래서 주석에는 세미콜론도 달러 기호도 넣지 않습니다.
--
-- payments   결제 한 건이 한 줄. 포트원에 보낸 결제 ID가 기본 키라 같은 결제는 두 줄이 될 수 없다.
--            본인 줄을 읽을 수만 있고, 쓰기는 서버(service_role)만 한다.
--            카드 번호 같은 결제 수단 정보는 저장하지 않는다(포트원·PG가 가지고 있다).
--            탈퇴해도 지우지 않는다 — 전자상거래법상 대금 결제·청약철회 기록 5년 보관.
--            user_id 만 비워지고(on delete set null) buyer_email 사본은 분쟁 대응을 위해 남는다(사용자 결정 2026-11-24).
--            5년이 지난 줄은 매일 정리 작업이 지운다(created_at 인덱스).
-- user_plans.web_left   PRO 웹 검색 남은 수. 비어 있으면(null) 제한 없음 — 관리자가 넣은 PRO.
--
-- 함수 세 개는 모두 서버(service_role)만 부를 수 있다. 사용자가 직접 부르면 스스로 PRO가 될 수 있기 때문이다.
--   grant_pro_pass(결제ID, PG거래ID, 결제수단)  결제 확인 뒤 이용권 반영. 같은 결제는 한 번만 반영된다(행 잠금 + 상태 확인).
--   revoke_pro_pass(결제ID, 사유)               취소·환불 뒤 이용권 회수. 같은 결제는 한 번만 회수된다.
--   spend_web_left(사용자)                      PRO 웹 검색 직전에 1 줄인다. 0이면 거절. 결제로 생긴 상한이 없으면 통과.
-- ============================================================

create table if not exists payments ( payment_id text primary key check (payment_id ~ '^[A-Za-z0-9-]{8,64}$'), user_id uuid references auth.users(id) on delete set null, buyer_email text, product text not null, amount int not null check (amount > 0), currency text not null default 'KRW', status text not null default 'ready' check (status in ('ready', 'paid', 'cancelled', 'failed')), pay_method text, pg_tx_id text, period_days int not null check (period_days > 0), web_count int not null check (web_count >= 0), granted_at timestamptz, period_end timestamptz, cancelled_at timestamptz, cancel_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now() );

create index if not exists payments_user_idx on payments(user_id, created_at desc);

create index if not exists payments_created_idx on payments(created_at);

alter table payments enable row level security;

drop policy if exists "payments_own_select" on payments;

create policy "payments_own_select" on payments for select to authenticated using (user_id = auth.uid());

alter table user_plans add column if not exists web_left int check (web_left is null or web_left >= 0);

-- 이용권 반영: 이미 paid면 아무것도 하지 않는다. 만료일 = (살아 있으면 남은 만료일, 아니면 지금) + 기간. 웹 검색은 살아 있으면 더하고 아니면 새로 시작. 만료 없는 수동 PRO는 줄이지 않는다
create or replace function public.grant_pro_pass(p_payment text, p_tx text, p_method text) returns jsonb language plpgsql security definer set search_path = public as $$ declare p payments%rowtype; cur user_plans%rowtype; has_cur boolean; live boolean; forever boolean; new_exp timestamptz; new_web int; begin select * into p from payments where payment_id = p_payment for update; if not found then raise exception 'payment not found'; end if; if p.status = 'paid' then return jsonb_build_object('already', true, 'expires_at', p.period_end); end if; if p.status = 'cancelled' then raise exception 'payment already cancelled'; end if; if p.user_id is null then raise exception 'payment has no user'; end if; select * into cur from user_plans where user_id = p.user_id for update; has_cur := found; forever := has_cur and cur.plan = 'pro' and cur.expires_at is null; live := has_cur and cur.plan = 'pro' and (cur.expires_at is null or cur.expires_at > now()); if forever then new_exp := null; new_web := cur.web_left; elsif live then new_exp := cur.expires_at + make_interval(days => p.period_days); new_web := coalesce(cur.web_left, 0) + p.web_count; else new_exp := now() + make_interval(days => p.period_days); new_web := p.web_count; end if; insert into user_plans (user_id, plan, source, expires_at, web_left, updated_at) values (p.user_id, 'pro', 'portone', new_exp, new_web, now()) on conflict (user_id) do update set plan = 'pro', source = case when forever then user_plans.source else 'portone' end, expires_at = new_exp, web_left = new_web, updated_at = now(); update payments set status = 'paid', pg_tx_id = left(p_tx, 200), pay_method = left(p_method, 40), granted_at = now(), period_end = new_exp, updated_at = now() where payment_id = p_payment; return jsonb_build_object('already', false, 'expires_at', new_exp, 'web_left', new_web); end $$;

-- 이용권 회수: 이미 cancelled면 아무것도 하지 않는다. 반영 전(ready·failed)이면 상태만 바꾼다. 반영된 결제면 만료일에서 기간을, 웹 검색에서 개수를 뺀다(0 아래로 안 간다). 만료일이 지나면 무료
create or replace function public.revoke_pro_pass(p_payment text, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$ declare p payments%rowtype; cur user_plans%rowtype; new_exp timestamptz; new_web int; begin select * into p from payments where payment_id = p_payment for update; if not found then raise exception 'payment not found'; end if; if p.status = 'cancelled' then return jsonb_build_object('already', true); end if; update payments set status = 'cancelled', cancelled_at = now(), cancel_reason = left(coalesce(p_reason, ''), 200), updated_at = now() where payment_id = p_payment; if p.status <> 'paid' or p.user_id is null then return jsonb_build_object('already', false, 'revoked', false); end if; select * into cur from user_plans where user_id = p.user_id for update; if not found or cur.expires_at is null then return jsonb_build_object('already', false, 'revoked', false); end if; new_exp := cur.expires_at - make_interval(days => p.period_days); new_web := case when cur.web_left is null then null else greatest(cur.web_left - p.web_count, 0) end; update user_plans set expires_at = new_exp, web_left = new_web, plan = case when new_exp <= now() then 'free' else plan end, updated_at = now() where user_id = p.user_id; return jsonb_build_object('already', false, 'revoked', true, 'expires_at', new_exp, 'web_left', new_web); end $$;

-- 웹 검색 1회 차감: 남은 수가 있으면 1 줄이고 true. 남은 수가 0이면 false. 줄이 없거나 제한이 없으면(null) true — PRO 여부는 부르기 전에 서버가 이미 확인한다
create or replace function public.spend_web_left(p_user uuid) returns boolean language plpgsql security definer set search_path = public as $$ begin update user_plans set web_left = web_left - 1, updated_at = now() where user_id = p_user and web_left > 0; if found then return true; end if; return not exists (select 1 from user_plans where user_id = p_user and web_left = 0); end $$;

revoke all on function public.grant_pro_pass(text, text, text) from public, anon, authenticated;

grant execute on function public.grant_pro_pass(text, text, text) to service_role;

revoke all on function public.revoke_pro_pass(text, text) from public, anon, authenticated;

grant execute on function public.revoke_pro_pass(text, text) to service_role;

revoke all on function public.spend_web_left(uuid) from public, anon, authenticated;

grant execute on function public.spend_web_left(uuid) to service_role;

-- 완료. 아래는 운영용 조회(실행할 때만 주석을 풀어서)
-- 최근 결제 20건:
-- select payment_id, buyer_email, amount, status, pay_method, granted_at, period_end, cancelled_at from payments order by created_at desc limit 20
-- 주 1회 대사(포트원 콘솔의 결제 완료 목록과 비교) — 지난 7일 결제 완료·취소:
-- select status, count(*), sum(amount) from payments where created_at > now() - interval '7 days' group by status
-- 반영 안 된 결제(포트원에선 완료인데 여기선 ready로 남은 것) 찾기 — 1시간 넘은 ready:
-- select payment_id, buyer_email, created_at from payments where status = 'ready' and created_at < now() - interval '1 hour' order by created_at desc
