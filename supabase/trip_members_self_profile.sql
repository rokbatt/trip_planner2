-- ============================================================
-- trip_members: 멤버가 "자기 행의 표시 이름·프로필 사진"을 고칠 수 있게 허용
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
--
-- 왜 필요한가
--   여행을 만들면 DB 트리거가 만든 사람을 trip_members에 먼저 넣는데, 그 행에는 이름과
--   프로필 사진이 비어 있다. 앱은 트립에 들어갈 때 그 빈 칸을 구글 프로필로 채우려 하지만
--   (workspace.ts의 ensureOwnMemberProfile), 자기 행을 UPDATE할 수 있는 정책이 없으면
--   그 요청은 에러 없이 0행만 바뀌고 끝나서 헤더의 프로필이 계속 회색 "?"로 남는다.
--
-- 무엇을 허용하나
--   자기 행(user_id = 로그인한 사용자)의 display_name, avatar_url 두 칸만.
--   role·trip_id·user_id는 못 바꾼다 — 아래에서 UPDATE 권한을 그 두 칸으로 좁혀 두었기
--   때문에, 정책만으로는 막을 수 없는 "스스로 owner로 바꾸기" 같은 수정이 차단된다.
--   (앱에서 trip_members를 UPDATE하는 곳은 위 프로필 채우기 하나뿐이다)
-- ============================================================

drop policy if exists "trip_members_update_own_profile" on trip_members;
create policy "trip_members_update_own_profile" on trip_members
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke update on trip_members from authenticated;
grant update (display_name, avatar_url) on trip_members to authenticated;
