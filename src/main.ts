/**
 * main.ts — 앱 엔트리포인트
 */

import './styles/global.css';

import { supabase } from './supabase';
import { store } from './store';
import { addRoute, setNotFound, startRouter, navigate, rerender, currentPath } from './router';

import { renderLogin } from './auth/auth';
import { renderTripList } from './trips/trip-list';
import { renderJoinPage, consumePendingInvite } from './trips/trip-join';
import { renderWorkspace } from './workspace/workspace';

// ─── 인증이 필요 없는 라우트 ───
// join은 초대코드를 들고 온 비로그인 사용자도 접근해야 해서 public 처리
// (renderJoinPage 내부에서 로그인 여부를 직접 분기함)
const PUBLIC_ROUTES = ['login', 'join'];

// ─── 라우트 등록 ───
addRoute('login', () => {
  renderLogin();
});

addRoute('trips', async () => {
  const app = document.getElementById('app')!;
  const el = await renderTripList();
  app.replaceChildren(el);
});

// 새 워크스페이스 라우트: #trip/:tripId/:gate
addRoute('trip', async (params) => {
  const app = document.getElementById('app')!;
  const el = await renderWorkspace(params.tripId ?? '', params.subPath);
  app.replaceChildren(el);
});

// 초대 참여 라우트: #join/:inviteCode
addRoute('join', async (params) => {
  const app = document.getElementById('app')!;
  const el = await renderJoinPage(params.tripId);
  app.replaceChildren(el);
});

// 하위호환: 기존 #board/:tripId → #trip/:tripId/ideas 로 리다이렉트
addRoute('board', (params) => {
  navigate('trip/' + (params.tripId ?? '') + '/ideas');
});

setNotFound(() => {
  const app = document.getElementById('app')!;
  app.innerHTML = [
    '<div style="padding:48px;text-align:center;">',
    '  <p style="font-size:48px;margin-bottom:12px;">404</p>',
    '  <p style="color:#697586;margin-bottom:20px;">페이지를 찾을 수 없어요</p>',
    '  <button class="btn btn-primary" id="btn-go-home">홈으로</button>',
    '</div>',
  ].join('\n');
  document.getElementById('btn-go-home')!.addEventListener('click', () => navigate('trips'));
});

// ─── 라우트 가드 ───
const originalHandleRoute = () => {
  const path = currentPath();
  const isPublic = PUBLIC_ROUTES.includes(path);

  if (!store.get('authChecked')) {
    const app = document.getElementById('app')!;
    app.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:center;min-height:100dvh;color:#94A3B8;font-size:13px;">',
      '  불러오는 중...',
      '</div>',
    ].join('');
    return false;
  }

  if (!isPublic && !store.get('user')) {
    navigate('login');
    return false;
  }

  return true;
};

// ─── 인증 상태 감지 ───
supabase.auth.onAuthStateChange((event, session) => {
  console.log('[Auth]', event, session?.user?.email ?? '(no user)');

  store.set('user', session?.user ?? null);
  store.set('authChecked', true);

  // 로그인 직후, 초대 링크를 통해 들어왔던 거라면 그 초대 페이지로 되돌아감
  if (session?.user) {
    const pendingCode = consumePendingInvite();
    if (pendingCode) {
      navigate('join/' + pendingCode);
      return;
    }
  }

  if (originalHandleRoute()) {
    rerender();
  }
});

// ─── 라우터 시작 ───
window.addEventListener('hashchange', () => {
  if (originalHandleRoute()) rerender();
});

if (originalHandleRoute()) {
  startRouter();
}

// ─── 안전장치: 5초 타임아웃 ───
setTimeout(() => {
  if (!store.get('authChecked')) {
    console.warn('[Auth] 세션 확인 타임아웃');
    store.set('authChecked', true);
    store.set('user', null);
    if (originalHandleRoute()) rerender();
  }
}, 5000);
