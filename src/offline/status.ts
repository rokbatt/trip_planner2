/**
 * 오프라인 상태 — 화면이 "지금 저장된 내용을 보고 있다"는 걸 알릴 수 있게 한 곳에서 관리한다.
 *
 *   offline  : 브라우저가 오프라인이라고 하거나, 방금 읽기가 네트워크 대신 저장본으로 대답했을 때
 *   cachedAt : 지금 보여주는 저장본 중 **가장 오래된** 것의 저장 시각(그 시각 기준이라고 밝힌다)
 *   pending  : 아직 서버에 못 보낸 쓰기(도착·체크·지출) 수
 */

type Listener = () => void;

let cachedAt: number | null = null;
let pending = 0;
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((fn) => {
    try { fn(); } catch (e) { console.error('[Offline] listener', e); }
  });
}

export interface OfflineState {
  offline: boolean;
  cachedAt: number | null;
  pending: number;
}

export function offlineState(): OfflineState {
  const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return { offline: browserOffline || cachedAt != null, cachedAt, pending };
}

/** 읽기가 저장본으로 대답했다 */
export function noteCacheServed(at: number): void {
  const next = cachedAt == null ? at : Math.min(cachedAt, at);
  if (next === cachedAt) return;
  cachedAt = next;
  emit();
}

/** 읽기가 네트워크로 성공했다 — 다시 연결됐다는 뜻이다 */
export function noteNetworkOk(): void {
  if (cachedAt == null) return;
  cachedAt = null;
  emit();
}

export function setPending(n: number): void {
  if (n === pending) return;
  pending = n;
  emit();
}

export function subscribeOffline(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 다시 연결됐을 때 할 일(대기열 보내기, 다시 읽기)을 걸어 둔다 */
const reconnectHandlers = new Set<Listener>();
export function onReconnect(fn: Listener): () => void {
  reconnectHandlers.add(fn);
  return () => reconnectHandlers.delete(fn);
}
export function emitReconnect(): void {
  reconnectHandlers.forEach((fn) => {
    try { fn(); } catch (e) { console.error('[Offline] reconnect', e); }
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', emit);
  window.addEventListener('online', () => { emit(); emitReconnect(); });
}
