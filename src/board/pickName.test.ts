import { describe, expect, it } from 'vitest';
import { cleanPickName, pickSearchQueries } from './pickName';
import { cleanPickName as serverClean } from '../../api/monthly-picks';

const CASES: [string, string][] = [
  ['**왕궁 (The Grand Palace)**: 방콕의 대표 명소', '왕궁 (The Grand Palace)'],
  ['**왓 아룬 (Wat Arun)**: 새벽 사원', '왓 아룬 (Wat Arun)'],
  ['**Le Du**: 창의적인 태국 요리', 'Le Du'],
  ['1. 카오산 로드 - 배낭여행자 거리', '카오산 로드'],
  ['- 아이콘시암', '아이콘시암'],
  ['Raan Jay Fai', 'Raan Jay Fai'],
  ['**', ''],
];

describe('cleanPickName', () => {
  it.each(CASES)('%s → %s', (raw, want) => {
    expect(cleanPickName(raw)).toBe(want);
  });
  it('서버 인라인 규칙과 결과가 같다', () => {
    for (const [raw] of CASES) expect(serverClean(raw)).toBe(cleanPickName(raw));
  });
  it('하이픈이 붙은 이름은 자르지 않는다', () => {
    expect(cleanPickName('Jeh-O Chula')).toBe('Jeh-O Chula');
  });
});

describe('pickSearchQueries', () => {
  it('괄호가 있으면 전체 → 괄호 안 → 괄호 밖 순서', () => {
    expect(pickSearchQueries('**왕궁 (The Grand Palace)**: 설명', '방콕')).toEqual([
      '왕궁 (The Grand Palace) 방콕',
      'The Grand Palace 방콕',
      '왕궁 방콕',
    ]);
  });
  it('괄호가 없으면 하나', () => {
    expect(pickSearchQueries('Le Du', '방콕')).toEqual(['Le Du 방콕']);
  });
  it('이름이 비면 검색하지 않는다', () => {
    expect(pickSearchQueries('**', '방콕')).toEqual([]);
  });
});
