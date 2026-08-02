-- ============================================================
-- EXPENSE 게이트 — 여행 예산·지출을 멤버들과 함께 관리하는 탭
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
--
-- 두 테이블로 구성:
--  1) trip_expense_budgets — 카테고리별 예산(전체 인원 기준, 원). 트립+카테고리당 1행.
--                            category='TOTAL'인 행은 카테고리 배분과 별개인 "총 예산"
--                            lump sum을 저장하는 sentinel(카테고리 목록에 없는 값이라
--                            trip_expenses.category 제약과 충돌하지 않음).
--  2) trip_expenses        — 지출 항목. 계획 단계에선 "예정" 항목으로 쌓고,
--                            실제 여행 중엔 결제 완료(is_paid)로 바꿔가며 기록.
--                            현지 통화 입력 시 저장 시점 환율(fx_rate)로 원화 환산값을
--                            함께 저장한다(원칙 3-1 — 환산에 쓴 환율·출처를 남겨 표시).
--                            split_mode로 "공동 지출"(정산 대상)과 "개인 지출"(정산 제외,
--                            본인만 쓰는 비용 기록용)을 구분한다.
--
-- 정산(누가 얼마 냈고 누구에게 보내야 하는지)은 결제 완료 + 공동 지출 항목의
-- paid_by / split_user_ids 를 기반으로 클라이언트에서 계산한다(별도 테이블 불필요).
-- ============================================================

create table if not exists trip_expense_budgets (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips(id) on delete cascade,
  category   text not null,
  amount_krw bigint,                 -- 전체 인원 기준 예산(원). null이면 미설정
  updated_at timestamptz not null default now(),
  unique (trip_id, category)
);
create index if not exists trip_expense_budgets_trip_id_idx on trip_expense_budgets(trip_id);

create table if not exists trip_expenses (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references trips(id) on delete cascade,
  destination_id uuid references trip_destinations(id) on delete set null,
  category       text not null default 'ETC',
  title          text not null,
  amount         numeric not null,   -- 입력한 통화 그대로의 금액
  currency       text not null default 'KRW',
  amount_krw     bigint,             -- 저장 시점 환율로 환산한 원화(집계·차트용). KRW면 amount와 동일
  fx_rate        numeric,            -- 환산에 사용한 환율(1 currency = fx_rate KRW)
  fx_source      text,               -- 'live' | 'fallback' | 'unavailable' — 환산 신뢰도 표시용
  expense_date   date,               -- null이면 "날짜 미정" (계획 단계)
  is_paid        boolean not null default false, -- false=예정, true=결제 완료(정산 대상)
  split_mode     text not null default 'SHARED', -- 'SHARED'(공동, 정산 대상) | 'PERSONAL'(개인, 정산 제외)
  paid_by        uuid references auth.users(id) on delete set null,
  paid_by_name   text,               -- 표시용 스냅샷(멤버 탈퇴 후에도 기록 유지)
  paid_by_avatar text,
  split_user_ids uuid[],             -- 나눠 낼 멤버들. null이면 "전원"
  memo           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists trip_expenses_trip_id_idx on trip_expenses(trip_id);

-- 이미 이전 버전(split_mode 없이)으로 실행해둔 트립도 안전하게 따라오도록 보강
alter table if exists trip_expenses add column if not exists split_mode text not null default 'SHARED';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trip_expenses_category_chk') then
    alter table trip_expenses
      add constraint trip_expenses_category_chk
      check (category in ('FLIGHT','STAY','TRANSPORT','FOOD','ACTIVITY','SHOPPING','ETC'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trip_expenses_split_mode_chk') then
    alter table trip_expenses
      add constraint trip_expenses_split_mode_chk
      check (split_mode in ('SHARED','PERSONAL'));
  end if;
end $$;

-- ── RLS ──────────────────────────────────────────────────────
alter table trip_expense_budgets enable row level security;
alter table trip_expenses enable row level security;

drop policy if exists "trip_expense_budgets_member_all" on trip_expense_budgets;
create policy "trip_expense_budgets_member_all" on trip_expense_budgets
  for all
  using (exists (select 1 from trip_members m
                 where m.trip_id = trip_expense_budgets.trip_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_members m
                      where m.trip_id = trip_expense_budgets.trip_id and m.user_id = auth.uid()));

drop policy if exists "trip_expenses_member_all" on trip_expenses;
create policy "trip_expenses_member_all" on trip_expenses
  for all
  using (exists (select 1 from trip_members m
                 where m.trip_id = trip_expenses.trip_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_members m
                      where m.trip_id = trip_expenses.trip_id and m.user_id = auth.uid()));

-- ── 실시간 동기화 ──────────────────────────────────────────
--    같은 트립을 보는 다른 멤버 화면(휴대폰 포함)에도 즉시 반영되도록 publication에 추가.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'trip_expenses'
    ) then
      alter publication supabase_realtime add table trip_expenses;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'trip_expense_budgets'
    ) then
      alter publication supabase_realtime add table trip_expense_budgets;
    end if;
  end if;
end $$;
