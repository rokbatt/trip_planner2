-- ============================================================
-- DOCUMENTS & NOTES — 여행 문서함(개인 금고 + 공용 문서함) + 여행 준비 메모
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다(idempotent).
--
-- ⚠️ 이 테이블이 없어도 앱은 정상 동작합니다 — 마이그레이션 전에는 DOCUMENTS 게이트가
--    "준비 중" 안내만 보여주고 나머지 게이트는 그대로 동작합니다
--    (trip_checklist.sql / route_plan.sql과 같은 graceful degradation).
--
-- ── 무엇을 담는가 ────────────────────────────────────────────
-- trip_documents : 항공권·숙소 예약증·발권증명서·보험증서 같은 "원본 자료"
-- trip_notes     : 수하물 규정·체크인 시간·준비물 같은 "기억해둘 정보"
--
-- 이 둘을 한 테이블로 합치지 않는 이유: 문서는 파일이 본체라 스토리지 경로·용량·미리보기가
-- 붙고, 메모는 본문 텍스트가 본체라 확인 여부(checked_at)와 고정(pinned_at)이 붙는다.
-- 한 테이블에 넣으면 절반이 항상 null인 행이 생기고 검색·정렬 규칙도 서로 어긋난다.
--
-- ── 개인 / 공용 구분 ──────────────────────────────────────────
-- visibility = 'SHARED'   : 여행 멤버 전원이 보는 문서(숙소 예약증, 렌터카 예약서 등)
-- visibility = 'PERSONAL' : 등록한 사람만 보는 문서(개인 항공권, 여권 사본, 결제 영수증 등)
--                           owner_id가 trip_doc_users의 어떤 사람 것인지 가리킨다.
--
-- ── PIN에 대한 정직한 설명 (중요) ────────────────────────────
-- trip_doc_users의 4자리 PIN은 "같은 여행을 준비하는 사람들끼리 개인 문서를 섞이지 않게
-- 구분하는 잠금"이지, 금융 수준의 인증이 아니다. 아래 RLS는 이 앱의 다른 테이블과 동일하게
-- "그 트립의 멤버인가"까지만 검사한다 — 즉 같은 트립의 다른 멤버가 직접 API를 호출하면
-- PERSONAL 행도 읽을 수 있다. 화면(클라이언트)은 PIN 확인 전에는 PERSONAL을 아예 조회하지
-- 않고, 확인 후에도 그 사람 소유(owner_id) 행만 조회한다.
-- PIN은 평문으로 저장하지 않는다 — 사용자별 랜덤 salt + SHA-256 해시만 저장한다.
--
-- 나중에 Supabase Auth 기준의 진짜 소유권으로 올리려면:
--   1) trip_doc_users.user_id를 채우게 하고(프로필 등록 시 auth.uid())
--   2) 아래 "향후 강화" 주석의 정책으로 교체하면 된다.
-- 데이터 구조는 그 전환을 견디도록 미리 분리해 두었다(문서 ↔ 소유자 = FK 한 줄).
-- ============================================================

-- ── 개인 문서 사용자(여행 멤버별 프로필 + PIN) ───────────────
create table if not exists trip_doc_users (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references trips(id) on delete cascade,
  name         text not null,
  pin_salt     text not null,              -- 사용자별 랜덤 salt(hex)
  pin_hash     text not null,              -- SHA-256(salt + PIN) hex — 평문 PIN은 저장하지 않음
  user_id      uuid references auth.users(id) on delete set null, -- 향후 Auth 연동용(지금은 참고값)
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists trip_doc_users_trip_id_idx on trip_doc_users(trip_id);
create unique index if not exists trip_doc_users_trip_name_uidx on trip_doc_users(trip_id, lower(name));

-- ── 문서 ─────────────────────────────────────────────────────
create table if not exists trip_documents (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references trips(id) on delete cascade,
  visibility       text not null default 'SHARED',   -- 'SHARED' | 'PERSONAL'
  owner_id         uuid references trip_doc_users(id) on delete cascade, -- PERSONAL일 때만 채움
  title            text not null,
  category         text not null default 'OTHER',
  description      text,
  reference_code   text,                              -- 예약번호 / 티켓번호 등
  -- 관련 DAY — Timeline의 DAY 번호(1부터). 하루짜리면 day_start만 채우고 day_end는 같은 값.
  -- null이면 "전체 일정"에 걸리는 문서(여행자 보험 증서 등).
  day_start        int,
  day_end          int,
  -- 파일(선택) — 파일 없이 예약번호/메모만 저장하는 문서도 허용한다.
  file_path        text,                              -- storage 'trip-docs' 버킷 내 경로
  file_name        text,
  file_type        text,                              -- MIME 타입
  file_size        int,
  uploaded_by      uuid references auth.users(id) on delete set null,
  uploaded_by_name text,                              -- 표시용 스냅샷(멤버 탈퇴 후에도 유지)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists trip_documents_trip_id_idx on trip_documents(trip_id);
create index if not exists trip_documents_owner_idx on trip_documents(owner_id);

-- 지역/도시(선택) — 다중 여행지 트립에서 "이 문서가 어느 여행지 것인지" 구분해 필터링하기
-- 위한 스냅샷 텍스트. trip_destinations에 FK를 걸지 않는 이유: 여행지가 아직 실제 DB 행
-- 없이 trips 컬럼만으로 합성되는 경우(trips/destinations.ts의 legacy 폴백)가 있어 FK가
-- 항상 성립하지 않는다 — 그래서 선택 시점의 여행지 이름을 다른 스냅샷 필드(uploaded_by_name
-- 등)와 같은 방식으로 문자열째 저장한다.
alter table if exists trip_documents add column if not exists region text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trip_documents_visibility_chk') then
    alter table trip_documents
      add constraint trip_documents_visibility_chk
      check (visibility in ('SHARED','PERSONAL'));
  end if;
  -- PERSONAL 문서는 반드시 주인이 있어야 하고, SHARED는 주인을 갖지 않는다
  if not exists (select 1 from pg_constraint where conname = 'trip_documents_owner_chk') then
    alter table trip_documents
      add constraint trip_documents_owner_chk
      check ((visibility = 'PERSONAL' and owner_id is not null)
          or (visibility = 'SHARED'   and owner_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trip_documents_category_chk') then
    alter table trip_documents
      add constraint trip_documents_category_chk
      check (category in ('FLIGHT','STAY','TRANSPORT','TICKET','INSURANCE','VISA','RECEIPT','OTHER'));
  end if;
end $$;

-- ── 메모 ─────────────────────────────────────────────────────
-- 체크리스트(trip_checklist)와 역할이 다르다:
--   CHECKLIST = 여행 중 "해야 하는 행동"
--   NOTES     = 여행 준비 중 "저장해두는 정보/생각"
-- 그래서 여기의 checked_at은 "할 일 완료"가 아니라 "내용을 확인했다"는 표시다.
create table if not exists trip_notes (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references trips(id) on delete cascade,
  category        text not null default 'OTHER',
  title           text not null,
  body            text,
  checked_at      timestamptz,                        -- null이면 미확인
  pinned_at       timestamptz,                        -- null이 아니면 상단 고정
  day_start       int,                                -- 관련 DAY(선택) — 문서와 같은 규칙
  day_end         int,
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists trip_notes_trip_id_idx on trip_notes(trip_id);

-- 지역/도시(선택) — trip_documents.region과 같은 이유·같은 방식(스냅샷 텍스트)
alter table if exists trip_notes add column if not exists region text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trip_notes_category_chk') then
    alter table trip_notes
      add constraint trip_notes_category_chk
      check (category in ('FLIGHT','BAGGAGE','STAY','TRANSPORT','PACKING','VISA','BOOKING','SHOPPING','OTHER'));
  end if;
end $$;

-- ── RLS ──────────────────────────────────────────────────────
--    이 앱의 다른 테이블과 같은 기준: "그 트립의 멤버인가".
--    PERSONAL 문서의 실제 구분은 화면 쪽 PIN 잠금 + owner_id 필터가 담당한다(위 설명 참고).
alter table trip_doc_users  enable row level security;
alter table trip_documents  enable row level security;
alter table trip_notes      enable row level security;

drop policy if exists "trip_doc_users_member_all" on trip_doc_users;
create policy "trip_doc_users_member_all" on trip_doc_users
  for all
  using (exists (select 1 from trip_members m
                 where m.trip_id = trip_doc_users.trip_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_members m
                      where m.trip_id = trip_doc_users.trip_id and m.user_id = auth.uid()));

drop policy if exists "trip_documents_member_all" on trip_documents;
create policy "trip_documents_member_all" on trip_documents
  for all
  using (exists (select 1 from trip_members m
                 where m.trip_id = trip_documents.trip_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_members m
                      where m.trip_id = trip_documents.trip_id and m.user_id = auth.uid()));

drop policy if exists "trip_notes_member_all" on trip_notes;
create policy "trip_notes_member_all" on trip_notes
  for all
  using (exists (select 1 from trip_members m
                 where m.trip_id = trip_notes.trip_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_members m
                      where m.trip_id = trip_notes.trip_id and m.user_id = auth.uid()));

-- ── 향후 강화(참고용, 지금은 실행하지 않음) ──────────────────
--    trip_doc_users.user_id를 실제 로그인 계정으로 채우게 되면, PERSONAL 문서를
--    DB 레벨에서도 주인에게만 보이도록 아래 정책으로 바꿀 수 있다.
--
--    create policy "trip_documents_scoped" on trip_documents
--      for all
--      using (
--        exists (select 1 from trip_members m
--                where m.trip_id = trip_documents.trip_id and m.user_id = auth.uid())
--        and (visibility = 'SHARED'
--             or exists (select 1 from trip_doc_users u
--                        where u.id = trip_documents.owner_id and u.user_id = auth.uid()))
--      );

-- ── 실시간 동기화 ──────────────────────────────────────────
--    한 명이 공용 문서를 올리면 같은 트립을 보고 있는 다른 멤버 화면에도 즉시 뜨도록.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'trip_documents') then
      alter publication supabase_realtime add table trip_documents;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'trip_notes') then
      alter publication supabase_realtime add table trip_notes;
    end if;
  end if;
end $$;

-- ── 파일 저장소 ──────────────────────────────────────────────
--    place-photos / link-previews와 달리 이 버킷은 비공개다 — 항공권·여권 사본처럼
--    URL만 알면 누구나 열 수 있으면 안 되는 파일이 들어오기 때문. 화면에서는 열 때마다
--    짧게 유효한 signed URL을 발급해서 미리보기/다운로드한다.
insert into storage.buckets (id, name, public)
values ('trip-docs', 'trip-docs', false)
on conflict (id) do nothing;

-- 파일 경로 규칙: {trip_id}/{shared|personal}/{uuid}.{ext}
-- → 경로 첫 세그먼트가 trip_id이므로, 그 트립의 멤버인지로 접근을 판단할 수 있다.
drop policy if exists "trip_docs_member_read"   on storage.objects;
drop policy if exists "trip_docs_member_insert" on storage.objects;
drop policy if exists "trip_docs_member_delete" on storage.objects;

create policy "trip_docs_member_read" on storage.objects
  for select
  using (
    bucket_id = 'trip-docs'
    and exists (select 1 from trip_members m
                where m.user_id = auth.uid()
                  and m.trip_id::text = (storage.foldername(name))[1])
  );

create policy "trip_docs_member_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'trip-docs'
    and exists (select 1 from trip_members m
                where m.user_id = auth.uid()
                  and m.trip_id::text = (storage.foldername(name))[1])
  );

create policy "trip_docs_member_delete" on storage.objects
  for delete
  using (
    bucket_id = 'trip-docs'
    and exists (select 1 from trip_members m
                where m.user_id = auth.uid()
                  and m.trip_id::text = (storage.foldername(name))[1])
  );

-- 완료.
