/**
 * 목적지 도시 자동완성 테스트 — 한글을 치는 "도중"의 입력에도 원하는 도시가 뜨는지가 핵심.
 */

import { describe, it, expect } from 'vitest';
import { toJamo, suggestCities, tokenAtCaret, replaceToken } from './citySuggest';

const names = (query: string, exclude: string[] = []) => suggestCities(query, exclude).map((c) => c.name);

describe('toJamo', () => {
  it('음절을 자판으로 친 순서의 낱자로 푼다', () => {
    expect(toJamo('방콕')).toBe('ㅂㅏㅇㅋㅗㄱ');
    expect(toJamo('삿포로')).toBe('ㅅㅏㅅㅍㅗㄹㅗ');
  });

  it('겹모음·겹받침도 친 순서대로 푼다', () => {
    expect(toJamo('괌')).toBe('ㄱㅗㅏㅁ');
    expect(toJamo('멟')).toBe('ㅁㅔㄹㅂ');
  });

  it('한글이 아닌 글자와 홀로 쓴 낱자는 그대로 둔다', () => {
    expect(toJamo('방ㅋ LA')).toBe('ㅂㅏㅇㅋ LA');
  });
});

describe('suggestCities', () => {
  it('조합 중인 입력: "방ㅋ" → 방콕', () => {
    expect(names('방ㅋ')).toEqual(['방콕']);
  });

  it('받침이 붙기 전 입력: "사" → 삿포로가 후보에 있다', () => {
    expect(names('사')).toContain('삿포로');
  });

  it('글자 그대로 시작하는 도시가 낱자로만 맞는 도시보다 먼저 온다', () => {
    const result = names('사');
    expect(result[0]).toBe('사이판');
    expect(result.indexOf('사이판')).toBeLessThan(result.indexOf('삿포로'));
  });

  it('한 음절을 치는 모든 중간 단계에서 그 도시가 계속 후보에 남는다', () => {
    // 한글 입력기가 실제로 거치는 화면 상태들 — 다음 초성이 잠깐 앞 글자의 받침으로 붙는다
    for (const step of ['파', '팥', '파타', '파탕']) expect(names(step)).toContain('파타야');
    for (const step of ['고', '과']) expect(names(step)).toContain('괌');
    expect(names('멟')).toContain('멜버른');
  });

  it('흔히 쓰는 다른 표기도 앞부분만 맞으면 찾는다: "싱가폴" → 싱가포르', () => {
    expect(names('싱가폴')).toEqual(['싱가포르']);
  });

  it('같은 곳의 다른 표기는 한 번만 보여준다', () => {
    const result = names('상');
    expect(result).toContain('상하이');
    expect(result).not.toContain('상해');
  });

  it('영문 이름과 공항코드로도 찾는다', () => {
    expect(names('bang')).toEqual(['방콕']);
    expect(names('hong k')).toEqual(['홍콩']);
    // 표에서 BKK는 방콕과 "태국"(나라 이름만 적은 경우의 관문 공항) 둘 다에 걸려 있다
    expect(names('BKK')).toEqual(['방콕', '태국']);
  });

  it('이미 적어 둔 도시는 다시 추천하지 않는다', () => {
    expect(names('방')).toContain('방콕');
    expect(names('방', ['방콕'])).not.toContain('방콕');
  });

  it('도시 이름을 정확히 다 쳐도 그 도시가 계속 목록에 남는다', () => {
    expect(names('방콕')).toEqual(['방콕']);
    expect(names('삿포로')).toEqual(['삿포로']);
    // 삿포로를 한 글자씩 완성해 가는 모든 단계에서 끊김 없이 후보로 남는다
    for (const step of ['ㅅ', '사', '삿', '삿ㅍ', '삿포', '삿폴', '삿포로']) {
      expect(names(step)).toContain('삿포로');
    }
  });

  it('정확히 친 도시가 맨 위에 온다 — 표에서 더 먼저 나오는 긴 이름에 밀리지 않는다', () => {
    // 표에는 인도네시아가 인도보다 먼저 적혀 있다. 첫 후보는 Enter로 바로 선택되므로 순서가 중요하다
    expect(names('인도')).toEqual(['인도', '인도네시아']);
    expect(names('포르투')).toEqual(['포르투', '포르투갈']);
  });

  it('표에 없는 도시·빈 입력은 추천이 없다', () => {
    expect(names('울란바토르')).toEqual([]);
    expect(names('')).toEqual([]);
    expect(names('   ')).toEqual([]);
  });

  it('최대 6개까지만 추천한다', () => {
    expect(suggestCities('ㅂ').length).toBe(6);
  });

  it('공항코드와 영문 이름을 함께 돌려준다', () => {
    expect(suggestCities('방ㅋ')).toEqual([{ name: '방콕', en: 'BANGKOK', code: 'BKK' }]);
  });
});

describe('tokenAtCaret', () => {
  it('도시가 하나면 칸 전체가 조각이다', () => {
    expect(tokenAtCaret('방ㅋ', 2)).toEqual({ start: 0, end: 2, text: '방ㅋ', others: [] });
  });

  it('콤마 뒤에서 치는 중이면 마지막 조각만 본다', () => {
    const value = '방콕, 파ㅌ';
    expect(tokenAtCaret(value, value.length)).toEqual({
      start: value.indexOf(',') + 1,
      end: value.length,
      text: '파ㅌ',
      others: ['방콕'],
    });
  });

  it('가운데 도시를 고치는 중이면 커서가 놓인 조각만 본다', () => {
    const value = '방콕, 파, 푸켓';
    const token = tokenAtCaret(value, value.indexOf('파') + 1);
    expect(token.text).toBe('파');
    expect(token.others).toEqual(['방콕', '푸켓']);
  });

  it('커서가 맨 앞이어도 첫 조각을 본다', () => {
    expect(tokenAtCaret('방콕, 파타야', 0).text).toBe('방콕');
  });
});

describe('replaceToken', () => {
  it('치던 조각만 고른 도시로 바꾸고, 커서를 그 도시 바로 뒤에 둔다', () => {
    const value = '방콕, 파ㅌ';
    const result = replaceToken(value, tokenAtCaret(value, value.length), '파타야');
    expect(result).toEqual({ value: '방콕, 파타야', caret: '방콕, 파타야'.length });
  });

  it('가운데 조각을 바꿔도 앞뒤 도시는 그대로다', () => {
    const value = '방콕, 파, 푸켓';
    const result = replaceToken(value, tokenAtCaret(value, value.indexOf('파') + 1), '파타야');
    expect(result).toEqual({ value: '방콕, 파타야, 푸켓', caret: '방콕, 파타야'.length });
  });

  it('콤마 뒤를 띄어 쓰지 않았으면 그대로 붙여 넣는다', () => {
    const value = '방콕,파';
    expect(replaceToken(value, tokenAtCaret(value, value.length), '파타야').value).toBe('방콕,파타야');
  });
});
