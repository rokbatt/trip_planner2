/**
 * 몽실이 — 앱 엔트리포인트
 *
 * 부팅 순서 (중요!):
 * 1. 글로벌 CSS import
 * 2. Supabase 클라이언트 (supabase.ts에서 자동 초기화)
 * 3. 라우터 등록 (모든 뷰 함수가 import된 상태)
 * 4. onAuthStateChange 등록 — 이 시점에서 모든 함수가 정의되어 있으므로
 *    INITIAL_SESSION 이벤트를 안전하게 처리 가능
 */

// 1. 글로벌 스타일
import './styles/global.css';

// 2. 코어 모듈 (import 시 supabase client 생성됨)
import { store } from './store';
import { createRouter, navigate } from './router';

// 3. 뷰 모듈
import { renderLogin, initAuth } from './auth/auth';
import { renderTripList } from './trips/trip-list';

// ── 라우터 설정 ──
createRouter({
  routes: [
    {
      path: '',
      render: () => {
        if (store.get('user')) {
          navigate('trips');
        } else if (!store.get('loading')) {
          renderLogin();
        }
        // loading 중이면 아무것도 안 그림 — onAuthStateChange가 처리
      },
    },
    {
      path: 'trips',
      render: () => renderTripList(),
    },
    {
      path: 'trips/new',
      render: async () => {
        // TODO: Phase 1에서 구현
        const app = document.getElementById('app')!;
        app.innerHTML = `
          <div style="padding:48px;text-align:center;color:var(--text-secondary);">
            🚧 여행 생성 — Phase 1에서 구현 예정
            <br><br>
            <button class="btn btn-secondary" onclick="location.hash='#/trips'">← 돌아가기</button>
          </div>
        `;
      },
    },
    {
      path: 'board/:tripId',
      render: async ({ tripId }) => {
        // TODO: Phase 2에서 구현
        const app = document.getElementById('app')!;
        app.innerHTML = `
          <div style="padding:48px;text-align:center;color:var(--text-secondary);">
            🧠 브레인스토밍 보드 — Phase 2에서 구현 예정
            <br><small>tripId: ${tripId}</small>
            <br><br>
            <button class="btn btn-secondary" onclick="location.hash='#/trips'">← 돌아가기</button>
          </div>
        `;
      },
    },
    {
      path: 'itinerary/:tripId',
      render: async ({ tripId }) => {
        // TODO: Phase 3에서 구현
        const app = document.getElementById('app')!;
        app.innerHTML = `
          <div style="padding:48px;text-align:center;color:var(--text-secondary);">
            📅 일정 관리 — Phase 3에서 구현 예정
            <br><small>tripId: ${tripId}</small>
            <br><br>
            <button class="btn btn-secondary" onclick="location.hash='#/trips'">← 돌아가기</button>
          </div>
        `;
      },
    },
    {
      path: 'map/:tripId',
      render: async ({ tripId }) => {
        // TODO: Phase 3에서 구현
        const app = document.getElementById('app')!;
        app.innerHTML = `
          <div style="padding:48px;text-align:center;color:var(--text-secondary);">
            🗺️ 지도 — Phase 3에서 구현 예정
            <br><small>tripId: ${tripId}</small>
            <br><br>
            <button class="btn btn-secondary" onclick="location.hash='#/trips'">← 돌아가기</button>
          </div>
        `;
      },
    },
  ],
  notFound: () => {
    const app = document.getElementById('app')!;
    app.innerHTML = `
      <div style="padding:48px;text-align:center;">
        <p style="font-size:48px;margin-bottom:16px;">🤷</p>
        <p style="font-size:16px;font-weight:600;">페이지를 찾을 수 없어요</p>
        <br>
        <button class="btn btn-secondary" onclick="location.hash='#/'">홈으로</button>
      </div>
    `;
  },
  // 인증 가드: 로그인 안 된 상태에서 보호 경로 접근 차단
  beforeEach: (to) => {
    const publicPaths = ['', 'login'];
    const isPublic = publicPaths.includes(to.split('/')[0]);

    if (!isPublic && !store.get('user') && !store.get('loading')) {
      return ''; // 로그인 페이지로 리다이렉트
    }
    return true;
  },
});

// 4. 인증 초기화 — 마지막에 호출 (INITIAL_SESSION 캐치)
initAuth();

// 초기 로딩 UI
const app = document.getElementById('app')!;
if (store.get('loading')) {
  app.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100dvh;color:var(--text-tertiary);">
      불러오는 중...
    </div>
  `;
}
