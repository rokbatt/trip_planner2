/**
 * 진입 게이트 결정 테스트.
 *
 * 폰으로 트립을 열면 Companion(`go`), PC면 IDEAS로 간다. 이 한 줄이 틀어지면 현지에서
 * 폰을 꺼낸 사람이 **폰에서 못 쓰는 화면**(브레인스토밍 보드)을 먼저 보게 된다.
 *
 * 여기서 지키려는 건 값 하나가 아니라 **CSS와의 경계값 일치**다. `workspace.css`의
 * 모바일 미디어쿼리가 `max-width: 768px`(768 포함)이고, 그 폭에서 Companion 전용 크롬
 * 숨김이 켜진다. 둘이 어긋나면 "사이드바는 서랍인데 기본 게이트는 PC용"처럼 어중간한
 * 상태가 조용히 생긴다 — 그래서 768/769 경계를 못 박아 둔다.
 */

import { describe, it, expect } from 'vitest';
import { defaultGateFor } from './workspace';

describe('defaultGateFor', () => {
  it('폰 폭이면 Companion', () => {
    expect(defaultGateFor(390)).toBe('go'); // iPhone
    expect(defaultGateFor(360)).toBe('go'); // 안드로이드 보급형
  });

  it('데스크톱 폭이면 IDEAS', () => {
    expect(defaultGateFor(1440)).toBe('ideas');
    expect(defaultGateFor(1024)).toBe('ideas');
  });

  // workspace.css의 `@media (max-width: 768px)`와 같은 경계여야 한다 — 768은 포함이다
  it('768px 경계가 CSS 미디어쿼리와 일치한다', () => {
    expect(defaultGateFor(768)).toBe('go');
    expect(defaultGateFor(769)).toBe('ideas');
  });
});
