-- ============================================================
-- 앱 오류 기록 (client_errors)
--
-- 사용자 화면(브라우저)에서 난 오류를 한 줄씩 남긴다. 누가 봐야 알 수 있었던 오류를 대시보드에서 바로 본다.
-- 저장하는 것: 오류 문장, 짧은 위치 정보(스택 앞부분), 화면 주소의 경로(#trip/... — 검색어·토큰 같은 ? 뒤는 빼고),
--             앱 버전, 브라우저 종류(짧게), 로그인한 사용자 id. 문서 내용·입력값은 저장하지 않는다.
-- 30일이 지나면 매일 정리 작업이 지운다(api/cleanup-search-cache.ts).
-- 이 SQL을 안 돌려도 앱은 동작한다 - 기록만 조용히 건너뛴다.
--
-- 한 줄에 한 구문으로 썼다. 대시보드 SQL 편집기가 여러 줄 구문을 중간에서 자른 적이 있어서다.
-- 그래서 주석에는 세미콜론도 달러 기호도 넣지 않는다. 통째로 붙여넣고 Run 하면 된다.
--
-- 정책 설계: 로그인한 사용자가 자기 id로 넣기만 할 수 있다. 읽기·고치기·지우기는 대시보드(관리자)만.
-- 계정이 삭제되면 on delete cascade 로 함께 지워진다.
-- ============================================================

create table if not exists client_errors ( id bigint generated always as identity primary key, user_id uuid references auth.users(id) on delete cascade default auth.uid(), message text not null check (char_length(message) <= 500), stack text check (char_length(stack) <= 2000), path text check (char_length(path) <= 200), app_version text check (char_length(app_version) <= 40), user_agent text check (char_length(user_agent) <= 160), updated_at timestamptz not null default now() );
create index if not exists client_errors_time_idx on client_errors (updated_at desc);
alter table client_errors enable row level security;
drop policy if exists "client_errors_own_insert" on client_errors;
create policy "client_errors_own_insert" on client_errors for insert to authenticated with check (user_id = auth.uid());

-- ── 보는 법(대시보드 SQL Editor에서 필요할 때) ──
-- 최근 오류 50개:
-- select updated_at, message, path, app_version, user_agent from client_errors order by updated_at desc limit 50;
-- 많이 난 오류 순서(최근 7일):
-- select message, count(*) as n, max(updated_at) as last from client_errors where updated_at > now() - interval '7 days' group by message order by n desc limit 20;
