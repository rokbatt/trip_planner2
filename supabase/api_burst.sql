-- ============================================================
-- PRO 기능 짧은 시간 연타 상한 (api_burst)
--
-- PRO 사용자도 무분별하게 쓰지 못하게, 정해진 시간(3분) 안에 정해진 횟수를 넘기면 잠깐 막는다.
-- 하루 상한(api_usage.sql)과 별개다 — 하루 상한은 총량, 이 상한은 짧은 시간의 몰아치기를 막는다.
-- 돈이 드는 외부 호출(PRO 웹 검색, 인생샷, 영수증 읽기) 직전에만 센다. 캐시에서 나온 결과는 세지 않는다.
-- 이 SQL을 안 돌려도 앱은 동작한다 - 연타 상한이 적용되지 않을 뿐이다.
--
-- 한 줄에 한 구문으로 썼다. 대시보드 SQL 편집기가 여러 줄 구문을 중간에서 자른 적이 있어서다.
-- 그래서 주석에는 세미콜론도 달러 기호도 넣지 않는다. 통째로 붙여넣고 Run 하면 된다. 여러 번 돌려도 안전하다.
--
-- api_burst  시도 한 번이 한 줄이다. 막힌 시도는 줄을 늘리지 않는다 - 그래서 계속 눌러도 잠금이 길어지지 않고, 가장 오래된 시도가 창 밖으로 나가면 풀린다.
--            RLS를 켜고 정책을 두지 않는다 - 서버(서비스 키)만 읽고 쓴다. 계정이 삭제되면 함께 지워진다.
-- spend_api_burst(사용자, 종류, 횟수, 창 길이 초)  허용이면 0, 막히면 풀리기까지 남은 초를 돌려준다.
--            같은 사용자·종류의 동시 요청은 잠금으로 한 줄씩 처리해서 숫자가 꼬이지 않는다.
-- 로그인한 사용자가 직접 부르면 남의 횟수를 올릴 수 있으므로 막고 서버(service_role)만 허용한다.
-- 오래된 줄은 이 함수가 부를 때마다 그 사용자 것을 지우고, 매일 새벽 정리 작업(api/cleanup-search-cache.ts)이 하루 지난 줄을 모두 지운다.
-- ============================================================

create table if not exists api_burst ( id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade, kind text not null, at timestamptz not null default now() );
create index if not exists api_burst_user_kind_at_idx on api_burst (user_id, kind, at);
alter table api_burst enable row level security;
create or replace function public.spend_api_burst(p_user uuid, p_kind text, p_limit int, p_window_seconds int) returns int language plpgsql security definer set search_path = public as $$ declare c int; oldest timestamptz; begin perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_kind, 0)); delete from api_burst where user_id = p_user and kind = p_kind and at < now() - make_interval(secs => p_window_seconds); select count(*), min(at) into c, oldest from api_burst where user_id = p_user and kind = p_kind; if c >= p_limit then return greatest(1, ceil(extract(epoch from (oldest + make_interval(secs => p_window_seconds) - now())))::int); end if; insert into api_burst (user_id, kind, at) values (p_user, p_kind, now()); return 0; end $$;
revoke all on function public.spend_api_burst(uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.spend_api_burst(uuid, text, int, int) to service_role;
