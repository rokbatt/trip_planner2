import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import './auth.css';

/* ── 인증 ── */
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

/* ── SVG ── */
const ICON_PLANE = `<svg class="lp-hero-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M42 6L22 26"/><path d="M42 6L28 42L22 26L6 20L42 6Z"/></svg>`;
const ICON_GOOGLE = `<svg class="lp-hero-btn-icon" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.3 35.4 26.8 36 24 36c-5.3 0-9.6-3.1-11.3-7.6l-6.5 5C9.6 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.3 5.3C40.5 36.6 44 30.9 44 24c0-1.3-.1-2.7-.4-3.5z"/></svg>`;
const ICON_GOOGLE_D = ICON_GOOGLE.replace('lp-hero-btn-icon', 'lp-cta-band-btn-icon');
const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
const ICON_BULB = `<svg class="flow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>`;
const ICON_BOARD = `<svg class="flow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`;
const ICON_MAP = `<svg class="flow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7z"/><path d="M9 4v13M15 7v13"/></svg>`;
const ICON_USERS = `<svg class="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
const ICON_ZAP = `<svg class="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`;
const ICON_SPARK = `<svg class="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>`;

/* ── 렌더 ── */
export function renderLogin(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="login-page">

      <nav class="lp-nav" id="lp-nav">
        <div class="lp-nav-logo">몽실이</div>
        <button class="lp-nav-cta" id="nav-login">시작하기</button>
      </nav>

      <!-- 고정 히어로 -->
      <section class="lp-hero" id="lp-hero">
        <div class="lp-hero-inner">
          ${ICON_PLANE}
          <p class="lp-eyebrow">즉흥 여행자를 위한 실시간 협업 플래너</p>
          <h1 class="lp-title">생각에서<br>여정까지.</h1>
          <p class="lp-subtitle">
            파편화된 아이디어를 하나의 완성된 동선으로.<br>
            친구들과 실시간으로 조율하는 가장 직관적인 여행 플래너.
          </p>
          <button class="lp-hero-btn" id="hero-login">
            ${ICON_GOOGLE}<span>Google 계정으로 시작하기</span>
          </button>
          <p class="lp-hero-note">가입 30초 · 신용카드 필요 없음</p>
        </div>
        <div class="lp-hero-scroll">${CHEVRON}</div>
      </section>

      <!-- 스크롤 오버레이 패널 -->
      <div class="lp-scroll">

        <section class="lp-section bg-white">
          <div class="lp-section-inner">
            <div class="reveal" style="text-align:center;margin-bottom:48px;">
              <p class="lp-sec-eyebrow">HOW IT WORKS</p>
              <h2 class="lp-sec-title" style="margin-bottom:0;">아이디어가 여정이 되기까지</h2>
            </div>
            <div class="lp-flow reveal">
              <div class="flow-card">
                <div class="flow-step">STEP 1</div>${ICON_BULB}
                <div class="flow-card-title">아이디어를 던져요</div>
                <div class="flow-card-desc">가고 싶은 곳을 자유롭게 쌓아두세요.</div>
                <div class="flow-chips">
                  <div class="flow-chip">🍜 방콕 로컬 맛집</div>
                  <div class="flow-chip">🏯 아사쿠사 절 구경</div>
                </div>
              </div>
              <div class="flow-arrow">${ARROW}</div>
              <div class="flow-card">
                <div class="flow-step">STEP 2</div>${ICON_BOARD}
                <div class="flow-card-title">함께 골라내요</div>
                <div class="flow-card-desc">하트와 투표로 자연스럽게 합의해요.</div>
                <div class="flow-chips">
                  <div class="flow-chip">❤️ 3명이 가고싶어요</div>
                  <div class="flow-chip">💬 여기 야경 좋대!</div>
                </div>
              </div>
              <div class="flow-arrow">${ARROW}</div>
              <div class="flow-card">
                <div class="flow-step">STEP 3</div>${ICON_MAP}
                <div class="flow-card-title">일정으로 완성돼요</div>
                <div class="flow-card-desc">확정한 장소가 동선이 되어 정리됩니다.</div>
                <div class="flow-chips">
                  <div class="flow-chip">📍 Day 1 · 시부야</div>
                  <div class="flow-chip">🕒 이동 12분</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="lp-section bg-light">
          <div class="lp-section-inner">
            <div class="lp-split reveal">
              <div class="lp-split-text">
                <p class="lp-sec-eyebrow">REAL-TIME</p>
                <h2 class="lp-sec-title">떨어져 있어도<br>같은 화면에서.</h2>
                <p class="lp-sec-desc">
                  누가 무엇을 추가했는지 실시간으로 보이고, 채팅으로
                  바로 의견을 나눠요. 흩어지던 여행 이야기를 한곳에 모읍니다.
                </p>
              </div>
              <div class="lp-split-demo">
                <div class="demo-chat">
                  <div class="chat-bubble them">현지인 오코노미야키 맛집 찾음 🔥 보드에 올렸어</div>
                  <div class="chat-bubble me">오 봤어! AI 팁 보니까 18:30부터 웨이팅 피크라는데?</div>
                  <div class="chat-bubble them">아 진짜? 그럼 오픈런으로 동선 최신화할게</div>
                  <div class="chat-bubble me">인당 2.2만이면 가성비도 OK. Day 2 저녁 확정! 📍</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="lp-section bg-white">
          <div class="lp-section-inner">
            <div class="lp-split reverse reveal">
              <div class="lp-split-text">
                <p class="lp-sec-eyebrow">BRAINSTORM BOARD</p>
                <h2 class="lp-sec-title">친구들과<br>함께 채워가는 보드</h2>
                <p class="lp-sec-desc">
                  가고싶어 · 먹고싶어 · 하고싶어. 무드별로 카드를 쌓고
                  드래그로 옮기며, 정해지지 않은 상태에서 가장 많은 도움을 얻어보세요.
                </p>
              </div>
              <div class="lp-split-demo">
                <div class="demo-board">
                  <div class="demo-sidebar">
                    <div class="demo-slot is-active"></div>
                    <div class="demo-slot"></div>
                    <div class="demo-slot"></div>
                  </div>
                  <div class="demo-main">
                    ${demoCol(2, true)}${demoCol(1, false)}${demoCol(3, false)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="lp-section bg-light">
          <div class="lp-section-inner">
            <div class="lp-split reveal">
              <div class="lp-split-text">
                <p class="lp-sec-eyebrow">MAP & ITINERARY</p>
                <h2 class="lp-sec-title">확정하면<br>바로 동선이 돼요.</h2>
                <p class="lp-sec-desc">
                  장소를 확정하는 순간 지도 위 동선과 이동 시간까지
                  자동으로 정리됩니다. 복잡한 계산은 몽실이가 대신할게요.
                </p>
              </div>
              <div class="lp-split-demo">
                <div class="media-box wide">여기에 지도·일정 스크린샷</div>
              </div>
            </div>
          </div>
        </section>

        <section class="lp-section bg-white">
          <div class="lp-section-inner">
            <div class="reveal" style="text-align:center;">
              <p class="lp-sec-eyebrow">WHY 몽실이</p>
              <h2 class="lp-sec-title" style="margin-bottom:0;">여행 준비, 이렇게 달라져요</h2>
            </div>
            <div class="lp-features reveal">
              <div class="feature-card">${ICON_USERS}
                <div class="feature-title">실시간 협업</div>
                <div class="feature-desc">모두가 동시에 편집하고, 변경사항이 즉시 반영돼요.</div>
              </div>
              <div class="feature-card">${ICON_ZAP}
                <div class="feature-title">즉흥에 최적화</div>
                <div class="feature-desc">딱딱한 일정표 대신, 아이디어를 먼저 자유롭게 던져요.</div>
              </div>
              <div class="feature-card">${ICON_SPARK}
                <div class="feature-title">AI 여행 꿀팁</div>
                <div class="feature-desc">방문 타이밍부터 현지 꿀팁까지 장소마다 알려드려요.</div>
              </div>
            </div>
          </div>
        </section>

        <section class="lp-section bg-navy lp-cta-band">
          <h2 class="lp-cta-band-title">이제, 같이 떠날<br>차례예요.</h2>
          <p class="lp-cta-band-desc">친구들을 초대하고 첫 여행 보드를 만들어보세요.</p>
          <button class="lp-cta-band-btn" id="band-login">
            ${ICON_GOOGLE_D}<span>Google 계정으로 시작하기</span>
          </button>
        </section>

        <footer class="lp-footer">
          <div class="lp-footer-inner">
            <div class="lp-footer-top">
              <div class="lp-footer-brand">몽실이</div>
              <div class="lp-footer-links">
                <a href="#" class="strong">서비스 소개</a>
                <a href="#">이용약관</a>
                <a href="#" class="strong">개인정보 처리방침</a>
                <a href="#">위치정보 이용약관</a>
                <a href="#">고객센터</a>
              </div>
            </div>
            <div class="lp-footer-biz">
              몽실이 (Mongsil) · 대표 OOO<br>
              사업자등록번호 000-00-00000 · 통신판매업신고 제0000-지역-0000호<br>
              주소 : 서울특별시 OO구 OO로 000, 0층 · 이메일 : help@mongsil.app<br>
              고객센터 : 000-0000-0000 (평일 10:00–18:00)
            </div>
            <div class="lp-footer-copy">
              © ${new Date().getFullYear()} Mongsil. All rights reserved.
            </div>
          </div>
        </footer>

      </div>
    </div>
  `;

  document.getElementById('nav-login')!.addEventListener('click', signInWithGoogle);
  document.getElementById('hero-login')!.addEventListener('click', signInWithGoogle);
  document.getElementById('band-login')!.addEventListener('click', signInWithGoogle);

  setupScrollEffects();
  observeReveals();
}

/* 보드 데모 컬럼 */
function demoCol(itemCount: number, accent: boolean): string {
  const items = Array.from({ length: itemCount }, (_, i) => `
    <div class="demo-item ${accent && i === 0 ? 'accent' : ''}">
      <div class="demo-item-line"></div>
      <div class="demo-item-line short"></div>
    </div>`).join('');
  return `<div class="demo-col"><div class="demo-col-head"></div>${items}</div>`;
}

/* 스크롤 시 네비 배경 전환 + 가려진 히어로 inert 처리 */
function setupScrollEffects(): void {
  const nav = document.getElementById('lp-nav');
  const hero = document.getElementById('lp-hero');
  if (!nav) return;

  const onScroll = () => {
    if (window.scrollY > window.innerHeight * 0.7) nav.classList.add('solid');
    else nav.classList.remove('solid');

    // 패널이 히어로를 완전히 덮으면 키보드 포커스에서 제외
    if (hero) hero.inert = window.scrollY > window.innerHeight;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* 스크롤 등장 애니메이션 */
function observeReveals(): void {
  const els = document.querySelectorAll<HTMLElement>('.reveal');
  if (!els.length) return;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 },
  );
  els.forEach((el) => observer.observe(el));
}
