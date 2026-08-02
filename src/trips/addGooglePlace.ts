/**
 * 실제 구글 장소(GooglePlaceResult)를 Supabase에 저장하는 공용 로직 — 여러 화면(BOARD의
 * 자동완성 추가, ROUTE의 지도 장소 검색·근처 검색)이 똑같은 저장 규칙(중복 방지 +
 * 크라우드소싱 캐시)을 공유해야 해서 board.ts 안에 있던 것을 여기로 뽑았다.
 * board.ts에 그대로 뒀으면 route.ts가 이 함수 하나 쓰자고 board.ts 전체(렌더링/이벤트
 * 바인딩 등)를 정적으로 끌고 들어오게 되어 번들이 불필요하게 얽힌다.
 */
import { supabase } from '../supabase';
import { store } from '../store';
import type { Database } from '../types/database';
import type { GooglePlaceResult } from '../utils/googleMaps';

type Place = Database['public']['Tables']['places']['Row'];

/** Google 사진 URL을 우리 Storage로 재호스팅 (실패하면 원본 URL로 폴백) — BOARD/ROUTE가
 * 공유. insertGooglePlace를 부르기 전에 반드시 이걸 먼저 거쳐야 photo_url이 매번 Google에
 * 요청 나가는 원본 URL(API 키 포함, 언젠가 만료됨)이 아니라 우리 Storage URL로 저장된다. */
export async function rehostPhoto(photoUrl: string, placeId: string): Promise<string> {
  try {
    const res = await fetch('/api/cache-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoUrl, placeId }),
    });
    const data = await res.json();
    if (res.ok && data.url) {
      console.log(
        '[Verify][사진 재호스팅] ' + (data.cached ? '이미 Storage에 있음(재다운로드 안 함)' : 'Google에서 새로 다운로드 → Storage 업로드') +
        ' → ' + data.url
      );
      return data.url;
    }
    console.error('[Photo] 재호스팅 실패, 원본 URL 사용:', data.error);
  } catch (e) {
    console.error('[Photo] 재호스팅 네트워크 오류, 원본 URL 사용:', (e as Error).message);
  }
  return photoUrl;
}

/**
 * 실제 구글 장소를 places 테이블에 저장 — 중복 방지(같은 트립에 같은 google_place_id가
 * 이미 있으면 재생성 안 함) + insert + 크라우드소싱 캐시(places_db) 저장.
 * destinationId를 인자로 받아 어느 화면(BOARD/ROUTE)이든 자기 자신의 활성 여행지로 호출한다.
 */
export async function insertGooglePlace(
  tripId: string,
  destinationId: string | undefined,
  mood: string | null,
  g: GooglePlaceResult,
  cacheSource: string = 'google_autocomplete'
): Promise<{ place: Place; isDuplicate: boolean } | null> {
  // 이 트립에 같은 장소(google_place_id)가 이미 있으면 중복 생성하지 않음
  if (g.place_id) {
    const { data: existing } = await supabase
      .from('places')
      .select('*')
      .eq('trip_id', tripId)
      .eq('google_place_id', g.place_id)
      .maybeSingle();

    if (existing) {
      console.log('[Verify][중복 방지] "' + g.name + '"은 이미 이 여행에 추가되어 있어서 다시 만들지 않음');
      const heal: Partial<Pick<Place, 'mood' | 'photo_url'>> = {};
      // mood가 없는 채로 저장된 기존 행(예: 예전엔 게이트 매핑이 없던 카테고리)은 Brainstorm
      // 대기줄에만 머물고 ROUTE 목록(.not('mood','is',null))에서도 빠져 "사라진 것처럼" 보인다.
      // 지금 다시 담으려는 시도에서 올바른 mood를 계산할 수 있으면 이 기회에 바로 잡아준다.
      if (!existing.mood && mood) heal.mood = mood;
      // 재호스팅 없이 Google 원본 사진 URL(API 키 포함, 언젠가 만료됨)이 그대로 저장된 기존
      // 행도, 지금 호출자가 이미 재호스팅한 URL을 들고 있으면 이 기회에 교체한다.
      if (
        existing.photo_url && existing.photo_url.includes('googleapis.com') &&
        g.photoUrl && !g.photoUrl.includes('googleapis.com')
      ) {
        heal.photo_url = g.photoUrl;
      }
      if (Object.keys(heal).length) {
        const { data: healed, error: healError } = await supabase
          .from('places')
          .update(heal)
          .eq('id', existing.id)
          .select()
          .single();
        if (!healError && healed) return { place: healed, isDuplicate: true };
      }
      return { place: existing, isDuplicate: true };
    }
  }

  const user = store.get('user');
  const { data, error } = await supabase
    .from('places')
    .insert({
      trip_id: tripId,
      name: g.name,
      mood,
      status: 'idea',
      is_idea: false,
      added_by: user?.id ?? null,
      sort_order: Math.floor(Date.now() / 1000),
      destination_id: destinationId,
      address: g.address,
      lat: g.lat,
      lng: g.lng,
      google_place_id: g.place_id,
      google_rating: g.rating,
      category: g.category,
      photo_url: g.photoUrl,
      opening_hours: g.openingHours,
    })
    .select()
    .single();

  if (error) {
    console.error('Rich idea add error:', error.message);
    return null;
  }

  // 크라우드소싱 캐싱: 다음 사용자를 위해 places_db에도 저장 (실패해도 무시)
  cacheToPlacesDb(g, cacheSource).catch(() => {});

  return { place: data, isDuplicate: false };
}

async function cacheToPlacesDb(g: GooglePlaceResult, source: string): Promise<void> {
  if (!g.place_id) return;
  const { data: existing } = await supabase
    .from('places_db')
    .select('id')
    .eq('google_place_id', g.place_id)
    .maybeSingle();

  if (existing) {
    console.log('[Verify][6단계: 이미 캐시됨] "' + g.name + '"은 이미 places_db에 있어서 재저장 안 함');
    return;
  }

  const { error } = await supabase.from('places_db').insert({
    name: g.name,
    category: g.category ?? '기타',
    country: '',
    city: '',
    address: g.address,
    lat: g.lat,
    lng: g.lng,
    google_place_id: g.place_id,
    google_rating: g.rating,
    photo_url: g.photoUrl,
    opening_hours: g.openingHours,
    source,
  });

  if (error) {
    console.error('[Verify][5단계 실패] places_db 저장 실패:', error.message);
  } else {
    console.log('[Verify][5단계 완료] "' + g.name + '"을 places_db에 저장함 → 다음 검색부터는 DB만 조회');
  }
}
