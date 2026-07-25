/**
 * 숙소 투표 요청 — Shortlist Step3에서 "이 숙소 어때요?"를 다른 멤버에게 실시간으로 물어보는 기능.
 *
 * 저장 없이 순수 브로드캐스트(Supabase Realtime broadcast)만 사용하는 MVP:
 *  - 요청 순간 앱을 켜놓고 있는 멤버에게만 작은 토스트가 뜸 (DB에 남기지 않음)
 *  - 응답을 못 받았으면 요청자는 버튼을 다시 눌러 재요청하면 됨 (별도 잠금 없음)
 *  - 투표는 좋음/별로 두 가지뿐
 */
import { supabase } from '../supabase';
import { store } from '../store';
import type { RealtimeChannel } from '@supabase/supabase-js';
import './hotelVote.css';

interface VoteRequestPayload {
  requestId: string;
  tripId: string;
  fromUserId: string;
  fromName: string;
  placeId: string;
  placeName: string;
  photoUrl: string | null;
  destinationId: string;
}

interface VoteResponsePayload {
  requestId: string;
  voterName: string;
  vote: 'up' | 'down';
  placeId: string;
  placeName: string;
}

let channel: RealtimeChannel | null = null;
let currentTripId: string | null = null;
let toastLayer: HTMLElement | null = null;

/** Step3 쪽에서 "지금 이 화면이 투표 요청으로 들어온 화면인지" 확인할 때 쓰는 대기 응답 상태 */
let pendingResponse: { requestId: string; placeId: string; placeName: string } | null = null;

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function ensureToastLayer(): HTMLElement {
  if (toastLayer && document.body.contains(toastLayer)) return toastLayer;
  toastLayer = document.createElement('div');
  toastLayer.className = 'hv-toast-layer';
  document.body.appendChild(toastLayer);
  return toastLayer;
}

function currentUserName(): string {
  const user = store.get('user');
  const meta = user?.user_metadata ?? {};
  return meta.full_name || meta.name || user?.email || '멤버';
}

/** 트립 워크스페이스 진입 시 1회 구독 (트립이 같고 이미 구독돼 있으면 재구독하지 않음) */
export function initHotelVoteChannel(tripId: string): void {
  if (currentTripId === tripId && channel) return;
  teardownHotelVoteChannel();
  currentTripId = tripId;

  channel = supabase
    .channel('hotel-vote:' + tripId)
    .on('broadcast', { event: 'vote_request' }, ({ payload }) => {
      handleIncomingRequest(payload as VoteRequestPayload);
    })
    .on('broadcast', { event: 'vote_response' }, ({ payload }) => {
      handleIncomingResponse(payload as VoteResponsePayload);
    })
    .subscribe();
}

export function teardownHotelVoteChannel(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  currentTripId = null;
  pendingResponse = null;
  toastLayer?.remove();
  toastLayer = null;
}

function handleIncomingRequest(payload: VoteRequestPayload): void {
  const user = store.get('user');
  if (!user || payload.fromUserId === user.id) return; // 본인이 보낸 요청은 무시

  const layer = ensureToastLayer();
  const card = document.createElement('div');
  card.className = 'hv-toast';
  card.innerHTML = [
    payload.photoUrl
      ? '<div class="hv-toast-photo" style="background-image:url(\'' + payload.photoUrl + '\')"></div>'
      : '<div class="hv-toast-photo hv-toast-photo-empty"></div>',
    '<div class="hv-toast-body">',
    '  <div class="hv-toast-title">' + escapeHtml(payload.fromName) + '님이 투표를 요청했어요</div>',
    '  <div class="hv-toast-place">' + escapeHtml(payload.placeName) + '</div>',
    '  <div class="hv-toast-actions">',
    '    <button type="button" class="hv-toast-btn hv-toast-view">보러 가기</button>',
    '    <button type="button" class="hv-toast-btn hv-toast-dismiss">닫기</button>',
    '  </div>',
    '</div>',
  ].join('');
  layer.appendChild(card);

  const remove = () => card.remove();
  const autoRemove = setTimeout(remove, 20000);

  card.querySelector('.hv-toast-dismiss')?.addEventListener('click', () => {
    clearTimeout(autoRemove);
    remove();
  });
  card.querySelector('.hv-toast-view')?.addEventListener('click', () => {
    clearTimeout(autoRemove);
    remove();
    pendingResponse = { requestId: payload.requestId, placeId: payload.placeId, placeName: payload.placeName };
    window.dispatchEvent(
      new CustomEvent('mongsil:openVoteTarget', {
        detail: { tripId: payload.tripId, destinationId: payload.destinationId, placeId: payload.placeId },
      })
    );
  });
}

function handleIncomingResponse(payload: VoteResponsePayload): void {
  const layer = ensureToastLayer();
  const card = document.createElement('div');
  card.className = 'hv-toast hv-toast-response';
  card.innerHTML = [
    '<div class="hv-toast-body">',
    '  <div class="hv-toast-title">' + escapeHtml(payload.voterName) + '님의 응답</div>',
    '  <div class="hv-toast-place">' + escapeHtml(payload.placeName) + ' — ' + (payload.vote === 'up' ? '👍 좋아요' : '👎 별로예요') + '</div>',
    '</div>',
  ].join('');
  layer.appendChild(card);
  setTimeout(() => card.remove(), 6000);
}

/** Step3에서 "투표 요청" 버튼 클릭 시 호출 — 몇 번이고 다시 눌러 재요청 가능 */
export function sendVoteRequest(
  tripId: string,
  destinationId: string,
  place: { id: string; name: string; photo_url: string | null }
): void {
  if (!channel) return;
  const user = store.get('user');
  channel.send({
    type: 'broadcast',
    event: 'vote_request',
    payload: {
      requestId: (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random()),
      tripId,
      fromUserId: user?.id ?? '',
      fromName: currentUserName(),
      placeId: place.id,
      placeName: place.name,
      photoUrl: place.photo_url,
      destinationId,
    } satisfies VoteRequestPayload,
  });
}

/** 지금 Step3가 투표 요청을 타고 들어온 화면이고, 보고 있는 숙소가 그 요청과 같은지 */
export function getPendingVoteResponseFor(placeId: string): { requestId: string; placeName: string } | null {
  if (!pendingResponse || pendingResponse.placeId !== placeId) return null;
  return { requestId: pendingResponse.requestId, placeName: pendingResponse.placeName };
}

export function clearPendingVoteResponse(): void {
  pendingResponse = null;
}

/** 좋음/별로 응답을 요청자에게 브로드캐스트 */
export function castVote(vote: 'up' | 'down'): void {
  if (!pendingResponse || !channel) return;
  channel.send({
    type: 'broadcast',
    event: 'vote_response',
    payload: {
      requestId: pendingResponse.requestId,
      voterName: currentUserName(),
      vote,
      placeId: pendingResponse.placeId,
      placeName: pendingResponse.placeName,
    } satisfies VoteResponsePayload,
  });
  clearPendingVoteResponse();
}
