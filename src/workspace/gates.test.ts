import { describe, it, expect } from 'vitest';
import { GATE_TITLES, isKnownGate } from './gates';
import { defaultGateFor } from './workspace';
import workspaceSrc from './workspace.ts?raw';

describe('isKnownGate', () => {
  it('메뉴 이름은 통과, 모르는 이름·빈 값·객체 기본 속성은 거른다', () => {
    expect(isKnownGate('ideas')).toBe(true);
    expect(isKnownGate('notes')).toBe(true);
    expect(isKnownGate('privacy')).toBe(false);
    expect(isKnownGate('IDEAS')).toBe(false);
    expect(isKnownGate('')).toBe(false);
    expect(isKnownGate(undefined)).toBe(false);
    expect(isKnownGate('constructor')).toBe(false);
  });

  it('기본 화면(폰·PC)은 언제나 아는 메뉴다 — 아니면 이동이 끝없이 반복된다', () => {
    expect(isKnownGate(defaultGateFor(375))).toBe(true);
    expect(isKnownGate(defaultGateFor(1440))).toBe(true);
  });

  it('목록의 메뉴마다 workspace.ts에 화면 분기가 있다', () => {
    for (const gate of Object.keys(GATE_TITLES)) {
      expect(workspaceSrc).toContain(`'${gate}'`);
    }
  });
});
