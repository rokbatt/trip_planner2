import { describe, it, expect } from 'vitest';
import { shareTargets } from './shareTargets';

describe('shareTargets', () => {
  const url = 'https://www.mongsil2.com/#join/ABC123';
  const list = shareTargets(url, '동유럽 여행에 같이 가요');
  const by = (k: string) => list.find((t) => t.key === k)!.href;

  it('링크와 문구를 주소에 안전하게 넣는다(# · 한글 인코딩)', () => {
    expect(by('x')).toContain('url=' + encodeURIComponent(url));
    expect(by('x')).not.toContain('#join');
    expect(by('whatsapp')).toBe('https://wa.me/?text=' + encodeURIComponent('동유럽 여행에 같이 가요\n' + url));
    expect(by('facebook')).toBe('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url));
  });
  it('문자는 휴대폰 전용, 나머지는 https 또는 mailto', () => {
    expect(list.find((t) => t.key === 'sms')!.mobileOnly).toBe(true);
    for (const t of list) if (t.key !== 'sms') expect(/^(https:\/\/|mailto:)/.test(t.href)).toBe(true);
  });
});
