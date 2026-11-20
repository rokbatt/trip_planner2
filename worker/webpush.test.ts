import { describe, it, expect } from 'vitest';
// 이 저장소는 @types/node를 쓰지 않는다 — 시험에서만 쓰는 Node 기능이라 타입 없이 가져온다
// @ts-expect-error — node:crypto 타입 정의 없음
import { createECDH, randomBytes } from 'node:crypto';
// @ts-expect-error — 타입 정의가 없는 Mozilla 참조 구현(시험에서만 쓴다)
import ece from 'http_ece';
import { encryptPayload, vapidAuthorization, isAllowedPushEndpoint, b64urlToBytes, bytesToB64url } from './webpush';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Buffer: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Buffer = any;

const b64u = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('encryptPayload (RFC 8291 aes128gcm)', () => {
  it('Mozilla 참조 구현(http_ece)이 그대로 해독한다', async () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = randomBytes(16);
    const text = JSON.stringify({ title: '몽실이', body: '내일 방콕 비 소식이 있어요 ☔' });
    const body = await encryptPayload({ p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) }, new TextEncoder().encode(text));
    const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: auth });
    expect(plain.toString('utf8')).toBe(text);
  });

  it('보내는 쪽 키·salt가 같으면 참조 구현의 암호문과 바이트까지 같다', async () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const sender = createECDH('prime256v1');
    sender.generateKeys();
    const auth = randomBytes(16);
    const salt = randomBytes(16);
    const text = Buffer.from('When I grow up, I want to be a watermelon');

    const ref: Buffer = ece.encrypt(text, { version: 'aes128gcm', privateKey: sender, dh: b64u(ua.getPublicKey()), authSecret: b64u(auth), salt: b64u(salt), rs: 4096 });

    const pub = sender.getPublicKey();
    const jwk = { kty: 'EC', crv: 'P-256', d: b64u(sender.getPrivateKey()), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), ext: true };
    const senderKeys = {
      privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
      publicKey: await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
    } as CryptoKeyPair;
    const mine = await encryptPayload({ p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) }, new Uint8Array(text), { senderKeys, salt: new Uint8Array(salt) });
    expect(Buffer.from(mine).toString('hex')).toBe(ref.toString('hex'));
  });

  it('구독 키 형식이 틀리면 거부', async () => {
    await expect(encryptPayload({ p256dh: 'abc', auth: 'def' }, new Uint8Array([1]))).rejects.toThrow();
  });
});

describe('vapidAuthorization (RFC 8292)', () => {
  it('ES256 서명이 공개 키로 검증되고 aud·exp·sub가 맞다', async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const publicKey = bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
    const privateKey = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d!;
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { publicKey, privateKey, subject: 'mailto:help@mongsil2.com' }, 1_000_000);

    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m[4]).toBe(publicKey);
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(m[2])));
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_000_000 + 12 * 3600, sub: 'mailto:help@mongsil2.com' });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, b64urlToBytes(m[3]), new TextEncoder().encode(m[1] + '.' + m[2]));
    expect(ok).toBe(true);
  });
});

describe('isAllowedPushEndpoint', () => {
  it('브라우저 알림 서버만 허용', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://evil.example.com/push')).toBe(false);
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('not a url')).toBe(false);
  });
});
