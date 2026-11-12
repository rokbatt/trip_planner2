-- ============================================================
-- 사용자당 하루 사용량 상한 + 관리자·예외 목록 (Claude.md 5-11)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
-- 안 돌려도 앱은 그대로 동작합니다(상한이 적용되지 않을 뿐).
--
-- api_usage  기능 종류별 하루 사용 횟수. 돈이 드는 외부 호출(AI·장소 검색·주변 시설·길찾기) 직전에만 센다.
--            날짜는 한국 시간 기준. 7일 지난 기록은 매일 새벽 정리 작업(api/cleanup-search-cache.ts)이 지운다.
-- app_roles  상한을 적용하지 않을 사람. 대시보드 → Table Editor → app_roles 에서 행을 추가·삭제한다.
--            email: 구글 로그인 이메일(소문자) / role: 'admin'(관리자) 또는 'unlimited'(지인 등 예외) / note: 메모
-- 두 표 모두 RLS를 켜고 정책을 두지 않는다 → 서버(서비스 키)만 읽고 쓴다. 브라우저에서는 보이지도 않는다.
-- 주석에 세미콜론을 넣지 않는다(대시보드가 구문을 자르는 문제, Claude.md 6장 MOBILE_SETUP.sql 설명 참고).
-- ============================================================

create table if not exists api_usage (user_id uuid not null references auth.users(id) on delete cascade, day date not null, kind text not null, count int not null default 0, updated_at timestamptz not null default now(), primary key (user_id, day, kind));

create index if not exists api_usage_updated_idx on api_usage(updated_at);

alter table api_usage enable row level security;

create table if not exists app_roles (email text primary key, role text not null check (role in ('admin', 'unlimited')), note text, created_at timestamptz not null default now());

alter table app_roles enable row level security;

-- 하루 사용량을 1 올리고, 상한 안이면 true. 동시에 여러 요청이 와도 한 줄 갱신이라 숫자가 꼬이지 않는다.
create or replace function public.spend_api_quota(p_user uuid, p_kind text, p_limit int) returns boolean language plpgsql security definer set search_path = public as $$ declare c int; begin insert into api_usage (user_id, day, kind, count, updated_at) values (p_user, (now() at time zone 'Asia/Seoul')::date, p_kind, 1, now()) on conflict (user_id, day, kind) do update set count = api_usage.count + 1, updated_at = now() returning count into c; return c <= p_limit; end $$;

-- 로그인한 사용자가 직접 부르면 남의 사용량을 올릴 수 있으므로 막고, 서버(service_role)만 허용한다
revoke all on function public.spend_api_quota(uuid, text, int) from public, anon, authenticated;

grant execute on function public.spend_api_quota(uuid, text, int) to service_role;

-- 완료. 본인을 관리자로 등록하려면 아래 줄의 이메일을 바꿔 실행하세요(구글 로그인 이메일).
-- insert into app_roles (email, role, note) values ('your-email@example.com', 'admin', '운영자') on conflict (email) do update set role = excluded.role
