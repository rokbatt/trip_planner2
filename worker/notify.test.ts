import { describe, it, expect } from 'vitest';
import { handleNotify, missingNotifyEnv, safeAppPath, type NotifyEnv } from './notify';
import { bytesToB64url } from './webpush';

async function vapidEnv(): Promise<NotifyEnv> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
  return {
    SUPABASE_URL: 'https://db.example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    VAPID_PUBLIC_KEY: bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', kp.privateKey)).d!,
    VAPID_SUBJECT: 'mailto:help@mongsil2.com',
  };
}

async function deviceKeys() {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  return {
    p256dh: bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))),
    auth: bytesToB64url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

const post = (body: unknown, token = 'user-token') =>
  new Request('https://www.mongsil2.com/api/notify', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('/api/notify', () => {
  it('설정이 빠지면 이름만 알려 주고 503', async () => {
    expect(missingNotifyEnv({})).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']);
    const res = await handleNotify(post({ kind: 'test' }), {}, async () => { throw new Error('호출하면 안 됨'); });
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('service');
  });

  it('토큰이 없거나 틀리면 401', async () => {
    const env = await vapidEnv();
    const noToken = new Request('https://x/api/notify', { method: 'POST', body: '{}' });
    expect((await handleNotify(noToken, env, async () => new Response('', { status: 500 }))).status).toBe(401);
    const bad = await handleNotify(post({ kind: 'test' }), env, async () => new Response('{}', { status: 401 }));
    expect(bad.status).toBe(401);
  });

  it('시험 알림: 내 기기에만 보내고, 끝난 구독은 지우고, 보낸 건 시각을 남긴다', async () => {
    const env = await vapidEnv();
    const a = await deviceKeys();
    const b = await deviceKeys();
    const calls: { url: string; method: string; headers: Headers }[] = [];
    const f = async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', headers: new Headers(init.headers) });
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: 'u-1' });
      if (url.includes('/rest/v1/push_subscriptions?select=')) {
        expect(url).toContain('user_id=eq.u-1');
        return Response.json([
          { id: 's-ok', endpoint: 'https://fcm.googleapis.com/fcm/send/aaa', ...a },
          { id: 's-gone', endpoint: 'https://web.push.apple.com/bbb', ...b },
          { id: 's-evil', endpoint: 'https://evil.example.com/x', ...b },
        ]);
      }
      if (url.startsWith('https://fcm.googleapis.com/')) return new Response(null, { status: 201 });
      if (url.startsWith('https://web.push.apple.com/')) return new Response(null, { status: 410 });
      return new Response(null, { status: 204 });
    };
    const res = await handleNotify(post({ kind: 'test' }), env, f);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, gone: 2, failed: 0, devices: 3 });

    expect(calls.some((c) => c.url.startsWith('https://evil.example.com'))).toBe(false);
    const push = calls.find((c) => c.url.startsWith('https://fcm.googleapis.com/'))!;
    expect(push.headers.get('content-encoding')).toBe('aes128gcm');
    expect(push.headers.get('authorization')).toMatch(/^vapid t=.+, k=/);
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(decodeURIComponent(del.url)).toContain('id=in.(s-gone,s-evil)');
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(decodeURIComponent(patch.url)).toContain('id=in.(s-ok)');
  });

  it('표가 아직 없으면 no_table', async () => {
    const env = await vapidEnv();
    const f = async (url: string) => (url.endsWith('/auth/v1/user') ? Response.json({ id: 'u-1' }) : new Response('{}', { status: 404 }));
    const res = await handleNotify(post({ kind: 'test' }), env, f);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('no_table');
  });

  it('모르는 종류·GET은 거부', async () => {
    const env = await vapidEnv();
    const f = async () => Response.json({ id: 'u-1' });
    expect((await handleNotify(post({ kind: 'spam' }), env, f)).status).toBe(400);
    expect((await handleNotify(new Request('https://x/api/notify'), env, f)).status).toBe(405);
  });
});

describe('safeAppPath', () => {
  it('우리 사이트 안 경로만', () => {
    expect(safeAppPath('/#trip/1/today')).toBe('/#trip/1/today');
    expect(safeAppPath('https://evil.com')).toBe('/');
    expect(safeAppPath('//evil.com')).toBe('/');
    expect(safeAppPath(undefined)).toBe('/');
  });
});

describe('/api/notify 어디야·위치', () => {
  const TRIP = '11111111-1111-4111-8111-111111111111';
  const ME = '22222222-2222-4222-8222-222222222222';
  const FRIEND = '33333333-3333-4333-8333-333333333333';
  const STRANGER = '44444444-4444-4444-8444-444444444444';

  async function setup(memberIds: string[]) {
    const env = await vapidEnv();
    const keys = await deviceKeys();
    const pushed: string[] = [];
    const subsFor: string[] = [];
    const f = async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: ME });
      if (url.includes('/rest/v1/trip_members')) {
        return Response.json(memberIds.map((id) => ({ user_id: id, display_name: id === ME ? '성현\n짱' : '친구' })));
      }
      if (url.includes('/rest/v1/push_subscriptions?select=')) {
        subsFor.push(decodeURIComponent(url));
        return Response.json([{ id: 's1', endpoint: 'https://fcm.googleapis.com/fcm/send/f', ...keys }]);
      }
      if (url.startsWith('https://fcm.googleapis.com/')) { pushed.push(String(init.body ? 'x' : '')); return new Response(null, { status: 201 }); }
      return new Response(null, { status: 204 });
    };
    return { env, f, pushed, subsFor };
  }

  it('같은 여행 일행에게만 "어디야?"를 보낸다', async () => {
    const ok = await setup([ME, FRIEND]);
    const res = await handleNotify(post({ kind: 'where', tripId: TRIP, to: FRIEND }), ok.env, ok.f);
    expect(res.status).toBe(200);
    expect(ok.subsFor[0]).toContain('user_id=eq.' + FRIEND);

    const no = await setup([ME]);
    expect((await handleNotify(post({ kind: 'where', tripId: TRIP, to: STRANGER }), no.env, no.f)).status).toBe(403);
    expect(no.pushed).toHaveLength(0);
  });

  it('형식이 틀린 id·나 자신·이상한 좌표는 거부', async () => {
    const s = await setup([ME, FRIEND]);
    expect((await handleNotify(post({ kind: 'where', tripId: 'x', to: FRIEND }), s.env, s.f)).status).toBe(400);
    expect((await handleNotify(post({ kind: 'where', tripId: TRIP, to: ME }), s.env, s.f)).status).toBe(400);
    expect((await handleNotify(post({ kind: 'here', tripId: TRIP, to: FRIEND, lat: 200, lng: 0 }), s.env, s.f)).status).toBe(400);
    expect((await handleNotify(post({ kind: 'here', tripId: TRIP, to: FRIEND, lat: 'a', lng: 0 }), s.env, s.f)).status).toBe(400);
    expect((await handleNotify(post({ kind: 'here', tripId: TRIP, to: FRIEND, lat: 13.75, lng: 100.5 }), s.env, s.f)).status).toBe(200);
  });

  it('연타는 막는다', async () => {
    const s = await setup([ME, FRIEND]);
    const seen = new Set<string>();
    const limiter = { first: async (k: string) => (seen.has(k) ? false : (seen.add(k), true)) };
    expect((await handleNotify(post({ kind: 'where', tripId: TRIP, to: FRIEND }), s.env, s.f, limiter)).status).toBe(200);
    expect((await handleNotify(post({ kind: 'where', tripId: TRIP, to: FRIEND }), s.env, s.f, limiter)).status).toBe(429);
  });
});

describe('appLink · cleanName', () => {
  it('Companion 주소에 쿼리를 붙이고 이름은 한 줄로 짧게', async () => {
    const { appLink, cleanName } = await import('./notify');
    expect(appLink('t1', { where_from: 'u', where_name: '성현 짱' })).toBe('/?where_from=u&where_name=%EC%84%B1%ED%98%84+%EC%A7%B1#trip/t1/go');
    expect(cleanName('성현\n짱')).toBe('성현 짱');
    expect(cleanName('  ')).toBe('일행');
    expect(cleanName('가'.repeat(40))).toHaveLength(20);
  });
});
