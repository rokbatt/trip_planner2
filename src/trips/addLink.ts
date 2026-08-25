/**
 * 채팅 메시지에 담긴 링크를 trip_links에 저장하는 공용 로직 — chat.ts(보내는 즉시 1회 저장)와
 * links.ts(LINKS 탭 렌더링, 드래그로 카테고리 수정) 양쪽에서 쓰지만, 렌더링 코드가 없는 이
 * 파일만 chat.ts가 정적으로 끌어와도 번들이 무겁지 않다(addGooglePlace.ts와 같은 이유로 분리).
 */
import { supabase } from '../supabase';
import { insertGooglePlace } from './addGooglePlace';
import { getCategoryLabel } from '../utils/googleMaps';
import type { GooglePlaceResult } from '../utils/googleMaps';
import type { ChatMessage, Trip } from '../types/database';
import { loadDestinations, resolveActiveDestination, isSyntheticDestination } from './destinations';

export type LinkCategory = 'STAY' | 'PLACE' | 'FOOD' | 'ACTIVITY' | 'VIDEO' | 'ARTICLE' | 'OTHER';
export const LINK_CATEGORIES: LinkCategory[] = ['STAY', 'PLACE', 'FOOD', 'ACTIVITY', 'VIDEO', 'ARTICLE', 'OTHER'];

interface LinkPreview {
  title: string | null;
  imageUrl: string | null;
  siteName: string | null;
  ogType: string | null;
}

/** 도메인 기준 — 가장 신뢰도 높은 신호라 최우선으로 확인 */
const DOMAIN_RULES: Array<{ category: LinkCategory; hosts: string[] }> = [
  { category: 'STAY', hosts: ['agoda.com', 'booking.com', 'airbnb.com', 'airbnb.co.kr', 'hotels.com', 'expedia.com', 'expedia.co.kr', 'yanolja.com', 'yeogi.com', 'trip.com', 'hostelworld.com'] },
  { category: 'VIDEO', hosts: ['youtube.com', 'youtu.be', 'tiktok.com', 'vimeo.com'] },
  { category: 'ARTICLE', hosts: ['blog.naver.com', 'tistory.com', 'brunch.co.kr', 'medium.com', 'wikipedia.org', 'velog.io', 'news.naver.com'] },
  { category: 'PLACE', hosts: ['maps.google.com', 'maps.app.goo.gl', 'map.naver.com', 'map.kakao.com', 'goo.gl'] },
  { category: 'FOOD', hosts: ['mangoplate.com', 'diningcode.com', 'yelp.com', 'opentable.com'] },
  { category: 'ACTIVITY', hosts: ['klook.com', 'getyourguide.com', 'viator.com', 'myrealtrip.com', 'triple.guide'] },
];

/** 도메인으로 못 정하면 제목의 키워드로 보조 판단 — 그래도 없으면 OTHER */
const KEYWORD_RULES: Array<{ category: LinkCategory; words: string[] }> = [
  { category: 'STAY', words: ['호텔', 'hotel', '리조트', 'resort', '게스트하우스', '숙소'] },
  { category: 'FOOD', words: ['맛집', '레스토랑', 'restaurant', '카페', 'cafe', '메뉴', 'menu'] },
  { category: 'ACTIVITY', words: ['투어', 'tour', '티켓', 'ticket', '액티비티', 'activity', '체험'] },
];

/** URL(+가능하면 og:title/og:type)로 카테고리를 추정한다. 애매하면 OTHER — 화면에서
 * 드래그로 직접 옮길 수 있으므로 여기서 무리해서 맞히려 하지 않는다. */
export function classifyLink(url: string, title: string | null, ogType: string | null): LinkCategory {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    /* 잘못된 URL이면 도메인 판단은 건너뛰고 아래 폴백으로 */
  }

  const domainHit = DOMAIN_RULES.find((r) => r.hosts.some((h) => host === h || host.endsWith('.' + h)));
  if (domainHit) return domainHit.category;

  if (ogType === 'video' || ogType === 'video.other' || ogType === 'video.movie') return 'VIDEO';
  if (ogType === 'article') return 'ARTICLE';

  const haystack = (title ?? '').toLowerCase();
  if (haystack) {
    const keywordHit = KEYWORD_RULES.find((r) => r.words.some((w) => haystack.includes(w.toLowerCase())));
    if (keywordHit) return keywordHit.category;
  }

  return 'OTHER';
}

/**
 * 예약 사이트별로 "특정 숙소 상세 페이지" URL 패턴이 어느 정도 정해져 있어서, 검색결과·목록
 * 페이지 링크(예: booking.com/searchresults.html)까지 자동 추가 대상으로 삼지 않기 위한 필터.
 * 여기 안 걸리면(패턴을 모르는 사이트 포함) 자동 추가는 건너뛰고 링크 카드 저장만 된다 —
 * 애매하면 틀리게 추가하는 것보다 안 하는 쪽이 안전(원칙 3-1).
 */
const HOTEL_DETAIL_PAGE_RULES: Array<{ hosts: string[]; test: (path: string) => boolean }> = [
  { hosts: ['booking.com'], test: (p) => p.includes('/hotel/') },
  { hosts: ['agoda.com'], test: (p) => p.includes('/hotel/') },
  { hosts: ['airbnb.com', 'airbnb.co.kr'], test: (p) => p.includes('/rooms/') },
  { hosts: ['hotels.com'], test: (p) => /\/ho\d+/.test(p) },
  { hosts: ['expedia.com', 'expedia.co.kr'], test: (p) => /\.h\d+\./.test(p) },
];

function isLikelyHotelDetailPage(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.replace(/^www\./, '');
  const rule = HOTEL_DETAIL_PAGE_RULES.find((r) => r.hosts.some((h) => host === h || host.endsWith('.' + h)));
  return rule ? rule.test(u.pathname) : false;
}

/** "호텔명, 도시 - 리뷰 보기 | Booking.com" 같은 제목에서 사이트명 접미사만 살짝 잘라냄 —
 *  나머지 잡음은 Google Places Text Search가 어느 정도 알아서 걸러내므로 그대로 넘긴다. */
function cleanHotelSearchName(title: string): string {
  const pipeIdx = title.indexOf(' | ');
  const trimmed = pipeIdx > 0 ? title.slice(0, pipeIdx) : title;
  return trimmed.trim().slice(0, 120);
}

/**
 * STAY로 분류된 링크가 특정 숙소 상세 페이지로 보이면, 이미 확보해둔 og:title을 이름
 * 검색 힌트 삼아 STAY Step2의 "이름으로 추가"와 똑같은 방식(Google Places Text Search)으로
 * 보드에 자동으로 담는다. 예약 사이트 URL 자체를 파싱하지 않으므로(그건 불안정해서 이미
 * 폐기한 방식) 안정성은 이름 기반 검색과 동일하게 유지된다.
 * 매칭 실패·이미 추가됨·환경변수 미설정 등 어떤 이유로든 실패하면 조용히 넘어간다 —
 * 링크 카드는 이미 저장되어 있어서, 필요하면 사용자가 STAY Step2에서 직접 추가할 수 있다.
 */
async function tryAutoImportHotelFromLink(tripId: string, url: string, ogTitle: string | null): Promise<void> {
  if (!ogTitle || !isLikelyHotelDetailPage(url)) return;
  const name = cleanHotelSearchName(ogTitle);
  if (!name) return;

  try {
    const { data: trip } = await supabase.from('trips').select('*').eq('id', tripId).maybeSingle();
    if (!trip) return;

    // 사용자가 지금 보고 있는(마지막으로 활성화한) 여행지로 담아야 한다 — 항상 첫 번째
    // 여행지로 고정하면 여러 여행지를 오가며 채팅할 때 엉뚱한 여행지에 숙소가 쌓인다.
    // BOARD/shortlist가 공유하는 세션 내 활성 여행지 상태(resolveActiveDestination)를
    // 그대로 재사용 — 아직 아무 화면에서도 활성값을 고르지 않았다면 첫 여행지로 폴백.
    const dests = await loadDestinations(trip as Trip);
    const activeDest = dests.length ? resolveActiveDestination(tripId, dests) : null;
    const contextHint = activeDest?.name ?? '';
    const destinationId = activeDest && !isSyntheticDestination(activeDest.id) ? activeDest.id : undefined;

    const res = await fetch('/api/import-hotel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, contextHint }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.place_id) return;

    const result: GooglePlaceResult = {
      place_id: data.place_id,
      name: data.name,
      address: data.address,
      lat: data.lat,
      lng: data.lng,
      rating: data.rating,
      category: getCategoryLabel(data.types ?? []),
      photoUrl: data.photoUrl,
      openingHours: null,
    };

    // insertGooglePlace가 같은 트립에 같은 google_place_id가 이미 있으면 중복 생성하지 않음
    await insertGooglePlace(tripId, destinationId, '숙소', result, 'link_auto_import');
  } catch (e) {
    console.error('[Links] 숙소 자동 추가 실패(링크 카드는 정상 저장됨):', (e as Error).message);
  }
}

/** 서버(api/cache-photo.ts, kind:'link-preview')에서 og:title/og:image 등을 가져온다.
 * 실패해도 예외를 던지지 않고 빈 값으로 채워 반환 — 미리보기가 없어도 링크 저장은 되어야 한다. */
async function fetchLinkPreview(url: string, linkId: string): Promise<LinkPreview> {
  const empty: LinkPreview = { title: null, imageUrl: null, siteName: null, ogType: null };
  try {
    const res = await fetch('/api/cache-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'link-preview', url, linkId }),
    });
    if (!res.ok) return empty;
    return (await res.json()) as LinkPreview;
  } catch {
    return empty;
  }
}

/**
 * 링크가 있는 채팅 메시지를 딱 한 번(보낸 사람의 클라이언트에서) trip_links에 저장한다.
 * 미리보기(제목/이미지)를 먼저 가져와 자동 분류까지 마친 뒤 한 번에 insert한다.
 * trip_links 테이블이 아직 없으면(마이그레이션 전) 실패하지만 콘솔 로그만 남기고
 * 채팅 전송 자체는 이미 끝난 뒤라 사용자 경험에 영향 없음 — 있으면 좋고 없어도 동작.
 */
export async function saveTripLinkFromChatMessage(msg: ChatMessage, url: string): Promise<void> {
  const linkId = globalThis.crypto?.randomUUID?.() ?? Date.now() + '-' + Math.random();
  const preview = await fetchLinkPreview(url, linkId);
  const category = classifyLink(url, preview.title, preview.ogType);

  const { error } = await supabase.from('trip_links').insert({
    id: linkId,
    trip_id: msg.trip_id,
    chat_message_id: msg.id,
    url,
    message: msg.message,
    title: preview.title,
    image_url: preview.imageUrl,
    site_name: preview.siteName,
    category,
    added_by: msg.user_id,
    display_name: msg.display_name,
    avatar_url: msg.avatar_url,
  });
  if (error) console.error('Trip link save error:', error.message);

  if (category === 'STAY') {
    void tryAutoImportHotelFromLink(msg.trip_id, url, preview.title);
  }
}
