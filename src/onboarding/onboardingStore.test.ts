/**
 * 온보딩 기록 — 사용자별로 나뉘고, 새로고침·재로그인 뒤에도 남고, 버전이 오르면 다시 뜨는지.
 */

import { describe, it, expect } from 'vitest';
import {
  loadState, parseState, needsWelcome, needsTour, markWelcomeSeen, markTourSeen, storageKey,
  type KeyValueStore,
} from './onboardingStore';

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

describe('환영 안내', () => {
  it('처음엔 띄우고, 한 번 닫으면(건너뛰기 포함) 다시 안 띄운다', () => {
    const s = memStore();
    expect(needsWelcome(loadState(s, 'u1'))).toBe(true);
    markWelcomeSeen(s, 'u1');
    expect(needsWelcome(loadState(s, 'u1'))).toBe(false);
  });

  it('사용자별로 따로 — 다른 계정은 처음부터', () => {
    const s = memStore();
    markWelcomeSeen(s, 'u1');
    expect(needsWelcome(loadState(s, 'u2'))).toBe(true);
    expect(s.data.has(storageKey('u1'))).toBe(true);
    expect(s.data.has(storageKey('u2'))).toBe(false);
  });

  it('내용이 바뀌어 버전이 오르면 다시 띄운다', () => {
    const s = memStore();
    markWelcomeSeen(s, 'u1', new Date(), 1);
    expect(needsWelcome(loadState(s, 'u1'), 1)).toBe(false);
    expect(needsWelcome(loadState(s, 'u1'), 2)).toBe(true);
  });

  it('로그인 전(사용자 없음)엔 기록하지 않고 띄울 대상도 아니다', () => {
    const s = memStore();
    markWelcomeSeen(s, null);
    expect(s.data.size).toBe(0);
  });
});

describe('페이지 가이드', () => {
  it('가이드마다 따로 기록하고 환영 안내와 섞이지 않는다', () => {
    const s = memStore();
    markTourSeen(s, 'u1', 'ideas', 1);
    const st = loadState(s, 'u1');
    expect(needsTour(st, 'ideas', 1)).toBe(false);
    expect(needsTour(st, 'route', 1)).toBe(true);
    expect(needsWelcome(st)).toBe(true);
  });

  it('기존 기록을 지우지 않고 덧붙인다', () => {
    const s = memStore();
    markWelcomeSeen(s, 'u1');
    markTourSeen(s, 'u1', 'ideas', 1);
    markTourSeen(s, 'u1', 'route', 1);
    const st = loadState(s, 'u1');
    expect(needsWelcome(st)).toBe(false);
    expect(Object.keys(st.tours).sort()).toEqual(['ideas', 'route']);
  });
});

describe('깨진 값', () => {
  it('JSON이 아니거나 모양이 달라도 빈 기록으로 읽는다', () => {
    expect(parseState('{oops')).toEqual({ welcome: null, tours: {} });
    expect(parseState('{"welcome":"yes","tours":{"ideas":3,"route":{"version":1,"at":"x"}}}')).toEqual({
      welcome: null,
      tours: { route: { version: 1, at: 'x' } },
    });
  });

  it('저장소 접근이 막혀도 멈추지 않는다', () => {
    const broken: KeyValueStore = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(needsWelcome(loadState(broken, 'u1'))).toBe(true);
    expect(() => markTourSeen(broken, 'u1', 'ideas', 1)).not.toThrow();
  });
});
