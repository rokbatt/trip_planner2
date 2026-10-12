/**
 * 날씨 모듈 테스트.
 *
 * 이 코드의 출력은 사용자가 **우산을 챙길지**를 가르는 근거다. 그래서 검증하는 건
 * "날씨를 잘 가져오는가"(그건 Open-Meteo의 몫이다)가 아니라 다음 두 가지다:
 *
 *   1. **모르는 코드를 아는 척하지 않는가** — 해석할 수 없는 WMO 코드는 null이어야 한다.
 *      기본값을 "맑음"으로 두면 스콜 오는 날 맑다고 찍힌다(원칙 3-1).
 *   2. **오늘과 미래를 섞지 않는가** — 내일 칸에 지금 기온을 보여주면 거짓이다.
 *      오늘은 `current`, 미래는 그 날짜의 `daily`를 물어야 한다.
 *
 * 네트워크는 타지 않는다(이 저장소의 테스트는 전부 그렇다). fetch를 가로채 호출된 URL과
 * 응답 해석만 본다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { interpret, fetchWeather, resetWeatherCache } from './weather';

function iso(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

describe('interpret (WMO 코드)', () => {
  it('맑음 계열', () => {
    expect(interpret(0)).toEqual({ label: '맑음', icon: 'sun' });
    expect(interpret(1)).toEqual({ label: '대체로 맑음', icon: 'sun' });
  });

  it('구름·흐림', () => {
    expect(interpret(2)?.icon).toBe('cloud');
    expect(interpret(3)).toEqual({ label: '흐림', icon: 'cloud' });
  });

  // 방콕 우기에 가장 자주 만나는 코드들 — 여기가 틀리면 우산을 안 챙긴다
  it('비 계열', () => {
    expect(interpret(61)?.icon).toBe('rain');
    expect(interpret(65)?.icon).toBe('rain');
    expect(interpret(80)).toEqual({ label: '소나기', icon: 'rain' });
    expect(interpret(82)?.icon).toBe('rain');
    expect(interpret(95)).toEqual({ label: '뇌우', icon: 'storm' });
    expect(interpret(99)?.icon).toBe('storm');
  });

  it('눈·안개', () => {
    expect(interpret(71)?.icon).toBe('snow');
    expect(interpret(86)?.icon).toBe('snow');
    expect(interpret(45)?.icon).toBe('fog');
  });

  // 가장 중요한 성질 — 모르는 코드를 "맑음"으로 때우지 않는다
  it('해석할 수 없는 코드는 null', () => {
    expect(interpret(7)).toBeNull();
    expect(interpret(49)).toBeNull();
    expect(interpret(100)).toBeNull();
    expect(interpret(-1)).toBeNull();
  });
});

describe('fetchWeather', () => {
  let calls: string[];

  beforeEach(() => {
    resetWeatherCache();
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      const daily = url.includes('daily=');
      return {
        ok: true,
        json: async () =>
          daily
            ? { daily: { temperature_2m_max: [33.4], temperature_2m_min: [26.1], weather_code: [80] } }
            : { current: { temperature_2m: 31.6, weather_code: 3 } },
      };
    }));
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('오늘은 current를 묻고 지금 기온을 돌려준다', async () => {
    const w = await fetchWeather(13.75, 100.5, iso(0));
    expect(calls[0]).toContain('current=temperature_2m%2Cweather_code');
    expect(calls[0]).not.toContain('daily=');
    expect(w).toEqual({ kind: 'now', tempC: 32, label: '흐림', icon: 'cloud' });
  });

  it('미래 날짜는 그 날짜의 daily를 묻고 최고/최저를 돌려준다', async () => {
    const date = iso(3);
    const w = await fetchWeather(13.75, 100.5, date);
    expect(calls[0]).toContain('daily=');
    expect(calls[0]).toContain('start_date=' + date);
    expect(calls[0]).toContain('end_date=' + date);
    expect(w).toEqual({ kind: 'day', maxC: 33, minC: 26, label: '소나기', icon: 'rain' });
  });

  it('지난 날짜는 아예 조회하지 않는다', async () => {
    expect(await fetchWeather(13.75, 100.5, iso(-1))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('예보 범위를 넘는 먼 미래도 조회하지 않는다', async () => {
    expect(await fetchWeather(13.75, 100.5, iso(30))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('같은 좌표·같은 날은 한 번만 묻는다 (원칙 3-2)', async () => {
    await fetchWeather(13.75, 100.5, iso(0));
    await fetchWeather(13.75, 100.5, iso(0));
    // 좌표는 소수점 2자리로 뭉개므로 1km 안쪽은 같은 캐시를 쓴다
    await fetchWeather(13.7504, 100.5003, iso(0));
    expect(calls).toHaveLength(1);
  });

  it('응답이 깨졌으면 지어내지 않고 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ current: {} }) })));
    expect(await fetchWeather(1, 1, iso(0))).toBeNull();
  });

  it('해석 못 하는 코드가 오면 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ current: { temperature_2m: 20, weather_code: 7 } }),
    })));
    expect(await fetchWeather(2, 2, iso(0))).toBeNull();
  });

  it('네트워크가 끊겨도 터지지 않고 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await fetchWeather(3, 3, iso(0))).toBeNull();
  });
});
