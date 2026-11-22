import { describe, it, expect } from 'vitest';
import { planFrom, parseWebAnswer, WEB_QA_DAILY_LIMIT } from '../../api/ai';

describe('planFrom (무료 · PRO)', () => {
  const now = Date.parse('2026-11-22T00:00:00Z');
  it('운영자·지인(app_roles)은 PRO', () => {
    expect(planFrom('admin', null, now)).toBe('pro');
    expect(planFrom('unlimited', null, now)).toBe('pro');
  });
  it('user_plans의 pro는 만료 전까지만', () => {
    expect(planFrom(null, { plan: 'pro', expires_at: null }, now)).toBe('pro');
    expect(planFrom(null, { plan: 'pro', expires_at: '2026-12-01T00:00:00Z' }, now)).toBe('pro');
    expect(planFrom(null, { plan: 'pro', expires_at: '2026-11-01T00:00:00Z' }, now)).toBe('free');
    expect(planFrom(null, { plan: 'pro', expires_at: 'not-a-date' }, now)).toBe('free');
  });
  it('줄이 없거나 free·모르는 값이면 무료', () => {
    expect(planFrom(null, null, now)).toBe('free');
    expect(planFrom(null, { plan: 'free' }, now)).toBe('free');
    expect(planFrom('member', { plan: 'gold' }, now)).toBe('free');
  });
});

describe('parseWebAnswer', () => {
  it('답과 사용한 자료 제목을 나눈다', () => {
    const t = '###ANSWER###\n프라하 성은 17시에 닫아요(웹).\n###USED###\n- 프라하 일정 메모\n- 없음\n';
    expect(parseWebAnswer(t)).toEqual({ answer: '프라하 성은 17시에 닫아요(웹).', usedTitles: ['프라하 일정 메모'] });
  });
  it('표시가 없으면 전체를 답으로', () => {
    expect(parseWebAnswer('그냥 답')).toEqual({ answer: '그냥 답', usedTitles: [] });
  });
  it('웹 질문 하루 상한은 20', () => expect(WEB_QA_DAILY_LIMIT).toBe(20));
});
