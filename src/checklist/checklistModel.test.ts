import { describe, expect, it } from 'vitest';
import type { TripChecklistItem } from '../types/database';
import {
  buildMustChecks,
  buildSmartSuggestions,
  categoryOf,
  countryOfDestination,
  daysBetween,
  dueInfo,
  inferCategory,
  isDomesticTrip,
  isSuggestionTaken,
  matchesAssignee,
  progressByCategory,
  progressOf,
  relatedDocCategory,
  reorderChanges,
  sortItems,
  tripCountdown,
} from './checklistModel';
import type { TripFacts } from './checklistModel';

let seq = 0;
function item(over: Partial<TripChecklistItem> = {}): TripChecklistItem {
  seq += 1;
  return {
    id: 'i' + seq,
    trip_id: 't',
    title: '항목 ' + seq,
    checked_at: null,
    checked_by: null,
    checked_by_name: null,
    sort_order: seq,
    created_by: null,
    created_at: '2026-01-01T00:00:' + String(seq).padStart(2, '0') + 'Z',
    place_key: null,
    place_name: null,
    category: null,
    priority: null,
    assignee_member_id: null,
    assignee_all: false,
    due_date: null,
    memo: null,
    linked_doc_id: null,
    suggestion_key: null,
    ...over,
  };
}

function facts(over: Partial<TripFacts> = {}): TripFacts {
  return {
    destinationNames: [],
    countries: [],
    hasUnknownDestination: false,
    flight: null,
    stays: [],
    ticketedStops: [],
    docCategories: [],
    ...over,
  };
}

describe('분류', () => {
  it('저장된 분류가 있으면 그걸 쓴다', () => {
    expect(categoryOf({ title: '여권', category: 'TIP' })).toBe('TIP');
  });
  it('분류가 없으면 제목으로 추정한다', () => {
    expect(inferCategory('여행자 보험 가입')).toBe('HEALTH');
    expect(inferCategory('항공권 확인')).toBe('BOOKING');
    expect(inferCategory('여권')).toBe('ESSENTIAL');
    expect(inferCategory('유심 · eSIM')).toBe('ESSENTIAL');
    expect(inferCategory('카메라 및 충전기')).toBe('GEAR');
  });
  it('모르는 분류 값은 무시하고 추정한다', () => {
    expect(categoryOf({ title: '상비약', category: 'WHATEVER' })).toBe('HEALTH');
  });
});

describe('진행률', () => {
  it('완료/전체/퍼센트를 실제 항목 수로 계산한다', () => {
    const items = [item({ checked_at: 'x' }), item(), item({ checked_at: 'y' })];
    expect(progressOf(items)).toEqual({ done: 2, total: 3, pct: 67 });
  });
  it('항목이 없으면 0%', () => {
    expect(progressOf([])).toEqual({ done: 0, total: 0, pct: 0 });
  });
  it('분류별로 나눠 센다', () => {
    const p = progressByCategory([item({ title: '여권', checked_at: 'x' }), item({ title: '보조배터리' })]);
    expect(p.ESSENTIAL).toEqual({ done: 1, total: 1, pct: 100 });
    expect(p.GEAR).toEqual({ done: 0, total: 1, pct: 0 });
    expect(p.TIP.total).toBe(0);
  });
});

describe('담당자 필터', () => {
  const mine = item({ assignee_member_id: 'm1' });
  const shared = item({ assignee_all: true });
  const none = item();
  it('내 항목에는 공동 담당도 포함된다', () => {
    expect([mine, shared, none].filter((i) => matchesAssignee(i, 'ME', 'm1'))).toEqual([mine, shared]);
  });
  it('미지정만', () => {
    expect([mine, shared, none].filter((i) => matchesAssignee(i, 'NONE', 'm1'))).toEqual([none]);
  });
});

describe('정렬', () => {
  it('기본 순서는 완료 여부와 상관없이 sort_order', () => {
    const a = item({ sort_order: 2, checked_at: 'x' });
    const b = item({ sort_order: 1 });
    expect(sortItems([a, b], 'manual').map((i) => i.id)).toEqual([b.id, a.id]);
  });
  it('중요도순', () => {
    const a = item({ priority: 'NORMAL' });
    const b = item({ priority: 'REQUIRED' });
    const c = item({ priority: 'RECOMMENDED' });
    expect(sortItems([a, b, c], 'priority').map((i) => i.id)).toEqual([b.id, c.id, a.id]);
  });
  it('마감일순 — 마감일 없는 항목은 뒤로', () => {
    const a = item();
    const b = item({ due_date: '2026-03-02' });
    const c = item({ due_date: '2026-03-01' });
    expect(sortItems([a, b, c], 'due').map((i) => i.id)).toEqual([c.id, b.id, a.id]);
  });
  it('미완료 먼저', () => {
    const a = item({ checked_at: 'x' });
    const b = item();
    expect(sortItems([a, b], 'status').map((i) => i.id)).toEqual([b.id, a.id]);
  });
});

describe('끌어서 순서 바꾸기', () => {
  it('바뀐 행만 돌려준다', () => {
    const a = item({ sort_order: 1 });
    const b = item({ sort_order: 2 });
    const c = item({ sort_order: 3 });
    expect(reorderChanges([a, b, c], [c, a, b])).toEqual([
      { id: c.id, sort_order: 1 },
      { id: a.id, sort_order: 2 },
      { id: b.id, sort_order: 3 },
    ]);
  });
  it('필터로 보이는 항목끼리만 자리를 바꾼다', () => {
    const a = item({ sort_order: 1 });
    const c = item({ sort_order: 5 });
    expect(reorderChanges([a, c], [c, a])).toEqual([
      { id: c.id, sort_order: 1 },
      { id: a.id, sort_order: 5 },
    ]);
  });
  it('겹친 sort_order는 벌려서 저장한다', () => {
    const a = item({ sort_order: 1 });
    const b = item({ sort_order: 1 });
    // b는 이미 1이라 그대로 두고, a만 2로 벌린다
    expect(reorderChanges([a, b], [b, a])).toEqual([{ id: a.id, sort_order: 2 }]);
  });
});

describe('날짜', () => {
  it('일수 차이', () => {
    expect(daysBetween('2026-03-01', '2026-03-04')).toBe(3);
  });
  it('D-day', () => {
    expect(tripCountdown('2026-03-04', '2026-03-08', '2026-03-01')).toBe('여행 시작까지 D-3');
    expect(tripCountdown('2026-03-04', '2026-03-08', '2026-03-04')).toBe('오늘 출발');
    expect(tripCountdown('2026-03-04', '2026-03-08', '2026-03-06')).toBe('여행 중');
    expect(tripCountdown('2026-03-04', '2026-03-08', '2026-03-09')).toBe('여행 종료');
    expect(tripCountdown(null, null, '2026-03-01')).toBeNull();
  });
  it('마감일 상태', () => {
    expect(dueInfo('2026-03-01', '2026-03-02')?.tone).toBe('overdue');
    expect(dueInfo('2026-03-03', '2026-03-02')?.tone).toBe('soon');
    expect(dueInfo('2026-03-20', '2026-03-02')?.tone).toBe('normal');
  });
});

describe('나라 판별', () => {
  it('공항표에 있는 도시만 나라를 안다', () => {
    expect(countryOfDestination('방콕')).toBe('TH');
    expect(countryOfDestination('제주')).toBe('KR');
    expect(countryOfDestination('어딘가모르는마을')).toBeNull();
  });
  it('모르는 여행지가 섞이면 국내로 단정하지 않는다', () => {
    expect(isDomesticTrip(facts({ countries: ['KR'] }))).toBe(true);
    expect(isDomesticTrip(facts({ countries: ['KR'], hasUnknownDestination: true }))).toBe(false);
  });
});

describe('스마트 추천 — 데이터가 있을 때만', () => {
  it('아무 데이터도 없으면 추천이 없다', () => {
    expect(buildSmartSuggestions(facts())).toEqual([]);
  });
  it('항공 정보가 있으면 실제 공항·시각을 인용한다', () => {
    const s = buildSmartSuggestions(facts({ flight: { arrivalAirport: '수완나품 국제공항', arrivalTime: '14:30', departureAirport: null, departureTime: null } }));
    const time = s.find((x) => x.key === 'flight-time');
    expect(time?.reason).toContain('수완나품 국제공항 14:30');
    expect(s.some((x) => x.key === 'flight-doc')).toBe(true); // 항공 문서가 없으니 보관 추천
  });
  it('항공 문서가 있으면 보관 대신 탑승권 저장', () => {
    const s = buildSmartSuggestions(facts({ docCategories: ['FLIGHT'] }));
    expect(s.some((x) => x.key === 'boarding-pass')).toBe(true);
    expect(s.some((x) => x.key === 'flight-doc')).toBe(false);
  });
  it('숙소가 둘 이상이면 이동일 확인', () => {
    const s = buildSmartSuggestions(facts({ stays: ['A 호텔', 'B 리조트'] }));
    expect(s.find((x) => x.key === 'stay-confirm')?.reason).toContain('A 호텔, B 리조트');
    expect(s.some((x) => x.key === 'stay-move')).toBe(true);
  });
  it('플러그가 다른 나라면 어댑터, 같은 나라면 추천하지 않음', () => {
    expect(buildSmartSuggestions(facts({ countries: ['JP'] })).find((x) => x.key === 'adapter')?.priority).toBe('REQUIRED');
    expect(buildSmartSuggestions(facts({ countries: ['FR'] })).some((x) => x.key === 'adapter')).toBe(false);
  });
  it('국내 여행이면 보험·어댑터 추천이 없다', () => {
    const s = buildSmartSuggestions(facts({ countries: ['KR'], destinationNames: ['제주'] }));
    expect(s.some((x) => x.key === 'insurance' || x.key === 'adapter')).toBe(false);
  });
  it('여행지가 둘 이상이면 도시 간 이동', () => {
    const s = buildSmartSuggestions(facts({ destinationNames: ['방콕', '푸켓'] }));
    expect(s.find((x) => x.key === 'intercity')?.reason).toContain('방콕 → 푸켓');
  });
});

describe('꼭 확인하세요', () => {
  it('국내면 해외 전용 항목을 뺀다', () => {
    const keys = buildMustChecks(facts({ countries: ['KR'] })).map((s) => s.key);
    expect(keys).toEqual(['baggage']);
  });
  it('해외면 통화 이름을 넣는다', () => {
    const money = buildMustChecks(facts({ countries: ['TH'] })).find((s) => s.key === 'money');
    expect(money?.title).toBe('바트 환전');
  });
  it('입국 요건은 공식 확인 표시', () => {
    expect(buildMustChecks(facts({ countries: ['JP'] })).find((s) => s.key === 'entry-rules')?.officialCheck).toBe(true);
  });
});

describe('중복 방지', () => {
  const s = buildMustChecks(facts({ countries: ['JP'] })).find((x) => x.key === 'passport')!;
  it('같은 키로 넣은 항목이 있으면 이미 있음', () => {
    expect(isSuggestionTaken(s, [item({ title: '아무 제목', suggestion_key: 'passport' })])).toBe(true);
  });
  it('띄어쓰기만 다른 같은 제목도 이미 있음', () => {
    expect(isSuggestionTaken(s, [item({ title: '여권유효기간 확인' })])).toBe(true);
  });
  it('관계없는 항목만 있으면 없음', () => {
    expect(isSuggestionTaken(s, [item({ title: '선크림' })])).toBe(false);
  });
});

describe('관련 문서 분류', () => {
  it('추천 키가 우선', () => {
    expect(relatedDocCategory({ title: '아무거나', suggestion_key: 'stay-confirm' })).toBe('STAY');
  });
  it('제목으로 추정', () => {
    expect(relatedDocCategory({ title: '항공권 확인' })).toBe('FLIGHT');
    expect(relatedDocCategory({ title: '선크림' })).toBeNull();
  });
});
