import { describe, it, expect } from 'vitest';
import { approxLocalHour, candidates, localTomorrow, covers, weatherMessage, pickDay, runWeatherAlerts, type DestRow } from './weatherAlert';

const bkk: DestRow = { trip_id: 't1', name: '방콕', lat: 13.75, lng: 100.5, start_date: '2026-11-20', end_date: '2026-11-23' };
const pkt: DestRow = { trip_id: 't1', name: '푸켓', lat: 7.88, lng: 98.39, start_date: '2026-11-23', end_date: '2026-11-26' };
const prg: DestRow = { trip_id: 't2', name: '프라하', lat: 50.08, lng: 14.43, start_date: '2026-11-20', end_date: '2026-11-25' };

// 2026-11-20 13:00 UTC = 방콕 20:00(+7), 프라하 14:00(+1)
const NOW = Date.parse('2026-11-20T13:00:00Z');

describe('현지 시각 고르기', () => {
  it('경도로 어림한 시각', () => {
    expect(approxLocalHour(NOW, 100.5)).toBe(20);
    expect(approxLocalHour(NOW, 14.43)).toBe(14);
  });
  it('저녁 무렵인 여행지만 후보', () => {
    expect(candidates([bkk, prg, { ...bkk, lat: null }], NOW)).toEqual([bkk]);
  });
  it('정확한 시차로 저녁 8시·현지 내일', () => {
    expect(localTomorrow(NOW, 7 * 3600)).toEqual({ isSendHour: true, tomorrow: '2026-11-21' });
    expect(localTomorrow(NOW, 8 * 3600)).toEqual({ isSendHour: false, tomorrow: '2026-11-21' });
    // 서울 +9: 11:00 UTC = 20:00 → 다음 날
    expect(localTomorrow(Date.parse('2026-11-20T11:00:00Z'), 9 * 3600)).toEqual({ isSendHour: true, tomorrow: '2026-11-21' });
  });
  it('끝나는 날까지 포함', () => {
    expect(covers(bkk, '2026-11-23')).toBe(true);
    expect(covers(bkk, '2026-11-24')).toBe(false);
  });
});

describe('weatherMessage', () => {
  it('비·더위·자외선을 한 번에', () => {
    const m = weatherMessage('방콕', { code: 80, maxC: 33.4, minC: 26.1, rainPct: 70, uv: 11, windKmh: 12 })!;
    expect(m.title).toBe('내일 방콕 · 소나기 33° / 26°');
    expect(m.body).toBe('비 올 확률 70% · 우산 꼭 챙기세요\n무더위 · 물 자주 마시기\n자외선 매우 강함 · 선크림');
  });
  it('추운 날', () => {
    expect(weatherMessage('프라하', { code: 3, maxC: 4, minC: -2, rainPct: 10, uv: 1, windKmh: 45 })!.body).toBe('영하 · 두꺼운 외투\n바람이 강해요');
  });
  it('특별한 게 없으면 좋은 날씨', () => {
    expect(weatherMessage('교토', { code: 1, maxC: 22, minC: 13, rainPct: 5, uv: 4, windKmh: 10 })!.body).toBe('외출하기 좋은 날씨예요.');
  });
  it('모르는 코드는 보내지 않는다', () => {
    expect(weatherMessage('x', { code: 999, maxC: 1, minC: 1, rainPct: null, uv: null, windKmh: null })).toBeNull();
  });
});

describe('pickDay', () => {
  it('그 날짜 칸을 고르고 빈 값은 null', () => {
    const m = { daily: { time: ['2026-11-20', '2026-11-21'], weather_code: [0, 61], temperature_2m_max: [30, 29], temperature_2m_min: [24, 23], precipitation_probability_max: [0, null] } };
    expect(pickDay(m, '2026-11-21')).toEqual({ code: 61, maxC: 29, minC: 23, rainPct: null, uv: null, windKmh: null });
    expect(pickDay(m, '2026-11-25')).toBeNull();
  });
});

describe('runWeatherAlerts', () => {
  it('저녁 8시인 여행의 멤버에게만, 내일 옮겨 가는 도시 날씨로', async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const dev = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const env = {
      SUPABASE_URL: 'https://db.example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      VAPID_PUBLIC_KEY: b64u(pub),
      VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', kp.privateKey)).d!,
      VAPID_SUBJECT: 'mailto:help@mongsil2.com',
    };
    // 방콕 마지막 밤(내일 푸켓으로 이동)
    const lastNight = Date.parse('2026-11-22T13:00:00Z');
    const meteoAsked: string[] = [];
    const subsFor: string[] = [];
    let pushes = 0;
    const f = async (url: string) => {
      if (url.includes('/rest/v1/trip_destinations')) return Response.json([bkk, pkt, prg]);
      if (url.startsWith('https://api.open-meteo.com/')) {
        meteoAsked.push(new URL(url).searchParams.get('latitude')!);
        return Response.json({ utc_offset_seconds: 7 * 3600, daily: { time: ['2026-11-22', '2026-11-23'], weather_code: [0, 95], temperature_2m_max: [31, 32], temperature_2m_min: [25, 26], precipitation_probability_max: [0, 80], uv_index_max: [5, 9], wind_speed_10m_max: [10, 20] } });
      }
      if (url.includes('/rest/v1/trip_members')) return Response.json([{ user_id: 'u1' }, { user_id: 'u2' }]);
      if (url.includes('/rest/v1/push_subscriptions?select=')) {
        subsFor.push(url);
        return Response.json(url.includes('u1') ? [{ id: 's1', endpoint: 'https://fcm.googleapis.com/x', p256dh: b64u(new Uint8Array(await crypto.subtle.exportKey('raw', dev.publicKey))), auth: b64u(new Uint8Array(16)) }] : []);
      }
      if (url.startsWith('https://fcm.googleapis.com/')) { pushes++; return new Response(null, { status: 201 }); }
      return new Response(null, { status: 204 });
    };
    const r = await runWeatherAlerts(env, lastNight, f);
    expect(r).toMatchObject({ checked: 1, sentTrips: 1, devices: 1 });
    expect(meteoAsked).toEqual(['13.75', '7.88']); // 방콕으로 시각 확인 → 푸켓 날씨
    expect(subsFor).toHaveLength(2);
    expect(pushes).toBe(1);
  });

  it('설정이 없으면 아무것도 부르지 않는다', async () => {
    const r = await runWeatherAlerts({}, NOW, async () => { throw new Error('no'); });
    expect(r.skipped[0]).toContain('설정 없음');
  });
});
