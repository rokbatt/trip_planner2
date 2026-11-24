/**
 * supabase/payments.sql 정적 검사 — 실제 동작(반영·중복·연장·환불·탈퇴 보관·권한)은 PR에서 Postgres 16으로 확인했다.
 * 여기서는 다시 실수하기 쉬운 것만 지킨다: 대시보드가 자르지 않는 형식, 함수 권한, 탈퇴 보관 규칙.
 */
import { describe, expect, it } from 'vitest';
import sql from '../../supabase/payments.sql?raw';

const FUNCS = ['grant_pro_pass(text, text, text)', 'revoke_pro_pass(text, text)', 'spend_web_left(uuid)'];

describe('payments.sql', () => {
  it('주석에 세미콜론·달러 기호가 없다(대시보드 편집기가 구문을 자른 전례)', () => {
    const bad = sql.split('\n').filter((l) => l.trim().startsWith('--') && /[;$]/.test(l));
    expect(bad).toEqual([]);
  });

  it('구문은 한 줄에 하나다(여러 줄 구문 없음)', () => {
    const stmtLines = sql.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'));
    for (const l of stmtLines) expect(l.trim().endsWith(';'), l.slice(0, 60)).toBe(true);
  });

  it('함수는 서버(service_role)만 부를 수 있다 — 사용자가 스스로 PRO가 되지 못하게', () => {
    for (const f of FUNCS) {
      expect(sql).toContain('revoke all on function public.' + f + ' from public, anon, authenticated;');
      expect(sql).toContain('grant execute on function public.' + f + ' to service_role;');
    }
    expect(sql.match(/security definer set search_path = public/g)?.length).toBe(FUNCS.length);
  });

  it('탈퇴해도 결제 기록은 남는다(user_id만 비움) · 본인 줄만 읽는다', () => {
    expect(sql).toMatch(/user_id uuid references auth\.users\(id\) on delete set null/);
    expect(sql).not.toMatch(/on delete cascade/);
    expect(sql).toMatch(/for select to authenticated using \(user_id = auth\.uid\(\)\)/);
  });

  it('같은 결제를 두 번 반영·회수하지 않는다(행 잠금 + 상태 확인)', () => {
    expect(sql).toMatch(/grant_pro_pass[\s\S]*?for update[\s\S]*?if p\.status = 'paid' then return/);
    expect(sql).toMatch(/revoke_pro_pass[\s\S]*?for update[\s\S]*?if p\.status = 'cancelled' then return/);
  });
});
