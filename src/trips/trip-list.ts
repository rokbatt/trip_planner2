import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import { withTimeout } from '../utils/with-timeout';
import './trip-list.css';

import type { Database } from '../types/database';
type Trip = Database['public']['Tables']['trips']['Row'];

/**
 * 여행 목록 화면 렌더
 */
export async function renderTripList(): Promise<void> {
  const app = document.getElementById('app')!;
  const user = store.get('user');

  app.innerHTML = `
    <div class="trip-list-page">
      <header class="trip-list-header">
        <div>
          <h1 class="trip-list-title">내 여행</h1>
          <p class="trip-list-sub">어디로 떠날까요? ✈️</p>
        </div>
        <div class="trip-list-actions">
          <button class="btn btn-coral" id="btn-create-trip">+ 새 여행</button>
          <button class="btn btn-ghost" id="btn-logout">로그아웃</button>
        </div>
      </header>
      <div class="trip-grid" id="trip-grid">
        <div class="trip-grid-loading">불러오는 중...</div>
      </div>
    </div>
  `;

  // 이벤트
  document.getElementById('btn-create-trip')!
    .addEventListener('click', () => navigate('trips/new'));
  document.getElementById('btn-logout')!
    .addEventListener('click', async () => {
      const { signOut } = await import('../auth/auth');
      signOut();
    });

  // 데이터 로드
  await loadTrips();
}

async function loadTrips(): Promise<void> {
  const grid = document.getElementById('trip-grid');
  if (!grid) return;

  const user = store.get('user');
  if (!user) return;

  try {
    // trip_members 조인으로 내가 속한 여행만 가져오기
    const { data, error } = await withTimeout(
      supabase
        .from('trip_members')
        .select('trip_id, trips(*)')
        .eq('user_id', user.id),
      8000
    );

    if (error) throw error;

    const trips = (data ?? [])
      .map((row: any) => row.trips as Trip)
      .filter(Boolean)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (trips.length === 0) {
      grid.innerHTML = `
        <div class="trip-empty">
          <p class="trip-empty-emoji">🌏</p>
          <p class="trip-empty-text">아직 여행이 없어요</p>
          <p class="trip-empty-hint">새 여행을 만들어서 친구들을 초대해보세요!</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = trips.map((trip) => renderTripCard(trip)).join('');

    // 카드 클릭 이벤트
    grid.querySelectorAll<HTMLElement>('[data-trip-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const tripId = el.dataset.tripId!;
        store.set('currentTrip', trips.find((t) => t.id === tripId) ?? null);
        navigate(`board/${tripId}`);
      });
    });

  } catch (err) {
    console.error('여행 목록 로드 실패:', err);
    grid.innerHTML = `
      <div class="trip-empty">
        <p class="trip-empty-text">😥 불러오기 실패</p>
        <button class="btn btn-secondary" onclick="location.reload()">다시 시도</button>
      </div>
    `;
  }
}

function renderTripCard(trip: Trip): string {
  const dest = trip.destinations?.[0] ?? '';
  const dateRange = formatDateRange(trip.start_date, trip.end_date);

  return `
    <div class="trip-card" data-trip-id="${trip.id}" role="button" tabindex="0">
      <div class="trip-card-info">
        <h3 class="trip-card-name">${escapeHtml(trip.name)}</h3>
        <span class="trip-card-meta">
          ${dateRange ? dateRange + ' · ' : ''}${trip.headcount ?? ''}명${trip.theme ? ' · ' + escapeHtml(trip.theme) : ''}
        </span>
      </div>
      <div class="trip-card-img" data-city="${escapeHtml(dest)}"></div>
    </div>
  `;
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return '';
  const s = new Date(start);
  const fmt = (d: Date) =>
    `${d.getMonth() + 1}월 ${d.getDate()}일`;
  if (!end) return fmt(s);
  return `${fmt(s)} – ${fmt(new Date(end))}`;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
