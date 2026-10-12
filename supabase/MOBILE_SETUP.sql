-- ════════════════════════════════════════════════════════════════════
--  몽실이 — 모바일 Companion 마이그레이션 (Supabase 대시보드 붙여넣기용)
--
--  【1부】를 통째로 복사 → SQL Editor 에 붙여넣고 Run. 그게 전부입니다.
--  【2부】는 실시간 동기화용이고 에러가 나도 괜찮습니다(2부 머리말 참고).
--
--  여러 번 실행해도 안전합니다. 뭘 돌렸는지 기억 안 나면 그냥 다시 돌리세요.
--
--  실행 전에도 앱은 동작합니다. 다만 아래가 저장되지 않습니다
--    · 도착/출발 기록, GPS 자동 체크인  → trip_stop_progress
--    · 여행 준비 체크리스트             → trip_checklist
--    · 여행 지갑(예약 서류·파일)        → trip_documents
--
--  ── 이 파일의 이상한 생김새에 대하여 ──────────────────────────
--  구문 하나가 **한 줄**에 들어 있습니다. 읽기엔 불편하지만 의도한 것입니다.
--  Supabase 대시보드 SQL Editor가 여러 줄 구문을 중간에서 잘라 버리는 일이 있어서
--  (do 블록 안쪽, 그리고 여러 줄 create policy 에서 실제로 겪음), 줄바꿈으로 쪼개든
--  세미콜론으로 쪼개든 **어느 쪽으로 잘라도 각 조각이 완결된 구문**이 되게 만들었습니다.
--
--  그래서 이 파일을 고칠 때 지켜야 할 것
--    · 구문을 여러 줄로 풀어쓰지 말 것
--    · do 블록(달러 인용)을 쓰지 말 것
--    · 주석 안에 세미콜론을 넣지 말 것
--  읽기 좋은 원본은 supabase/ 폴더의 개별 .sql 파일에 그대로 있습니다(psql용).
-- ════════════════════════════════════════════════════════════════════


-- ████ 1부 · 필수 — 여기부터 "2부" 표시 전까지 복사해 Run ████


-- 도착/출발 기록 테이블
create table if not exists trip_stop_progress ( id uuid primary key default gen_random_uuid(), trip_id uuid not null references trips(id) on delete cascade, destination_id uuid references trip_destinations(id) on delete cascade, day_index int not null, stop_key text not null, status text not null default 'pending', actual_arrive_at timestamptz, actual_depart_at timestamptz, recorded_by uuid references auth.users(id) on delete set null, recorded_by_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now() );
create unique index if not exists trip_stop_progress_dest_day_key_uniq on trip_stop_progress(destination_id, day_index, stop_key) where destination_id is not null;
create index if not exists trip_stop_progress_trip_id_idx on trip_stop_progress(trip_id);
alter table trip_stop_progress enable row level security;
drop policy if exists "trip_stop_progress_member_all" on trip_stop_progress;
create policy "trip_stop_progress_member_all" on trip_stop_progress for all using (exists (select 1 from trip_members m where m.trip_id = trip_stop_progress.trip_id and m.user_id = auth.uid())) with check (exists (select 1 from trip_members m where m.trip_id = trip_stop_progress.trip_id and m.user_id = auth.uid()));

-- 준비 체크리스트 테이블
create table if not exists trip_checklist ( id uuid primary key default gen_random_uuid(), trip_id uuid not null references trips(id) on delete cascade, title text not null, checked_at timestamptz, checked_by uuid references auth.users(id) on delete set null, checked_by_name text, sort_order int not null default 0, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now() );
create index if not exists trip_checklist_trip_id_idx on trip_checklist(trip_id);
alter table trip_checklist enable row level security;
drop policy if exists "trip_checklist_member_all" on trip_checklist;
create policy "trip_checklist_member_all" on trip_checklist for all using (exists (select 1 from trip_members m where m.trip_id = trip_checklist.trip_id and m.user_id = auth.uid())) with check (exists (select 1 from trip_members m where m.trip_id = trip_checklist.trip_id and m.user_id = auth.uid()));

-- 체크리스트 ↔ 장소 연결 컬럼
alter table if exists trip_checklist add column if not exists place_key text;

-- 체크리스트 ↔ 장소 연결 컬럼
alter table if exists trip_checklist add column if not exists place_name text;

-- 문서 잠금 사용자
create table if not exists trip_doc_users ( id uuid primary key default gen_random_uuid(), trip_id uuid not null references trips(id) on delete cascade, name text not null, pin_salt text not null, pin_hash text not null, user_id uuid references auth.users(id) on delete set null, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now() );
create index if not exists trip_doc_users_trip_id_idx on trip_doc_users(trip_id);
create unique index if not exists trip_doc_users_trip_name_uidx on trip_doc_users(trip_id, lower(name));

-- 여행 지갑 문서
create table if not exists trip_documents ( id uuid primary key default gen_random_uuid(), trip_id uuid not null references trips(id) on delete cascade, visibility text not null default 'SHARED', owner_id uuid references trip_doc_users(id) on delete cascade, title text not null, category text not null default 'OTHER', description text, reference_code text, day_start int, day_end int, file_path text, file_name text, file_type text, file_size int, uploaded_by uuid references auth.users(id) on delete set null, uploaded_by_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now() );
create index if not exists trip_documents_trip_id_idx on trip_documents(trip_id);
create index if not exists trip_documents_owner_idx on trip_documents(owner_id);
alter table if exists trip_documents add column if not exists region text;

-- 여행 메모
create table if not exists trip_notes ( id uuid primary key default gen_random_uuid(), trip_id uuid not null references trips(id) on delete cascade, category text not null default 'OTHER', title text not null, body text, checked_at timestamptz, pinned_at timestamptz, day_start int, day_end int, created_by uuid references auth.users(id) on delete set null, created_by_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now() );
create index if not exists trip_notes_trip_id_idx on trip_notes(trip_id);
alter table if exists trip_notes add column if not exists region text;
alter table trip_doc_users enable row level security;
alter table trip_documents enable row level security;
alter table trip_notes enable row level security;
drop policy if exists "trip_doc_users_member_all" on trip_doc_users;
create policy "trip_doc_users_member_all" on trip_doc_users for all using (exists (select 1 from trip_members m where m.trip_id = trip_doc_users.trip_id and m.user_id = auth.uid())) with check (exists (select 1 from trip_members m where m.trip_id = trip_doc_users.trip_id and m.user_id = auth.uid()));
drop policy if exists "trip_documents_member_all" on trip_documents;
create policy "trip_documents_member_all" on trip_documents for all using (exists (select 1 from trip_members m where m.trip_id = trip_documents.trip_id and m.user_id = auth.uid())) with check (exists (select 1 from trip_members m where m.trip_id = trip_documents.trip_id and m.user_id = auth.uid()));
drop policy if exists "trip_notes_member_all" on trip_notes;
create policy "trip_notes_member_all" on trip_notes for all using (exists (select 1 from trip_members m where m.trip_id = trip_notes.trip_id and m.user_id = auth.uid())) with check (exists (select 1 from trip_members m where m.trip_id = trip_notes.trip_id and m.user_id = auth.uid()));

-- 비공개 파일 버킷 trip-docs
insert into storage.buckets (id, name, public) values ('trip-docs', 'trip-docs', false) on conflict (id) do nothing;
drop policy if exists "trip_docs_member_read" on storage.objects;
drop policy if exists "trip_docs_member_insert" on storage.objects;
drop policy if exists "trip_docs_member_delete" on storage.objects;
create policy "trip_docs_member_read" on storage.objects for select using ( bucket_id = 'trip-docs' and exists (select 1 from trip_members m where m.user_id = auth.uid() and m.trip_id::text = (storage.foldername(name))[1]) );
create policy "trip_docs_member_insert" on storage.objects for insert with check ( bucket_id = 'trip-docs' and exists (select 1 from trip_members m where m.user_id = auth.uid() and m.trip_id::text = (storage.foldername(name))[1]) );
create policy "trip_docs_member_delete" on storage.objects for delete using ( bucket_id = 'trip-docs' and exists (select 1 from trip_members m where m.user_id = auth.uid() and m.trip_id::text = (storage.foldername(name))[1]) );
alter table trip_stop_progress drop constraint if exists trip_stop_progress_status_chk;
alter table trip_stop_progress add constraint trip_stop_progress_status_chk check (status in ('pending', 'arrived', 'departed', 'skipped'));
alter table trip_documents drop constraint if exists trip_documents_visibility_chk;
alter table trip_documents add constraint trip_documents_visibility_chk check (visibility in ('SHARED','PERSONAL'));
alter table trip_documents drop constraint if exists trip_documents_owner_chk;
alter table trip_documents add constraint trip_documents_owner_chk check ((visibility = 'PERSONAL' and owner_id is not null) or (visibility = 'SHARED' and owner_id is null));
alter table trip_documents drop constraint if exists trip_documents_category_chk;
alter table trip_documents add constraint trip_documents_category_chk check (category in ('FLIGHT','STAY','TRANSPORT','TICKET','INSURANCE','VISA','RECEIPT','OTHER'));
alter table trip_notes drop constraint if exists trip_notes_category_chk;
alter table trip_notes add constraint trip_notes_category_chk check (category in ('FLIGHT','BAGGAGE','STAY','TRANSPORT','PACKING','VISA','BOOKING','SHOPPING','OTHER'));

-- ████ 2부 · 실시간 (선택) ████
--
--  같은 트립을 보는 다른 멤버 화면에 변경이 즉시 반영되게 합니다.
--  안 해도 앱은 정상 동작합니다 — 새로고침하면 보일 뿐입니다.
--
--  Postgres에는 publication 멤버십용 if-not-exists 문법이 없습니다. 그래서 이미
--  추가된 테이블을 또 추가하면 이런 에러가 납니다
--      ERROR: relation "..." is already member of publication "supabase_realtime"
--  이 에러는 "이미 돼 있다"는 뜻이라 무시해도 됩니다.
--  한 줄씩 따로 실행하시면 한 줄이 실패해도 나머지는 들어갑니다.

alter publication supabase_realtime add table trip_stop_progress;
alter publication supabase_realtime add table trip_checklist;
alter publication supabase_realtime add table trip_documents;
alter publication supabase_realtime add table trip_notes;

-- ════════ 끝 ════════
