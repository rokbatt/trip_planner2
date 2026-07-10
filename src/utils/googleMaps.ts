/**
 * Google Maps JS API (Places 라이브러리) 지연 로딩 유틸
 * - 스크립트는 처음 필요할 때 딱 한 번만 삽입
 * - Places 자동완성 결과를 몽실이 표준 포맷으로 변환
 */

let loadPromise: Promise<void> | null = null;

declare global {
  interface Window {
    google?: any;
  }
}

export function loadGoogleMapsScript(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (window.google?.maps?.places) {
      resolve();
      return;
    }

    const key = import.meta.env.VITE_GOOGLE_MAPS_KEY;
    if (!key) {
      reject(new Error('VITE_GOOGLE_MAPS_KEY 환경변수가 없어요.'));
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://maps.googleapis.com/maps/api/js?key=' + key + '&libraries=places&loading=async';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Maps 스크립트 로드에 실패했어요.'));
    document.head.appendChild(script);
  });

  return loadPromise;
}

export function buildPhotoUrl(photoRef: string, maxWidth = 480): string {
  const key = import.meta.env.VITE_GOOGLE_MAPS_KEY;
  return 'https://maps.googleapis.com/maps/api/place/photo?maxwidth=' + maxWidth + '&photoreference=' + photoRef + '&key=' + key;
}

export interface GooglePlaceResult {
  place_id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  category: string | null;
  photoRef: string | null;
}

/** Google Place types → 몽실이 한글 카테고리 라벨 매핑 */
const CATEGORY_MAP: Record<string, string> = {
  restaurant: '음식점',
  cafe: '카페',
  bakery: '베이커리',
  bar: '바',
  tourist_attraction: '관광명소',
  museum: '박물관',
  art_gallery: '미술관',
  park: '공원',
  place_of_worship: '종교시설',
  lodging: '숙소',
  shopping_mall: '쇼핑',
  night_club: '나이트라이프',
  amusement_park: '테마파크',
  point_of_interest: '명소',
};

export function extractPlaceResult(place: any): GooglePlaceResult | null {
  if (!place || !place.place_id) return null;

  const types: string[] = place.types || [];
  const matchedType = types.find((t) => CATEGORY_MAP[t]);
  const photo = place.photos && place.photos.length > 0 ? place.photos[0] : null;

  return {
    place_id: place.place_id,
    name: place.name || '',
    address: place.formatted_address || null,
    lat: place.geometry?.location ? place.geometry.location.lat() : null,
    lng: place.geometry?.location ? place.geometry.location.lng() : null,
    rating: typeof place.rating === 'number' ? place.rating : null,
    category: matchedType ? CATEGORY_MAP[matchedType] : null,
    photoRef: photo?.photo_reference ?? null,
  };
}

/** Google 카테고리 → 몽실이 게이트(mood) 추천 (진짜 AI 아닌 매핑 규칙) */
const CATEGORY_TO_GATE: Record<string, string> = {
  '음식점': '먹고싶어', '카페': '먹고싶어', '베이커리': '먹고싶어', '바': '먹고싶어',
  '관광명소': '가고싶어', '박물관': '가고싶어', '미술관': '가고싶어', '공원': '가고싶어',
  '종교시설': '가고싶어', '명소': '가고싶어',
  '쇼핑': '하고싶어', '나이트라이프': '하고싶어', '테마파크': '하고싶어',
};

export function suggestGateFromCategory(category: string | null): string | null {
  if (!category) return null;
  return CATEGORY_TO_GATE[category] ?? null;
}
