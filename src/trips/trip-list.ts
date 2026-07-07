import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import { signOut } from '../auth/auth';
import type { Database } from '../types/database';
import './trip-list.css';

type Trip = Database['public']['Tables']['trips']['Row'];

/** 내 여행 목록 로드 (trip_members 조인) */
async function loadTrips(): Promise<Trip[]> {
  const user = store.get('user');
  if (!user) return [];

  const { data, error } = await supabase
    .from('trip_members')
    .select('trip_id, trips(*)')
    .eq('user_id', user.id);

  if (error) {
    console.error('여행 목록 로드 실패:', error.message);
    return [];
  }

  return (data ?? [])
    .map((row: { trips: Trip | null }) => row.trips)
    .filter((t): t is Trip => t !== null)
    .sort((a: Trip, b: Trip) => {
      const aTime = a.start_date ? new Date(a.start_date).getTime() : 0;
      const bTime = b.start_date ? new Date(b.start_date).getTime() : 0;
      return bTime - aTime;
    });
}

/** 여행 카드 하나 생성 */
function createTripCard(trip: Trip): HTMLElement {
  const card = document.createElement('div');
  card.className = 'trip-card';

  const dateStr = trip.start_date && trip.end_date
    ? `${trip.start_date} – ${trip.end_date}`
    : '날짜 미정';

  const destinations = trip.destinations?.join(', ') || '';

  card.innerHTML = `
    <div class="trip-card-info">
      <h3 class="trip-card-name">${escapeHtml(trip.name)}</h3>
      <div class="trip-card-meta">${dateStr}${destinations ? ` · ${escapeHtml(destinations)}` : ''}</div>
    </div>
    <div class="trip-card-img" id="trip-img-${trip.id}"></div>
  `;

  card.addEventListener('click', () => {
    store.set('currentTrip', trip);
    navigate(`board/${trip.id}`);
  });

  // 도시 이미지 비동기 로드 (city_images 테이블)
  if (trip.destinations?.[0]) {
    loadCityImage(trip.destinations[0]).then((url) => {
      if (url) {
        const imgEl = card.querySelector(`#trip-img-${trip.id}`) as HTMLElement | null;
        if (imgEl) imgEl.style.backgroundImage = `url('${url}')`;
      }
    });
  }

  return card;
}

/** city_images 테이블에서 도시 이미지 조회 (localStorage 캐시) */
async function loadCityImage(cityKo: string): Promise<string | null> {
  const cacheKey = `city_img_${cityKo}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    const parsed: { url: string; ts: number } = JSON.parse(cached);
    if (Date.now() - parsed.ts < 24 * 60 * 60 * 1000) return parsed.url;
  }

  const { data } = await supabase
    .from('city_images')
    .select('image_url')
    .eq('city_ko', cityKo)
    .single();

  const url = data?.image_url ?? null;
  if (url) localStorage.setItem(cacheKey, JSON.stringify({ url, ts: Date.now() }));
  return url;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** 여행 목록 뷰 렌더 */
export async function renderTripList(): Promise<HTMLElement> {
  const page = document.createElement('div');
  page.className = 'trip-list-page';

  page.innerHTML = `
    <div class="trip-list-header">
      <div>
        <h1 class="trip-list-title">내 여행</h1>
        <p class="trip-list-sub">어디로 떠날까요? ✈️</p>
      </div>
      <div class="trip-list-actions">
        <button class="btn btn-coral" id="btn-new-trip">+ 새 여행</button>
        <button class="btn btn-ghost" id="btn-logout">로그아웃</button>
      </div>
    </div>
    <div class="trip-grid" id="trip-grid">
      <div class="trip-grid-loading">불러오는 중...</div>
    </div>
  `;

  // 이벤트
  page.querySelector('#btn-logout')!.addEventListener('click', signOut);
  page.querySelector('#btn-new-trip')!.addEventListener('click', () => {
    // TODO: Phase 1에서 여행 생성 모달 구현
    alert('여행 생성 모달은 Phase 1에서 구현 예정!');
  });

  // 비동기 데이터 로드
  const trips = await loadTrips();
  const grid = page.querySelector('#trip-grid')!;

  if (trips.length === 0) {
    grid.innerHTML = `
      <div class="trip-empty">
        <p class="trip-empty-emoji">🌏</p>
        <p class="trip-empty-text">아직 여행이 없어요</p>
        <p class="trip-empty-hint">새 여행을 만들어서 친구들을 초대해보세요!</p>
      </div>
    `;
  } else {
    grid.innerHTML = '';
    trips.forEach((trip) => grid.appendChild(createTripCard(trip)));
  }

  return page;
}
