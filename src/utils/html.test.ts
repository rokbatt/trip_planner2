import { describe, it, expect } from 'vitest';
import { escapeHtml, safeHttpUrl } from './html';

describe('escapeHtml', () => {
  it('텍스트에 위험한 글자를 모두 바꾼다', () => {
    expect(escapeHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
  });

  it('따옴표도 바꿔서 속성값 밖으로 나갈 수 없다', () => {
    // 예전 복사본은 이 입력이 title="…" 밖으로 나가 onmouseover 속성을 만들었다
    const evil = 'x" onmouseover="alert(1)" data-x="';
    const out = escapeHtml(evil);
    expect(out).not.toContain('"');
    expect(out).toBe('x&quot; onmouseover=&quot;alert(1)&quot; data-x=&quot;');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('한글·이모지·빈 문자열은 그대로 둔다', () => {
    expect(escapeHtml('방콕 왕궁 🛕')).toBe('방콕 왕궁 🛕');
    expect(escapeHtml('')).toBe('');
  });
});

describe('safeHttpUrl', () => {
  it('http(s) 주소만 통과한다', () => {
    expect(safeHttpUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/');
  });

  it('스크립트가 돌 수 있는 주소는 막는다', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl(' JavaScript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHttpUrl('vbscript:x')).toBeNull();
  });

  it('주소가 아니거나 비어 있으면 null', () => {
    expect(safeHttpUrl('not a url')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
});

describe('이스케이프 함수는 한 곳에만 있다', () => {
  // 파일마다 복사본을 두면 언젠가 하나가 느슨해진다 — 실제로 19벌 중 18벌이 따옴표를 막지 못했다
  const sources = import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

  it('utils/html.ts 말고는 escapeHtml·esc 함수를 직접 정의하지 않는다', () => {
    const offenders = Object.entries(sources)
      // glob 키는 같은 폴더면 './html.ts', 다른 폴더면 '../x/y.ts' 꼴이다
      .filter(([path]) => path !== './html.ts' && !path.endsWith('.test.ts'))
      .filter(([, src]) => /\bfunction\s+(escapeHtml|esc)\s*\(/.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
