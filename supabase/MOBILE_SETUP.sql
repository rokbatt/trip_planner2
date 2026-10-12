-- ════════════════════════════════════════════════════════════════════
--  몽실이 — 모바일 Companion 마이그레이션 (한 번에 실행용 합본)
--
--  Supabase 대시보드 → SQL Editor 에 **이 파일 전체를 붙여넣고 Run** 하세요.
--
--  ⚠️ 여러 번 실행해도 안전합니다(idempotent).
--     이미 돌린 적 있는 항목이 섞여 있어도 그냥 통과합니다 —
--     create table/index는 if not exists, 정책은 drop 후 재생성,
--     제약조건은 존재 확인 후 추가, 버킷은 on conflict do nothing 입니다.
--     그러니 "뭘 돌렸는지 기억 안 날 때"도 그냥 전체를 다시 돌리면 됩니다.
--
--  ⚠️ 실행 전에도 앱은 동작합니다. 다만 아래 기능이 **저장되지 않습니다**:
--       · 도착/출발 기록, GPS 자동 체크인  → trip_stop_progress
--       · 여행 준비 체크리스트             → trip_checklist(+_place)
--       · 여행 지갑(예약 서류·파일)        → trip_documents
--
--  이 합본은 **모바일 Companion에 필요한 것만** 모았습니다. 다른 기능(채팅·지출·
--  링크 등)이 안 보이면 supabase/ 폴더의 해당 .sql을 따로 확인하세요.
--
--  생성: supabase/MOBILE_SETUP.sql — 원본 4개를 순서대로 합친 것이며,
--        원본을 고치면 이 파일도 같이 고쳐야 합니다(아래 목차 순서 유지).
--
--  목차
--    1. trip_stop_progress   도착/출발 기록
--    2. trip_checklist       준비 체크리스트
--    3. trip_checklist_place 체크리스트 ↔ 장소 연결   (2 다음이어야 함)
--    4. trip_documents       여행 지갑 + trip-docs 버킷
-- ════════════════════════════════════════════════════════════════════

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  trip_stop_progress.sql
-- ║  도착/출발 기록 — TODAY의 도착 버튼, GPS 자동 체크인, 남은 일정 재계산
-- ╚══════════════════════════════════════════════════════════════════╝

-- ============================================================
-- MOBILE(Companion) — 여행 중 실제 도착/출발 기록
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 여러 번 실행해도 안전합니다(idempotent).
--
-- ⚠️ 이 테이블이 없어도 앱은 정상 동작합니다 — 마이그레이션 전에는 도착/출발 버튼을 눌러도
--    "세션 메모리 전용" 모드로 조용히 떨어집니다(route_plan.sql과 같은 graceful degradation).
--
-- ── 왜 route_stops에 바로 기록하지 않는가 ──────────────────
-- route_stops는 "계획"이다. 실제 도착 시각으로 덮어써버리면 계획을 되돌릴 수 없고,
-- 무엇보다 route_stops는 ROUTE/TIMELINE에서 하루를 저장할 때마다 **그 DAY 전체를
-- 지우고 다시 넣는 방식**(routeStore.saveRouteDay)이라, 만약 진행 기록이 route_stops.id를
-- FK로 참조했다면 PC에서 그 날 아무거나 하나만 고쳐도(다른 정류지 메모 수정 등) 관련 없는
-- 정류지의 진행 기록까지 CASCADE로 통째로 날아간다. 그래서 route_stops.id를 전혀 참조하지
-- 않고, dayModel.ts가 이미 계산해 쓰는 "그 DAY 안에서 정류지를 가리키는 문자열 키"
-- (TlStop.key = "d{dayIndex}-{순번}-{placeId 또는 customName}")를 그대로 저장한다.
-- 계획(route_stops)은 불변, 실제(trip_stop_progress)만 쌓인다 — 여행 후 리포트가 공짜로 생긴다.
-- ============================================================

create table if not exists trip_stop_progress (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references trips(id) on delete cascade,
  destination_id    uuid references trip_destinations(id) on delete cascade,
  day_index         int  not null,
  stop_key          text not null,          -- dayModel.ts의 TlStop.key와 동일한 문자열
  status            text not null default 'pending', -- 'pending' | 'arrived' | 'departed' | 'skipped'
  actual_arrive_at  timestamptz,
  actual_depart_at  timestamptz,
  recorded_by       uuid references auth.users(id) on delete set null,
  recorded_by_name  text,                    -- 표시용 스냅샷(멤버 탈퇴 후에도 "누가 기록했는지" 유지)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 같은 정류지에 대한 기록은 하나만 — upsert로 갱신한다(destination_id가 있을 때만 유일함 보장,
-- route_plan.sql의 route_days_dest_day_uniq와 같은 이유로 부분 인덱스를 쓴다)
create unique index if not exists trip_stop_progress_dest_day_key_uniq
  on trip_stop_progress(destination_id, day_index, stop_key)
  where destination_id is not null;

create index if not exists trip_stop_progress_trip_id_idx on trip_stop_progress(trip_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trip_stop_progress_status_chk') then
    alter table trip_stop_progress
      add constraint trip_stop_progress_status_chk
      check (status in ('pending', 'arrived', 'departed', 'skipped'));
  end if;
end $$;

-- ── RLS ──────────────────────────────────────────────────────
alter table trip_stop_progress enable row level security;

drop policy if exists "trip_stop_progress_member_all" on trip_stop_progress;
create policy "trip_stop_progress_member_all" on trip_stop_progress
  for all
  using (exists (select 1 from trip_members m
                 where m.trip_id = trip_stop_progress.trip_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_members m
                      where m.trip_id = trip_stop_progress.trip_id and m.user_id = auth.uid()));

-- ── 실시간 동기화 ──────────────────────────────────────────
--    한 멤버가 "도착"을 누르면 같은 트립의 다른 멤버 화면에도 즉시 반영되도록 publication에 추가.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'trip_stop_progress'
    ) then
      alter publication supabase_realtime add table trip_stop_progress;
    end if;
  end if;
end $$;



-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  trip_checklist.sql
-- ║  여행 준비 체크리스트 — 여행 탭의 공유 체크리스트
-- ╚══════════════════════════════════════════════════════════════════╝

-- ============================================================
-- MOBILE(Companion) — 여행 준비 체크리스트
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 여러 번 실행해도 안전합니다(idempotent).
--
-- ⚠️ 이 테이블이 없어도 앱은 정상 동작합니다 — 마이그레이션 전에는 MORE 탭의 체크리스트
--    자리에 "준비 중" 안내만 뜨고 나머지 섹션(숙소·예약 링크·멤버)은 그대로 보입니다
--    (route_plan.sql / trip_stop_progress.sql과 같은 graceful degradation).
--
-- ── 왜 "개인 목록"이 아니라 "트립 공유 목록"인가 ────────────
-- 몽실이는 혼자 쓰는 여행 메모가 아니라 여럿이 같은 여행을 준비하는 도구다. 실제로 빠뜨려서
-- 문제가 되는 건 "내 칫솔"이 아니라 "유심 아무도 안 샀네" 쪽이고, 그건 목록이 공유될 때만
-- 막힌다. 그래서 항목은 트립 단위로 공유하고, 누가 체크했는지만 남긴다(checked_by_name).
-- 개인 전용 항목이 필요하면 나중에 assigned_to로 확장하면 되지만, v1에서 목록을 둘로
-- 쪼개면 "어느 쪽에 적었더라"가 생겨 오히려 빠뜨리기 쉬워진다.
--
-- 체크 상태를 boolean이 아니라 checked_at(timestamptz)으로 두는 이유: "체크됨"은
-- checked_at is not null로 그대로 읽히면서, 언제 체크했는지가 공짜로 남는다.
-- ============================================================

create table if not exists trip_checklist (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references trips(id) on delete cascade,
  title            text not null,
  checked_at       timestamptz,             -- null이면 미완료
  checked_by       uuid references auth.users(id) on delete set null,
  checked_by_name  text,                    -- 표시용 스냅샷(멤버 탈퇴 후에도 "누가 했는지" 유지)
  sort_order       int  not null default 0,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists trip_checklist_trip_id_idx on trip_checklist(trip_id);

-- ── RLS ──────────────────────────────────────────────────────
alter table trip_checklist enable row level security;

drop policy if exists "trip_checklist_member_all" on trip_checklist;
create policy "trip_checklist_member_all" on trip_checklist
  for all
  using (exists (select 1 from trip_members m
                 where m.trip_id = trip_checklist.trip_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_members m
                      where m.trip_id = trip_checklist.trip_id and m.user_id = auth.uid()));

-- ── 실시간 동기화 ──────────────────────────────────────────
--    한 명이 "유심 구매"를 체크하면 다른 멤버 화면에서도 즉시 지워지도록 publication에 추가.
--    체크리스트는 여럿이 동시에 만지는 목록이라 이게 없으면 중복 준비가 그대로 발생한다.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'trip_checklist'
    ) then
      alter publication supabase_realtime add table trip_checklist;
    end if;
  end if;
end $$;



-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  trip_checklist_place.sql
-- ║  체크리스트 항목에 장소 연결 (위 trip_checklist 다음에 와야 함)
-- ╚══════════════════════════════════════════════════════════════════╝

-- ============================================================
-- 체크리스트 항목을 "장소"에 연결 — TIMELINE 장소 상세 패널의 "이 장소 준비" 목록용
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 여러 번 실행해도 안전(idempotent)합니다. trip_checklist.sql을 먼저 실행해야 합니다.
--
-- 왜 새 테이블이 아니라 컬럼인가
--   장소별 준비물을 따로 두면 "어디에 적었더라"가 생겨 오히려 빠뜨리기 쉬워진다
--   (trip_checklist.sql 상단의 "트립 공유 목록" 이유와 같음). 그래서 목록은 하나로 두고,
--   TIMELINE에서 넣은 항목에만 어느 장소 것인지 표시를 붙인다. MOBILE 체크리스트에서도
--   같은 항목이 장소 이름과 함께 보인다.
--
-- ⚠️ 이 마이그레이션 전에도 앱은 동작한다 — 컬럼이 없으면 장소 이름을 제목 앞에 붙여
--    ("왓 아룬 · 복장 규정 확인") 저장하고, 화면은 그 접두어로 장소 항목을 알아본다.
-- ============================================================

alter table if exists trip_checklist add column if not exists place_key  text;
alter table if exists trip_checklist add column if not exists place_name text;



-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  trip_documents.sql
-- ║  여행 지갑 — 항공권·숙소·티켓·개인 문서 + 비공개 파일 버킷
-- ╚══════════════════════════════════════════════════════════════════╝

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



-- ════════ 전부 완료 ════════
