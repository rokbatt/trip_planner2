/**
 * 숙소 투표 요청 — Shortlist Step3에서 "이 숙소 어때요?"를 다른 멤버에게 실시간으로 물어보는 기능.
 *
 * 저장 없이 순수 브로드캐스트(Supabase Realtime broadcast)만 사용하는 MVP:
 *  - 요청 순간 앱을 켜놓고 있는 멤버에게만 작은 토스트가 뜸 (DB에 남기지 않음)
 *  - 응답을 못 받았으면 요청자는 버튼을 다시 눌러 재요청하면 됨 (별도 잠금 없음)
 *  - 투표는 좋음/별로 두 가지뿐
 *  - 집계(몇 명이 좋아요/별로예요 눌렀는지)는 세션 메모리에만 유지 — 요청자·응답자
 *    누구든 그 숙소의 Step3를 보고 있으면 실시간으로 같은 숫자를 봄. 새로고침하면
 *    사라짐(DB에 남기지 않는다는 MVP 스코프를 그대로 따름).
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

export interface VoteTally {
  up: number;
  down: number;
}

let channel: RealtimeChannel | null = null;
let currentTripId: string | null = null;
let toastLayer: HTMLElement | null = null;

/** Step3 쪽에서 "지금 이 화면이 투표 요청으로 들어온 화면인지" 확인할 때 쓰는 대기 응답 상태 */
let pendingResponse: { requestId: string; placeId: string; placeName: string } | null = null;

/** requestId별 집계 — DB에 저장하지 않고 세션 메모리에만 유지 */
const talliesByRequest = new Map<string, VoteTally>();
/** 이 숙소(placeId)에 대해 지금 이 클라이언트가 알고 있는 "현재 진행 중인" 투표 요청 id
 *  — 내가 요청을 보냈거나, 요청을 받아 화면을 열어본 경우 모두 여기 기록됨 */
const activeRequestByPlace = new Map<string, string>();
/** 이 클라이언트가 이 숙소에 대해 이미 던진 투표(있다면) */
const myVoteByPlace = new Map<string, 'up' | 'down'>();

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

function bumpTally(requestId: string, vote: 'up' | 'down'): VoteTally {
  const tally = talliesByRequest.get(requestId) ?? { up: 0, down: 0 };
  tally[vote] += 1;
  talliesByRequest.set(requestId, tally);
  return tally;
}

function notifyTallyChanged(requestId: string, placeId: string): void {
  const tally = talliesByRequest.get(requestId) ?? { up: 0, down: 0 };
  window.dispatchEvent(
    new CustomEvent('mongsil:voteTallyChanged', { detail: { requestId, placeId, tally } })
  );
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
  talliesByRequest.clear();
  activeRequestByPlace.clear();
  myVoteByPlace.clear();
  toastLayer?.remove();
  toastLayer = null;
}

function handleIncomingRequest(payload: VoteRequestPayload): void {
  const user = store.get('user');
  if (!user || payload.fromUserId === user.id) return; // 본인이 보낸 요청은 무시

  activeRequestByPlace.set(payload.placeId, payload.requestId);
  if (!talliesByRequest.has(payload.requestId)) {
    talliesByRequest.set(payload.requestId, { up: 0, down: 0 });
  }

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
  bumpTally(payload.requestId, payload.vote);
  activeRequestByPlace.set(payload.placeId, payload.requestId);
  notifyTallyChanged(payload.requestId, payload.placeId);

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
  const requestId = globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random();

  talliesByRequest.set(requestId, { up: 0, down: 0 });
  activeRequestByPlace.set(place.id, requestId);
  myVoteByPlace.delete(place.id);

  channel.send({
    type: 'broadcast',
    event: 'vote_request',
    payload: {
      requestId,
      tripId,
      fromUserId: user?.id ?? '',
      fromName: currentUserName(),
      placeId: place.id,
      placeName: place.name,
      photoUrl: place.photo_url,
      destinationId,
    } satisfies VoteRequestPayload,
  });
  notifyTallyChanged(requestId, place.id);
}

/** 지금 Step3가 투표 요청을 타고 들어온 화면이고, 아직 응답하지 않았는지 */
export function getPendingVoteResponseFor(placeId: string): { requestId: string; placeName: string } | null {
  if (!pendingResponse || pendingResponse.placeId !== placeId) return null;
  return { requestId: pendingResponse.requestId, placeName: pendingResponse.placeName };
}

export function clearPendingVoteResponse(): void {
  pendingResponse = null;
}

/** 이 숙소에 대해 지금 진행 중인(내가 요청했거나, 요청받아 열어본) 투표 요청 id */
export function getActiveRequestIdForPlace(placeId: string): string | null {
  return activeRequestByPlace.get(placeId) ?? null;
}

/** requestId 기준 현재 집계 */
export function getTally(requestId: string): VoteTally {
  return talliesByRequest.get(requestId) ?? { up: 0, down: 0 };
}

/** 이 클라이언트(나)가 이 숙소에 이미 투표했다면 어떤 표를 던졌는지 */
export function getMyVoteForPlace(placeId: string): 'up' | 'down' | null {
  return myVoteByPlace.get(placeId) ?? null;
}

/** 좋음/별로 응답을 요청자(+다른 참여자)에게 브로드캐스트 */
export function castVote(vote: 'up' | 'down'): void {
  if (!pendingResponse || !channel) return;
  const { requestId, placeId, placeName } = pendingResponse;

  channel.send({
    type: 'broadcast',
    event: 'vote_response',
    payload: { requestId, voterName: currentUserName(), vote, placeId, placeName } satisfies VoteResponsePayload,
  });

  // broadcast self:false(기본값)라 내가 보낸 응답은 나에게 되돌아오지 않으므로 직접 반영
  myVoteByPlace.set(placeId, vote);
  bumpTally(requestId, vote);
  notifyTallyChanged(requestId, placeId);
  clearPendingVoteResponse();
}
