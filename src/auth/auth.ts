// src/auth/auth.ts
import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import './auth.css';

/**
 * Google OAuth 로그인
 */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  });
  if (error) console.error('로그인 실패:', error.message);
}

/**
 * 로그아웃
 */
export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) console.error('로그아웃 실패:', error.message);
  store.set('user', null);
  navigate('login');
}

/**
 * 구글 로고 SVG (미니멀, 4색 그대로 유지)
 */
const GOOGLE_ICON = `
<svg class="login-btn-icon" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/>
  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
  <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.3 35.4 26.8 36 24 36c-5.3 0-9.6-3.1-11.3-7.6l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.3 5.3C40.5 36.6 44 30.9 44 24c0-1.3-.1-2.7-.4-3.5z"/>
</svg>`;

/**
 * 로그인 화면 렌더
 */
export function renderLogin(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="login-page">
      <div class="login-inner">
        <h1 class="login-title">생각에서 여정까지.</h1>
        <p class="login-subtitle">
          파편화된 아이디어를 하나의 완성된 동선으로.<br>
          친구들과 실시간으로 조율하는 가장 직관적인 여행 플래너.
        </p>
        <button class="login-btn" id="btn-google-login">
          ${GOOGLE_ICON}
          <span>Google 계정으로 계속하기</span>
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-google-login')!
    .addEventListener('click', signInWithGoogle);
}
