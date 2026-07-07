// src/auth/auth.ts
import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import './auth.css';

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) console.error('로그인 실패:', error.message);
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) console.error('로그아웃 실패:', error.message);
  store.set('user', null);
  navigate('login');
}

/* ── SVG 모음 ── */

const ICON_PLANE = `
<svg class="login-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M42 6L22 26"/>
  <path d="M42 6L28 42L22 26L6 20L42 6Z"/>
</svg>`;

const ICON_GOOGLE = `
<svg class="login-btn-icon" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/>
  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
  <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.3 35.4 26.8 36 24 36c-5.3 0-9.6-3.1-11.3-7.6l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.3 5.3C40.5 36.6 44 30.9 44 24c0-1.3-.1-2.7-.4-3.5z"/>
</svg>`;

const ICON_BULB = `
<svg class="slot-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M9 18h6M10 22h4"/>
  <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>
</svg>`;

const ICON_BOARD = `
<svg class="slot-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="7" height="9" rx="1.5"/>
  <rect x="14" y="3" width="7" height="5" rx="1.5"/>
  <rect x="14" y="12" width="7" height="9" rx="1.5"/>
  <rect x="3" y="16" width="7" height="5" rx="1.5"/>
</svg>`;

const ICON_MAP = `
<svg class="slot-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7z"/>
  <path d="M9 4v13M15 7v13"/>
</svg>`;

const ICON_SCROLL = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 5v14M5 12l7 7 7-7"/>
</svg>`;

function slotLine(count: number): string {
  return Array.from({ length: count }, () => '<div class="slot-line"></div>').join('');
}

export function renderLogin(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="login-page">

      <div class="cloud-layer">
        <div class="cloud cloud-a"></div>
        <div class="cloud cloud-b"></div>
        <div class="cloud cloud-c"></div>
        <div class="cloud cloud-d"></div>
        <div class="cloud cloud-e"></div>
      </div>

      <section class="login-hero">
        <div class="login-inner">

          <div class="seq seq-1">${ICON_PLANE}</div>

          <h1 class="login-title seq seq-2">생각에서 여정까지.</h1>

          <p class="login-subtitle seq seq-3">
            파편화된 아이디어를 하나의 완성된 동선으로.<br>
            친구들과 실시간으로 조율하는 가장 직관적인 여행 플래너.
          </p>

          <div class="slot-board seq seq-4">
            <div class="slot-card">
              ${ICON_BULB}
              <span class="slot-label">Ideas</span>
              <div class="slot-lines">${slotLine(3)}</div>
            </div>
            <div class="slot-connector">
              <div class="slot-dot"></div>
              <div class="slot-dot"></div>
              <div class="slot-dot"></div>
            </div>
            <div class="slot-card">
              ${ICON_BOARD}
              <span class="slot-label">Brainstorm</span>
              <div class="slot-lines">${slotLine(3)}</div>
            </div>
            <div class="slot-connector">
              <div class="slot-dot"></div>
              <div class="slot-dot"></div>
              <div class="slot-dot"></div>
            </div>
            <div class="slot-card">
              ${ICON_MAP}
              <span class="slot-label">Itinerary</span>
              <div class="slot-lines">${slotLine(3)}</div>
            </div>
          </div>

          <button class="login-btn seq seq-5" id="btn-google-login">
            ${ICON_GOOGLE}
            <span>Google 계정으로 계속하기</span>
          </button>

        </div>

        <div class="scroll-hint seq seq-5">
          <span>Scroll</span>
          ${ICON_SCROLL}
        </div>
      </section>

      <section class="login-footer" id="login-footer">
        <h2 class="login-footer-title">친구들과 함께 채워가는 보드</h2>
        <p class="login-footer-desc">
          가고 싶은 장소를 던지고, 함께 골라내고,<br>
          하나의 일정으로 완성하는 과정을 한 화면에서.
        </p>
        <div class="mockup">
          <div class="mockup-sidebar">
            <div class="mockup-slot is-active"></div>
            <div class="mockup-slot"></div>
            <div class="mockup-slot"></div>
          </div>
          <div class="mockup-main">
            <div class="mockup-col">
              <div class="mockup-col-label"></div>
              <div class="mockup-item"></div>
              <div class="mockup-item"></div>
            </div>
            <div class="mockup-col">
              <div class="mockup-col-label"></div>
              <div class="mockup-item"></div>
            </div>
            <div class="mockup-col">
              <div class="mockup-col-label"></div>
              <div class="mockup-item"></div>
              <div class="mockup-item"></div>
              <div class="mockup-item"></div>
            </div>
          </div>
        </div>
      </section>

    </div>
  `;

  document.getElementById('btn-google-login')!
    .addEventListener('click', signInWithGoogle);

  observeFooter();
}

function observeFooter(): void {
  const el = document.getElementById('login-footer');
  if (!el) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          el.classList.add('in-view');
          observer.unobserve(el);
        }
      });
    },
    { threshold: 0.15 },
  );

  observer.observe(el);
}
