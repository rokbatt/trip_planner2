/**
 * main.ts — 앱 엔트리포인트
 *
 * 부팅 순서:
 * 1. 글로벌 CSS
 * 2. Supabase 클라이언트 (import 시 자동 생성)
 * 3. 모든 라우트 등록
 * 4. onAuthStateChange 등록 — 세션 상태가 바뀔 때마다 화면을 다시 그림
 * 5. 라우터 시작
 */

import './styles/global.css';

import { supabase } from './supabase';
import { store } from './store';
import { addRoute, setNotFound, startRouter, navigate, rerender } from './router';

import { renderLogin } from './auth/auth';
import { renderTripList } from './trips/trip-list';

// ─── 인증이 필요 없는 라우트 ───
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

// ─── 라우트 가드: 로그인 안 됐으면 보호된 라우트 접근 차단 ───
const originalHandleRoute = () => {
  const path = window.location.hash.replace(/^#\/?/, '').split('/')[0] || 'login';
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
// 핵심: createClient() 이후, 모든 함수가 정의된 뒤에 등록해야
// 새로고침 시 발생하는 INITIAL_SESSION 이벤트를 놓치지 않음
supabase.auth.onAuthStateChange((event, session) => {
  console.log('[Auth]', event, session?.user?.email ?? '(no user)');

  store.set('user', session?.user ?? null);
  store.set('authChecked', true);

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

// ─── 안전장치: 5초 내로 세션 확인이 안 끝나면 강제로 로그인 화면 ───
setTimeout(() => {
  if (!store.get('authChecked')) {
    console.warn('[Auth] 세션 확인 타임아웃 — 로그인 화면으로 전환');
    store.set('authChecked', true);
    store.set('user', null);
    if (originalHandleRoute()) rerender();
  }
}, 5000);
