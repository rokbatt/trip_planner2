import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import './auth.css';

/**
 * 인증 초기화 — main.ts에서 최초 1회 호출
 *
 * 중요: createClient() 이후, 다른 모든 모듈 정의 이후에 호출해야
 * INITIAL_SESSION 이벤트를 안전하게 처리할 수 있음
 */
export function initAuth(): void {
  supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null;
    store.set('user', user);
    store.set('loading', false);

    if (event === 'SIGNED_IN') {
      // 로그인 직후 여행 목록으로
      navigate('trips');
    }

    if (event === 'SIGNED_OUT') {
      // 로그아웃 시 로그인 화면으로
      navigate('');
    }
  });
}

/**
 * Google OAuth 로그인
 */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname,
    },
  });
  if (error) {
    console.error('로그인 실패:', error.message);
  }
}

/**
 * 로그아웃
 */
export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('로그아웃 실패:', error.message);
  }
}

/**
 * 로그인 화면 렌더
 */
export function renderLogin(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <h1 class="login-title">몽실이</h1>
        <p class="login-subtitle">같이 떠나자 ✈️</p>
        <p class="login-desc">
          즉흥적인 여행 계획을 친구들과 함께.<br>
          아이디어를 던지고, 브레인스토밍하고, 일정으로 만들어보세요.
        </p>
        <button class="btn btn-primary login-btn" id="btn-google-login">
          Google로 시작하기
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-google-login')!
    .addEventListener('click', signInWithGoogle);
}
