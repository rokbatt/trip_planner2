/**
 * Web Push 보내기 — Cloudflare Worker의 WebCrypto만으로 구현한다(Node 전용 web-push 라이브러리를 쓰지 않는다).
 *
 * 두 표준을 따른다.
 *  - RFC 8292 (VAPID): 우리 서버임을 증명하는 서명(ES256 JWT)을 Authorization 헤더에 붙인다.
 *  - RFC 8291 (aes128gcm): 알림 내용을 받는 기기만 풀 수 있게 암호화한다.
 * 비밀 키는 환경 변수 VAPID_PRIVATE_KEY(43자 base64url)로만 받는다 — 코드·로그에 남기지 않는다.
 * 올바른지는 webpush.test.ts가 Mozilla 구현(http_ece)으로 해독해 확인한다.
 */

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string; // base64url, 65바이트 공개 키
  auth: string; // base64url, 16바이트
}

export interface VapidKeys {
  publicKey: string; // base64url, 65바이트(0x04로 시작)
  privateKey: string; // base64url, 32바이트
  subject: string; // mailto: 또는 https:
}

const enc = new TextEncoder();
/** WebCrypto가 받는 바이트 배열(ArrayBuffer 기반) */
type Bytes = Uint8Array<ArrayBuffer>;

export function b64urlToBytes(s: string): Bytes {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(b: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** HKDF(RFC 5869) — 필요한 길이가 32바이트 이하라 Expand는 한 블록이면 된다 */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

/**
 * RFC 8291 aes128gcm 암호화. 시험을 위해 보내는 쪽 키와 salt를 바꿔 끼울 수 있다.
 * 결과 = salt(16) | 레코드 크기(4) | 키 길이(1) | 보내는 쪽 공개 키(65) | 암호문
 */
export async function encryptPayload(
  sub: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
  plaintext: Uint8Array,
  opts: { senderKeys?: CryptoKeyPair; salt?: Bytes } = {}
): Promise<Bytes> {
  const uaPublic = b64urlToBytes(sub.p256dh);
  const authSecret = b64urlToBytes(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('알림 구독 키 형식이 올바르지 않아요.');

  const as = opts.senderKeys ?? (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // 레코드 하나 — 끝 표시(0x02)를 붙이고 채움은 넣지 않는다
  const record = concat(plaintext, new Uint8Array([2]));
  const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record));

  const rs = 4096;
  const header = concat(salt, new Uint8Array([(rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255, asPublic.length]), asPublic);
  return concat(header, cipher);
}

/** RFC 8292 VAPID 서명(ES256 JWT) — aud는 알림 서버 주소의 origin, 유효 12시간 */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const pub = b64urlToBytes(vapid.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID 공개 키 형식이 올바르지 않아요.');
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256', d: vapid.privateKey,
    x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)), ext: true,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = bytesToB64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: vapid.subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body)));
  return 'vapid t=' + head + '.' + body + '.' + bytesToB64url(sig) + ', k=' + vapid.publicKey;
}

/** 알림 서버로 보낼 주소는 알려진 브라우저 알림 서버만 허용한다(요청 위조로 다른 곳에 보내지 않게) */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname;
    return (
      h === 'fcm.googleapis.com' ||
      h.endsWith('.push.apple.com') ||
      h === 'updates.push.services.mozilla.com' ||
      h.endsWith('.notify.windows.com')
    );
  } catch {
    return false;
  }
}

export type PushResult = 'sent' | 'gone' | 'failed';

/** 한 기기에 알림 하나. 404/410이면 그 구독은 만료라 'gone'(호출한 쪽이 지운다) */
export async function sendPush(
  sub: PushSubscriptionKeys,
  payload: unknown,
  vapid: VapidKeys,
  ttlSec = 3600,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = (i, init) => fetch(i, init)
): Promise<PushResult> {
  if (!isAllowedPushEndpoint(sub.endpoint)) return 'failed';
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(payload)));
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttlSec),
      Urgency: 'normal',
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return 'gone';
  if (!res.ok) {
    console.error('[push] 전송 실패', res.status, new URL(sub.endpoint).hostname);
    return 'failed';
  }
  return 'sent';
}
