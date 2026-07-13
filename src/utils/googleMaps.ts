/**
 * Google Maps JS API (Places 라이브러리) 지연 로딩 유틸
 * - 콜백 기반 로딩(Google 공식 권장 방식) — script onload만으로는
 *   loading=async 조합에서 라이브러리 준비 시점을 보장 못 함
 * - 실패 시 promise를 초기화해서 다음 호출에서 재시도 가능하게 함
 */

let loadPromise: Promise<void> | null = null;
let callbackCounter = 0;

declare global {
  interface Window {
    google?: any;
    [key: string]: any;
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
      console.error('[GoogleMaps] VITE_GOOGLE_MAPS_KEY 환경변수가 비어있어요. Vercel 환경변수 설정 + 재배포 여부를 확인해주세요.');
      loadPromise = null; // 재시도 가능하도록 초기화
      reject(new Error('VITE_GOOGLE_MAPS_KEY 환경변수가 없어요.'));
      return;
    }

    // 이미 삽입된 스크립트가 있으면 중복 삽입 방지
    if (document.getElementById('mongsil-gmaps-script')) {
      // 로드 중일 수 있으니 폴링으로 대기
      const check = setInterval(() => {
        if (window.google?.maps?.places) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(check);
        if (!window.google?.maps?.places) {
          loadPromise = null;
          reject(new Error('Google Maps 로드 시간 초과'));
        }
      }, 8000);
      return;
    }

    const callbackName = '__mongsilGmapsReady_' + (++callbackCounter);
    window[callbackName] = () => {
      delete window[callbackName];
      if (window.google?.maps?.places) {
        resolve();
      } else {
        loadPromise = null;
        reject(new Error('Google Maps 콜백은 실행됐지만 places 라이브러리가 없어요.'));
      }
    };

    const script = document.createElement('script');
    script.id = 'mongsil-gmaps-script';
    script.src = 'https://maps.googleapis.com/maps/api/js?key=' + key + '&libraries=places&language=ko&region=KR&callback=' + callbackName;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      console.error('[GoogleMaps] 스크립트 태그 로드 자체가 실패했어요. 네트워크 차단(광고 차단기 등) 또는 API 키 도메인 제한을 확인해주세요.');
      loadPromise = null;
      reject(new Error('Google Maps 스크립트 로드에 실패했어요.'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

export interface GooglePlaceResult {
  place_id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  category: string | null;
  photoUrl: string | null;
  openingHours: string[] | null;
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

/** 새 Place 클래스 인스턴스(fetchFields 완료 후)를 몽실이 표준 포맷으로 변환 */
export function extractPlaceResult(place: any): GooglePlaceResult | null {
  if (!place || !place.id) return null;

  const types: string[] = place.types || [];
  const matchedType = types.find((t) => CATEGORY_MAP[t]);
  const photo = place.photos && place.photos.length > 0 ? place.photos[0] : null;

  // 새 API의 Photo 클래스는 getURI() 사용 (레거시 PlacePhoto.getUrl()과 다름)
  let photoUrl: string | null = null;
  if (photo && typeof photo.getURI === 'function') {
    try {
      photoUrl = photo.getURI({ maxWidth: 480, maxHeight: 480 });
    } catch (e) {
      photoUrl = null;
    }
  }

  const openingHours: string[] | null = Array.isArray(place.regularOpeningHours?.weekdayDescriptions)
    ? place.regularOpeningHours.weekdayDescriptions
    : null;

  return {
    place_id: place.id,
    name: place.displayName || '',
    address: place.formattedAddress || null,
    lat: place.location ? place.location.lat() : null,
    lng: place.location ? place.location.lng() : null,
    rating: typeof place.rating === 'number' ? place.rating : null,
    category: matchedType ? CATEGORY_MAP[matchedType] : null,
    photoUrl,
    openingHours,
  };
}

/** Google 카테고리 → 몽실이 게이트(mood) 추천 (진짜 AI 아닌 매핑 규칙) */
const CATEGORY_TO_GATE: Record<string, string> = {
  '음식점': '먹고싶어', '카페': '먹고싶어', '베이커리': '먹고싶어', '바': '먹고싶어',
  '관광명소': '가고싶어', '박물관': '가고싶어', '미술관': '가고싶어', '공원': '가고싶어',
  '종교시설': '가고싶어', '명소': '가고싶어',
  '쇼핑': '하고싶어', '나이트라이프': '하고싶어', '테마파크': '하고싶어',
  '숙소': '숙소',
};

export function suggestGateFromCategory(category: string | null): string | null {
  if (!category) return null;
  return CATEGORY_TO_GATE[category] ?? null;
}

/* ============================================================
   커스텀 자동완성 (직접 만든 드롭다운 UI용)
   - AutocompleteService: 예측 목록 (텍스트만, 사진/평점 없음 → 비용 저렴)
   - PlacesService.getDetails: 선택된 1곳만 상세정보 요청
   - 세션 토큰을 공유해서 Google의 "세션 기반 자동완성" 할인 요금 유지
   ============================================================ */

let sessionToken: any = null;

/** 보드를 다시 마운트할 때마다 호출 — 이전 방문에서 남은 세션 토큰을 확실히 비움 */
export function resetGoogleServices(): void {
  sessionToken = null;
}

function ensureSessionToken(): void {
  const g = window.google;
  if (!sessionToken && g?.maps?.places?.AutocompleteSessionToken) {
    sessionToken = new g.maps.places.AutocompleteSessionToken();
  }
}

export interface PlacePrediction {
  placeId: string;
  mainText: string;
  secondaryText: string;
  types: string[];
}

/** 입력 텍스트로 예측 목록 요청 (텍스트만, 추가 과금 없음)
 *  2025년 3월부터 신규 발급 키는 레거시 AutocompleteService를 쓸 수 없어서
 *  Google 권장 신규 API(AutocompleteSuggestion)로 구현 */
export async function getPlacePredictions(input: string): Promise<PlacePrediction[]> {
  const g = window.google;
  if (!g?.maps?.places || !input.trim()) return [];

  ensureSessionToken();

  try {
    const { AutocompleteSuggestion } = await g.maps.importLibrary('places');
    const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input,
      sessionToken,
    });

    return (suggestions ?? [])
      .filter((s: any) => s.placePrediction)
      .map((s: any) => {
        const p = s.placePrediction;
        return {
          placeId: p.placeId,
          mainText: p.mainText?.text ?? p.text?.text ?? '',
          secondaryText: p.secondaryText?.text ?? '',
          types: p.types ?? [],
        };
      });
  } catch (e) {
    console.error('[GoogleMaps] 예측 요청 실패:', (e as Error).message);
    return [];
  }
}

/** 사용자가 선택한 1곳만 상세정보 요청 (사진/평점 포함, 세션 토큰으로 할인 요금 적용)
 *  레거시 PlacesService 대신 신규 Place 클래스 사용 */
export async function getPlaceDetails(placeId: string): Promise<any> {
  const g = window.google;
  if (!g?.maps?.places) {
    throw new Error('Google Maps가 준비되지 않았어요.');
  }

  const { Place } = await g.maps.importLibrary('places');
  const place = new Place({ id: placeId });

  await place.fetchFields({
    fields: ['id', 'displayName', 'formattedAddress', 'location', 'rating', 'types', 'photos', 'regularOpeningHours'],
  });

  sessionToken = null; // 세션 종료 → 다음 검색은 새 세션(요금 단위)으로 시작
  return place;
}

/** 예측 항목의 types → 한글 카테고리 라벨 (드롭다운 아이콘/보조텍스트용) */
export function getCategoryLabel(types: string[]): string | null {
  const matched = types.find((t) => CATEGORY_MAP[t]);
  return matched ? CATEGORY_MAP[matched] : null;
}
