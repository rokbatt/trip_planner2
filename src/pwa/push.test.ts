import { describe, it, expect } from 'vitest';
import { pushSupport, subscriptionRow, urlBase64ToBytes, type PushEnvProbe } from './push';

const base: PushEnvProbe = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, isIOS: false, standalone: false, vapidKey: 'BAAA' };

describe('pushSupport', () => {
  it('안드로이드·PC 브라우저는 바로 가능', () => expect(pushSupport(base)).toBe('ok'));
  it('아이폰 사파리 탭은 홈 화면 설치 안내', () => {
    expect(pushSupport({ ...base, isIOS: true, hasPushManager: false })).toBe('ios-install');
    expect(pushSupport({ ...base, isIOS: true, standalone: true })).toBe('ok');
  });
  it('키가 없으면 준비 중, 기능이 없으면 미지원', () => {
    expect(pushSupport({ ...base, vapidKey: undefined })).toBe('no-key');
    expect(pushSupport({ ...base, hasPushManager: false })).toBe('unsupported');
  });
});

describe('subscriptionRow', () => {
  it('키가 다 있어야 저장', () => {
    expect(subscriptionRow({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } }, 'u')).toEqual({
      user_id: 'u', endpoint: 'https://fcm.googleapis.com/x', p256dh: 'p', auth: 'a',
    });
    expect(subscriptionRow({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p' } }, 'u')).toBeNull();
  });
});

describe('urlBase64ToBytes', () => {
  it('패딩 없는 base64url을 읽는다', () => {
    expect([...urlBase64ToBytes('-_8')]).toEqual([0xfb, 0xff]);
  });
});
