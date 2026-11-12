import { describe, it, expect, vi, afterEach } from 'vitest';
import { DAILY_LIMITS, spendDailyQuota } from '../../api/ai';
// ?raw 는 Vite 가 파일 내용을 문자열로 넘겨 준다(deletionDrift.test.ts와 같은 방식)
import aiSrc from '../../api/ai.ts?raw';
import zonesSrc from '../../api/destination-zones.ts?raw';
import scoreSrc from '../../api/hotel-score.ts?raw';
import importSrc from '../../api/import-hotel.ts?raw';
import picksSrc from '../../api/monthly-picks.ts?raw';
import infraSrc from '../../api/nearby-infra.ts?raw';
import searchSrc from '../../api/nearby-search.ts?raw';
import routeSrc from '../../api/route-matrix.ts?raw';

/** 사용자당 하루 상한(Claude.md 5-11, supabase/api_usage.sql) */

describe('하루 상한 숫자', () => {
  it('사용자와 정한 값이다(AI 60 · 검색 40 · 주변 시설 20 · 길찾기 60)', () => {
    expect(DAILY_LIMITS).toEqual({ ai: 60, search: 40, infra: 20, routes: 60 });
  });
});

describe('spendDailyQuota', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('로그인 토큰이 없으면 세지 않고 통과한다(서버 로그인 확인을 켜기 전까지)', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await spendDailyQuota({}, 'ai')).toBe(true);
    expect(await spendDailyQuota({ headers: { authorization: 'Basic x' } }, 'routes')).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('여덟 서버 파일의 상한 코드가 같다', () => {
  // api/*.ts는 자립형이라(Claude.md 4장) 같은 코드를 복사해 둔다 — 한쪽만 고치면 이 테스트가 잡는다
  function block(src: string): string {
    const start = src.indexOf('// ── 사용량 상한 (BEGIN');
    const end = src.indexOf('// ── 사용량 상한 (END) ──');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  }

  it('모든 파일이 같은 내용을 쓰고, 실제로 상한을 확인한다', () => {
    const base = block(aiSrc);
    for (const src of [zonesSrc, scoreSrc, importSrc, picksSrc, infraSrc, searchSrc, routeSrc]) {
      expect(block(src)).toBe(base);
      expect(src).toMatch(/await spendDailyQuota\(req, '(ai|search|infra|routes)'\)/);
    }
  });
});
