import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
// 메인페이지 서체(원티드 산스). 글자 범위별로 쪼갠 파일이라 화면에 나온 글자의 조각만 내려받는다
import 'wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.css';
import './auth.css';
import './landing-shots.css';
import { boardShotHtml, chatShotHtml, expenseShotHtml, routeShotHtml, stayShotHtml, timelineShotHtml } from './landingShots';
import { escapeHtml } from '../utils/html';

/* ── 인증 ── */
export async function signInWithGoogle(): Promise<void> {
  // 가입 동의가 먼저다 — 구글 로그인으로 넘어가는 순간 계정이 만들어지기 때문이다.
  // 랜딩의 버튼 3곳과 초대 페이지(trip-join.ts)가 전부 이 함수를 거치므로 여기 한 곳에서 막는다.
  // 동의 창은 로그인 때만 필요해서 별도 청크로 불러온다.
  const { ensureConsentBeforeLogin } = await import('../account/consent');
  if (!(await ensureConsentBeforeLogin())) return;

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
const ICON_PLANE = `<svg class="lp-hero-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><path d="M2 12L22 5L15 22L11 14L2 12Z"/><path d="M11 14L22 5"/></svg>`;
const ICON_GOOGLE = `<svg class="lp-hero-btn-icon" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.3 35.4 26.8 36 24 36c-5.3 0-9.6-3.1-11.3-7.6l-6.5 5C9.6 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.3 5.3C40.5 36.6 44 30.9 44 24c0-1.3-.1-2.7-.4-3.5z"/></svg>`;
const ICON_GOOGLE_D = ICON_GOOGLE.replace('lp-hero-btn-icon', 'lp-cta-band-btn-icon');
const CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter"><path d="M5 8L12 15L19 8"/></svg>`;

/** 보딩패스 가운데 비행기 — 히어로 로고와 같은 형태를 조금 크게 */
const ICON_PLANE_PASS = `<svg class="lp-pass-plane" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="square" stroke-linejoin="miter"><path d="M2 12L22 5L15 22L11 14L2 12Z"/><path d="M11 14L22 5"/></svg>`;

const DI = {
  trip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><rect x="3" y="5" width="18" height="16"/><path d="M3 10H21M8 3V7M16 3V7"/></svg>`,
  setting: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><rect x="4" y="4" width="16" height="16"/><path d="M9 4V20M4 9H20"/></svg>`,
  help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5C9.5 8 10.5 7 12 7C13.5 7 14.5 8 14.5 9.5C14.5 11 12 11 12 13"/><circle cx="12" cy="16.5" r="0.5"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter"><rect x="3" y="4" width="10" height="16"/><path d="M21 12H9M17 8L21 12L17 16"/></svg>`,
};

/* ── 유저 정보 ── */
function getUserInfo() {
  const user = store.get('user');
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  return {
    name: meta.full_name ?? meta.name ?? user.email?.split('@')[0] ?? '사용자',
    avatar: meta.avatar_url ?? meta.picture ?? '',
    email: user.email ?? '',
  };
}


/* ── 네비 우측 영역 ── */
function navRightHtml(): string {
  const info = getUserInfo();
  if (info) {
    const avatarInner = info.avatar
      ? `<img src="${info.avatar}" alt="" referrerpolicy="no-referrer" />`
      : escapeHtml(info.name.charAt(0));
    return `
      <div class="lp-nav-profile">
        <button class="lp-nav-dashboard" id="nav-dashboard">내 여행 보기</button>
        <button class="lp-nav-avatar-btn" id="nav-avatar">${avatarInner}</button>
        <div class="lp-dropdown" id="nav-dropdown">
          <div class="lp-dropdown-header">
            <div class="lp-dropdown-name">${escapeHtml(info.name)}</div>
            <div class="lp-dropdown-email">${escapeHtml(info.email)}</div>
          </div>
          <button class="lp-dropdown-item" id="dd-trips">${DI.trip}<span>내 여행</span></button>
          <button class="lp-dropdown-item" id="dd-settings">${DI.setting}<span>설정</span></button>
          <button class="lp-dropdown-item" id="dd-help">${DI.help}<span>문의하기</span></button>
          <div class="lp-dropdown-divider"></div>
          <button class="lp-dropdown-item logout" id="dd-logout">${DI.logout}<span>로그아웃</span></button>
        </div>
      </div>`;
  }
  return `<button class="lp-nav-cta" id="nav-login">시작하기</button>`;
}

function heroBtnHtml(): string {
  if (getUserInfo()) {
    return `<button class="lp-hero-btn" id="hero-dashboard"><span>내 여행 보러 가기</span></button>`;
  }
  return `<button class="lp-hero-btn" id="hero-login">${ICON_GOOGLE}<span>Google 계정으로 시작하기</span></button>`;
}

function heroNoteHtml(): string {
  const info = getUserInfo();
  if (info) return `<p class="lp-hero-note">WELCOME, ${escapeHtml(info.name).toUpperCase()}</p>`;
  return `<p class="lp-hero-note">GATE OPEN · NO CARD REQUIRED</p>`;
}

function ctaBandBtnHtml(): string {
  if (getUserInfo()) {
    return `<button class="lp-cta-band-btn" id="band-dashboard"><span>여행 보드 만들기</span></button>`;
  }
  return `<button class="lp-cta-band-btn" id="band-login">${ICON_GOOGLE_D}<span>Google 계정으로 시작하기</span></button>`;
}

/* ── 렌더 ── */
export function renderLogin(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="login-page">

      <nav class="lp-nav" id="lp-nav">
        <div class="lp-nav-logo"><img src="/favicon.svg" alt="" width="26" height="26" />몽실이</div>
        ${navRightHtml()}
      </nav>

      <section class="lp-hero" id="lp-hero">
        <div class="lp-hero-inner">
          ${ICON_PLANE}
          <p class="lp-eyebrow">ICN · DEPARTURE LOUNGE</p>
          <!-- 헤드라인 후보(톤이 갈리는 부분이라 남겨 둠):
               B) 단톡방에 흩어진 여행을 / 한 장의 시각표로.  ← 문제→해결이 가장 잘 보임
               C) 아직 아무것도 / 안 정했어도 괜찮아요.        ← 타겟 정서에 가장 가까움 -->
          <h1 class="lp-title">여행은 정하는 게 아니라<br>좁혀가는 거니까.</h1>
          <p class="lp-subtitle">
            가고 싶은 곳을 쌓고 → 숙소를 정하고 → 동선을 잇고 →<br>
            여행 중엔 오늘 할 일만. 친구들과 같은 화면에서.
          </p>
          ${heroBtnHtml()}
          ${heroNoteHtml()}
        </div>
        <div class="lp-hero-scroll">${CHEVRON}</div>
      </section>

      <div class="lp-scroll">

        <section class="lp-section bg-white">
          <div class="lp-section-inner">
            <div class="lp-split reveal">
              <div class="lp-split-text">
                <p class="lp-sec-eyebrow">THE PROBLEM</p>
                <h2 class="lp-sec-title">여행 이야기는 단톡방에서 시작해서,<br>단톡방에서 사라져요.</h2>
                <p class="lp-sec-desc">
                  링크를 던지고, 좋다고 하고, 그러고 끝. 이틀 뒤엔 아무도 그게
                  어디였는지 못 찾습니다. 결국 누군가 혼자 엑셀을 만들다 맙니다.
                </p>
              </div>
              <div class="lp-split-demo">
                <div class="lp-kakao">
                  <div class="lp-kakao-head">10월 방콕 ✈︎ · 3</div>
                  <div class="lp-kakao-msg"><span class="lp-kakao-who">민수</span><span class="lp-kakao-bubble">여기 루프탑 미쳤대</span></div>
                  <div class="lp-kakao-msg"><span class="lp-kakao-who"></span><span class="lp-kakao-bubble is-link">m.blog.naver.com/…</span></div>
                  <div class="lp-kakao-msg"><span class="lp-kakao-who">지현</span><span class="lp-kakao-bubble">오 저장</span></div>
                  <div class="lp-kakao-gap">메시지 214개</div>
                  <div class="lp-kakao-msg"><span class="lp-kakao-who">태호</span><span class="lp-kakao-bubble is-lost">아까 그 루프탑 어디였지?</span></div>
                  <div class="lp-kakao-msg"><span class="lp-kakao-who">민수</span><span class="lp-kakao-bubble is-lost">스크롤 내려봐…</span></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="lp-proof">
          <div class="lp-proof-inner reveal">
            <div>
              <p class="lp-proof-label"><i></i>REAL TRIP LOG</p>
              <h2 class="lp-proof-title">그래서 이번 방콕 여행은,<br>처음부터 끝까지 몽실이로 짰어요.</h2>
              <p class="lp-proof-trip">
                <b>ICN → BKK · 10.26 – 10.30 · 4박 5일 · 3명</b><br>
                이 아래 화면은 전부 그 여행의 실제 기록이에요. 동행자 이름과 사진만 지웠어요.
              </p>
            </div>
            <div class="lp-proof-stats">
              <div class="lp-stat" style="--c:#E24B4A"><b>11<small>곳</small></b><span>가장 바빴던 DAY 2의 일정</span></div>
              <div class="lp-stat" style="--c:#2F80ED"><b>2<small>시간</small> 43<small>분</small></b><span>그날 이동에 쓴 시간</span></div>
              <div class="lp-stat" style="--c:#D97706"><b>590<small>THB</small></b><span>그날 예상 교통비</span></div>
              <div class="lp-stat" style="--c:#16A34A"><b>0<small>건</small></b><span>여행이 끝나고 남은 정산</span></div>
            </div>
          </div>
        </section>

        <section class="lp-section bg-light">
          <div class="lp-section-inner">
            <div class="reveal" style="text-align:center;margin-bottom:48px;">
              <p class="lp-sec-eyebrow">HOW IT WORKS</p>
              <h2 class="lp-sec-title" style="margin-bottom:14px;">네 개의 게이트를 지나면<br>여행이 완성돼요.</h2>
              <p class="lp-sec-desc" style="margin:0 auto;">한 번에 다 정하지 않아요. 게이트마다 딱 하나씩만 정합니다.</p>
            </div>
            <div class="lp-gates reveal">
              <div class="lp-gates-head">
                <span>GATE</span><span>STAGE</span><span>여기서 정하는 것</span><span class="lp-gates-verb">ACTION</span>
              </div>
              <div class="lp-gate-row" style="--acc:#E24B4A">
                <span class="lp-gate-code">GATE 01</span>
                <span class="lp-gate-name">IDEAS<small>Departure Hall</small></span>
                <span class="lp-gate-desc">가고 싶은 곳을 판단 없이 모아요.</span>
                <span class="lp-gates-verb lp-gate-verb">던지기</span>
              </div>
              <div class="lp-gate-row" style="--acc:#12A594">
                <span class="lp-gate-code">GATE 02</span>
                <span class="lp-gate-name">STAY<small>Immigration Counter</small></span>
                <span class="lp-gate-desc">생활권과 숙소 하나. 여행의 중심이 정해져요.</span>
                <span class="lp-gates-verb lp-gate-verb">좁히기</span>
              </div>
              <div class="lp-gate-row" style="--acc:#2F5FD0">
                <span class="lp-gate-code">GATE 03</span>
                <span class="lp-gate-name">ROUTE<small>Boarding Pass</small></span>
                <span class="lp-gate-desc">숙소 기준으로 갈 만한 곳만 남겨 이어요.</span>
                <span class="lp-gates-verb lp-gate-verb">잇기</span>
              </div>
              <div class="lp-gate-row" style="--acc:#D97706">
                <span class="lp-gate-code">GATE 04</span>
                <span class="lp-gate-name">TIMELINE<small>Flight Schedule</small></span>
                <span class="lp-gate-desc">동선이 시각표가 돼요. 이동 시간까지.</span>
                <span class="lp-gates-verb lp-gate-verb">떠나기</span>
              </div>
            </div>
          </div>
        </section>

        <section class="lp-section lp-tint" style="--acc:#E24B4A">
          <div class="lp-section-inner">
            <div class="lp-split reveal">
              <div class="lp-split-text">
                <p class="lp-gate-chip"><i></i>GATE 01 · IDEAS</p>
                <h2 class="lp-sec-title">단톡방에 던진 링크가,<br>보드 위 카드가 됩니다.</h2>
                <p class="lp-sec-desc">
                  채팅에 링크를 붙이면 미리보기를 불러와 숙소 · 맛집 · 액티비티로
                  분류해 보드에 꽂아요. 누가 무엇을 올렸는지 모두에게 실시간으로 보입니다.
                </p>
              </div>
              <div class="lp-split-demo ls-stage">
                ${chatShotHtml()}
                <span class="ls-callout" style="left:-6%;bottom:14%">숙소 링크도, 블로그 링크도<br>보낸 순서 그대로 쌓여요</span>
              </div>
            </div>
            <div class="lp-split reverse reveal lp-split-next">
              <div class="lp-split-text">
                <h2 class="lp-sec-title">친구들과<br>함께 채워가는 보드</h2>
                <p class="lp-sec-desc">
                  가고싶어 · 먹고싶어 · 하고싶어. 무드별로 카드를 쌓고 드래그로 옮겨요.
                  아직 아무것도 안 정해진 상태가 가장 자유로운 순간이니까요.
                </p>
              </div>
              <div class="lp-split-demo">
                ${boardShotHtml()}
              </div>
            </div>
          </div>
        </section>

        <section class="lp-section bg-white" style="--acc:#12A594">
          <div class="lp-section-inner is-wide">
            <div class="lp-wide-head reveal">
              <div>
                <p class="lp-gate-chip"><i></i>GATE 02 · STAY</p>
                <h2 class="lp-sec-title">숙소를 정하면,<br>여행의 절반이 정해져요.</h2>
              </div>
              <div>
                <p class="lp-sec-desc">
                  어디 묵느냐가 하루의 동선을 결정합니다. 그래서 몽실이는 장소부터
                  늘어놓지 않아요. <strong>생활권 → 숙소 → 그 숙소에서 갈 만한 곳</strong>
                  순서로 좁혀갑니다.
                </p>
                <p class="lp-honest">
                  점수는 위치 · 주변 시설 · 평점을 바탕으로 <strong>AI가 분석한 값</strong>이고,
                  예약 사이트의 이용자 평점이 아니에요. 화면에도 그렇게 적습니다.
                </p>
              </div>
            </div>
            <div class="ls-stage reveal">
              ${stayShotHtml()}
              <span class="ls-callout" style="left:4%;bottom:-22px">편의점 1분, 약국 1분, ATM 1분 — 숙소 앞이 어떤지 먼저 보여요</span>
              <span class="ls-callout is-light" style="right:4%;top:-24px">담아 둔 장소까지 평균 20분 — 숙소끼리 숫자로 비교돼요</span>
            </div>
          </div>
        </section>

        <section class="lp-section lp-tint" style="--acc:#2F5FD0">
          <div class="lp-section-inner is-wide">
            <div class="lp-wide-head reveal">
              <div>
                <p class="lp-gate-chip"><i></i>GATE 03 · ROUTE</p>
                <h2 class="lp-sec-title">담아 둔 곳을 고르면,<br>지도 위에 하루가 그려져요.</h2>
              </div>
              <p class="lp-sec-desc">
                왕궁에서 왓 프라깨우까지 도보 4분, 왓 포에서 식당까지 대중교통 12분.
                구간마다 이동 수단 · 시간 · 요금이 붙어요. 짐만 맡기고 지나가는 숙소도
                하루 동선 안에 넣을 수 있어요.
              </p>
            </div>
            <div class="ls-stage reveal">
              ${routeShotHtml()}
              <span class="ls-callout" style="right:4%;top:-24px">공항 숙소 → 짐 맡기고 → 왕궁. 들르는 곳도 동선이 돼요</span>
              <span class="ls-callout is-light" style="left:4%;bottom:-22px">보드에 담은 장소에서 골라 담기만 하면 끝</span>
            </div>
          </div>
        </section>

        <section class="lp-section bg-white" style="--acc:#D97706">
          <div class="lp-section-inner is-wide">
            <div class="lp-wide-head reveal">
              <div>
                <p class="lp-gate-chip"><i></i>GATE 04 · TIMELINE</p>
                <h2 class="lp-sec-title">“43분”이라고 쓰여 있으면,<br>진짜 43분이에요.</h2>
              </div>
              <p class="lp-sec-desc">
                장소를 확정하면 지도 위 동선과 이동 시간이 시각표로 정리됩니다.
                실측 데이터가 있으면 실측을, 없으면 <strong>“추정”이라고 적어요.</strong>
                그래야 그 숫자를 믿고 일정을 짤 수 있으니까요.
              </p>
            </div>
            <div class="ls-stage reveal">
              ${timelineShotHtml()}
              <span class="ls-callout" style="right:4%;top:-24px">가장 오래 걸리는 구간을 먼저 짚어 줘요</span>
              <span class="ls-callout is-light" style="left:4%;bottom:-22px">운영 시간 · 예상 체류 · 도착 예정까지 한 줄에</span>
            </div>
          </div>
        </section>

        <section class="lp-section bg-night">
          <div class="lp-section-inner">
            <div class="lp-split reveal">
              <div class="lp-split-text">
                <p class="lp-sec-eyebrow">COMPANION · 여행 중</p>
                <h2 class="lp-sec-title">떠난 뒤엔,<br>오늘 한 곳만.</h2>
                <p class="lp-sec-desc">
                  여행 중에 계획 전체는 필요 없어요. 다음 갈 곳 하나와 남은 시간이면 충분합니다.
                  도착을 누르면 남은 일정이 알아서 밀려요. 아무도 다시 계산하지 않아도 됩니다.
                </p>
              </div>
              <div class="lp-split-demo">
                <div class="lp-phone">
                  <div class="lp-phone-top"><span>DAY 2 · 방콕</span><span>13:47</span></div>
                  <p class="lp-now-label">NOW — 다음 목적지</p>
                  <p class="lp-now-place">왓 포</p>
                  <p class="lp-now-meta">도보 9분 · 13:56 도착 예정</p>
                  <div class="lp-now-actions">
                    <span class="lp-now-btn is-primary">도착</span>
                    <span class="lp-now-btn">출발</span>
                    <span class="lp-now-btn">밀기</span>
                  </div>
                  <p class="lp-now-after">지금 속도면 오늘 마지막 일정 <strong>21:13 마무리</strong></p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="lp-section lp-tint" style="--acc:#16A34A">
          <div class="lp-section-inner is-wide">
            <div class="lp-wide-head reveal">
              <div>
                <p class="lp-gate-chip"><i></i>EXPENSE</p>
                <h2 class="lp-sec-title">“내가 더 냈나?”로<br>끝나지 않게.</h2>
              </div>
              <p class="lp-sec-desc">
                예산을 잡고, 현지에서 바로 기록하고, 마지막엔 누가 누구에게 얼마를 보내면
                되는지 한 줄로 정리해요. 바트로 낸 돈도 기록하는 시점의 환율로 원화 환산해 두고,
                어떤 환율을 썼는지까지 같이 적습니다.
              </p>
            </div>
            <div class="ls-stage reveal">
              ${expenseShotHtml()}
              <span class="ls-callout" style="right:4%;top:-24px">정산 대기 0건 — 여행이 끝나면 정산도 끝</span>
              <span class="ls-callout is-light" style="left:4%;bottom:-22px">공동 지출과 개인 지출이 따로 쌓여요</span>
            </div>
          </div>
        </section>

        <section class="lp-section bg-navy lp-cta-band">
          <div class="lp-pass reveal">
            <div class="lp-pass-top">
              <span class="lp-port"><b>ICN</b><small>SEOUL</small></span>
              ${ICON_PLANE_PASS}
              <span class="lp-port is-to"><b>ANY</b><small>WHERE</small></span>
            </div>
            <div class="lp-pass-perf"></div>
            <div class="lp-pass-body">
              <div class="lp-pass-fields">
                <span class="lp-pass-field"><small>PASSENGER</small><b>당신과 친구들</b></span>
                <span class="lp-pass-field"><small>GATE</small><b>01 · IDEAS</b></span>
                <span class="lp-pass-field"><small>BOARDING</small><b>지금</b></span>
              </div>
              <h2 class="lp-pass-title">첫 보드를 만들고<br>친구를 초대하세요.</h2>
              ${ctaBandBtnHtml()}
              <div class="lp-pass-barcode" aria-hidden="true"></div>
            </div>
          </div>
        </section>

        <footer class="lp-footer">
          <div class="lp-footer-inner">
            <!--
              사업자등록번호·주소·대표자는 실제 값이 생긴 뒤에 넣는다. 자리표시용 번호는
              "비어 있는 것"이 아니라 "틀린 것"이라 없는 것보다 나쁘다.
              약관·개인정보처리방침 본문의 같은 자리도 함께 채울 것(src/legal/legal.ts).
            -->
            <div class="lp-footer-top">
              <div class="lp-footer-brand">몽실이</div>
              <div class="lp-footer-links">
                <a href="/terms">이용약관</a>
                <a href="/privacy" class="strong">개인정보 처리방침</a>
                <a href="mailto:help@mongsil.app">문의하기</a>
              </div>
            </div>
            <div class="lp-footer-biz">
              친구와 함께 짜는 여행 계획 · 몽실이 (Mongsil)
            </div>
            <div class="lp-footer-copy">
              © ${new Date().getFullYear()} Mongsil. All rights reserved.
            </div>
          </div>
        </footer>

      </div>
    </div>
  `;

  document.getElementById('nav-login')?.addEventListener('click', signInWithGoogle);
  document.getElementById('hero-login')?.addEventListener('click', signInWithGoogle);
  document.getElementById('band-login')?.addEventListener('click', signInWithGoogle);

  document.getElementById('nav-dashboard')?.addEventListener('click', () => navigate('trips'));
  document.getElementById('hero-dashboard')?.addEventListener('click', () => navigate('trips'));
  document.getElementById('band-dashboard')?.addEventListener('click', () => navigate('trips'));

  const avatarBtn = document.getElementById('nav-avatar');
  const dropdown = document.getElementById('nav-dropdown');
  if (avatarBtn && dropdown) {
    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => dropdown.classList.remove('open'));
    dropdown.addEventListener('click', (e) => e.stopPropagation());
  }

  document.getElementById('dd-trips')?.addEventListener('click', () => navigate('trips'));
  document.getElementById('dd-settings')?.addEventListener('click', () => navigate('settings'));
  document.getElementById('dd-help')?.addEventListener('click', () => alert('문의하기 기능은 곧 구현 예정이에요!'));
  document.getElementById('dd-logout')?.addEventListener('click', signOut);

  setupScrollEffects();
  observeReveals();
}

/* 랜딩의 제품 화면(채팅·보드·숙소·동선·시각표·정산)은 landingShots.ts에 있다.
 * 실제 방콕 여행 기록을 옮겨 그린 것이라, 값을 바꿀 때는 그 파일 상단의 주석을 먼저 읽을 것. */

function setupScrollEffects(): void {
  const nav = document.getElementById('lp-nav');
  const hero = document.getElementById('lp-hero');
  if (!nav) return;
  const onScroll = () => {
    if (window.scrollY > window.innerHeight * 0.7) nav.classList.add('solid');
    else nav.classList.remove('solid');
    if (hero) hero.inert = window.scrollY > window.innerHeight;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

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
