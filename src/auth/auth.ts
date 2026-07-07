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

const GOOGLE_ICON = `
<svg class="login-btn-icon" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/>
  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
  <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.3 35.4 26.8 36 24 36c-5.3 0-9.6-3.1-11.3-7.6l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.3 5.3C40.5 36.6 44 30.9 44 24c0-1.3-.1-2.7-.4-3.5z"/>
</svg>`;

const SCROLL_ICON = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
  <path d="M12 5v14M5 12l7 7 7-7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/** 좌측 카드 슬롯 + 우측 실시간 보드 구조를 얇은 선으로만 그린 목업 */
function mockupMarkup(): string {
  return `
    <div class="mockup">
      <div class="mockup-panel">
        <div class="mockup-card-list">
          <div class="mockup-card is-accent"></div>
          <div class="mockup-card"></div>
          <div class="mockup-card"></div>
          <div class="mockup-card"></div>
        </div>
      </div>
      <div class="mockup-panel">
        <div class="mockup-board">
          <div class="mockup-board-col">
            <div class="mockup-board-label"></div>
            <div class="mockup-board-item"></div>
            <div class="mockup-board-item"></div>
          </div>
          <div class="mockup-board-col">
            <div class="mockup-board-label"></div>
            <div class="mockup-board-item"></div>
          </div>
          <div class="mockup-board-col">
            <div class="mockup-board-label"></div>
            <div class="mockup-board-item"></div>
            <div class="mockup-board-item"></div>
            <div class="mockup-board-item"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * 로그인 화면 렌더
 */
export function renderLogin(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="login-page">
      <div class="login-blob login-blob-top"></div>
      <div class="login-blob login-blob-bottom"></div>

      <section class="login-hero">
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
        <div class="login-scroll-hint">
          <span>더 알아보기</span>
          ${SCROLL_ICON}
        </div>
      </section>

      <section class="login-preview" id="login-preview">
        <h2 class="login-preview-title">친구들과 함께 채워가는 보드</h2>
        ${mockupMarkup()}
      </section>
    </div>
  `;

  document.getElementById('btn-google-login')!
    .addEventListener('click', signInWithGoogle);

  observePreviewFadeIn();
}

/** 스크롤로 하단 목업 섹션이 뷰포트에 들어오면 페이드인 */
function observePreviewFadeIn(): void {
  const target = document.getElementById('login-preview');
  if (!target) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          target.classList.add('in-view');
          observer.unobserve(target);
        }
      });
    },
    { threshold: 0.2 }
  );

  observer.observe(target);
}
