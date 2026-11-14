import { describe, it, expect } from 'vitest';
import { edgeNote } from './edgeNote';

const req = (url: string, cf?: object) => {
  const r = new Request(url, { method: 'POST' });
  if (cf) Object.defineProperty(r, 'cf', { value: cf });
  return r;
};

describe('edgeNote', () => {
  it('성공 응답은 기록하지 않는다', () => {
    expect(edgeNote(req('https://x.dev/api/ai'), 200)).toBeNull();
    expect(edgeNote(req('https://x.dev/api/ai'), 399)).toBeNull();
  });

  it('실패하면 주소·상태·colo를 적는다', () => {
    expect(edgeNote(req('https://x.dev/api/hotel-score', { colo: 'HKG', country: 'KR' }), 502)).toBe(
      '[worker] POST /api/hotel-score -> 502 (colo=HKG, country=KR)'
    );
  });

  it('colo 정보가 없으면 ?로 적고, 쿼리 문자열은 기록하지 않는다', () => {
    const note = edgeNote(req('https://x.dev/api/exchange-rate?from=USD&secret=abc'), 500);
    expect(note).toBe('[worker] POST /api/exchange-rate -> 500 (colo=?, country=?)');
    expect(note).not.toContain('secret');
  });
});
