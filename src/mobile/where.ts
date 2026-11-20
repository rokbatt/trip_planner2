/**
 * "어디야?" — 일행에게 위치를 물어보고, 받은 사람이 **누를 때만 한 번** 위치를 보낸다.
 *
 * 1. 내가 여행 정보 → 일행 → "어디야?"  → 서버(worker/notify.ts kind 'where')가 그 사람 휴대폰에 알림
 * 2. 그 사람이 알림을 누르면 앱이 `?where_from=…` 주소로 열린다 → "내 위치 보내기" 시트
 * 3. 보내기를 누르면 그 순간 위치 한 번 → kind 'here' → 나에게 알림
 * 4. 내가 누르면 `?here_lat=…` 주소로 열린다 → "길찾기" 시트(출발지는 현재 위치)
 *
 * 위치는 서버·DB에 저장하지 않는다. 계속 따라가는 추적도 없다(아이폰 웹앱은 백그라운드 위치를 못 쓴다).
 */
import { apiFetch } from '../utils/apiFetch';

export type WhereIncoming =
  | { kind: 'ask'; fromId: string; name: string }
  | { kind: 'here'; lat: number; lng: number; name: string; at: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 알림으로 열린 주소의 쿼리 읽기 — 형식이 틀리면 무시 */
export function parseWhereParams(search: string): WhereIncoming | null {
  const q = new URLSearchParams(search);
  const name = (q.get('where_name') ?? q.get('here_name') ?? '').slice(0, 20) || '일행';
  const from = q.get('where_from');
  if (from && UUID.test(from)) return { kind: 'ask', fromId: from, name };
  const lat = Number(q.get('here_lat'));
  const lng = Number(q.get('here_lng'));
  if (q.has('here_lat') && q.has('here_lng') && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    const at = Number(q.get('here_at'));
    return { kind: 'here', lat, lng, name, at: Number.isFinite(at) && at > 0 ? at : Date.now() };
  }
  return null;
}

/** 주소에서 우리 쿼리를 지운다 — 새로고침해도 시트가 다시 뜨지 않게 */
export function takeWhereParams(): WhereIncoming | null {
  const inc = parseWhereParams(location.search);
  if (location.search) history.replaceState(history.state, '', location.pathname + location.hash);
  return inc;
}

/** "3분 전" */
export function agoLabel(at: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - at) / 60000));
  if (min < 1) return '방금';
  if (min < 60) return min + '분 전';
  const h = Math.round(min / 60);
  return h < 24 ? h + '시간 전' : '오래전';
}

type Sent = { ok: true; sent: number } | { ok: false; message: string };

async function post(body: Record<string, unknown>): Promise<Sent> {
  try {
    const res = await apiFetch('/api/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as { sent?: number; error?: string };
    if (!res.ok) return { ok: false, message: j.error || '보내지 못했어요.' };
    return { ok: true, sent: j.sent ?? 0 };
  } catch {
    return { ok: false, message: '인터넷 연결을 확인해 주세요.' };
  }
}

export const askWhere = (tripId: string, to: string) => post({ kind: 'where', tripId, to });
export const sendHere = (tripId: string, to: string, lat: number, lng: number) => post({ kind: 'here', tripId, to, lat, lng });

/** 지금 위치 한 번 */
export function positionOnce(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('unsupported')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(e),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });
}
