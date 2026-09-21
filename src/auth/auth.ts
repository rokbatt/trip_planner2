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

function escapeHtml(str: string): string {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
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
        <div class="lp-nav-logo">몽실이</div>
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
                  <div class="lp-kakao-head">3월 방콕 ✈︎ · 4</div>
                  <div class="lp-kakao-msg"><span class="lp-kakao-who">민수</span><span class="lp-kakao-bubble">여기 야경 미쳤대</span></div>
                  <div class="lp-kakao-msg"><span class="lp-kakao-who"></span><span class="lp-kakao-bubble is-link">instagram.com/reel/Cx9k2…</span></div>
                  <div class="lp-kakao-msg"><span class="lp-kakao-who">지현</span><span class="lp-kakao-bubble">오 저장</span></div>
                  <div class="lp-kakao-gap">메시지 214개</div>
                  <div class="lp-kakao-msg"><span class="lp-kakao-who">태호</span><span class="lp-kakao-bubble is-lost">아까 그 야경 어디였지?</span></div>
                  <div class="lp-kakao-msg"><span class="lp-kakao-who">민수</span><span class="lp-kakao-bubble is-lost">스크롤 내려봐…</span></div>
                </div>
              </div>
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
              <div class="lp-gate-row">
                <span class="lp-gate-code">GATE 01</span>
                <span class="lp-gate-name">IDEAS<small>Departure Hall</small></span>
                <span class="lp-gate-desc">가고 싶은 곳을 판단 없이 모아요.</span>
                <span class="lp-gates-verb lp-gate-verb">던지기</span>
              </div>
              <div class="lp-gate-row">
                <span class="lp-gate-code">GATE 02</span>
                <span class="lp-gate-name">STAY<small>Immigration Counter</small></span>
                <span class="lp-gate-desc">생활권과 숙소 하나. 여행의 중심이 정해져요.</span>
                <span class="lp-gates-verb lp-gate-verb">좁히기</span>
              </div>
              <div class="lp-gate-row">
                <span class="lp-gate-code">GATE 03</span>
                <span class="lp-gate-name">ROUTE<small>Boarding Pass</small></span>
                <span class="lp-gate-desc">숙소 기준으로 갈 만한 곳만 남겨 이어요.</span>
                <span class="lp-gates-verb lp-gate-verb">잇기</span>
              </div>
              <div class="lp-gate-row">
                <span class="lp-gate-code">GATE 04</span>
                <span class="lp-gate-name">TIMELINE<small>Flight Schedule</small></span>
                <span class="lp-gate-desc">동선이 시각표가 돼요. 이동 시간까지.</span>
                <span class="lp-gates-verb lp-gate-verb">떠나기</span>
              </div>
            </div>
          </div>
        </section>

        <section class="lp-section bg-white">
          <div class="lp-section-inner">
            <div class="lp-split reverse reveal">
              <div class="lp-split-text">
                <p class="lp-sec-eyebrow">GATE 02 · IMMIGRATION COUNTER</p>
                <h2 class="lp-sec-title">숙소를 정하면,<br>여행의 절반이 정해져요.</h2>
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
              <div class="lp-split-demo">
                <div class="lp-map">${zoneMapSvg()}</div>
                <div class="lp-zones">
                  <div class="lp-zone is-picked">
                    <span class="lp-zone-name">수쿰윗<em>선택됨</em></span>
                    <span class="lp-zone-meta">BTS 아쏙 도보 4분 · 편의점 2 · 식당 40+</span>
                    <span class="lp-zone-score">86<small>AI 분석</small></span>
                  </div>
                  <div class="lp-zone">
                    <span class="lp-zone-name">시암</span>
                    <span class="lp-zone-meta">BTS 시암 도보 6분 · 쇼핑 중심</span>
                    <span class="lp-zone-score">81<small>AI 분석</small></span>
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
                <p class="lp-sec-eyebrow">REAL-TIME</p>
                <h2 class="lp-sec-title">단톡방에 던진 링크가,<br>보드 위 카드가 됩니다.</h2>
                <p class="lp-sec-desc">
                  채팅에 링크를 붙이면 미리보기를 불러와 숙소 · 맛집 · 액티비티로
                  분류해 보드에 꽂아요. 누가 무엇을 올렸는지 모두에게 실시간으로 보입니다.
                </p>
              </div>
              <div class="lp-split-demo">
                <div class="demo-chat">
                  <div class="chat-bubble them">여기 야경 미쳤대 instagram.com/reel/Cx9k2…</div>
                  <div class="chat-bubble me">오 자동으로 담겼네</div>
                  <div class="demo-linkcard">
                    <div class="demo-linkcard-thumb"></div>
                    <div class="demo-linkcard-body">
                      <span class="demo-linkcard-chip">FOOD</span>
                      <div class="demo-linkcard-title">옥타브 루프탑 바</div>
                      <div class="demo-linkcard-host">instagram.com</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="lp-section bg-white">
          <div class="lp-section-inner">
            <div class="lp-split reverse reveal">
              <div class="lp-split-text">
                <p class="lp-sec-eyebrow">GATE 01 · DEPARTURE HALL</p>
                <h2 class="lp-sec-title">친구들과<br>함께 채워가는 보드</h2>
                <p class="lp-sec-desc">
                  가고싶어 · 먹고싶어 · 하고싶어. 무드별로 카드를 쌓고 드래그로 옮겨요.
                  아직 아무것도 안 정해진 상태가 가장 자유로운 순간이니까요.
                </p>
              </div>
              <div class="lp-split-demo">
                ${boardDemoHtml()}
              </div>
            </div>
          </div>
        </section>

        <section class="lp-section bg-light">
          <div class="lp-section-inner">
            <div class="lp-split reveal">
              <div class="lp-split-text">
                <p class="lp-sec-eyebrow">ROUTE & TIMELINE</p>
                <h2 class="lp-sec-title">“18분”이라고 쓰여 있으면,<br>진짜 18분이에요.</h2>
                <p class="lp-sec-desc">
                  장소를 확정하면 지도 위 동선과 이동 시간이 시각표로 정리됩니다.
                  실측 데이터가 있으면 실측을, 없으면 <strong>“추정”이라고 적어요.</strong>
                  그래야 그 숫자를 믿고 일정을 짤 수 있으니까요.
                </p>
              </div>
              <div class="lp-split-demo">
                <div class="lp-map">${routeMapSvg()}</div>
                <div class="demo-sched">
                  <div class="demo-sched-row">
                    <span class="demo-sched-time">09:00</span>
                    <span class="demo-sched-name">호텔 출발</span>
                    <span></span>
                  </div>
                  <div class="demo-sched-row is-leg">
                    <span class="demo-sched-time">+18분</span>
                    <span class="demo-sched-name">BTS 아쏙 → 사판탁신</span>
                    <span class="demo-sched-badge real">실측</span>
                  </div>
                  <div class="demo-sched-row">
                    <span class="demo-sched-time">09:18</span>
                    <span class="demo-sched-name">왓 아룬</span>
                    <span></span>
                  </div>
                  <div class="demo-sched-row is-leg">
                    <span class="demo-sched-time">+12분</span>
                    <span class="demo-sched-name">도보 이동</span>
                    <span class="demo-sched-badge est">추정</span>
                  </div>
                  <div class="demo-sched-row">
                    <span class="demo-sched-time">10:30</span>
                    <span class="demo-sched-name">티엔 시장 점심</span>
                    <span></span>
                  </div>
                </div>
              </div>
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
                  <div class="lp-phone-top"><span>DAY 2 · 방콕</span><span>14:20</span></div>
                  <p class="lp-now-label">NOW — 다음 목적지</p>
                  <p class="lp-now-place">티엔 시장</p>
                  <p class="lp-now-meta">도보 12분 · 14:32 도착 예정</p>
                  <div class="lp-now-actions">
                    <span class="lp-now-btn is-primary">도착</span>
                    <span class="lp-now-btn">출발</span>
                    <span class="lp-now-btn">밀기</span>
                  </div>
                  <p class="lp-now-after">지금 속도면 마지막 일정 <strong>22:10 도착</strong> · 30분 초과</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="lp-section bg-white">
          <div class="lp-section-inner">
            <div class="lp-split reverse reveal">
              <div class="lp-split-text">
                <p class="lp-sec-eyebrow">EXPENSE</p>
                <h2 class="lp-sec-title">“내가 더 냈나?”로<br>끝나지 않게.</h2>
                <p class="lp-sec-desc">
                  예산을 잡고, 현지에서 바로 기록하고, 마지막엔 누가 누구에게 얼마를 보내면
                  되는지 한 줄로 정리해요. 바트로 낸 돈도 그날 환율로 환산해 두고,
                  어떤 환율을 썼는지까지 같이 적습니다.
                </p>
              </div>
              <div class="lp-split-demo">
                <div class="lp-settle">
                  <div class="lp-settle-head">정산 — 최소 송금</div>
                  <div class="lp-settle-row"><span>태호</span><i>→</i><span>민수</span><b>₩41,200</b></div>
                  <div class="lp-settle-row"><span>지현</span><i>→</i><span>민수</span><b>₩23,000</b></div>
                  <div class="lp-settle-row"><span>현주</span><i>→</i><span>태호</span><b>₩8,500</b></div>
                  <p class="lp-settle-foot">공동 지출 18건 · 결제 완료분만 반영 · 환율 3월 14일 기준</p>
                </div>
              </div>
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
              약관·개인정보처리방침·사업자정보는 실제 문서와 실제 값이 생긴 뒤에 넣는다.
              빈 href="#" 링크와 자리표시용 사업자번호(000-00-00000)는 "비어 있는 것"이 아니라
              "틀린 것"이라 신뢰를 깎는다 — 없는 것보다 나쁘다.
              ⚠️ 제휴 링크나 유료화를 붙이려면 이용약관·개인정보처리방침이 법적으로 선행 조건이다.
                 그때 이 자리에 실제 문서를 연결할 것.
            -->
            <div class="lp-footer-top">
              <div class="lp-footer-brand">몽실이</div>
              <div class="lp-footer-links">
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
  document.getElementById('dd-settings')?.addEventListener('click', () => alert('설정 페이지는 곧 구현 예정이에요!'));
  document.getElementById('dd-help')?.addEventListener('click', () => alert('문의하기 기능은 곧 구현 예정이에요!'));
  document.getElementById('dd-logout')?.addEventListener('click', signOut);

  setupScrollEffects();
  observeReveals();
}

/* ── 랜딩용 지도 일러스트 ──
 * 실제 스크린샷 대신 같은 색 체계로 직접 그린다. 색은 제품에서 쓰는 값 그대로다:
 *   경로선·정류지 핀 = AERO_BLUE #0891B2 (route.ts와 동일)
 *   무드 색 = 가고싶어 #E24B4A · 먹고싶어 #1D9E75 · 하고싶어 #7F77DD (board.ts와 동일)
 * 랜딩이 제품과 다른 색을 쓰면 들어왔을 때 "다른 서비스 같다"는 인상을 준다.
 */

/** 지도 바닥 — 강·도로. 두 지도가 같은 도시로 보이도록 좌표를 공유한다. */
const MAP_BASE = `
  <rect width="440" height="300" fill="#F5FAFE"/>
  <path d="M-10,300 C50,242 30,182 76,133 C111,96 97,40 120,-10"
        stroke="#DCEEF8" stroke-width="30" fill="none" stroke-linecap="round"/>
  <g stroke="#E7EEF4" stroke-width="5" stroke-linecap="round">
    <path d="M0,96 H440"/><path d="M0,208 H440"/>
    <path d="M264,0 V300"/><path d="M370,0 V300"/>
  </g>`;

/** 끝점이 (0,0)에 오는 물방울 핀 */
const PIN_PATH = 'M0 0 C-5.5 -8 -11 -13 -11 -19 A11 11 0 1 1 11 -19 C11 -13 5.5 -8 0 0 Z';

/** 생활권 지도 — 숙소를 정하면 여행의 중심이 정해진다는 걸 보여주는 자리 */
function zoneMapSvg(): string {
  return `
  <svg class="lp-map-svg" viewBox="0 0 440 300" role="img"
       aria-label="생활권 지도. 수쿰윗이 선택되어 있고 숙소 핀이 그 안에 있습니다.">
    ${MAP_BASE}
    <g>
      <path d="M150,262 L266,176 L418,124" stroke="#B8C6D4" stroke-width="2.5" stroke-dasharray="7 6" fill="none"/>
      <circle cx="150" cy="262" r="3.6" fill="#fff" stroke="#B8C6D4" stroke-width="2"/>
      <circle cx="266" cy="176" r="3.6" fill="#fff" stroke="#B8C6D4" stroke-width="2"/>
      <circle cx="418" cy="124" r="3.6" fill="#fff" stroke="#B8C6D4" stroke-width="2"/>
    </g>
    <ellipse cx="104" cy="182" rx="58" ry="45" fill="rgba(130,150,170,0.09)" stroke="#CBD5E1" stroke-width="1.5" stroke-dasharray="5 5"/>
    <text class="lp-map-zone" x="104" y="186" text-anchor="middle">리버사이드</text>
    <ellipse cx="248" cy="88" rx="62" ry="45" fill="rgba(130,150,170,0.09)" stroke="#CBD5E1" stroke-width="1.5" stroke-dasharray="5 5"/>
    <text class="lp-map-zone" x="248" y="92" text-anchor="middle">시암</text>
    <ellipse cx="346" cy="208" rx="76" ry="55" fill="rgba(8,177,178,0.10)" stroke="#0891B2" stroke-width="2"/>
    <text class="lp-map-zone is-picked" x="346" y="252" text-anchor="middle">수쿰윗</text>
    <g transform="translate(346,200)">
      <path d="${PIN_PATH}" fill="#0B2A5C"/>
      <circle cy="-19" r="4.2" fill="#fff"/>
    </g>
  </svg>`;
}

/** 동선 지도 — 확정한 장소가 선으로 이어지는 걸 보여주는 자리 */
function routeMapSvg(): string {
  const line = 'M356,208 L268,180 L178,152 L126,86 L248,56';
  const stops: Array<[number, number, string, string]> = [
    [268, 180, '1', '왓 아룬'],
    [178, 152, '2', '티엔 시장'],
    [126, 86, '3', '카오산'],
    [248, 56, '4', '아이콘시암'],
  ];
  const pins = stops.map(([x, y, n, label]) => `
      <g transform="translate(${x},${y})">
        <circle r="13" fill="#0891B2" stroke="#fff" stroke-width="2.5"/>
        <text class="lp-map-num" y="4.5" text-anchor="middle">${n}</text>
        <text class="lp-map-label" y="-20" text-anchor="middle">${label}</text>
      </g>`).join('');
  return `
  <svg class="lp-map-svg" viewBox="0 0 440 300" role="img"
       aria-label="동선 지도. 숙소에서 출발해 네 곳을 차례로 잇는 경로입니다.">
    ${MAP_BASE}
    <path d="${line}" stroke="#fff" stroke-width="7.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${line}" stroke="#0891B2" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    ${pins}
    <g transform="translate(356,208)">
      <path d="${PIN_PATH}" fill="#0B2A5C"/>
      <circle cy="-19" r="4.2" fill="#fff"/>
      <text class="lp-map-label is-stay" y="18" text-anchor="middle">숙소</text>
    </g>
  </svg>`;
}

/** 브레인스토밍 보드 — 무채색 스켈레톤 대신 실제로 쌓이는 카드 모습 */
function boardDemoHtml(): string {
  const cols: Array<[string, string, string[]]> = [
    ['가고싶어', '#E24B4A', ['왓 아룬', '아시아티크 야시장', '짜뚜짝 주말시장']],
    ['먹고싶어', '#1D9E75', ['팁싸마이 팟타이', '옥타브 루프탑 바']],
    ['하고싶어', '#7F77DD', ['타이 마사지', '수상시장 보트투어', '쿠킹 클래스']],
  ];
  const main = cols.map(([mood, color, items], ci) => `
      <div class="lp-board-col">
        <div class="lp-board-colhead">
          <span class="lp-board-dot" style="background:${color}"></span>${mood}
          <em>${items.length}</em>
        </div>
        ${items.map((t, i) => `
        <div class="lp-board-card${ci === 0 && i === 0 ? ' is-picked' : ''}">
          <span class="lp-board-bar" style="background:${color}"></span>
          <span class="lp-board-name">${t}</span>
        </div>`).join('')}
      </div>`).join('');
  return `
    <div class="lp-board">
      <div class="lp-board-side">
        <div class="lp-board-dest is-active">방콕<span>4박</span></div>
        <div class="lp-board-dest">치앙마이<span>2박</span></div>
        <div class="lp-board-dest lp-board-dest-add">+ 도시 추가</div>
      </div>
      <div class="lp-board-main">${main}</div>
    </div>`;
}

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
