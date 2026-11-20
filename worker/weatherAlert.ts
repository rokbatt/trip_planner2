/**
 * 날씨 알림 — 여행지 **현지 시각 저녁 8시**에 "내일 날씨"를 그 여행 멤버들 휴대폰으로 보낸다.
 *
 * 위치가 아니라 **몽실이에 적힌 일정** 기준이다. 서버는 사용자의 현재 위치를 모르고(저장하지 않는다),
 * 아이폰 웹앱은 백그라운드 위치를 못 쓴다. 대신 "내일 머무는 여행지"(trip_destinations 날짜·좌표)는
 * 언제나 알 수 있고, 출발 전날에도 첫 도시 날씨를 알려 줄 수 있다.
 *
 * 매시 정각에 실행(wrangler.jsonc crons). 여행지마다 현지 시각을 따져 저녁 8시인 곳만 보낸다 —
 * 그래서 하루 한 번만 간다. 같은 tag라 혹시 두 번 가도 알림은 하나로 바뀐다.
 *
 * Open-Meteo는 키가 없는 무료 날씨 API다(src/mobile/weather.ts와 같은 곳).
 * 무료 Worker의 요청당 외부 호출 50번 안에 머물도록 한 번에 여행 MAX_TRIPS개까지만 처리한다.
 */
import { Db, sendToUser, missingNotifyEnv, type NotifyEnv } from './notify';
import { interpret } from '../src/mobile/weather';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const SEND_HOUR = 20;
const MAX_TRIPS = 6;

export interface DestRow {
  trip_id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  start_date: string | null;
  end_date: string | null;
}

export interface DayForecast {
  code: number;
  maxC: number;
  minC: number;
  rainPct: number | null;
  uv: number | null;
  windKmh: number | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (dateISO: string, n: number) => iso(new Date(Date.parse(dateISO + 'T00:00:00Z') + n * 86400000));

/** 경도로 어림한 현지 시각(시). 정확한 시차는 Open-Meteo 응답으로 다시 확인한다 */
export function approxLocalHour(nowMs: number, lng: number): number {
  const h = new Date(nowMs + Math.round(lng / 15) * 3600000).getUTCHours();
  return h;
}

/** 이 시각에 날씨를 물어볼 만한 여행지 — 어림 현지 시각이 19~21시이고 좌표·날짜가 있는 곳 */
export function candidates(rows: DestRow[], nowMs: number): DestRow[] {
  return rows.filter((r) => {
    if (r.lat == null || r.lng == null || !r.start_date || !r.end_date) return false;
    const h = approxLocalHour(nowMs, r.lng);
    return h >= SEND_HOUR - 1 && h <= SEND_HOUR + 1;
  });
}

/** 정확한 시차로 지금이 현지 저녁 8시인지 + 현지 기준 "내일" 날짜 */
export function localTomorrow(nowMs: number, utcOffsetSec: number): { isSendHour: boolean; tomorrow: string } {
  const local = new Date(nowMs + utcOffsetSec * 1000);
  return { isSendHour: local.getUTCHours() === SEND_HOUR, tomorrow: addDays(iso(local), 1) };
}

/** 내일 그 여행지에 머무는가(끝나는 날 포함) */
export const covers = (r: DestRow, dateISO: string) => !!r.start_date && !!r.end_date && r.start_date <= dateISO && dateISO <= r.end_date;

/** 알림 문구 — 순수 함수(시험용). 모르는 날씨 코드면 null(지어내지 않는다) */
export function weatherMessage(place: string, f: DayForecast): { title: string; body: string } | null {
  const w = interpret(f.code);
  if (!w) return null;
  const max = Math.round(f.maxC);
  const min = Math.round(f.minC);
  const tips: string[] = [];
  if (w.icon === 'storm') tips.push('뇌우 · 야외 일정은 조심하세요');
  if (f.rainPct != null && f.rainPct >= 60) tips.push('비 올 확률 ' + f.rainPct + '% · 우산 꼭 챙기세요');
  else if (f.rainPct != null && f.rainPct >= 30) tips.push('비 올 확률 ' + f.rainPct + '% · 접이식 우산 추천');
  if (w.icon === 'snow') tips.push('눈 소식 · 미끄럼 주의');
  if (max >= 33) tips.push('무더위 · 물 자주 마시기');
  else if (max >= 28) tips.push('더워요 · 가벼운 옷');
  if (min <= 0) tips.push('영하 · 두꺼운 외투');
  else if (min <= 8) tips.push('쌀쌀해요 · 겉옷 챙기기');
  if (f.uv != null && f.uv >= 8) tips.push('자외선 매우 강함 · 선크림');
  if (f.windKmh != null && f.windKmh >= 40) tips.push('바람이 강해요');
  return {
    title: '내일 ' + place + ' · ' + w.label + ' ' + max + '° / ' + min + '°',
    body: tips.length ? tips.slice(0, 3).join('\n') : '외출하기 좋은 날씨예요.',
  };
}

interface MeteoResponse {
  utc_offset_seconds?: number;
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: (number | null)[];
    uv_index_max?: (number | null)[];
    wind_speed_10m_max?: (number | null)[];
  };
}

export function pickDay(m: MeteoResponse, dateISO: string): DayForecast | null {
  const d = m.daily;
  const i = d?.time?.indexOf(dateISO) ?? -1;
  if (!d || i < 0) return null;
  const code = d.weather_code?.[i];
  const maxC = d.temperature_2m_max?.[i];
  const minC = d.temperature_2m_min?.[i];
  if (typeof code !== 'number' || typeof maxC !== 'number' || typeof minC !== 'number') return null;
  const num = (v: number | null | undefined) => (typeof v === 'number' ? v : null);
  return {
    code,
    maxC,
    minC,
    rainPct: num(d.precipitation_probability_max?.[i]),
    uv: num(d.uv_index_max?.[i]),
    windKmh: num(d.wind_speed_10m_max?.[i]),
  };
}

export interface WeatherRunResult { checked: number; sentTrips: number; devices: number; skipped: string[] }

export async function runWeatherAlerts(env: NotifyEnv, nowMs = Date.now(), f: FetchLike = (i, init) => fetch(i, init)): Promise<WeatherRunResult> {
  const out: WeatherRunResult = { checked: 0, sentTrips: 0, devices: 0, skipped: [] };
  const miss = missingNotifyEnv(env);
  if (miss.length) { out.skipped.push('설정 없음: ' + miss.join(', ')); return out; }

  const base = (env.SUPABASE_URL || env.VITE_SUPABASE_URL)!.replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY!;
  const db = new Db(base, key, f);
  const headers = { apikey: key, authorization: 'Bearer ' + key };
  const vapid = { publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY!, subject: env.VAPID_SUBJECT! };

  // 오늘~모레(UTC) 사이에 걸친 여행지만 — 시차가 있어도 현지 "내일"은 이 안에 든다
  const today = iso(new Date(nowMs));
  const q = '/rest/v1/trip_destinations?select=trip_id,name,lat,lng,start_date,end_date' +
    '&start_date=lte.' + addDays(today, 2) + '&end_date=gte.' + today + '&lat=not.is.null&lng=not.is.null&limit=200';
  const res = await f(base + q, { headers });
  if (!res.ok) { out.skipped.push('여행지 조회 실패 ' + res.status); return out; }
  const rows = candidates((await res.json()) as DestRow[], nowMs);

  // 여행마다 하나 — 내일 새 도시로 옮기면(그날 시작하는 여행지) 그쪽을 고른다
  const byTrip = new Map<string, DestRow[]>();
  for (const r of rows) byTrip.set(r.trip_id, [...(byTrip.get(r.trip_id) ?? []), r]);
  const trips = [...byTrip.entries()];
  if (trips.length > MAX_TRIPS) out.skipped.push('여행 ' + (trips.length - MAX_TRIPS) + '개는 한도 때문에 건너뜀');

  for (const [tripId, dests] of trips.slice(0, MAX_TRIPS)) {
    out.checked++;
    const probe = dests[0];
    const meteo = await f(
      'https://api.open-meteo.com/v1/forecast?' +
        new URLSearchParams({
          latitude: String(probe.lat),
          longitude: String(probe.lng),
          daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,wind_speed_10m_max',
          timezone: 'auto',
          forecast_days: '3',
        })
    );
    if (!meteo.ok) { out.skipped.push(tripId + ' 날씨 실패 ' + meteo.status); continue; }
    let m = (await meteo.json()) as MeteoResponse;
    const { isSendHour, tomorrow } = localTomorrow(nowMs, m.utc_offset_seconds ?? 0);
    if (!isSendHour) continue;

    const staying = dests.filter((d) => covers(d, tomorrow));
    if (!staying.length) continue;
    const dest = staying.find((d) => d.start_date === tomorrow) ?? staying[0];
    // 고른 도시가 처음 물어본 도시와 다르면 그 도시로 다시 묻는다(같은 여행 안 도시 이동)
    if (dest !== probe) {
      const again = await f(
        'https://api.open-meteo.com/v1/forecast?' +
          new URLSearchParams({
            latitude: String(dest.lat),
            longitude: String(dest.lng),
            daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,wind_speed_10m_max',
            timezone: 'auto',
            forecast_days: '3',
          })
      );
      if (!again.ok) continue;
      m = (await again.json()) as MeteoResponse;
    }
    const day = pickDay(m, tomorrow);
    const msg = day ? weatherMessage(dest.name, day) : null;
    if (!msg) continue;

    const mres = await f(base + '/rest/v1/trip_members?select=user_id&trip_id=eq.' + tripId, { headers });
    if (!mres.ok) continue;
    const members = (await mres.json()) as { user_id: string }[];
    let any = false;
    for (const mem of members) {
      const r = await sendToUser(db, mem.user_id, { ...msg, url: '/#trip/' + tripId + '/go', tag: 'weather-' + tripId }, vapid, f);
      if (r?.sent) { out.devices += r.sent; any = true; }
    }
    if (any) out.sentTrips++;
  }
  return out;
}
