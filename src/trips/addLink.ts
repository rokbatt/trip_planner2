/**
 * 채팅 메시지에 담긴 링크를 trip_links에 저장하는 공용 로직 — chat.ts(보내는 즉시 1회 저장)와
 * links.ts(LINKS 탭 렌더링, 드래그로 카테고리 수정) 양쪽에서 쓰지만, 렌더링 코드가 없는 이
 * 파일만 chat.ts가 정적으로 끌어와도 번들이 무겁지 않다(addGooglePlace.ts와 같은 이유로 분리).
 */
import { supabase } from '../supabase';
import type { ChatMessage } from '../types/database';

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
}
