/**
 * /api/notify — 휴대폰 알림 보내기 (Worker 전용 주소).
 *
 * api/ 폴더에 파일을 만들지 않고 Worker에서 바로 처리한다. Vercel 무료 플랜의 서버 함수 12개 한도를
 * 넘기지 않기 위해서다(5단계에서 Vercel을 정리하면 이 제약은 없어진다).
 *
 * 종류
 *   { kind: 'test' }                       → 로그인한 본인 기기 전부에 시험 알림
 *   { kind: 'where', tripId, to }          → 같은 여행 일행에게 "어디야?" (누르면 위치를 한 번 보낼지 묻는 화면)
 *   { kind: 'here', tripId, to, lat, lng } → 물어본 사람에게 내 위치 한 번 (누르면 길찾기)
 * 위치는 서버에 저장하지 않는다 — 암호화된 알림 안에만 실려 상대 기기로 간다.
 * where·here는 보내는 사람과 받는 사람이 **둘 다 그 여행 멤버**일 때만 보낸다.
 *
 * 비밀값: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 * (Cloudflare 대시보드 → Worker → Settings → Variables and Secrets). 코드에 쓰지 않는다.
 */
import { sendPush, isAllowedPushEndpoint, type VapidKeys } from './webpush';

export interface NotifyEnv {
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PushMessage {
  title: string;
  body: string;
  /** 알림을 누르면 열 앱 안 주소(같은 사이트 경로만) */
  url?: string;
  /** 같은 tag의 알림은 새 것으로 바뀐다(쌓이지 않는다) */
  tag?: string;
}

/** 한 사람에게 보내는 기기 수 상한 — 외부 호출 한도(요청당 50번) 안에 머물게 */
const MAX_DEVICES = 10;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** 설정이 빠졌는지 — 빠진 "이름"만 돌려준다(값은 절대 안 보낸다) */
export function missingNotifyEnv(env: NotifyEnv): string[] {
  const miss: string[] = [];
  if (!(env.SUPABASE_URL || env.VITE_SUPABASE_URL)) miss.push('SUPABASE_URL');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) miss.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!env.VAPID_PUBLIC_KEY) miss.push('VAPID_PUBLIC_KEY');
  if (!env.VAPID_PRIVATE_KEY) miss.push('VAPID_PRIVATE_KEY');
  if (!env.VAPID_SUBJECT) miss.push('VAPID_SUBJECT');
  return miss;
}

/** 알림을 누르면 열 주소는 우리 사이트 안 경로만 허용한다(다른 사이트로 보내는 알림 금지) */
export function safeAppPath(url: string | undefined): string {
  if (!url || !url.startsWith('/') || url.startsWith('//')) return '/';
  return url.slice(0, 300);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** 같은 요청을 짧은 시간에 되풀이하지 못하게 — 처음이면 true. 없으면(로컬·시험) 항상 true */
export interface Limiter {
  first(key: string, seconds: number): Promise<boolean>;
}

/** 알림 안에 실을 이름 — 줄바꿈 없애고 짧게 */
export function cleanName(v: string | null | undefined): string {
  const t = (v ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return t || '일행';
}

/** 앱 안 주소 + 쿼리. 해시 라우트(#trip/:id/go) 앞에 붙여 Companion 화면이 읽는다(src/mobile/where.ts) */
export function appLink(tripId: string, params: Record<string, string>): string {
  return '/?' + new URLSearchParams(params).toString() + '#trip/' + tripId + '/go';
}

export class Db {
  constructor(private base: string, private key: string, private f: FetchLike) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.key, authorization: 'Bearer ' + this.key, ...extra };
  }

  /** 로그인 토큰 → 사용자 id. 토큰이 틀리면 null */
  async userId(token: string): Promise<string | null> {
    const res = await this.f(this.base + '/auth/v1/user', { headers: { apikey: this.key, authorization: 'Bearer ' + token } });
    if (!res.ok) return null;
    const u = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return typeof u?.id === 'string' ? u.id : null;
  }

  async subscriptions(userId: string): Promise<{ id: string; endpoint: string; p256dh: string; auth: string }[] | null> {
    const q = '/rest/v1/push_subscriptions?select=id,endpoint,p256dh,auth&user_id=eq.' + encodeURIComponent(userId) +
      '&order=created_at.desc&limit=' + MAX_DEVICES;
    const res = await this.f(this.base + q, { headers: this.headers() });
    if (!res.ok) return null;
    return (await res.json()) as { id: string; endpoint: string; p256dh: string; auth: string }[];
  }

  /** 그 여행에서 이 사람들이 멤버인지 + 표시 이름 */
  async members(tripId: string, userIds: string[]): Promise<Map<string, string | null> | null> {
    const q = '/rest/v1/trip_members?select=user_id,display_name&trip_id=eq.' + tripId + '&user_id=in.(' + userIds.join(',') + ')';
    const res = await this.f(this.base + q, { headers: this.headers() });
    if (!res.ok) return null;
    const rows = (await res.json()) as { user_id: string; display_name: string | null }[];
    return new Map(rows.map((r) => [r.user_id, r.display_name]));
  }

  async remove(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.f(this.base + '/rest/v1/push_subscriptions?id=in.(' + ids.map(encodeURIComponent).join(',') + ')', {
      method: 'DELETE',
      headers: this.headers(),
    });
  }

  async touch(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.f(this.base + '/rest/v1/push_subscriptions?id=in.(' + ids.map(encodeURIComponent).join(',') + ')', {
      method: 'PATCH',
      headers: this.headers({ 'content-type': 'application/json', prefer: 'return=minimal' }),
      body: JSON.stringify({ last_ok_at: new Date().toISOString() }),
    });
  }
}

export interface SendResult { sent: number; gone: number; failed: number; devices: number }

/** 한 사람이 알림을 켠 기기 전부에 보낸다. 브라우저가 "구독 끝남(404/410)"이라 하면 그 줄을 지운다 */
export async function sendToUser(
  db: Db,
  userId: string, msg: PushMessage,
  vapid: VapidKeys,
  f: FetchLike
): Promise<SendResult | null> {
  const subs = await db.subscriptions(userId);
  if (!subs) return null;
  const payload = { title: msg.title.slice(0, 80), body: msg.body.slice(0, 240), url: safeAppPath(msg.url), tag: msg.tag };
  const results = await Promise.all(
    subs.map(async (s) => {
      if (!isAllowedPushEndpoint(s.endpoint)) return { id: s.id, r: 'gone' as const };
      try {
        return { id: s.id, r: await sendPush(s, payload, vapid, 3600, f) };
      } catch {
        return { id: s.id, r: 'failed' as const };
      }
    })
  );
  const gone = results.filter((x) => x.r === 'gone').map((x) => x.id);
  const sent = results.filter((x) => x.r === 'sent').map((x) => x.id);
  await Promise.all([db.remove(gone), db.touch(sent)]).catch(() => undefined);
  return { sent: sent.length, gone: gone.length, failed: results.length - sent.length - gone.length, devices: subs.length };
}

export async function handleNotify(
  request: Request,
  env: NotifyEnv,
  f: FetchLike = (i, init) => fetch(i, init),
  limiter?: Limiter
): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const miss = missingNotifyEnv(env);
  if (miss.length) {
    console.warn('[notify] 서버 설정 없음: ' + miss.join(', '));
    return json(503, { error: '알림 서버 설정이 아직 없어요.', code: 'not_configured' });
  }

  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!m) return json(401, { error: '로그인이 필요해요.' });

  let body: { kind?: unknown; tripId?: unknown; to?: unknown; lat?: unknown; lng?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: '요청 형식이 올바르지 않아요.' });
  }

  const base = (env.SUPABASE_URL || env.VITE_SUPABASE_URL)!.replace(/\/+$/, '');
  const db = new Db(base, env.SUPABASE_SERVICE_ROLE_KEY!, f);
  const uid = await db.userId(m[1]);
  if (!uid) return json(401, { error: '로그인이 필요해요.' });

  const vapid: VapidKeys = { publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY!, subject: env.VAPID_SUBJECT! };

  if (body.kind === 'test') {
    const r = await sendToUser(db, uid, { title: '몽실이 알림', body: '알림이 잘 와요. 여행 중 소식을 여기로 알려 드릴게요.', url: '/', tag: 'test' }, vapid, f);
    if (!r) return json(503, { error: '알림 저장소가 아직 준비되지 않았어요.', code: 'no_table' });
    return json(200, r);
  }

  if (body.kind === 'where' || body.kind === 'here') {
    const { tripId, to } = body;
    if (!isUuid(tripId) || !isUuid(to) || to === uid) return json(400, { error: '받는 사람이 올바르지 않아요.' });
    let lat = 0;
    let lng = 0;
    if (body.kind === 'here') {
      lat = Number(body.lat);
      lng = Number(body.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return json(400, { error: '위치가 올바르지 않아요.' });
      }
    }

    const mem = await db.members(tripId, [uid, to]);
    if (!mem) return json(503, { error: '잠시 뒤 다시 시도해 주세요.' });
    if (!mem.has(uid) || !mem.has(to)) return json(403, { error: '같은 여행 일행에게만 보낼 수 있어요.' });

    // 같은 사람에게 연달아 누르는 것 막기("어디야?" 30초, 위치 10초)
    const wait = body.kind === 'where' ? 30 : 10;
    if (limiter && !(await limiter.first(body.kind + ':' + uid + ':' + to, wait))) {
      return json(429, { error: '방금 보냈어요. 잠시 뒤 다시 눌러 주세요.' });
    }

    const name = cleanName(mem.get(uid));
    const msg: PushMessage =
      body.kind === 'where'
        ? {
            title: name + '님이 "어디야?"',
            body: '눌러서 지금 위치를 한 번 보내 주세요.',
            url: appLink(tripId, { where_from: uid, where_name: name }),
            tag: 'where-' + uid,
          }
        : {
            title: name + '님 위치가 왔어요',
            body: '눌러서 바로 길찾기',
            url: appLink(tripId, { here_lat: lat.toFixed(6), here_lng: lng.toFixed(6), here_name: name, here_at: String(Date.now()) }),
            tag: 'here-' + uid,
          };
    const r = await sendToUser(db, to, msg, vapid, f);
    if (!r) return json(503, { error: '알림 저장소가 아직 준비되지 않았어요.', code: 'no_table' });
    return json(200, r);
  }

  return json(400, { error: '모르는 알림 종류예요.' });
}
