import { describe, it, expect } from 'vitest';
import { scrub, safePath, isNoise, buildRow } from './errorReport';

describe('오류 기록 — 개인정보 가리기', () => {
  it('이메일·토큰·주소 속 비밀값을 가린다', () => {
    expect(scrub('user a.b@gmail.com failed')).toBe('user [email] failed');
    expect(scrub('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij')).toBe('Bearer [token]');
    expect(scrub('/api/x?code=abc123&q=서울')).toBe('/api/x?code=[x]&q=[x]');
  });
  it('주소는 해시 경로만 남기고 ? 뒤는 버린다', () => {
    expect(safePath('https://www.mongsil2.com/?code=secret#trip/t1/go?x=1')).toBe('/#trip/t1/go');
    expect(safePath('not a url')).toBe('');
  });
  it('소음은 거른다', () => {
    expect(isNoise('ResizeObserver loop limit exceeded')).toBe(true);
    expect(isNoise('Script error.')).toBe(true);
    expect(isNoise('TypeError: x is undefined')).toBe(false);
  });
  it('기록 줄 만들기 — 길이 제한·스택 앞부분', () => {
    const e = new Error('boom ' + 'x'.repeat(600));
    const row = buildRow(e, 'https://www.mongsil2.com/#trip/1/go', 'v1', 'UA')!;
    expect(row.message.length).toBe(500);
    expect(row.stack!.split('\n').length).toBeLessThanOrEqual(8);
    expect(row.path).toBe('/#trip/1/go');
    expect(buildRow('Script error.', 'https://x/', 'v', 'u')).toBeNull();
  });
});
