/**
 * CHECKLIST의 규칙 — 분류·중요도·진행률·정렬·스마트 추천. DOM도 Supabase도 모르는 순수 모듈이라
 * 옆의 checklistModel.test.ts로 그대로 검증한다.
 *
 * ⚠️ 추천은 AI가 아니라 **규칙**이다(원칙 3-1). 근거는 전부 이 트립에 실제로 저장된 값이다:
 *    여행지 이름 → 나라(공항표) / 공항·시각(trip_destinations) / 확정 숙소(stay_segments) /
 *    일정 장소(route_stops) / 공용 문서 분류(trip_documents). 근거가 없으면 그 추천은 만들지 않는다.
 *    입국 규정처럼 자주 바뀌는 정보는 내용을 적지 않고 "공식 안내로 확인"까지만 말한다.
 */

import type { TripChecklistItem } from '../types/database';
import { lookupAirportCode } from '../trips/airports';

/* ══════════════ 분류 · 중요도 ══════════════ */

export type CkCategory = 'ESSENTIAL' | 'GEAR' | 'HEALTH' | 'BOOKING' | 'TIP';
export const CK_CATEGORIES: CkCategory[] = ['ESSENTIAL', 'GEAR', 'HEALTH', 'BOOKING', 'TIP'];
export const CK_CATEGORY_LABEL: Record<CkCategory, string> = {
  ESSENTIAL: '필수품',
  GEAR: '여행 용품',
  HEALTH: '건강 · 안전',
  BOOKING: '예약 · 일정',
  TIP: '여행 팁',
};

export type CkPriority = 'REQUIRED' | 'RECOMMENDED' | 'NORMAL';
export const CK_PRIORITIES: CkPriority[] = ['REQUIRED', 'RECOMMENDED', 'NORMAL'];
export const CK_PRIORITY_LABEL: Record<CkPriority, string> = {
  REQUIRED: '필수',
  RECOMMENDED: '추천',
  NORMAL: '일반',
};
const PRIORITY_RANK: Record<CkPriority, number> = { REQUIRED: 0, RECOMMENDED: 1, NORMAL: 2 };

/**
 * 분류가 비어 있는 항목(모바일에서 제목만 적은 것, 마이그레이션 전 항목)을 어디에 보여줄지.
 * 저장하지 않고 화면에서만 쓰는 추정이다 — 사용자가 고르면 그 값이 우선한다.
 */
const CATEGORY_KEYWORDS: Array<[CkCategory, RegExp]> = [
  ['HEALTH', /보험|상비약|비상약|약품|진통제|소화제|구급|마스크|선크림|자외선|모기|멀미|건강|안전|응급/],
  ['BOOKING', /항공|탑승|비행|체크인|체크아웃|예약|숙소|호텔|리조트|투어|티켓|입장권|바우처|교통|기차|열차|버스|렌터카|픽업|일정/],
  ['ESSENTIAL', /여권|비자|신분증|면허|카드|환전|현금|지갑|유심|usim|esim|e-sim|로밍|입국/i],
  ['TIP', /팁|앱|어플|지도 다운|오프라인 지도|번역|매너|에티켓|복장|드레스코드/],
];

export function inferCategory(title: string): CkCategory {
  for (const [cat, re] of CATEGORY_KEYWORDS) if (re.test(title)) return cat;
  return 'GEAR';
}

export function categoryOf(item: Pick<TripChecklistItem, 'title'> & { category?: string | null }): CkCategory {
  const raw = item.category ?? null;
  return (CK_CATEGORIES as string[]).includes(raw ?? '') ? (raw as CkCategory) : inferCategory(item.title);
}

export function priorityOf(item: { priority?: string | null }): CkPriority {
  const raw = item.priority ?? null;
  return (CK_PRIORITIES as string[]).includes(raw ?? '') ? (raw as CkPriority) : 'NORMAL';
}

export function isDone(item: { checked_at: string | null }): boolean {
  return item.checked_at != null;
}

/* ══════════════ 진행률 ══════════════ */

export interface Progress {
  done: number;
  total: number;
  /** 0~100 정수. 항목이 없으면 0 */
  pct: number;
}

export function progressOf(items: ReadonlyArray<{ checked_at: string | null }>): Progress {
  const total = items.length;
  const done = items.filter(isDone).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function progressByCategory(items: readonly TripChecklistItem[]): Record<CkCategory, Progress> {
  const out = {} as Record<CkCategory, Progress>;
  for (const cat of CK_CATEGORIES) out[cat] = progressOf(items.filter((i) => categoryOf(i) === cat));
  return out;
}

/** 최근에 완료한 순서로 */
export function recentlyDone(items: readonly TripChecklistItem[], limit: number): TripChecklistItem[] {
  return items
    .filter(isDone)
    .sort((a, b) => (b.checked_at ?? '').localeCompare(a.checked_at ?? ''))
    .slice(0, limit);
}

/* ══════════════ 필터 · 정렬 ══════════════ */

/** 'ALL' | 'ME' | 'SHARED'(공동) | 'NONE'(미지정) | trip_members.id */
export type AssigneeFilter = string;

export function matchesAssignee(item: TripChecklistItem, filter: AssigneeFilter, myMemberId: string | null): boolean {
  const memberId = item.assignee_member_id ?? null;
  const all = item.assignee_all === true;
  switch (filter) {
    case 'ALL': return true;
    case 'SHARED': return all;
    case 'NONE': return !all && !memberId;
    // "내 항목"에는 공동 담당도 들어간다 — 나도 같이 챙겨야 하는 일이므로
    case 'ME': return all || (!!myMemberId && memberId === myMemberId);
    default: return memberId === filter;
  }
}

export type SortMode = 'manual' | 'priority' | 'due' | 'status' | 'assignee';
export const SORT_LABEL: Record<SortMode, string> = {
  manual: '기본 순서',
  priority: '중요도순',
  due: '마감일순',
  status: '미완료 먼저',
  assignee: '담당자순',
};

function manualCompare(a: TripChecklistItem, b: TripChecklistItem): number {
  return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
}

/**
 * 정렬. "기본 순서"는 sort_order 그대로라 완료한 항목도 제자리에 남는다(끌어서 바꾼 순서가
 * 체크할 때마다 흐트러지지 않게). 나머지 정렬은 같은 값끼리 기본 순서를 따른다.
 */
export function sortItems(
  items: readonly TripChecklistItem[],
  mode: SortMode,
  memberName: (id: string) => string | null = () => null
): TripChecklistItem[] {
  const list = [...items];
  const assigneeKey = (i: TripChecklistItem): string => {
    if (i.assignee_all) return '1';
    const name = i.assignee_member_id ? memberName(i.assignee_member_id) : null;
    return name ? '0' + name : '2';
  };
  list.sort((a, b) => {
    switch (mode) {
      case 'priority':
        return PRIORITY_RANK[priorityOf(a)] - PRIORITY_RANK[priorityOf(b)] || manualCompare(a, b);
      case 'due': {
        const ad = a.due_date ?? null;
        const bd = b.due_date ?? null;
        if (ad !== bd) {
          if (!ad) return 1;
          if (!bd) return -1;
          return ad.localeCompare(bd);
        }
        return manualCompare(a, b);
      }
      case 'status':
        return Number(isDone(a)) - Number(isDone(b)) || manualCompare(a, b);
      case 'assignee':
        return assigneeKey(a).localeCompare(assigneeKey(b), 'ko') || manualCompare(a, b);
      default:
        return manualCompare(a, b);
    }
  });
  return list;
}

/**
 * 끌어서 놓은 뒤의 새 순서 → 실제로 바뀐 sort_order만. 화면에 보이는 순서(필터가 걸려 있을 수
 * 있음)의 자리만 서로 바꿔 끼우므로, 필터에 안 걸린 항목의 상대 순서는 그대로 유지된다.
 */
export function reorderChanges(
  visibleBefore: readonly TripChecklistItem[],
  visibleAfter: readonly TripChecklistItem[]
): Array<{ id: string; sort_order: number }> {
  const slots = visibleBefore.map((i) => i.sort_order).sort((a, b) => a - b);
  // 같은 sort_order가 겹쳐 있으면(모바일에서 동시에 추가한 경우 등) 자리를 벌려 준다
  for (let i = 1; i < slots.length; i += 1) if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 1;
  const changes: Array<{ id: string; sort_order: number }> = [];
  visibleAfter.forEach((item, idx) => {
    if (item.sort_order !== slots[idx]) changes.push({ id: item.id, sort_order: slots[idx] });
  });
  return changes;
}

/* ══════════════ 날짜 ══════════════ */

/** 'YYYY-MM-DD' 두 날짜 사이의 일수(b - a). 시간대 영향 없이 달력 기준 */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

export function todayIso(now: Date = new Date()): string {
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

/** 헤더의 D-day 표시. 날짜를 모르면 null(지어내지 않는다) */
export function tripCountdown(start: string | null, end: string | null, today: string): string | null {
  if (!start) return null;
  const d = daysBetween(today, start);
  if (d > 0) return '여행 시작까지 D-' + d;
  if (d === 0) return '오늘 출발';
  if (end && daysBetween(today, end) >= 0) return '여행 중';
  return '여행 종료';
}

/** 마감일 표시 + 상태(지남/임박) */
export function dueInfo(due: string | null, today: string): { label: string; tone: 'overdue' | 'soon' | 'normal' } | null {
  if (!due) return null;
  const d = daysBetween(today, due);
  const [, m, day] = due.split('-').map(Number);
  const date = m + '.' + String(day).padStart(2, '0');
  if (d < 0) return { label: date + ' 지남', tone: 'overdue' };
  if (d === 0) return { label: '오늘까지', tone: 'soon' };
  if (d <= 3) return { label: date + ' · D-' + d, tone: 'soon' };
  return { label: date + '까지', tone: 'normal' };
}

/* ══════════════ 나라 판별 (공항표 → 나라) ══════════════ */

/**
 * 플러그: 'same'이면 한국 플러그(C·F형)가 그대로 맞는 곳, 'differs'면 맞지 않는 곳,
 * 'mixed'면 콘센트가 섞여 있는 곳. 통화는 환전 문구에만 쓴다. 둘 다 잘 바뀌지 않는 값이고,
 * 확실하지 않은 나라는 표에 넣지 않았다(→ 어댑터 추천을 하지 않음).
 */
interface CountryInfo {
  name: string;
  plug?: 'same' | 'differs' | 'mixed';
  currency?: string;
}

const COUNTRY: Record<string, CountryInfo> = {
  KR: { name: '한국', plug: 'same', currency: '원화' },
  JP: { name: '일본', plug: 'differs', currency: '엔화' },
  CN: { name: '중국', plug: 'mixed', currency: '위안화' },
  HK: { name: '홍콩', plug: 'differs', currency: '홍콩달러' },
  MO: { name: '마카오', plug: 'differs' },
  TW: { name: '대만', plug: 'differs', currency: '대만달러' },
  TH: { name: '태국', plug: 'mixed', currency: '바트' },
  SG: { name: '싱가포르', plug: 'differs', currency: '싱가포르달러' },
  MY: { name: '말레이시아', plug: 'differs', currency: '링깃' },
  VN: { name: '베트남', plug: 'mixed', currency: '동' },
  ID: { name: '인도네시아', plug: 'same', currency: '루피아' },
  PH: { name: '필리핀', plug: 'differs', currency: '페소' },
  KH: { name: '캄보디아', plug: 'mixed' },
  LA: { name: '라오스', plug: 'mixed', currency: '킵' },
  MM: { name: '미얀마', plug: 'mixed' },
  IN: { name: '인도', plug: 'mixed', currency: '루피' },
  LK: { name: '스리랑카', plug: 'mixed' },
  MV: { name: '몰디브', plug: 'mixed' },
  NP: { name: '네팔', plug: 'mixed' },
  AE: { name: '아랍에미리트', plug: 'differs', currency: '디르함' },
  QA: { name: '카타르', plug: 'differs', currency: '리얄' },
  TR: { name: '튀르키예', plug: 'same', currency: '리라' },
  IL: { name: '이스라엘', plug: 'mixed' },
  FR: { name: '프랑스', plug: 'same', currency: '유로' },
  GB: { name: '영국', plug: 'differs', currency: '파운드' },
  IE: { name: '아일랜드', plug: 'differs', currency: '유로' },
  NL: { name: '네덜란드', plug: 'same', currency: '유로' },
  BE: { name: '벨기에', plug: 'mixed', currency: '유로' },
  DE: { name: '독일', plug: 'same', currency: '유로' },
  CH: { name: '스위스', plug: 'mixed', currency: '스위스프랑' },
  AT: { name: '오스트리아', plug: 'same', currency: '유로' },
  CZ: { name: '체코', plug: 'mixed', currency: '코루나' },
  HU: { name: '헝가리', plug: 'same', currency: '포린트' },
  PL: { name: '폴란드', plug: 'mixed', currency: '즐로티' },
  IT: { name: '이탈리아', plug: 'mixed', currency: '유로' },
  ES: { name: '스페인', plug: 'same', currency: '유로' },
  PT: { name: '포르투갈', plug: 'same', currency: '유로' },
  GR: { name: '그리스', plug: 'same', currency: '유로' },
  DK: { name: '덴마크', plug: 'mixed', currency: '크로네' },
  SE: { name: '스웨덴', plug: 'same', currency: '크로나' },
  NO: { name: '노르웨이', plug: 'same', currency: '크로네' },
  FI: { name: '핀란드', plug: 'same', currency: '유로' },
  IS: { name: '아이슬란드', plug: 'same', currency: '크로나' },
  HR: { name: '크로아티아', plug: 'same', currency: '유로' },
  SI: { name: '슬로베니아', plug: 'same', currency: '유로' },
  RU: { name: '러시아', plug: 'same' },
  US: { name: '미국', plug: 'differs', currency: '달러' },
  GU: { name: '괌', plug: 'differs', currency: '달러' },
  MP: { name: '사이판', plug: 'differs', currency: '달러' },
  CA: { name: '캐나다', plug: 'differs', currency: '캐나다달러' },
  MX: { name: '멕시코', plug: 'differs', currency: '페소' },
  AU: { name: '호주', plug: 'differs', currency: '호주달러' },
  NZ: { name: '뉴질랜드', plug: 'differs', currency: '뉴질랜드달러' },
};

const AIRPORT_COUNTRY: Record<string, string> = {
  ICN: 'KR', GMP: 'KR', PUS: 'KR', CJU: 'KR', TAE: 'KR',
  NRT: 'JP', HND: 'JP', KIX: 'JP', NGO: 'JP', CTS: 'JP', FUK: 'JP', OKA: 'JP', HIJ: 'JP', SDJ: 'JP',
  KOJ: 'JP', KMJ: 'JP', OIT: 'JP', TAK: 'JP',
  PEK: 'CN', PVG: 'CN', CAN: 'CN', SZX: 'CN', CTU: 'CN', XIY: 'CN', TAO: 'CN', DYG: 'CN',
  HKG: 'HK', MFM: 'MO', TPE: 'TW', KHH: 'TW',
  BKK: 'TH', HKT: 'TH', CNX: 'TH', KBV: 'TH', USM: 'TH', UTP: 'TH',
  SIN: 'SG', KUL: 'MY', BKI: 'MY', PEN: 'MY',
  HAN: 'VN', SGN: 'VN', DAD: 'VN', CXR: 'VN', PQC: 'VN', DLI: 'VN',
  DPS: 'ID', CGK: 'ID', MNL: 'PH', CEB: 'PH', MPH: 'PH', PPS: 'PH',
  PNH: 'KH', REP: 'KH', VTE: 'LA', LPQ: 'LA', RGN: 'MM',
  DEL: 'IN', BOM: 'IN', CMB: 'LK', MLE: 'MV', KTM: 'NP',
  DXB: 'AE', AUH: 'AE', DOH: 'QA', IST: 'TR', NAV: 'TR', TLV: 'IL',
  CDG: 'FR', NCE: 'FR', LHR: 'GB', MAN: 'GB', EDI: 'GB', DUB: 'IE', AMS: 'NL', BRU: 'BE',
  FRA: 'DE', MUC: 'DE', BER: 'DE', HAM: 'DE', ZRH: 'CH', GVA: 'CH', VIE: 'AT', SZG: 'AT',
  PRG: 'CZ', BUD: 'HU', WAW: 'PL', KRK: 'PL',
  FCO: 'IT', MXP: 'IT', VCE: 'IT', FLR: 'IT', NAP: 'IT',
  BCN: 'ES', MAD: 'ES', SVQ: 'ES', LIS: 'PT', OPO: 'PT', ATH: 'GR', JTR: 'GR', JMK: 'GR',
  CPH: 'DK', ARN: 'SE', OSL: 'NO', HEL: 'FI', KEF: 'IS', SVO: 'RU', ZAG: 'HR', DBV: 'HR', LJU: 'SI',
  JFK: 'US', LAX: 'US', SFO: 'US', LAS: 'US', ORD: 'US', BOS: 'US', IAD: 'US', SEA: 'US', MIA: 'US',
  MCO: 'US', HNL: 'US', GUM: 'GU', SPN: 'MP', YVR: 'CA', YYZ: 'CA', YUL: 'CA', MEX: 'MX', CUN: 'MX',
  SYD: 'AU', MEL: 'AU', BNE: 'AU', OOL: 'AU', CNS: 'AU', PER: 'AU', AKL: 'NZ', ZQN: 'NZ',
};

/** 여행지 이름 → 나라 코드. 공항표에 없거나 나라를 모르는 도시면 null */
export function countryOfDestination(name: string): string | null {
  const code = lookupAirportCode(name);
  return code ? AIRPORT_COUNTRY[code] ?? null : null;
}

export function countryName(code: string): string {
  return COUNTRY[code]?.name ?? code;
}

/* ══════════════ 스마트 추천 ══════════════ */

/** 추천의 근거가 되는 사실들 — checklist.ts가 실제 DB 값으로만 채운다 */
export interface TripFacts {
  destinationNames: string[];
  /** 판별된 나라 코드(중복 없음). 판별 못 한 여행지는 빠진다 */
  countries: string[];
  /** 판별 못 한 여행지가 하나라도 있는지 — 국내/해외를 단정하지 않기 위해 */
  hasUnknownDestination: boolean;
  /** 첫 여행지 도착 공항/시각, 마지막 여행지 출국 공항/시각 — 입력된 값만 */
  flight: { arrivalAirport: string | null; arrivalTime: string | null; departureAirport: string | null; departureTime: string | null } | null;
  /** 확정한 숙소 이름(날짜순) */
  stays: string[];
  /** 일정에 담긴, 입장권이 필요할 수 있는 장소(테마파크·박물관·미술관) 이름 */
  ticketedStops: string[];
  /** 공용 문서의 분류(FLIGHT/STAY/INSURANCE/TICKET/VISA/TRANSPORT …) */
  docCategories: string[];
}

export type SuggestionSource = 'FLIGHT' | 'STAY' | 'TIMELINE' | 'DESTINATION' | 'DOCS' | 'BASIC';

export interface Suggestion {
  /** 같은 추천을 다시 띄우지 않기 위한 키(trip_checklist.suggestion_key) */
  key: string;
  title: string;
  /** 왜 이 추천이 떴는지 — 실제 데이터만 인용한다 */
  reason: string;
  category: CkCategory;
  priority: CkPriority;
  source: SuggestionSource;
  /** 이 분류의 공용 문서가 하나뿐이면 추가할 때 자동으로 연결한다 */
  docCategory?: string;
  /** 변경 가능성이 높아 공식 안내로 확인해야 하는 내용 */
  officialCheck?: boolean;
}

export const SOURCE_LABEL: Record<SuggestionSource, string> = {
  FLIGHT: '항공',
  STAY: '숙소',
  TIMELINE: '일정',
  DESTINATION: '여행지',
  DOCS: '문서',
  BASIC: '기본',
};

/** 국내 여행인지 — 판별된 나라가 전부 한국이고 모르는 여행지가 없을 때만 true */
export function isDomesticTrip(facts: TripFacts): boolean {
  return facts.countries.length > 0 && !facts.hasUnknownDestination && facts.countries.every((c) => c === 'KR');
}

/** 해외로 판별된 나라가 하나라도 있는지 */
export function isInternationalTrip(facts: TripFacts): boolean {
  return facts.countries.some((c) => c !== 'KR');
}

function joinNames(names: string[], max = 2): string {
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? shown + ' 외 ' + (names.length - max) + '곳' : shown;
}

/** 일정·숙소·항공·여행지 데이터에서 뽑은 추천 — 근거가 있는 것만, 근거가 구체적인 것부터 */
export function buildSmartSuggestions(facts: TripFacts): Suggestion[] {
  const out: Suggestion[] = [];
  const hasDoc = (cat: string) => facts.docCategories.includes(cat);
  const foreign = facts.countries.filter((c) => c !== 'KR');

  // ── 항공: 공항/시각을 입력했거나 항공 문서가 있을 때만
  const f = facts.flight;
  if (f || hasDoc('FLIGHT')) {
    const parts: string[] = [];
    if (f?.arrivalAirport) parts.push('도착 ' + f.arrivalAirport + (f.arrivalTime ? ' ' + f.arrivalTime : ''));
    if (f?.departureAirport) parts.push('출국 ' + f.departureAirport + (f.departureTime ? ' ' + f.departureTime : ''));
    out.push({
      key: 'flight-time',
      title: '항공편 시각 확인',
      reason: parts.length ? parts.join(' · ') + ' — 항공권과 같은지 확인해 보세요.' : '항공권의 출발·도착 시각을 일정과 맞춰 보세요.',
      category: 'BOOKING', priority: 'REQUIRED', source: 'FLIGHT', docCategory: 'FLIGHT',
    });
    out.push({
      key: 'online-checkin',
      title: '온라인 체크인',
      reason: '항공사 앱·웹에서 체크인 가능 시간을 확인해 두세요.',
      category: 'BOOKING', priority: 'RECOMMENDED', source: 'FLIGHT', docCategory: 'FLIGHT',
    });
    out.push(hasDoc('FLIGHT')
      ? { key: 'boarding-pass', title: '탑승권 저장', reason: '체크인 후 모바일 탑승권을 휴대폰에 저장해 두세요.', category: 'BOOKING', priority: 'RECOMMENDED', source: 'FLIGHT', docCategory: 'FLIGHT' }
      : { key: 'flight-doc', title: '항공권 Documents에 보관', reason: '항공권 파일이 아직 없어요. 공항에서 바로 꺼낼 수 있게 올려 두세요.', category: 'BOOKING', priority: 'RECOMMENDED', source: 'DOCS' });
  }

  // ── 숙소: 확정한 숙소가 있거나 숙소 문서가 있을 때만
  if (facts.stays.length || hasDoc('STAY')) {
    const named = facts.stays.length ? joinNames(facts.stays) : null;
    out.push({
      key: 'stay-confirm',
      title: '숙소 예약 확정 확인',
      reason: named ? named + ' — 예약이 확정 상태인지 확인하세요.' : '숙소 예약 확인서의 날짜와 인원을 확인하세요.',
      category: 'BOOKING', priority: 'REQUIRED', source: 'STAY', docCategory: 'STAY',
    });
    out.push({
      key: 'stay-checkin',
      title: '체크인 · 체크아웃 시간 확인',
      reason: '도착·출발 시각과 맞지 않으면 짐 보관이나 얼리 체크인을 미리 문의해 두세요.',
      category: 'BOOKING', priority: 'RECOMMENDED', source: 'STAY', docCategory: 'STAY',
    });
    out.push({
      key: 'stay-address',
      title: '숙소 주소 · 연락처 저장',
      reason: '택시 기사에게 보여줄 현지어 주소를 오프라인으로 저장해 두세요.',
      category: 'BOOKING', priority: 'RECOMMENDED', source: 'STAY',
    });
    if (facts.stays.length >= 2) {
      out.push({
        key: 'stay-move',
        title: '숙소 이동일 일정 확인',
        reason: '숙소 ' + facts.stays.length + '곳 — 옮기는 날의 체크아웃과 다음 숙소 체크인 사이 짐 동선을 확인하세요.',
        category: 'BOOKING', priority: 'RECOMMENDED', source: 'STAY',
      });
    }
    if (!hasDoc('STAY')) {
      out.push({
        key: 'stay-doc',
        title: '숙소 예약 확인서 Documents에 보관',
        reason: '숙소 예약 확인서가 아직 없어요. 체크인할 때 바로 보여줄 수 있게 올려 두세요.',
        category: 'BOOKING', priority: 'NORMAL', source: 'DOCS',
      });
    }
  }

  // ── 일정: 여행지가 둘 이상이면 도시 간 이동, 입장권이 필요할 수 있는 장소가 있으면 예매 확인
  if (facts.destinationNames.length >= 2) {
    out.push({
      key: 'intercity',
      title: '도시 간 이동편 예약 확인',
      reason: facts.destinationNames.join(' → ') + ' — 이동 수단과 시간을 미리 예약해 두세요.',
      category: 'BOOKING', priority: 'REQUIRED', source: 'TIMELINE', docCategory: 'TRANSPORT',
    });
  }
  if (facts.ticketedStops.length) {
    out.push({
      key: 'tour-booking',
      title: '투어 · 입장권 예매 확인',
      reason: '일정의 ' + joinNames(facts.ticketedStops) + ' — 사전 예매가 필요한지 확인하세요.',
      category: 'BOOKING', priority: 'RECOMMENDED', source: 'TIMELINE', docCategory: 'TICKET',
    });
  } else if (hasDoc('TICKET')) {
    out.push({
      key: 'tour-booking',
      title: '투어 · 티켓 바우처 확인',
      reason: '올려 둔 바우처의 날짜와 집결 장소를 확인하세요.',
      category: 'BOOKING', priority: 'RECOMMENDED', source: 'DOCS', docCategory: 'TICKET',
    });
  }

  // ── 여행지(나라): 플러그가 다른 곳이면 어댑터, 해외면 여행자 보험
  const differs = foreign.filter((c) => COUNTRY[c]?.plug === 'differs');
  const mixed = foreign.filter((c) => COUNTRY[c]?.plug === 'mixed');
  if (differs.length) {
    out.push({
      key: 'adapter',
      title: '여행용 어댑터',
      reason: differs.map(countryName).join(', ') + '은(는) 한국 플러그(C·F형)가 맞지 않는 곳이 많아요.',
      category: 'GEAR', priority: 'REQUIRED', source: 'DESTINATION',
    });
  } else if (mixed.length) {
    out.push({
      key: 'adapter',
      title: '멀티 어댑터',
      reason: mixed.map(countryName).join(', ') + '은(는) 콘센트 형태가 섞여 있어 멀티 어댑터가 있으면 편해요.',
      category: 'GEAR', priority: 'RECOMMENDED', source: 'DESTINATION',
    });
  }
  if (foreign.length) {
    out.push(hasDoc('INSURANCE')
      ? { key: 'insurance', title: '여행자 보험 보장 내용 확인', reason: '올려 둔 보험 증서의 보장 기간과 긴급 연락처를 확인하세요.', category: 'HEALTH', priority: 'RECOMMENDED', source: 'DOCS', docCategory: 'INSURANCE' }
      : { key: 'insurance', title: '여행자 보험 가입', reason: '해외 여행이에요. 보험 증서는 Documents에 함께 올려 두면 좋아요.', category: 'HEALTH', priority: 'REQUIRED', source: 'DESTINATION', docCategory: 'INSURANCE' });
  }

  return out;
}

/**
 * "여행 전 꼭 확인하세요" — 놓치기 쉬운 기본 항목. 국내 여행으로 판별되면 해외 전용 항목은 뺀다.
 * 입국 요건은 내용을 적지 않는다(자주 바뀜) — 공식 안내로 확인하라는 것까지만.
 */
export function buildMustChecks(facts: TripFacts): Suggestion[] {
  const domestic = isDomesticTrip(facts);
  const foreign = facts.countries.filter((c) => c !== 'KR');
  const currencies = [...new Set(foreign.map((c) => COUNTRY[c]?.currency).filter((x): x is string => !!x))];
  const list: Suggestion[] = [];
  if (!domestic) {
    list.push(
      { key: 'passport', title: '여권 유효기간 확인', reason: '나라마다 요구하는 남은 유효기간이 달라요.', category: 'ESSENTIAL', priority: 'REQUIRED', source: 'BASIC' },
      { key: 'entry-rules', title: '입국 요건 확인', reason: '비자·전자여행허가 등은 바뀔 수 있어요. 외교부·대사관 공식 안내로 확인하세요.', category: 'ESSENTIAL', priority: 'REQUIRED', source: 'BASIC', docCategory: 'VISA', officialCheck: true },
      { key: 'card-overseas', title: '해외 결제 카드 설정', reason: '해외 결제·ATM 출금이 막혀 있지 않은지 카드사 앱에서 확인하세요.', category: 'ESSENTIAL', priority: 'REQUIRED', source: 'BASIC' },
      { key: 'roaming', title: '로밍 · 유심 · eSIM 준비', reason: '도착하자마자 지도와 메신저를 쓸 수 있게 미리 준비하세요.', category: 'ESSENTIAL', priority: 'RECOMMENDED', source: 'BASIC' },
      { key: 'money', title: currencies.length ? currencies.join(' · ') + ' 환전' : '환전 · 현지 결제 수단', reason: '현금이 필요한 곳을 대비해 일부는 현지 통화로 준비하세요.', category: 'ESSENTIAL', priority: 'RECOMMENDED', source: 'BASIC' },
    );
  }
  list.push({ key: 'baggage', title: '위탁 수하물 규정 확인', reason: '무게·개수 한도와 기내 반입 금지 물품을 항공사 안내로 확인하세요.', category: 'BOOKING', priority: 'RECOMMENDED', source: 'BASIC', docCategory: 'FLIGHT' });
  return list;
}

/** 제목 비교용 — 띄어쓰기·기호 차이는 같은 항목으로 본다 */
export function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[\s·.,/()\-_]+/g, '');
}

/** 이미 체크리스트에 있는 추천인지 — 키가 같거나, 제목이 사실상 같으면 */
export function isSuggestionTaken(s: Suggestion, items: readonly TripChecklistItem[]): boolean {
  const title = normalizeTitle(s.title);
  return items.some((i) => (i.suggestion_key ?? null) === s.key || normalizeTitle(i.title) === title);
}

/* ══════════════ 문서 연결 ══════════════ */

/** 항목과 관련 있을 법한 문서 분류 — 추천 키가 있으면 그걸로, 없으면 제목으로 */
const DOC_KEYWORDS: Array<[string, RegExp]> = [
  ['FLIGHT', /항공|탑승|비행|수하물|온라인 체크인/],
  ['STAY', /숙소|호텔|리조트|체크인|체크아웃/],
  ['INSURANCE', /보험/],
  ['TICKET', /투어|티켓|입장권|바우처|예매/],
  ['VISA', /비자|입국|전자여행허가|eta|esta/i],
  ['TRANSPORT', /기차|열차|버스|페리|렌터카|이동편|교통/],
];

const KEY_DOC: Record<string, string> = {
  'flight-time': 'FLIGHT', 'online-checkin': 'FLIGHT', 'boarding-pass': 'FLIGHT', baggage: 'FLIGHT',
  'stay-confirm': 'STAY', 'stay-checkin': 'STAY', insurance: 'INSURANCE', 'tour-booking': 'TICKET',
  'entry-rules': 'VISA', intercity: 'TRANSPORT',
};

export function relatedDocCategory(item: { title: string; suggestion_key?: string | null }): string | null {
  const byKey = item.suggestion_key ? KEY_DOC[item.suggestion_key] : undefined;
  if (byKey) return byKey;
  for (const [cat, re] of DOC_KEYWORDS) if (re.test(item.title)) return cat;
  return null;
}
