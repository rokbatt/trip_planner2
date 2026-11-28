import { describe, it, expect } from 'vitest';
import { BURST_LIMITS, BURST_WINDOW_SECONDS, burstMessage, spendBurst } from '../../api/ai';
import sql from '../../supabase/api_burst.sql?raw';
import aiSrc from '../../api/ai.ts?raw';

/** 서버에 닿지 않는 가짜 Supabase — rpc 결과와 역할 표 응답만 정한다 */
function fakeSb(opts: { role?: string | null; rpc?: { data?: unknown; error?: unknown } | 'throw' }) {
  const calls: any[] = [];
  const sb: any = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.role ? { role: opts.role } : null }) }) }) }),
    rpc: async (name: string, args: any) => {
      calls.push([name, args]);
      if (opts.rpc === 'throw') throw new Error('boom');
      return opts.rpc ?? { data: 0, error: null };
    },
  };
  return { sb, calls };
}
const user = { id: 'u1', email: 'a@b.com' };

describe('PRO 기능 3분 연타 상한', () => {
  it('정한 값: 3분 창, 웹 검색 5 · 인생샷 4 · 영수증 6', () => {
    expect(BURST_WINDOW_SECONDS).toBe(180);
    expect(BURST_LIMITS).toEqual({ web: 5, 'photo-spots': 4, receipt: 6, 'place-story': 10, 'route-story': 10 });
  });

  it('허용이면 0, 종류별 횟수·창 길이를 함께 보낸다', async () => {
    const { sb, calls } = fakeSb({ rpc: { data: 0, error: null } });
    expect(await spendBurst(sb, user, 'web')).toBe(0);
    expect(calls[0]).toEqual(['spend_api_burst', { p_user: 'u1', p_kind: 'web', p_limit: 5, p_window_seconds: 180 }]);
  });

  it('막히면 남은 초를 돌려준다', async () => {
    const { sb } = fakeSb({ rpc: { data: 74, error: null } });
    expect(await spendBurst(sb, user, 'photo-spots')).toBe(74);
  });

  it('관리자·지인(admin·unlimited)은 세지 않는다', async () => {
    for (const role of ['admin', 'unlimited']) {
      const { sb, calls } = fakeSb({ role, rpc: { data: 99, error: null } });
      expect(await spendBurst(sb, user, 'receipt')).toBe(0);
      expect(calls).toHaveLength(0);
    }
  });

  it('표·함수가 없거나 오류면 막지 않는다', async () => {
    expect(await spendBurst(fakeSb({ rpc: { data: null, error: { code: '42883' } } }).sb, user, 'web')).toBe(0);
    expect(await spendBurst(fakeSb({ rpc: 'throw' }).sb, user, 'web')).toBe(0);
    expect(await spendBurst(fakeSb({ rpc: { data: 'x', error: null } }).sb, user, 'web')).toBe(0);
  });

  it('안내 문구: 초 / 분 + 초', () => {
    expect(burstMessage(45)).toContain('45초 뒤');
    expect(burstMessage(60)).toContain('1분 뒤');
    expect(burstMessage(125)).toContain('2분 5초 뒤');
    expect(burstMessage(0)).toContain('1초 뒤');
  });

  it('세 PRO 기능이 모두 돈 드는 호출 직전에 상한을 확인한다', () => {
    expect(aiSrc).toMatch(/spendBurst\(supabase, user, 'web'\)/);
    expect(aiSrc).toMatch(/spendBurst\(supabase, authData\.user, 'photo-spots'\)/);
    expect(aiSrc).toMatch(/spendBurst\(supabase, authData\.user, 'receipt'\)/);
  });
});

describe('supabase/api_burst.sql', () => {
  const lines = sql.split('\n');
  it('주석에 세미콜론·달러 기호가 없다(대시보드 SQL 편집기가 구문을 자르는 문제)', () => {
    for (const l of lines.filter((x) => x.trimStart().startsWith('--'))) {
      expect(l, l).not.toMatch(/[;$]/);
    }
  });
  it('표·함수·권한: RLS 켬, 서비스 키만 실행', () => {
    expect(sql).toMatch(/create table if not exists api_burst/);
    expect(sql).toMatch(/alter table api_burst enable row level security/);
    expect(sql).toMatch(/create or replace function public\.spend_api_burst/);
    expect(sql).toMatch(/revoke all on function public\.spend_api_burst\(uuid, text, int, int\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.spend_api_burst\(uuid, text, int, int\) to service_role/);
  });
});

describe('서버를 거치지 않는 PRO 기능의 사용 기록(pro-use)', () => {
  it('영역 검색이 환불 판단용 사용 기록을 남기도록 연결돼 있다', async () => {
    const area = (await import('../board/areaSearch.ts?raw')).default;
    expect(aiSrc).toMatch(/kind === 'pro-use'\) return handleProUse/);
    expect(area).toMatch(/reportProUse\('area-search'\)/);
  });
});

describe('요금제 다시 확인 정책(결제 화면에서 이용권을 사고 돌아온 경우)', () => {
  it('PRO로 확인됐으면 더 묻지 않는다', async () => {
    const { planRecheckDue } = await import('../assistant/assistantClient');
    expect(planRecheckDue('pro', 1, 999_999_999)).toBe(false);
  });
  it('처음이거나 무료·모름이면 20초 뒤에 다시 묻는다', async () => {
    const { planRecheckDue, PLAN_RECHECK_MS } = await import('../assistant/assistantClient');
    expect(planRecheckDue(null, 0, 5)).toBe(true);
    expect(planRecheckDue('free', 1000, 1000 + PLAN_RECHECK_MS - 1)).toBe(false);
    expect(planRecheckDue('free', 1000, 1000 + PLAN_RECHECK_MS)).toBe(true);
  });
});
