/**
 * 채팅 메시지에 담긴 링크를 trip_links에 저장하는 공용 로직 — chat.ts(보내는 즉시 1회 저장)와
 * links.ts(LINKS 탭 렌더링) 양쪽에서 쓰지만, 렌더링 코드가 없는 이 파일만 chat.ts가 정적으로
 * 끌어와도 번들이 무겁지 않다(addGooglePlace.ts와 같은 이유로 분리).
 */
import { supabase } from '../supabase';
import type { ChatMessage } from '../types/database';

/**
 * 링크가 있는 채팅 메시지를 딱 한 번(보낸 사람의 클라이언트에서) trip_links에 저장한다.
 * trip_links 테이블이 아직 없으면(마이그레이션 전) 실패하지만 콘솔 로그만 남기고
 * 채팅 전송 자체는 이미 끝난 뒤라 사용자 경험에 영향 없음 — 있으면 좋고 없어도 동작.
 */
export async function saveTripLinkFromChatMessage(msg: ChatMessage, url: string): Promise<void> {
  const { error } = await supabase.from('trip_links').insert({
    trip_id: msg.trip_id,
    chat_message_id: msg.id,
    url,
    message: msg.message,
    added_by: msg.user_id,
    display_name: msg.display_name,
    avatar_url: msg.avatar_url,
  });
  if (error) console.error('Trip link save error:', error.message);
}
