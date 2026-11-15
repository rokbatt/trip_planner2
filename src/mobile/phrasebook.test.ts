import { describe, it, expect } from 'vitest';
import { PHRASES, LANG_LABEL, languageForDestination, situationsForDay, type PhraseLang, type Situation } from './phrasebook';

describe('PHRASES', () => {
  it('모든 문장이 모든 언어를 [현지어, 발음]으로 빠짐없이 갖는다', () => {
    const langs = Object.keys(LANG_LABEL) as PhraseLang[];
    for (const sit of Object.keys(PHRASES) as Situation[]) {
      for (const p of PHRASES[sit]) {
        for (const l of langs) {
          const pair = p.t[l];
          expect(pair, sit + ' / ' + p.ko + ' / ' + l).toBeDefined();
          expect(pair![0].trim().length).toBeGreaterThan(0);
          expect(pair![1].trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('languageForDestination', () => {
  it('여행지 → 언어', () => {
    expect(languageForDestination('방콕')).toEqual({ lang: 'th', fallback: false });
    expect(languageForDestination('오사카')).toEqual({ lang: 'ja', fallback: false });
    expect(languageForDestination('다낭')).toEqual({ lang: 'vi', fallback: false });
    expect(languageForDestination('타이베이')).toEqual({ lang: 'zh-TW', fallback: false });
    expect(languageForDestination('상하이')).toEqual({ lang: 'zh-CN', fallback: false });
  });
  it('국내는 null, 영어권은 영어, 그 밖은 영어로 대신(fallback)', () => {
    expect(languageForDestination('제주')).toBeNull();
    expect(languageForDestination('런던')).toEqual({ lang: 'en', fallback: false });
    expect(languageForDestination('프라하')).toEqual({ lang: 'en', fallback: true });
    expect(languageForDestination('아무데나')).toEqual({ lang: 'en', fallback: true });
  });
});

describe('situationsForDay', () => {
  it('기본이 맨 앞, 급할 때가 맨 뒤, 일정 종류에 맞춰 중복 없이', () => {
    expect(situationsForDay(['FOOD', 'VISIT', 'FOOD', 'SHOPPING', 'STAY'])).toEqual(['basic', 'food', 'move', 'shop', 'stay', 'emergency']);
    expect(situationsForDay([])).toEqual(['basic', 'emergency']);
  });
});
