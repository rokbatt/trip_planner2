import { describe, expect, it } from 'vitest';
import { parsePlaceStory, parseRouteStory, parseStoryLines, BURST_LIMITS } from '../../api/ai';

const VISIT = `###HEAD###
왕이 걸어 올라간 언덕
###INTRO###
프라하 성은 9세기에 시작됐어요. 천 년 넘게 나라의 중심이었죠.
###HISTORY###
- 870년 경 | 보리보이 공이 첫 교회를 세웠어요
* 1344년 | 성 비투스 대성당 공사가 시작됐어요
3. 1929년 | 대성당이 완공됐어요
###POINTS###
- 황금소로 | 작은 집 22번이 카프카가 글을 쓰던 곳이에요
- 대성당 스테인드글라스 | 오후 햇빛이 들 때 가장 예뻐요
###TIPS###
- 오전 9시 전에 가면 줄이 짧아요
###TIME###
2~3시간, 오전 추천`;

const FOOD = `###HEAD###
체코식 족발 한 판
###INTRO###
관광객도 현지인도 줄 서는 곳이에요.
###MENU###
- 콜레뇨 | 돼지 무릎을 통으로 구운 요리 | 390 Kč
- 스비치코바 | 소고기 크림 소스 | -
###PRICE###
-
###TIPS###
- 저녁은 예약이 안전해요`;

describe('도슨트 파서', () => {
  it('관광지: 머리말별로 읽고 번호·별표·하이픈 줄을 모두 받는다', () => {
    const s = parsePlaceStory(VISIT, 'visit');
    expect(s.headline).toBe('왕이 걸어 올라간 언덕');
    expect(s.history.map((h) => h.when)).toEqual(['870년 경', '1344년', '1929년']);
    expect(s.points[0]).toEqual({ title: '황금소로', text: '작은 집 22번이 카프카가 글을 쓰던 곳이에요' });
    expect(s.tips).toHaveLength(1);
    expect(s.time).toContain('2~3시간');
  });
  it('식당: 가격은 적힌 것만, "-"는 비운다', () => {
    const s = parsePlaceStory(FOOD, 'food');
    expect(s.menu[0].price).toBe('390 Kč');
    expect(s.menu[1].price).toBe('');
    expect(s.priceRange).toBe('');
    expect(s.tips[0]).toContain('예약');
  });
  it('머리말이 빠지거나 엉망이어도 죽지 않는다', () => {
    const s = parsePlaceStory('그냥 문장만 있어요', 'visit');
    expect(s.points).toEqual([]);
    expect(s.headline).toBe('');
  });
  it('가는 길: 이름 | 위치 | 이야기 세 칸이 있는 줄만, 최대 3곳', () => {
    const pts = parseRouteStory(`###POINTS###
- 카를교 | 다리 입구 | 1357년에 놓인 다리예요
- 화약탑 | 오른쪽 | 옛 성문이었어요
- 천문시계 | 광장 | 600년 넘게 돌아요
- 네 번째 | 어딘가 | 잘려야 해요
- 두 칸뿐 | 이야기 없음`);
    expect(pts.map((p) => p.name)).toEqual(['카를교', '화약탑', '천문시계']);
    expect(parseRouteStory('###POINTS###\n')).toEqual([]);
  });
  it('줄 읽기: 글자 수 상한과 빈 줄 처리', () => {
    expect(parseStoryLines('\n- a | b\n\n- | x\n', 5)).toEqual([['a', 'b']]);
  });
  it('연타 상한에 도슨트 두 종류가 들어 있다', () => {
    expect(BURST_LIMITS['place-story']).toBeGreaterThan(0);
    expect(BURST_LIMITS['route-story']).toBeGreaterThan(0);
  });
});
