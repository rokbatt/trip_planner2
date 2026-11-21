-- ============================================================
-- 날씨 알림 끄기 (push_subscriptions.weather)
--
-- 알림을 켠 기기마다 "날씨 알림도 받을지"를 저장하는 칸 하나를 더한다. 기본값은 켜짐(true)이라
-- 지금까지 알림을 켠 기기는 그대로 날씨를 받는다. 기존 줄을 지우거나 바꾸지 않는다.
-- 이 SQL을 안 돌려도 앱은 동작한다 - 메뉴의 날씨 알림 버튼만 "준비 중"으로 실패하고 날씨는 계속 간다.
--
-- 먼저 push_subscriptions.sql이 실행돼 있어야 한다. 한 줄에 한 구문이라 통째로 붙여넣고 Run 하면 된다.
-- 본인 줄 고치기(update) 정책은 push_subscriptions.sql에 이미 있어 새 정책은 필요 없다.
-- ============================================================

alter table push_subscriptions add column if not exists weather boolean not null default true;
