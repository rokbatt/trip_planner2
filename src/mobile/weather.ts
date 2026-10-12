/**
 * 날씨 — Open-Meteo (무료, **API 키 없음**).
 *
 * 키가 필요 없는 API를 고른 이유가 설계상 중요하다: `api/*.ts`가 Vercel Hobby 상한인 12개를
 * 이미 꽉 채워서(원칙 3-7) 날씨용 서버 함수를 새로 만들 수 없다. 키가 있는 API였다면 키를
 * 숨길 서버 경유가 필요했을 텐데, Open-Meteo는 브라우저에서 바로 부를 수 있어 상한을 건드리지
 * 않는다. 키가 없으니 프런트에 노출될 비밀도 없다.
 *
 * 돌려주는 값의 성격을 **오늘과 미래로 구분**한다 — 내일 일정에 지금 기온을 보여주면 거짓이다.
 *   · 오늘  → `current`  (지금 기온)
 *   · 미래  → `daily`    (그날 최고/최저)
 *   · 과거  → 아무것도 안 준다 (지난 날씨는 여행 중에 쓸모가 없고, 아카이브 API가 따로 필요하다)
 *
 * 실패하면 **null**이다. 원칙 3-1 — 날씨를 못 받았으면 그 줄을 지우지, 지어내지 않는다.
 */

export interface WeatherNow {
  kind: 'now';
  tempC: number;
  label: string;
  icon: WeatherIcon;
}
export interface WeatherDay {
  kind: 'day';
  maxC: number;
  minC: number;
  label: string;
  icon: WeatherIcon;
}
export type Weather = WeatherNow | WeatherDay;

export type WeatherIcon = 'sun' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog';

/**
 * WMO 기상 코드 → 한국어 + 아이콘.
 * Open-Meteo가 쓰는 WMO 해석 코드표를 그대로 따른다. **모르는 코드는 추측하지 않고**
 * null을 돌려 그 줄을 지운다 — "맑음"이라고 찍었다가 스콜을 맞으면 안 쓰느니만 못하다.
 */
export function interpret(code: number): { label: string; icon: WeatherIcon } | null {
  if (code === 0) return { label: '맑음', icon: 'sun' };
  if (code === 1) return { label: '대체로 맑음', icon: 'sun' };
  if (code === 2) return { label: '구름 조금', icon: 'cloud' };
  if (code === 3) return { label: '흐림', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: '안개', icon: 'fog' };
  if (code >= 51 && code <= 57) return { label: '이슬비', icon: 'rain' };
  if (code >= 61 && code <= 67) return { label: '비', icon: 'rain' };
  if (code >= 71 && code <= 77) return { label: '눈', icon: 'snow' };
  if (code >= 80 && code <= 82) return { label: '소나기', icon: 'rain' };
  if (code === 85 || code === 86) return { label: '눈 소나기', icon: 'snow' };
  if (code >= 95 && code <= 99) return { label: '뇌우', icon: 'storm' };
  return null;
}

/** 같은 좌표·같은 날을 반복해서 묻지 않는다(원칙 3-2). 세션 메모리면 충분하다. */
const cache = new Map<string, { at: number; value: Weather | null }>();
const TTL_MS = 30 * 60 * 1000;

/** 좌표는 소수점 2자리(약 1km)로 뭉갠다 — 같은 도시 안에서 캐시가 갈리지 않게 */
function cacheKey(lat: number, lng: number, dateISO: string): string {
  return lat.toFixed(2) + ',' + lng.toFixed(2) + ',' + dateISO;
}

function todayISO(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * 그 좌표·그 날짜의 날씨. 못 받거나 범위를 벗어나면 null.
 * Open-Meteo 예보는 약 16일까지라, 그보다 먼 날짜는 아예 묻지 않는다.
 */
export async function fetchWeather(lat: number, lng: number, dateISO: string): Promise<Weather | null> {
  const key = cacheKey(lat, lng, dateISO);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const today = todayISO();
  if (dateISO < today) return null; // 지난 날씨는 다루지 않는다
  const daysAhead = Math.round(
    (new Date(dateISO + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000
  );
  if (daysAhead > 15) return null; // 예보 범위 밖 — 묻지 않는다

  const isToday = dateISO === today;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    timezone: 'auto',
  });
  if (isToday) params.set('current', 'temperature_2m,weather_code');
  else {
    params.set('daily', 'temperature_2m_max,temperature_2m_min,weather_code');
    params.set('start_date', dateISO);
    params.set('end_date', dateISO);
  }

  try {
    const res = await fetch('https://api.open-meteo.com/v1/forecast?' + params.toString());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();

    let value: Weather | null = null;
    if (isToday) {
      const t = json?.current?.temperature_2m;
      const c = json?.current?.weather_code;
      const meta = typeof c === 'number' ? interpret(c) : null;
      if (typeof t === 'number' && meta) value = { kind: 'now', tempC: Math.round(t), ...meta };
    } else {
      const max = json?.daily?.temperature_2m_max?.[0];
      const min = json?.daily?.temperature_2m_min?.[0];
      const c = json?.daily?.weather_code?.[0];
      const meta = typeof c === 'number' ? interpret(c) : null;
      if (typeof max === 'number' && typeof min === 'number' && meta) {
        value = { kind: 'day', maxC: Math.round(max), minC: Math.round(min), ...meta };
      }
    }

    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    // 네트워크가 불안한 해외에서 흔한 일이다 — 조용히 접고 그 줄을 안 그린다
    console.error('[Weather] 조회 실패:', e);
    // 실패도 잠깐 캐시해서 매 렌더마다 재시도하지 않게 한다
    cache.set(key, { at: Date.now(), value: null });
    return null;
  }
}

export function resetWeatherCache(): void {
  cache.clear();
}
