-- ============================================================
-- 가입 동의 기록 (user_consents)
--
-- 누가 언제 어느 버전의 이용약관·개인정보처리방침에 동의했는지 남기는 증빙 테이블이다.
-- 이 SQL을 안 돌려도 앱은 동작한다 - 동의 창은 뜨고, 기록은 이 기기에만 남는다.
--
-- 한 줄에 한 구문으로 썼다. 대시보드 SQL 편집기가 여러 줄 구문을 중간에서 자른 적이 있어서다.
-- 그래서 주석에는 세미콜론도 달러 기호도 넣지 않는다. 통째로 붙여넣고 Run 하면 된다.
--
-- 정책 설계: 본인 기록을 읽고 쓸 수만 있고 고치거나 지울 수는 없다 (증빙이라서).
-- 계정이 삭제되면 on delete cascade 로 함께 지워진다.
-- ============================================================

create table if not exists user_consents ( id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, terms_version text not null, privacy_version text not null, agreed_at timestamptz not null default now(), user_agent text, unique (user_id, terms_version, privacy_version) );
alter table user_consents enable row level security;
drop policy if exists "user_consents_own_select" on user_consents;
create policy "user_consents_own_select" on user_consents for select to authenticated using (user_id = auth.uid());
drop policy if exists "user_consents_own_insert" on user_consents;
create policy "user_consents_own_insert" on user_consents for insert to authenticated with check (user_id = auth.uid());
