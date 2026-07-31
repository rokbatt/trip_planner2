-- ============================================================
-- LINKS 게이트 — 채팅에 공유된 링크를 자동으로 모아 카테고리별로 정리하는 탭
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
--
-- 채팅 메시지에 링크(http/https)가 있으면, "보낸 사람"의 화면에서 그 메시지를
-- 딱 한 번만 이 테이블에 저장한다(여러 멤버가 동시에 채팅을 보고 있어도, 저장은
-- 받는 쪽이 아니라 보내는 쪽에서 1회만 하므로 중복 저장이 생기지 않는다). 저장할 때
-- 그 페이지의 og:title/og:image를 함께 가져와 제목/썸네일을 보여주고, 도메인·제목
-- 기반으로 STAY/PLACE/FOOD/ACTIVITY/VIDEO/ARTICLE/OTHER 중 하나로 자동 분류한다
-- (애매하면 OTHER — 화면에서 드래그로 직접 옮길 수 있다).
-- ============================================================

create table if not exists trip_links (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references trips(id) on delete cascade,
  chat_message_id uuid references chat_messages(id) on delete set null,
  url             text not null,
  message         text,          -- 링크가 포함된 채팅 메시지 원문(맥락 표시용)
  title           text,          -- 그 페이지의 og:title(없으면 <title>) — 없으면 화면에서 도메인으로 대체 표시
  image_url       text,          -- og:image를 우리 Storage로 재호스팅한 URL(원본이 만료/차단돼도 안전)
  site_name       text,          -- og:site_name(있을 때만) — 없으면 화면에서 도메인으로 대체 표시
  category        text not null default 'OTHER',
  added_by        uuid references auth.users(id) on delete set null,
  display_name    text,
  avatar_url      text,
  created_at      timestamptz not null default now()
);
create index if not exists trip_links_trip_id_idx on trip_links(trip_id);

-- 이미 이전 버전(카테고리/미리보기 컬럼 없이)으로 실행해둔 트립도 안전하게 따라오도록 보강
alter table if exists trip_links add column if not exists title        text;
alter table if exists trip_links add column if not exists image_url    text;
alter table if exists trip_links add column if not exists site_name    text;
alter table if exists trip_links add column if not exists category    text not null default 'OTHER';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trip_links_category_chk') then
    alter table trip_links
      add constraint trip_links_category_chk
      check (category in ('STAY','PLACE','FOOD','ACTIVITY','VIDEO','ARTICLE','OTHER'));
  end if;
end $$;

-- ── RLS ──────────────────────────────────────────────────────
alter table trip_links enable row level security;

drop policy if exists "trip_links_member_all" on trip_links;
create policy "trip_links_member_all" on trip_links
  for all
  using (exists (select 1 from trip_members m
                 where m.trip_id = trip_links.trip_id and m.user_id = auth.uid()))
  with check (exists (select 1 from trip_members m
                      where m.trip_id = trip_links.trip_id and m.user_id = auth.uid()));

-- ── 실시간 동기화 ──────────────────────────────────────────
--    같은 트립을 보고 있는 다른 멤버의 LINKS 탭에도 즉시 반영되도록(새 링크 + 카테고리
--    드래그 이동 둘 다) publication에 추가.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'trip_links'
    ) then
      alter publication supabase_realtime add table trip_links;
    end if;
  end if;
end $$;

-- ── 링크 미리보기 이미지 저장소 ──────────────────────────────
--    og:image를 이 공개 버킷으로 재호스팅한다(원본 사이트가 나중에 만료/차단해도 안전).
--    place-photos와 마찬가지로 공개 버킷이라 별도 RLS 없이 공개 URL로 바로 접근 가능하고,
--    업로드는 서버(서비스 롤 키, api/cache-photo.ts)만 하므로 클라이언트 쓰기 정책도 불필요.
insert into storage.buckets (id, name, public)
values ('link-previews', 'link-previews', true)
on conflict (id) do nothing;
