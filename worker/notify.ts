/**
 * /api/notify — 휴대폰 알림 보내기 (Worker 전용 주소).
 *
 * api/ 폴더에 파일을 만들지 않고 Worker에서 바로 처리한다. Vercel 무료 플랜의 서버 함수 12개 한도를
 * 넘기지 않기 위해서다(5단계에서 Vercel을 정리하면 이 제약은 없어진다).
 *
 * 지금 하는 일: { kind: 'test' } → 로그인한 본인이 알림을 켠 기기 전부에 시험 알림 1건.
 * 다음 PR(날씨·"어디야?")에서 같은 발송 함수 sendToUser()를 쓴다.
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

export async function handleNotify(request: Request, env: NotifyEnv, f: FetchLike = (i, init) => fetch(i, init)): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const miss = missingNotifyEnv(env);
  if (miss.length) {
    console.warn('[notify] 서버 설정 없음: ' + miss.join(', '));
    return json(503, { error: '알림 서버 설정이 아직 없어요.', code: 'not_configured' });
  }

  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!m) return json(401, { error: '로그인이 필요해요.' });

  let body: { kind?: unknown } = {};
  try {
    body = (await request.json()) as { kind?: unknown };
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

  return json(400, { error: '모르는 알림 종류예요.' });
}
