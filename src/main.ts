// src/main.ts
/**
 * main.ts — 앱 엔트리포인트
 */

import './styles/global.css';

import { supabase } from './supabase';
import { store } from './store';
import { addRoute, setNotFound, startRouter, navigate, rerender, currentPath } from './router';

import { renderLogin } from './auth/auth';
import { renderTripList } from './trips/trip-list';

const PUBLIC_ROUTES = ['login'];

// ─── 라우트 등록 ───
addRoute('login', () => {
  renderLogin();
});

addRoute('trips', async () => {
  const app = document.getElementById('app')!;
  const el = await renderTripList();
  app.replaceChildren(el);
});

addRoute('board', async (params) => {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div style="padding:48px;text-align:center;color:var(--text-secondary);">
      🧠 브레인스토밍 보드 — 다음 단계에서 구현 예정
      <br><small>tripId: ${params.tripId ?? '없음'}</small>
    </div>
  `;
});

setNotFound(() => {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div style="padding:48px;text-align:center;">
      <p style="font-size:48px;margin-bottom:12px;">🤔</p>
      <p style="color:var(--text-secondary);margin-bottom:20px;">페이지를 찾을 수 없어요</p>
      <button class="btn btn-primary" id="btn-go-home">홈으로</button>
    </div>
  `;
  document.getElementById('btn-go-home')!.addEventListener('click', () => navigate('trips'));
});

// ─── 라우트 가드: router.ts의 currentPath()를 그대로 사용 (판단 기준 이원화 방지) ───
const guardAndMaybeRender = (): boolean => {
  const path = currentPath();
  const isPublic = PUBLIC_ROUTES.includes(path);

  if (!store.get('authChecked')) {
    const app = document.getElementById('app')!;
    app.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100dvh;color:var(--text-tertiary);font-size:13px;">
        불러오는 중...
      </div>
    `;
    return false;
  }

  if (!isPublic && !store.get('user')) {
    navigate('login');
    return false;
  }

  if (path === 'login' && store.get('user')) {
    navigate('trips');
    return false;
  }

  return true;
};

// ─── 인증 상태 감지 ───
supabase.auth.onAuthStateChange((event, session) => {
  console.log('[Auth]', event, session?.user?.email ?? '(no user)');

  store.set('user', session?.user ?? null);
  store.set('authChecked', true);

  if (guardAndMaybeRender()) {
    rerender();
  }
});

// ─── 라우터 시작 ───
window.addEventListener('hashchange', () => {
  if (guardAndMaybeRender()) rerender();
});

if (guardAndMaybeRender()) {
  startRouter();
}

// ─── 안전장치: 5초 내로 세션 확인이 안 끝나면 강제로 로그인 화면 ───
setTimeout(() => {
  if (!store.get('authChecked')) {
    console.warn('[Auth] 세션 확인 타임아웃 — 로그인 화면으로 전환');
    store.set('authChecked', true);
    store.set('user', null);
    if (guardAndMaybeRender()) rerender();
  }
}, 5000);
