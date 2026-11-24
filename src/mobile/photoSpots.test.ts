import { describe, it, expect } from 'vitest';
import { instagramTagUrl } from './photoSpots';
import { parsePhotoSpots } from '../../api/ai';

describe('instagramTagUrl', () => {
  it('띄어쓰기·기호를 빼고 해시태그 화면 주소를 만든다', () => {
    expect(instagramTagUrl('Wat Arun')).toBe('https://www.instagram.com/explore/tags/WatArun/');
    expect(instagramTagUrl('伏見稲荷大社')).toBe('https://www.instagram.com/explore/tags/' + encodeURIComponent('伏見稲荷大社') + '/');
    expect(instagramTagUrl("St. Peter's Basilica")).toBe('https://www.instagram.com/explore/tags/StPetersBasilica/');
  });
  it('글자가 하나도 없으면 null', () => {
    expect(instagramTagUrl(' - · ')).toBeNull();
  });
});

describe('parsePhotoSpots', () => {
  it('마커 아래 "- 이름 | 이유"만 읽고, 굵게 표시·중복을 지운다', () => {
    const text = '설명 문장\n###SPOTS###\n- **Wat Arun** | 노을 질 때 강 건너편에서\n- Wat Arun | 중복\n그냥 문장\n- Chinatown | 밤 네온사인';
    expect(parsePhotoSpots(text)).toEqual([
      { name: 'Wat Arun', reason: '노을 질 때 강 건너편에서' },
      { name: 'Chinatown', reason: '밤 네온사인' },
    ]);
  });
  it('최대 6곳, 이름 없는 줄은 버린다', () => {
    const text = '###SPOTS###\n' + Array.from({ length: 9 }, (_, i) => '- 장소' + i + ' | 이유').join('\n') + '\n- | 이름 없음';
    expect(parsePhotoSpots(text)).toHaveLength(6);
  });
  it('"* ", "• ", 번호 목록으로 답해도 읽는다', () => {
    const text = '###SPOTS###\n* Wat Arun | 노을\n• Chinatown | 네온\n1. Lumpini Park | 호수\n2) ICONSIAM | 야경';
    expect(parsePhotoSpots(text).map((s) => s.name)).toEqual(['Wat Arun', 'Chinatown', 'Lumpini Park', 'ICONSIAM']);
  });
  it('"|"가 없는 줄(설명 문장·목록)은 장소로 읽지 않는다', () => {
    expect(parsePhotoSpots('###SPOTS###\n- 아래는 추천이에요\n- Wat Arun | 노을')).toEqual([{ name: 'Wat Arun', reason: '노을' }]);
  });
});
