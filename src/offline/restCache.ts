/**
 * Supabase REST 요청의 오프라인 처리 — `createClient`의 `global.fetch`로 끼워 넣는다.
 *
 * 읽기(GET)
 *   · 평소엔 네트워크 그대로. 성공한 응답은 IndexedDB에 저장해 둔다.
 *   · 네트워크가 실패하면(또는 저장본이 있는데 6초 넘게 대답이 없으면) 저장본으로 대답한다.
 *     → 앱 전체 화면이 "마지막으로 받은 내용"으로 열린다. 화면 쪽은 바꿀 게 없다.
 * 쓰기(POST/PATCH/DELETE)
 *   · 여행 중 폰에서 누르는 테이블(restModel.QUEUE_TABLES)만 대기열에 넣는다.
 *   · 실패하면 대기열에 넣고 "성공"으로 대답한다 — 화면은 이미 낙관적으로 바뀌어 있다.
 *   · 다시 연결되면 들어온 순서대로 보낸다(flushQueue).
 *   · 대기열이 남아 있는 동안에는 읽기 응답(네트워크든 저장본이든)에 대기열을 겹쳐 보여준다.
 *
 * REST가 아닌 요청(인증·스토리지·실시간)은 건드리지 않는다.
 */

import { idbGet, idbSet, idbDelete, idbEntries, idbClear } from './idb';
import {
  parseRestUrl,
  isQueueable,
  withClientIds,
  applyQueued,
  bodyRows,
  cacheKey,
  type QueuedWrite,
} from './restModel';
import { noteCacheServed, noteNetworkOk, setPending, onReconnect, emitReconnect } from './status';

const GET_TIMEOUT_MS = 6000;
const MAX_BODY_CHARS = 2_000_000;
const MAX_ENTRIES = 800;

interface CachedResp {
  status: number;
  body: string;
  contentType: string | null;
  contentRange: string | null;
  at: number;
}

/** 대기열의 메모리 사본 — 읽을 때마다 IndexedDB를 열지 않으려고 둔다 */
let queueMem: Array<{ key: IDBValidKey; write: QueuedWrite }> = [];
let queueLoaded: Promise<void> | null = null;
let getAccessToken: () => Promise<string | null> = async () => null;

function loadQueue(): Promise<void> {
  if (!queueLoaded) {
    queueLoaded = idbEntries<QueuedWrite>('queue').then((entries) => {
      queueMem = entries.map(([key, write]) => ({ key, write }));
      setPending(queueMem.length);
    });
  }
  return queueLoaded;
}

/* ══════════════ 진입점 ══════════════ */

export async function offlineFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes('/rest/v1/')) return fetch(input, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));

  if (method === 'GET') return cachedGet(url, input, init, headers);
  if (isQueueable(method, url) && (init?.body == null || typeof init.body === 'string')) {
    return queueableWrite(method as QueuedWrite['method'], url, init, headers);
  }
  return fetch(input, init);
}

/* ══════════════ 읽기 ══════════════ */

async function cachedGet(url: string, input: RequestInfo | URL, init: RequestInit | undefined, headers: Headers): Promise<Response> {
  await loadQueue();
  const key = cacheKey('GET', url, headers.get('accept'));
  const cachedP = idbGet<CachedResp>('rest', key);

  const net = fetch(input, init).then(async (res) => {
    if (res.ok) {
      noteNetworkOk();
      const text = await res.clone().text();
      if (text.length <= MAX_BODY_CHARS) {
        void idbSet('rest', key, {
          status: res.status,
          body: text,
          contentType: res.headers.get('content-type'),
          contentRange: res.headers.get('content-range'),
          at: Date.now(),
        } satisfies CachedResp);
      }
    }
    return res;
  });

  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), GET_TIMEOUT_MS); });
    const first = await Promise.race([net, timeout]);
    clearTimeout(timer);
    if (first !== 'timeout') return await withQueue(first, url, headers);
    // 대답이 늦다 — 저장본이 있으면 그걸로 먼저 대답하고, 네트워크는 뒤에서 저장본만 갱신한다
    const cached = await cachedP;
    if (cached) {
      net.catch(() => undefined);
      return serveCached(cached, url, headers);
    }
    return await withQueue(await net, url, headers);
  } catch (e) {
    if (init?.signal?.aborted) throw e;
    const cached = await cachedP;
    if (cached) return serveCached(cached, url, headers);
    throw e;
  }
}

function serveCached(c: CachedResp, url: string, headers: Headers): Response {
  noteCacheServed(c.at);
  const body = mergeQueue(c.body, url, headers);
  const h = new Headers({ 'x-mongsil-cached-at': String(c.at) });
  if (c.contentType) h.set('content-type', c.contentType);
  if (c.contentRange) h.set('content-range', c.contentRange);
  return new Response(body, { status: c.status, headers: h });
}

/** 대기열이 남아 있으면 네트워크 응답에도 겹친다 — 보내기 전이라 서버엔 아직 없다 */
async function withQueue(res: Response, url: string, headers: Headers): Promise<Response> {
  if (!res.ok || !queueMem.length) return res;
  const table = parseRestUrl(url)?.table;
  if (!table || !queueMem.some((q) => q.write.table === table)) return res;
  const text = await res.text();
  const h = new Headers(res.headers);
  return new Response(mergeQueue(text, url, headers), { status: res.status, headers: h });
}

function mergeQueue(body: string, url: string, headers: Headers): string {
  if (!queueMem.length) return body;
  const read = parseRestUrl(url);
  if (!read) return body;
  const writes = queueMem.map((q) => q.write).filter((w) => w.table === read.table);
  if (!writes.length) return body;
  // 한 행(object) 응답은 겹치지 않는다 — 목록만
  if ((headers.get('accept') ?? '').includes('vnd.pgrst.object')) return body;
  try {
    const rows = JSON.parse(body) as unknown;
    if (!Array.isArray(rows)) return body;
    return JSON.stringify(applyQueued(rows as Array<Record<string, unknown>>, read, writes));
  } catch {
    return body;
  }
}

/* ══════════════ 쓰기 + 대기열 ══════════════ */

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    // 토큰은 저장하지 않는다 — 보낼 때 그 순간의 토큰을 새로 붙인다(만료·유출 방지)
    if (k.toLowerCase() === 'authorization') return;
    out[k] = v;
  });
  return out;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function queueableWrite(method: QueuedWrite['method'], url: string, init: RequestInit | undefined, headers: Headers): Promise<Response> {
  await loadQueue();
  const table = parseRestUrl(url)!.table;
  const write = withClientIds(
    { method, url, table, headers: headersToObject(headers), body: (init?.body as string | null | undefined) ?? null, at: Date.now() },
    newId
  );

  // 앞에 못 보낸 쓰기가 있으면 순서를 지키려고 이것도 뒤에 줄 세운다
  if (queueMem.length) {
    await enqueue(write);
    void flushQueue();
    return syntheticOk(write, headers);
  }
  try {
    return await fetch(url, { ...init, body: write.body });
  } catch (e) {
    if (init?.signal?.aborted) throw e;
    await enqueue(write);
    return syntheticOk(write, headers);
  }
}

async function enqueue(write: QueuedWrite): Promise<void> {
  const key = await idbSet('queue', undefined, write);
  queueMem.push({ key: key ?? Date.now(), write });
  setPending(queueMem.length);
}

/** 대기열에 넣은 쓰기에 대한 "성공" 응답 — 요청이 돌려받길 원한 모양(행/목록/없음)에 맞춘다 */
function syntheticOk(write: QueuedWrite, headers: Headers): Response {
  const prefer = (headers.get('prefer') ?? '').toLowerCase();
  const h = new Headers({ 'content-type': 'application/json', 'x-mongsil-queued': '1' });
  if (!prefer.includes('return=representation')) {
    return new Response(null, { status: write.method === 'POST' ? 201 : 204, headers: h });
  }
  const now = new Date().toISOString();
  const rows = bodyRows(write.body).map((r) => ({ created_at: now, ...r }));
  const single = (headers.get('accept') ?? '').includes('vnd.pgrst.object');
  return new Response(JSON.stringify(single ? rows[0] ?? null : rows), { status: write.method === 'POST' ? 201 : 200, headers: h });
}

let flushing = false;

/**
 * 대기열을 들어온 순서대로 보낸다. 네트워크가 아직 없으면 거기서 멈추고 다음 기회를 기다린다.
 * 서버가 **영구적으로** 거절한 쓰기(400대, 단 401·408·429 제외)는 버린다 — 예: 연결이 끊기기
 * 직전에 사실은 저장됐던 insert를 다시 보내 409가 나는 경우. 계속 붙잡고 있으면 뒤의 쓰기까지 막힌다.
 */
export async function flushQueue(): Promise<void> {
  await loadQueue();
  if (flushing || !queueMem.length) return;
  flushing = true;
  let sent = 0;
  try {
    while (queueMem.length) {
      const { key, write } = queueMem[0];
      const token = await getAccessToken();
      if (!token) break; // 로그인 정보가 아직 없다 — 다시 연결돼 토큰이 갱신되면 보낸다
      let res: Response;
      try {
        res = await fetch(write.url, {
          method: write.method,
          headers: { ...write.headers, Authorization: 'Bearer ' + token },
          body: write.body,
        });
      } catch {
        break; // 아직 오프라인
      }
      const permanent = res.status >= 400 && res.status < 500 && ![401, 408, 429].includes(res.status);
      if (!res.ok && !permanent) break;
      if (!res.ok) console.warn('[Offline] 서버가 거절한 대기열 쓰기를 버림:', res.status, write.method, write.url);
      await idbDelete('queue', key);
      queueMem.shift();
      sent += 1;
    }
  } finally {
    flushing = false;
    setPending(queueMem.length);
  }
  if (sent > 0) emitReconnect(); // 화면이 서버 기준으로 다시 읽도록
}

/* ══════════════ 시작·정리 ══════════════ */

let flushTimer: ReturnType<typeof setInterval> | null = null;

/** 앱 시작 시 한 번 — 토큰 공급자를 받고, 남은 대기열을 보내고, 오래된 저장본을 정리한다 */
export function initOfflineRest(opts: { getAccessToken: () => Promise<string | null> }): void {
  getAccessToken = opts.getAccessToken;
  void loadQueue().then(() => flushQueue());
  onReconnect(() => { void flushQueue(); });
  // 약한 신호(lie-fi)에서는 online 이벤트가 안 온다 — 대기열이 있는 동안만 30초마다 다시 시도
  if (!flushTimer && typeof window !== 'undefined') {
    flushTimer = setInterval(() => { if (queueMem.length) void flushQueue(); }, 30_000);
  }
  void pruneRest();
}

async function pruneRest(): Promise<void> {
  const entries = await idbEntries<CachedResp>('rest');
  if (entries.length <= MAX_ENTRIES) return;
  entries.sort((a, b) => (a[1]?.at ?? 0) - (b[1]?.at ?? 0));
  await Promise.all(entries.slice(0, entries.length - MAX_ENTRIES).map(([k]) => idbDelete('rest', k)));
}

/** 로그아웃 — 이 기기에 남은 여행 데이터를 지운다(다른 사람이 같은 폰으로 로그인할 수 있다) */
export async function clearOfflineRest(): Promise<void> {
  queueMem = [];
  setPending(0);
  await Promise.all([idbClear('rest'), idbClear('queue'), idbClear('kv')]);
}
