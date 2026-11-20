/**
 * 휴대폰 알림(웹 푸시) 켜기·끄기·시험 — 브라우저 쪽.
 *
 * 흐름: 알림 권한 → 서비스워커 pushManager.subscribe(공개 키) → 받은 주소·키를 Supabase
 * push_subscriptions에 저장(본인 줄만, RLS) → 서버(worker/notify.ts)가 그 주소로 보낸다.
 *
 * 아이폰은 "홈 화면에 추가"로 설치한 앱에서만 웹 알림을 받을 수 있다(iOS 16.4+). 사파리 탭에서는
 * PushManager가 아예 없어서, 그때는 설치 방법을 안내한다.
 */
import { supabase } from '../supabase';
import { apiFetch } from '../utils/apiFetch';

export type PushSupport = 'ok' | 'ios-install' | 'unsupported' | 'no-key';

export interface PushEnvProbe {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  isIOS: boolean;
  standalone: boolean;
  vapidKey: string | undefined;
}

/** 이 기기에서 알림을 켤 수 있는가 — 순수 함수(시험용) */
export function pushSupport(p: PushEnvProbe): PushSupport {
  if (!p.vapidKey) return 'no-key';
  if (p.isIOS && !p.standalone) return 'ios-install';
  if (!p.hasServiceWorker || !p.hasPushManager || !p.hasNotification) return 'unsupported';
  return 'ok';
}

function probe(): PushEnvProbe {
  const nav = navigator as Navigator & { standalone?: boolean };
  const ua = navigator.userAgent;
  // 아이패드 데스크톱 모드는 Macintosh로 나오지만 터치가 있다
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return {
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: typeof window !== 'undefined' && 'PushManager' in window,
    hasNotification: typeof window !== 'undefined' && 'Notification' in window,
    isIOS,
    standalone: nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true,
    vapidKey: import.meta.env.VITE_VAPID_PUBLIC_KEY || undefined,
  };
}

export function currentPushSupport(): PushSupport {
  return pushSupport(probe());
}

/** base64url → 바이트(applicationServerKey용) */
export function urlBase64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 브라우저 구독 객체 → 저장할 줄. 키가 빠진 구독은 null */
export function subscriptionRow(sub: { endpoint: string; keys?: { p256dh?: string; auth?: string } }, userId: string) {
  const p256dh = sub.keys?.p256dh;
  const auth = sub.keys?.auth;
  if (!sub.endpoint || !p256dh || !auth) return null;
  return { user_id: userId, endpoint: sub.endpoint, p256dh, auth };
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // 개발 서버에서는 서비스워커를 등록하지 않는다(main.ts) — 기다리면 영원히 안 끝난다
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), 4000)),
  ]);
  return reg;
}

/** 이 기기에서 지금 알림이 켜져 있나(권한 + 구독) */
export async function isPushOn(): Promise<boolean> {
  if (currentPushSupport() !== 'ok' || Notification.permission !== 'granted') return false;
  const reg = await registration();
  return !!(await reg?.pushManager.getSubscription());
}

export type EnableResult = 'on' | 'denied' | 'unsupported' | 'no-table' | 'error';

export async function enablePush(): Promise<EnableResult> {
  if (currentPushSupport() !== 'ok') return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const reg = await registration();
  if (!reg) return 'unsupported';
  try {
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(import.meta.env.VITE_VAPID_PUBLIC_KEY!) }));
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return 'error';
    const row = subscriptionRow(sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } }, uid);
    if (!row) return 'error';
    const { error } = await supabase.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' });
    if (error) {
      // 42P01: 표가 아직 없다(supabase/push_subscriptions.sql을 안 돌림)
      if (error.code === '42P01' || /push_subscriptions/.test(error.message)) return 'no-table';
      return 'error';
    }
    return 'on';
  } catch (e) {
    console.warn('[push] 구독 실패', e);
    return 'error';
  }
}

/** 이 기기 알림 끄기 — 브라우저 구독을 끊고 저장한 줄도 지운다 */
export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe().catch(() => false);
}

/** 로그아웃·탈퇴 때 — 이 기기로 다른 사람 알림이 오지 않게 구독을 끊는다(실패해도 조용히) */
export async function dropPushOnSignOut(): Promise<void> {
  try {
    await disablePush();
  } catch {
    /* 무시 */
  }
}

export type TestResult = { ok: true; sent: number } | { ok: false; message: string };

export async function sendTestPush(): Promise<TestResult> {
  try {
    const res = await apiFetch('/api/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'test' }),
    });
    const j = (await res.json().catch(() => ({}))) as { sent?: number; error?: string };
    if (!res.ok) return { ok: false, message: j.error || '알림을 보내지 못했어요.' };
    if (!j.sent) return { ok: false, message: '알림을 켠 기기를 찾지 못했어요. 끄고 다시 켜 주세요.' };
    return { ok: true, sent: j.sent };
  } catch {
    return { ok: false, message: '인터넷 연결을 확인해 주세요.' };
  }
}
