/**
 * MOBILE — 여행 중 Companion 화면.
 *
 * 데스크톱 TIMELINE을 반응형으로 줄인 게 아니라, **역할이 다른 두 번째 표면**이다.
 *   PC     = PLANNER    : 4개 게이트로 "어디를 갈지" 결정한다
 *   MOBILE = COMPANION  : 확정된 하루를 "지금 어디로"만 보고 따라간다
 * (자세한 배경은 docs/MOBILE_STRATEGY.md)
 *
 * 그래서 편집 UI(순서 변경·이동수단 선택·지도 편집)는 여기 없다. 대신 한 손으로 읽기 좋은
 * 밀도와, 카드를 누르면 장소 상세로 밀려 들어가는 두 화면 구조만 갖는다.
 *
 * **길찾기는 원터치, 자체 지도 없이.** 카드 우상단(`.mb-card-nav`), Overview·Guide 탭의
 * "길찾기" 링크가 전부 `directionsHref(stop)` 하나를 쓴다 — Google Maps 딥링크(`/maps/dir/`)
 * 조합뿐이라 API 비용이 0(원칙 3-2)이고, 출발지를 일부러 안 넣어서 앱이 위치 권한을 따로
 * 요청할 필요가 없다(생략하면 Google Maps가 여는 기기의 현재 위치를 자동으로 쓴다).
 * 자체 내비게이션·지도 타일 캐싱은 만들지 않는다 — 실시간 교통정보를 우리가 지어낼 수 없고
 * (원칙 3-1), 만들 이유도 없다.
 *
 * 컬러는 Light가 기본(프로젝트 원래 Airport Lounge Premium Light)이고, 기기가 다크모드면
 * "Night Lounge"로 바뀐다. 색의 의미 고정은 mobile.css 상단 주석 참고 —
 * 골드 = AI가 만든 값·별점 / 파랑 = 우리 DB의 실제 값·링크 / 회색 = 추정 / 주황 = 지금.
 *
 * ⚠️ 일정 데이터·시각 계산은 **직접 하지 않는다.** `timeline/dayModel.ts`의 loadDayModel과
 *    scheduleFor를 그대로 쓴다 — 같은 DAY인데 PC와 폰의 도착 시각이 다르면 그 자체가
 *    버그이기 때문이다(Claude.md 5-3). 이 파일에는 표현(마크업·색·아이콘)만 있다.
 *
 * **실제 도착 기록 → 남은 일정 자동 재계산.** 오늘 DAY의 카드에서 "도착"을 누르면
 * `stopProgress.ts`가 `trip_stop_progress`에 실제 시각을 저장하고, `scheduleFor`에 그 값을
 * 넘기면 이후 정류지들의 예상 시각이 자동으로 다시 계산된다(계획을 덮어쓰지 않는다 —
 * 자세한 이유는 stopProgress.ts와 supabase/trip_stop_progress.sql 참고). 이 기록은 오늘
 * DAY에서만 뜬다 — 지난 날·미래 날에는 "도착"이 의미가 없다.
 *
 * 원칙 3-1 — 화면에 뜨는 값의 출처를 섞지 않는다.
 *   · 평점·영업시간·주소  : DB에 저장된 실제 값이 있을 때만
 *   · 도착 시각·체류·이동 : 추정치(구간마다 "추정" 표기, 헤더에 안내)
 *   · 요약·놓치지 말 것    : Gemini(`AI` 태그 필수) — 없으면 만들지 않고 생성 버튼만 둔다
 *   입장료·예약 필요 여부처럼 근거가 아예 없는 값은 지어내지 않고 "확인 필요"로 남긴다.
 */

import { supabase } from '../supabase';
import { store } from '../store';
import { navigate } from '../router';
import { subscribeRoutePlan, unsubscribeRoutePlan, resetRouteStorageProbe } from '../route/routeStore';
import { loadTripDayModel, scheduleFor, stopLegKey, todaysHoursLine, hoursWarning } from '../timeline/dayModel';
import type { TlDay, TlStop, DaySchedule, RealLegMap, ProgressMap, StopProgress, HoursWarning } from '../timeline/dayModel';
import {
  loadStopProgress,
  markArrived,
  markDeparted,
  markSkipped,
  resetProgress,
  subscribeStopProgress,
  unsubscribeStopProgress,
  resetStopProgressStorageProbe,
} from './stopProgress';
import {
  modeLabel,
  fmtMin,
  fmtKm,
  minToHHMM,
  dwellMinutes,
  CAT_LABEL,
} from '../utils/travelEstimate';
import type { RealLeg, TravelMode } from '../utils/travelEstimate';
import {
  loadExpenseCtx,
  buildExpensePayload,
  fetchRate,
  computeSettlement,
  memberName,
  sumPaid,
  sumPaidOn,
  getTotalBudget,
  krwOf,
  categoryOf,
  fmtKRW,
  fmtAmount,
  symbolOf,
  unconvertedCount,
  EXPENSE_CATEGORIES,
  CATEGORY_META,
  CURRENCIES,
} from '../expense/expenseModel';
import type { ExpenseCtx, ExpenseCategory } from '../expense/expenseModel';
import {
  loadChecklist,
  addChecklistItem,
  setChecklistChecked,
  deleteChecklistItem,
  subscribeChecklist,
  unsubscribeChecklist,
  resetChecklistStorageProbe,
} from './checklist';
import {
  loadSharedDocuments,
  loadPersonalDocuments,
  getUnlockedUserId,
  normalizeDocCategory,
  signedUrlFor,
  dayDateRangeLabel,
} from '../docs/docsStore';
import type { DocCategory } from '../docs/docsStore';
import { matchStop, startWatch, stopWatch, isWatching, isGeoSupported } from './geo';
import type { GeoFix } from './geo';
import { pickTodayIndex, tripDestinationLabel } from '../timeline/tripSpans';
import { fetchWeather, resetWeatherCache } from './weather';
import type { Weather } from './weather';
import { loadGoogleMapsScript } from '../utils/googleMaps';
import { requestPlaceBrief, placeBriefKey } from '../timeline/placeBrief';
import type { PlaceBrief, PlaceBriefRequest } from '../timeline/placeBrief';
import type { Database, TripDestination, StaySegment, TripChecklistItem, TripLink, TripDocument } from '../types/database';
import './mobile.css';

type Place = Database['public']['Tables']['places']['Row'];
type Trip = Database['public']['Tables']['trips']['Row'];

/* ══════════════ 아이콘 (얇은 선 — 이모지 금지, Claude.md 5-3) ══════════════ */

const IC = {
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 19a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 18 9.5a4.7 4.7 0 0 1 .5 9.5z"/><path d="M15 3l5 1.6-3.6 3.8z" fill="currentColor" stroke-width="1"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 6-3 7-3 7h18s-3-1-3-7"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  chevDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  chevRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.8 5.9 20.4 7.2 13.7 2.2 9l6.8-.8z"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-4.5L5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  walk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="M11 8l-3 3 2 7M11 8l3 2 3-1M8 11l-3 2v6M13 10l2 4-2 6"/></svg>',
  transit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="14" rx="2"/><path d="M4 11h16M8 21l2-4h4l2 4M8 7h.01M16 7h.01"/></svg>',
  taxi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M5 17l1.5-5h11L19 17M8 12V8h8v4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3Z"/></svg>',
  starLine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l2.6 5.5 5.9.8-4.3 4.1 1.1 5.9L12 17l-5.3 2.8 1.1-5.9L3.5 9.8l5.9-.8z"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="14" rx="2.5"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M9 11v6M15 11v6"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.4"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5z"/><path d="M14.5 6.5 17.5 9.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/></svg>',
  route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H14a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h5.5"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M17 14.5h.01"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 8h16M4 14h16"/></svg>',
  navigate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  padDel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9L3 12l6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="M17 9.5 12.5 14M12.5 9.5 17 14"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4z"/><path d="M9 4v13M15 6.5v13"/></svg>',
  ticket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.5a1.5 1.5 0 0 0 0 3V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a1.5 1.5 0 0 0 0-3V9z"/></svg>',
  plane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5a2.1 2.1 0 0 0-3-3L13 8 4.8 6.2a.8.8 0 0 0-.8 1.3L8 10l-2 2-2.5-.5a.6.6 0 0 0-.6 1L5 14l1.5 2.1a.6.6 0 0 0 1-.6L7 13l2-2 2.5 4a.8.8 0 0 0 1.3-.8z"/></svg>',
  bed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8M2 17h20M6 10V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 3 8l4 4"/><path d="M3 8h13a4 4 0 0 1 0 8h-1"/><path d="m17 20 4-4-4-4"/></svg>',
};

/** 날씨 아이콘 — weather.ts의 WeatherIcon과 1:1. 이모지를 쓰지 않는다(Claude.md 5-3). */
const WX_ICON: Record<Weather['icon'], string> = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 11.1 3.5 3.5 0 0 0 7 18z"/></svg>',
  rain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 8.1 3.5 3.5 0 0 0 7 15z"/><path d="M8.5 18.5 8 20.5M12 18.5l-.5 2M15.5 18.5l-.5 2"/></svg>',
  snow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 8.1 3.5 3.5 0 0 0 7 15z"/><path d="M8.5 19h.01M12 20h.01M15.5 19h.01"/></svg>',
  storm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 7.1 3.5 3.5 0 0 0 7 14z"/><path d="m13 16-3 4h4l-3 4"/></svg>',
  fog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 9h16M4 13h16M6 17h12"/></svg>',
};

const MODE_ICON: Record<TravelMode, string> = { WALK: IC.walk, TRANSIT: IC.transit, TAXI: IC.taxi };

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 하단 탭 네 개. 레퍼런스 디자인(오늘·지도·지갑·여행)에 맞춰 재구성했고, 기존 화면은
 * 하나도 버리지 않고 아래로 들어갔다 — TIMELINE(DAY 페이저)과 MORE(숙소·체크리스트)는
 * `trip`(여행) 탭 안으로, 지출 지갑은 `wallet`(지갑) 탭의 한 섹션으로 옮겼다.
 */
type MbTab = 'today' | 'map' | 'wallet' | 'trip';
/** 여행 탭 안의 두 화면 — 예전 TIMELINE / MORE */
type TripSub = 'days' | 'info';
type PdTab = 'overview' | 'guide' | 'reviews';

/* ══════════════ 모듈 상태 ══════════════ */

let container: HTMLElement | null = null;
let currentTripId = '';
let currentTrip: Trip | null = null;
let activeDestId: string | null = null;
let allDestinations: TripDestination[] = [];

let days: TlDay[] = [];
let activeDayIndex = 0;
let activeTab: MbTab = 'today';
/** 여행 탭 안에서 보고 있는 화면 (예전 TIMELINE / MORE) */
let tripSub: TripSub = 'days';

/** 숙소 구간(체크인~체크아웃)과 그 숙소 Place를 찾기 위한 조회표 — 둘 다 loadDayModel이 이미
 *  돌려주는 값이라 MORE 탭 때문에 따로 조회하지 않는다(원칙 3-2). */
let staySegments: StaySegment[] = [];
let placeById = new Map<string, Place>();

/** 열려 있는 장소 상세의 stop key (null이면 목록 화면) */
let detailKey: string | null = null;
let detailTab: PdTab = 'overview';

let placeBriefs = new Map<string, PlaceBrief>();
let placeBriefLoading = new Set<string>();
let placeBriefErrors = new Map<string, string>();

let realLegs: RealLegMap = new Map();
let realLegPending = false;

/** 활성 DAY(오늘 보고 있는 하루)의 정류지별 실제 도착/출발 기록 — 활성 DAY만 불러온다(원칙 3-2와
 *  같은 절제: 안 보는 날의 진행 기록까지 매번 조회하지 않는다). 키는 TlStop.key. */
let progress: ProgressMap = new Map();

let daySheetOpen = false;
let nowTimer: ReturnType<typeof setInterval> | null = null;

/** TIMELINE 가로 페이저 — 스와이프가 "멈춘 뒤"에만 상태를 반영하고, 조회는 거기서 더 미룬다 */
let pagerSettleTimer: ReturnType<typeof setTimeout> | null = null;
let pagerLoadTimer: ReturnType<typeof setTimeout> | null = null;

/* ── WALLET ── */
/** 지출·예산·멤버. WALLET 탭을 처음 열 때만 불러온다(원칙 3-2 — 안 보는 탭을 미리 조회하지 않음) */
let expenseCtx: ExpenseCtx | null = null;
let expenseLoading = false;
let expenseChannel: ReturnType<typeof supabase.channel> | null = null;
/** 숫자패드 시트 상태 */
let padOpen = false;
let padAmount = '';
let padCurrency = 'KRW';
let padCategory: ExpenseCategory = 'ETC';
let padSaving = false;
/**
 * 숫자패드의 두 가지 쓰임.
 *   'expense' — 쓴 돈을 기록한다 (원래 용도)
 *   'calc'    — **그냥 얼마인지만 본다.** 시장에서 "500밧이면 얼마야"를 확인하려고 계산기 앱을
 *               여는 일을 없애려는 모드다. 환율·숫자패드·통화 칩이 이미 다 있어서 새로 만들 게
 *               없고, 계산하다가 실제로 샀으면 금액을 그대로 들고 기록 모드로 넘어간다.
 */
let padMode: 'expense' | 'calc' = 'expense';
/** 현재 통화의 환율 미리보기(≈₩) — fetchRate가 통화당 1회만 조회하고 캐시한다 */
let padRate: { rate: number | null; source: string } | null = null;

/* ── GPS 현재 위치 ── */
/**
 * 위치 자동 확인은 **기본 꺼짐**이다. 권한을 묻는 건 사용자 제스처 안에서만 해야 하고
 * (자동으로 물으면 대부분 거절당하고 그 뒤로는 다시 못 묻는다), 위치 구독은 배터리를 쓴다.
 * 여행 중 배터리는 생명줄이라 사용자가 켤 때만 켠다.
 */
let geoOn = false;
let geoFix: GeoFix | null = null;
let geoError = '';
/** GPS가 지금 여기라고 판정한 정류지 key */
let geoAtKey: string | null = null;
/** GPS로 이미 자동 기록한 정류지 — 같은 곳을 반복해서 쓰지 않게 */
const geoRecorded = new Set<string>();

/* ── 날씨 ── */
/** 활성 DAY의 날씨. 못 받으면 null이고 그 줄은 아예 안 그린다(원칙 3-1). */
let weather: Weather | null = null;
/** 지금 담긴 날씨가 어느 (좌표·날짜)의 것인지 — 같은 날을 반복 조회하지 않게 */
let weatherKey = '';

/* ── 지갑: 예약 서류 ── */
/** 지갑 탭을 처음 열 때만 불러온다(원칙 3-2) */
let walletDocs: TripDocument[] = [];
let walletDocsLoading = false;
let walletDocsLoaded = false;
/** 이 기기에서 개인 문서 잠금을 푼 적이 있는지 */
let walletPersonalUnlocked = false;

/* ── MORE ── */
/** 체크리스트·공유 링크. WALLET과 같은 규칙으로 **MORE를 처음 열 때만** 불러온다(원칙 3-2). */
let moreLoading = false;
let moreLoaded = false;
let checklist: TripChecklistItem[] = [];
/** trip_checklist 마이그레이션 전이면 false — 체크리스트 섹션을 통째로 접는다 */
let checklistReady = false;
let checklistAdding = false;
let checklistDraft = '';
/** 채팅에 공유된 링크 중 숙소·액티비티(=예약 흔적)만 */
let tripLinks: TripLink[] = [];
let linksChannel: ReturnType<typeof supabase.channel> | null = null;

export function teardownMobile(): void {
  unsubscribeRoutePlan();
  resetRouteStorageProbe();
  unsubscribeStopProgress();
  resetStopProgressStorageProbe();
  unsubscribeChecklist();
  resetChecklistStorageProbe();
  teardownMap();
  if (nowTimer) {
    clearInterval(nowTimer);
    nowTimer = null;
  }
  if (pagerSettleTimer) {
    clearTimeout(pagerSettleTimer);
    pagerSettleTimer = null;
  }
  if (pagerLoadTimer) {
    clearTimeout(pagerLoadTimer);
    pagerLoadTimer = null;
  }
  container = null;
  currentTripId = '';
  currentTrip = null;
  activeDestId = null;
  allDestinations = [];
  days = [];
  staySegments = [];
  placeById = new Map();
  activeDayIndex = 0;
  activeTab = 'today';
  tripSub = 'days';
  detailKey = null;
  detailTab = 'overview';
  placeBriefs = new Map();
  placeBriefLoading = new Set();
  placeBriefErrors = new Map();
  realLegs = new Map();
  realLegPending = false;
  progress = new Map();
  daySheetOpen = false;
  if (expenseChannel) {
    supabase.removeChannel(expenseChannel);
    expenseChannel = null;
  }
  expenseCtx = null;
  expenseLoading = false;
  padOpen = false;
  padAmount = '';
  padCurrency = 'KRW';
  padCategory = 'ETC';
  padSaving = false;
  padMode = 'expense';
  padRate = null;
  if (linksChannel) {
    supabase.removeChannel(linksChannel);
    linksChannel = null;
  }
  stopWatch();
  geoOn = false;
  geoFix = null;
  geoError = '';
  geoAtKey = null;
  geoRecorded.clear();
  weather = null;
  weatherKey = '';
  resetWeatherCache();
  walletDocs = [];
  walletDocsLoading = false;
  walletDocsLoaded = false;
  walletPersonalUnlocked = false;
  moreLoading = false;
  moreLoaded = false;
  checklist = [];
  checklistReady = false;
  checklistAdding = false;
  checklistDraft = '';
  tripLinks = [];
}

/* ══════════════ 유틸 ══════════════ */

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function todayISO(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** 오늘이 여행 기간 안이면 그 DAY 인덱스, 아니면 -1 */
function todayDayIndex(): number {
  // 여행지가 바뀌는 날은 같은 날짜가 두 번 나온다 — 일정 있는 쪽을 우선한다(tripSpans.ts)
  return pickTodayIndex(days, todayISO());
}

function activeDay(): TlDay | null {
  return days[activeDayIndex] ?? null;
}

/** "10.26 (일)" */
function dateLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return (d.getMonth() + 1) + '.' + String(d.getDate()).padStart(2, '0') + ' (' + WEEKDAY[d.getDay()] + ')';
}

/** 지금 보고 있는 DAY의 여행지 이름 — 여행지가 여럿이면 날마다 다르다 */
function destName(): string {
  return activeDay()?.destName ?? tripDestName();
}

/** 여행 **전체**의 여행지 이름 — "방콕 → 푸켓". 하루가 아니라 여행을 말하는 자리에 쓴다. */
function tripDestName(): string {
  return tripDestinationLabel(allDestinations) || currentTrip?.destinations?.[0] || '여행';
}

/** 여행지가 둘 이상인가 — 그럴 때만 날마다 어느 여행지인지 표시한다(하나뿐이면 군더더기다) */
function isMultiDest(): boolean {
  return new Set(days.map((d) => d.destId)).size > 1;
}

/**
 * 진행 기록은 **활성 DAY 것만** 불러와 있다(원칙 3-2). 그걸 다른 DAY에 넘기면, 여행지가 다르고
 * 순번·장소 이름이 같은 정류지의 기록이 엉뚱한 날에 "다녀옴"으로 비칠 수 있다(키가 여행지 안에서만
 * 유일하다). 그래서 활성 DAY에만 넘기고 나머지는 빈 맵을 준다.
 */
const NO_PROGRESS: ProgressMap = new Map();
function progressOf(day: TlDay): ProgressMap {
  const a = activeDay();
  return a && day.destId === a.destId && day.dayIndex === a.dayIndex ? progress : NO_PROGRESS;
}

async function loadTrip(tripId: string): Promise<Trip | null> {
  const cached = store.get('currentTrip');
  if (cached && cached.id === tripId) return cached;
  const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).single();
  if (error) {
    console.error('[Mobile] Trip load error:', error.message);
    return null;
  }
  return data;
}

function gotoGate(gate: string): void {
  if (!currentTripId) return;
  navigate('trip/' + currentTripId + '/' + gate);
}

/**
 * 주소 복사 — 택시 기사에게 보여줄 주소를 손으로 옮겨 적지 않게 한다.
 * 결과는 버튼 글자로만 알린다(토스트 인프라를 이 화면 하나 때문에 만들지 않는다).
 * navigator.clipboard는 HTTPS에서만 있으므로 없으면 조용히 넘어간다.
 */
async function copyToClipboard(text: string, btn: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.innerHTML;
    btn.innerHTML = IC.check + ' 복사됨';
    setTimeout(() => { btn.innerHTML = original; }, 1600);
  } catch (e) {
    console.error('[Mobile] 주소 복사 실패:', e);
  }
}

/**
 * 이 정류지로 가는 길찾기 링크(Google Maps). URL 조합뿐이라 API 비용이 0(원칙 3-2).
 * 목적지는 좌표가 있으면 좌표로, 없으면 이름으로 잡는다. 출발지는 일부러 넣지 않는다 —
 * 비워두면 Google Maps가 이 링크를 여는 기기의 현재 위치를 출발지로 자동으로 잡아준다
 * (우리가 위치 권한을 따로 요청할 필요가 없다).
 * 이 정류지로 "들어오는" 구간에 사용자가 직접 지정한 이동수단이 있으면 힌트로 같이 넘긴다 —
 * 없으면 Google Maps가 알아서 고른다.
 */
function directionsHref(stop: TlStop): string {
  const dest = stop.lat != null && stop.lng != null ? stop.lat + ',' + stop.lng : stop.name;
  const mode =
    stop.travelMode === 'WALK' ? 'walking' : stop.travelMode === 'TRANSIT' ? 'transit' : stop.travelMode === 'TAXI' ? 'driving' : null;
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(dest) + (mode ? '&travelmode=' + mode : '');
}

/* ══════════════ 진입점 ══════════════ */

export async function renderMobileContent(host: HTMLElement, tripId: string): Promise<void> {
  teardownMobile();
  container = host;
  currentTripId = tripId;

  host.innerHTML = '<div class="mb-app"><div class="mb-loading"><span class="mb-spinner"></span>일정 불러오는 중…</div></div>';

  const trip = await loadTrip(tripId);
  currentTrip = trip;
  if (!trip) {
    host.innerHTML = '<div class="mb-app"><div class="mb-loading">여행 정보를 찾을 수 없어요.</div></div>';
    return;
  }

  // 여행지를 고르지 않아도 모든 여행지가 DAY로 이어져 보인다(방콕 DAY 1~4 다음 푸켓 DAY 5~)
  const model = await loadTripDayModel(trip);
  days = model.days;
  allDestinations = model.destinations;
  activeDestId = model.activeDestId;
  staySegments = model.staySegments;
  placeById = model.ctx.placeById;

  // 여행 중이면 오늘 DAY로, 아니면 일정이 처음 들어 있는 DAY로 연다
  const today = todayDayIndex();
  const firstFilled = days.findIndex((d) => d.stops.length > 0);
  activeDayIndex = today >= 0 ? today : firstFilled >= 0 ? firstFilled : 0;

  render();

  subscribeRoutePlan(tripId, () => { void reloadFromRemote(); });
  subscribeStopProgress(tripId, () => { void loadProgressForActiveDay(); });
  void loadRealLegsForActiveDay();
  void loadProgressForActiveDay();
  void loadWeatherForActiveDay();
  // 요약 카드의 "예약 서류 N건"이 이 값을 쓴다 — 지갑 탭과 같은 데이터를 한 번만 받는다
  void ensureWalletDocs();

  // "지금" 표시는 분 단위로만 움직이면 충분하다
  nowTimer = setInterval(() => { if (todayDayIndex() >= 0 && !detailKey) render(); }, 60_000);
}

async function reloadFromRemote(): Promise<void> {
  if (!currentTrip) return;
  const model = await loadTripDayModel(currentTrip);
  days = model.days;
  allDestinations = model.destinations;
  activeDestId = model.activeDestId;
  staySegments = model.staySegments;
  placeById = model.ctx.placeById;
  if (activeDayIndex >= days.length) activeDayIndex = Math.max(0, days.length - 1);
  render();
}

/**
 * 활성 DAY의 날씨를 채운다. 좌표는 그 날 **첫 정류지의 저장된 좌표**를 쓴다 — 하루 동선이
 * 보통 한 도시 안이라 그걸로 충분하고, 사용자 위치 권한을 따로 묻지 않아도 된다.
 * 좌표가 없거나 조회가 실패하면 그냥 안 그린다.
 */
async function loadWeatherForActiveDay(): Promise<void> {
  const day = activeDay();
  const pin = day?.stops.find((st) => st.lat != null && st.lng != null);
  if (!day?.date || !pin) {
    if (weather) { weather = null; weatherKey = ''; render(); }
    return;
  }
  const key = pin.lat!.toFixed(2) + ',' + pin.lng!.toFixed(2) + ',' + day.date;
  if (key === weatherKey) return; // 같은 날·같은 곳이면 다시 묻지 않는다
  weatherKey = key;
  const w = await fetchWeather(pin.lat!, pin.lng!, day.date);
  // 그 사이 사용자가 DAY를 옮겼으면 버린다
  if (weatherKey !== key) return;
  weather = w;
  render();
}

/** 활성 DAY의 진행 기록만 불러온다(원칙 3-2). DAY를 옮길 때마다 다시 호출한다. */
async function loadProgressForActiveDay(): Promise<void> {
  const day = activeDay();
  // 진행 기록은 (여행지, 여행지 안의 DAY 순번)으로 저장된다 — 이어 붙인 목록의 전체 순번이 아니다
  if (!day?.destId) {
    if (progress.size) { progress = new Map(); render(); }
    return;
  }
  const map = await loadStopProgress(day.destId, day.dayIndex);
  if (!map) return; // 저장소를 못 씀(마이그레이션 전) — 조용히 유지
  // 기다리는 사이 다른 DAY로 옮겼으면 이 응답은 버린다(남의 날 기록으로 덮어쓰지 않게)
  const now = activeDay();
  if (!now || now.destId !== day.destId || now.dayIndex !== day.dayIndex) return;
  progress = map;
  render();
}

/* ══════════════ 실측 경로 (활성 DAY만) ══════════════ */

/**
 * 원칙 3-2 — 화면에 들어올 때마다 전부 조회하지 않는다. 지금 보고 있는 DAY의, 아직 안 받은
 * 구간만 묻는다(TIMELINE과 같은 전략). 실패하면 조용히 추정치를 유지한다.
 */
async function loadRealLegsForActiveDay(): Promise<void> {
  const day = activeDay();
  if (!day || realLegPending) return;
  const stops = day.stops.filter((s) => s.lat != null && s.lng != null);
  if (stops.length < 2) return;

  const pending: Array<{ id: string; from: { lat: number; lng: number }; to: { lat: number; lng: number } }> = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const key = stopLegKey(stops[i], stops[i + 1]);
    if (realLegs.has(key) || pending.some((p) => p.id === key)) continue;
    pending.push({
      id: key,
      from: { lat: stops[i].lat!, lng: stops[i].lng! },
      to: { lat: stops[i + 1].lat!, lng: stops[i + 1].lng! },
    });
  }
  if (!pending.length) return;

  realLegPending = true;
  try {
    const res = await fetch('/api/route-matrix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs: pending, modes: ['WALK', 'TRANSIT', 'DRIVE'] }),
    });
    if (!res.ok) return;
    const json = await res.json();
    const results: Array<{ id: string; modes: Record<string, RealLeg> }> = json?.results ?? [];
    let got = false;
    results.forEach((r) => {
      if (r.modes && Object.keys(r.modes).length) {
        realLegs.set(r.id, r.modes);
        got = true;
      }
    });
    if (got) render();
  } catch (e) {
    console.error('[Mobile] /api/route-matrix 요청 실패:', e);
  } finally {
    realLegPending = false;
  }
}

/* ══════════════ 렌더 ══════════════ */

function render(): void {
  if (!container) return;
  const scrollTop = (container.querySelector('.mb-scroll') as HTMLElement | null)?.scrollTop ?? 0;

  container.innerHTML = '<div class="mb-app">' + appHtml() + '</div>';
  applyPhotos();
  bind();

  // 목록으로 돌아왔을 때 보던 위치를 잃지 않게(상세를 열고 닫으면 위로 튀는 걸 막음)
  const scroller = container.querySelector('.mb-scroll') as HTMLElement | null;
  if (scroller && !detailKey) scroller.scrollTop = scrollTop;

  // TIMELINE 페이저는 innerHTML을 새로 그리면 첫 페이지로 돌아간다 — 상태(activeDayIndex)가
  // 곧 페이지 위치이므로 매 렌더마다 거기로 되돌려 놓는다(애니메이션 없이: 이미 그 자리다).
  const pager = container.querySelector('#mb-tl-pager') as HTMLElement | null;
  if (pager) pager.scrollLeft = activeDayIndex * pager.clientWidth;
  centerActiveChip();

  // 지도는 마크업이 DOM에 올라온 뒤에야 붙일 수 있다
  if (activeTab === 'map' && !detailKey) void mountMap();
}

function appHtml(): string {
  if (detailKey) return detailHtml();
  // TIMELINE은 세로로 흐르지 않는다 — 가로 페이저가 남은 높이를 다 쓰고, 세로 스크롤은
  // 페이지 안쪽이 맡는다(축이 달라 서로 싸우지 않는다)
  const scrollCls = 'mb-scroll' + (activeTab === 'trip' && tripSub === 'days' && days.some((d) => d.stops.length) ? ' is-pager' : '');
  return [
    topBarHtml(),
    '<main class="' + scrollCls + '">' + tabBodyHtml() + '</main>',
    tabBarHtml(),
    daySheetOpen ? daySheetHtml() : '',
    padOpen ? padSheetHtml() : '',
  ].join('');
}

function tabBodyHtml(): string {
  if (activeTab === 'today') return todayTabHtml();
  if (activeTab === 'map') return mapTabHtml();
  if (activeTab === 'wallet') return walletTabHtml();
  return tripSub === 'days' ? allDaysTabHtml() : moreTabHtml();
}

/* ── 상단 바 ── */

function topBarHtml(): string {
  const day = activeDay();
  const isToday = day?.date === todayISO();
  const brandRow = [
    '<header class="mb-top">',
    '  <div class="mb-brand"><span class="mb-brand-mark">' + IC.logo + '</span>몽실이</div>',
    '  <div class="mb-top-actions">',
    // 폰에서 Companion은 앱 전체라 워크스페이스 헤더가 숨겨져 있다 — 여기서 PC 게이트로
    // 보내면 돌아올 길이 애매해진다. 그래서 나가는 길은 "다른 여행 고르기" 하나만 둔다.
    // (링크는 MORE 탭에 이미 있어서 종 아이콘은 없앴다 — 버튼 두 개가 할 일이 겹쳤다.)
    '    <button class="mb-icon-btn" id="mb-trips" aria-label="다른 여행">' + IC.menu + '</button>',
    '  </div>',
    '</header>',
  ].join('');

  // 화면 제목은 탭마다 다르다. TODAY는 날짜 띠가 바로 아래에 있어서 상단에 DAY 피커를 또 두지 않는다.
  if (activeTab !== 'today') {
    const title = activeTab === 'wallet' ? '지갑' : activeTab === 'map' ? '지도' : tripSub === 'info' ? '여행 정보' : '전체 일정';
    return [
      brandRow,
      '<div class="mb-daybar"><span class="mb-screen-title">' + title + '</span></div>',
      '<div class="mb-daymeta">',
      '  <span class="mb-date">' + escapeHtml(tripDestName()) + ' · 여행 전체</span>',
      '</div>',
    ].join('');
  }

  return [
    brandRow,
    '<div class="mb-daybar"><span class="mb-screen-title">' + escapeHtml(currentTrip?.name || tripDestName()) + '</span></div>',
    '<div class="mb-daymeta">',
    isToday ? '  <span class="mb-today-chip">TODAY</span>' : '',
    '  <span class="mb-date">' + escapeHtml(dateLabel(day?.date ?? null)) + '</span>',
    weatherChipHtml(),
    '</div>',
  ].join('');
}

/**
 * 날씨 한 조각. **못 받았으면 빈 문자열** — 자리를 비워 두지 "—"나 기본값을 찍지 않는다(원칙 3-1).
 * 오늘은 지금 기온, 다른 날은 그날 최고/최저를 보여준다. 둘을 같은 모양으로 찍으면
 * 내일 칸의 숫자를 "지금 기온"으로 읽게 되므로 표기를 일부러 다르게 둔다.
 */
function weatherChipHtml(): string {
  if (!weather) return '';
  const text =
    weather.kind === 'now'
      ? weather.tempC + '° ' + weather.label
      : weather.maxC + '° / ' + weather.minC + '° ' + weather.label;
  return '  <span class="mb-wx">' + WX_ICON[weather.icon] + escapeHtml(text) + '</span>';
}

/* ── 하단 탭 ── */

function tabBarHtml(): string {
  const items: Array<{ key: MbTab; label: string; icon: string }> = [
    { key: 'today', label: '오늘', icon: IC.home },
    { key: 'map', label: '지도', icon: IC.map },
    { key: 'wallet', label: '지갑', icon: IC.wallet },
    { key: 'trip', label: '여행', icon: IC.bag },
  ];
  return (
    '<nav class="mb-tabs">' +
    items
      .map(
        (t) =>
          '<button class="mb-tab' + (t.key === activeTab ? ' active' : '') + '" data-tab="' + t.key + '">' +
          '<span class="mb-tab-ic">' + t.icon + '</span>' +
          '<span class="mb-tab-label">' + t.label + '</span>' +
          '</button>'
      )
      .join('') +
    '</nav>'
  );
}

/* ══════════════ TODAY 탭 — 시간축 위의 하루 ══════════════ */

/* ── "지금" 상태 판정 ──────────────────────────────────────
 * TODAY 히어로가 답해야 하는 질문은 하나다: "지금 뭘 해야 하나."
 * 새 데이터는 쓰지 않는다 — 이미 있는 일정(scheduleFor)과 실제 도착 기록(progress)만으로
 * 상태를 가른다. 판정 순서는 항상 **실제 기록 > 시각 추정**이다(원칙 3-1).
 */
type NowState =
  | { kind: 'before'; daysLeft: number; startDate: string | null; totalStops: number }
  | { kind: 'after'; visited: number; totalStops: number }
  | { kind: 'otherday'; todayIdx: number; todayLabel: string }
  | { kind: 'pre'; stop: TlStop; minsTo: number; at: number }
  | { kind: 'at'; stop: TlStop; index: number; minsLeft: number; next: TlStop | null }
  | { kind: 'moving'; stop: TlStop; index: number; leg: ReturnType<typeof scheduleFor>['legs'][number]; minsTo: number }
  | { kind: 'done'; visited: number; totalStops: number };

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + 'T00:00:00').getTime();
  const b = new Date(toISO + 'T00:00:00').getTime();
  return Math.round((b - a) / 86400000);
}

function computeNowState(day: TlDay, s: DaySchedule): NowState | null {
  const t = todayISO();
  const filled = days.filter((d) => d.stops.length);
  const first = filled[0]?.date ?? null;
  const last = filled[filled.length - 1]?.date ?? null;
  const totalStops = days.reduce((acc, d) => acc + d.stops.length, 0);

  // 여행 전 — 아직 시작 안 함
  if (first && t < first) {
    return { kind: 'before', daysLeft: daysBetween(t, first), startDate: first, totalStops };
  }
  // 여행 후 — 실제로 다녀온 곳만 센다(기록이 없으면 0)
  if (last && t > last) {
    let visited = 0;
    progress.forEach((v) => { if (v.status === 'arrived' || v.status === 'departed') visited++; });
    return { kind: 'after', visited, totalStops };
  }
  // 여행 중인데 다른 날을 보고 있음 — 오늘로 돌아갈 길만 안내한다
  const todayIdx = todayDayIndex();
  // 날짜로 판단한다 — 여행지가 바뀌는 날은 같은 날짜의 DAY가 둘이라, 인덱스로 비교하면
  // 그 둘 중 하나를 보고 있을 때도 "다른 날을 보고 있어요"가 뜬다
  if (todayIdx >= 0 && day.date !== t) {
    return { kind: 'otherday', todayIdx, todayLabel: days[todayIdx]?.label ?? '오늘' };
  }
  if (day.date !== t || !day.stops.length) return null;

  const now = nowMinutes();
  const stops = day.stops;

  // ① 실제 "도착" 기록이 있으면 그게 가장 확실한 현재 위치
  const arrivedIdx = stops.findIndex((st) => progress.get(st.key)?.status === 'arrived');
  if (arrivedIdx >= 0) {
    return {
      kind: 'at',
      stop: stops[arrivedIdx],
      index: arrivedIdx,
      minsLeft: s.departMin[arrivedIdx] - now,
      next: stops[arrivedIdx + 1] ?? null,
    };
  }

  // ② "출발"까지 기록했고 다음 정류지가 아직이면 이동 중
  let lastDeparted = -1;
  stops.forEach((st, i) => { if (progress.get(st.key)?.status === 'departed') lastDeparted = i; });
  if (lastDeparted >= 0 && lastDeparted + 1 < stops.length) {
    const nextIdx = lastDeparted + 1;
    const np = progress.get(stops[nextIdx].key)?.status;
    if (!np || np === 'pending') {
      return { kind: 'moving', stop: stops[nextIdx], index: nextIdx, leg: s.legs[lastDeparted], minsTo: s.arriveMin[nextIdx] - now };
    }
  }

  // ③ 기록이 없으면 시각으로 추정한다
  if (now < s.arriveMin[0]) {
    return { kind: 'pre', stop: stops[0], minsTo: s.arriveMin[0] - now, at: s.arriveMin[0] };
  }
  for (let i = 0; i < stops.length; i++) {
    if (now >= s.arriveMin[i] && now < s.departMin[i]) {
      return { kind: 'at', stop: stops[i], index: i, minsLeft: s.departMin[i] - now, next: stops[i + 1] ?? null };
    }
    if (i + 1 < stops.length && now >= s.departMin[i] && now < s.arriveMin[i + 1]) {
      return { kind: 'moving', stop: stops[i + 1], index: i + 1, leg: s.legs[i], minsTo: s.arriveMin[i + 1] - now };
    }
  }

  let visited = 0;
  stops.forEach((st) => { const v = progress.get(st.key); if (v?.status === 'arrived' || v?.status === 'departed') visited++; });
  return { kind: 'done', visited, totalStops: stops.length };
}

/** "40분", "1시간 20분" — 음수(이미 지난 시각)는 호출부가 따로 다룬다 */
function fmtLeft(mins: number): string {
  return fmtMin(Math.max(0, Math.round(mins)));
}

/**
 * TODAY 히어로 — 카드 목록 위에 얹히는 "지금" 한 덩어리.
 * 상태마다 문구와 액션이 통째로 바뀐다. 여기 뜨는 시각·소요는 전부 기존 계산에서 오고,
 * 새로 지어내는 값은 없다(원칙 3-1).
 */
function heroHtml(st: NowState, day: TlDay, s: DaySchedule): string {
  const wrap = (cls: string, eyebrow: string, title: string, sub: string, extra: string, actions: string): string =>
    [
      '<section class="mb-now ' + cls + '">',
      '  <div class="mb-now-eyebrow">' + eyebrow + '</div>',
      '  <h2 class="mb-now-title">' + title + '</h2>',
      sub ? '  <p class="mb-now-sub">' + sub + '</p>' : '',
      extra,
      actions ? '  <div class="mb-now-actions">' + actions + '</div>' : '',
      '</section>',
    ].join('');

  /** 지금 향하고 있는 곳이 닫혀 있으면 히어로에서 먼저 알린다 — 이미 출발한 뒤에 카드까지
   *  스크롤해서 발견하면 늦는다. 판단 불가면 빈 문자열이라 아무것도 안 뜬다. */
  const heroWarn = (stop: TlStop, arrive: number, depart?: number): string => {
    const w = hoursWarning(stop.place ?? null, day.date, arrive, depart);
    return w ? '  <p class="mb-now-warn">' + escapeHtml(hoursWarnText(w)) + '</p>' : '';
  };

  if (st.kind === 'before') {
    const d = st.daysLeft;
    return wrap(
      'is-plan',
      'D-' + d,
      escapeHtml(tripDestName()) + ' 여행까지 ' + d + '일',
      (st.startDate ? escapeHtml(dateLabel(st.startDate)) + ' 출발' : '') + (st.totalStops ? ' · 일정 ' + st.totalStops + '곳' : ''),
      '',
      ''
    );
  }

  if (st.kind === 'after') {
    return wrap(
      'is-plan',
      '여행 끝',
      '잘 다녀오셨어요',
      st.visited > 0 ? '기록한 방문 ' + st.visited + '곳 · 전체 일정 ' + st.totalStops + '곳' : '전체 일정 ' + st.totalStops + '곳',
      '',
      ''
    );
  }

  if (st.kind === 'otherday') {
    return wrap(
      'is-plan',
      'TODAY',
      '오늘은 ' + escapeHtml(st.todayLabel) + '이에요',
      '지금은 다른 날을 보고 있어요',
      '',
      '<button class="mb-now-btn primary" data-goday="' + st.todayIdx + '">오늘 보기</button>'
    );
  }

  if (st.kind === 'pre') {
    return wrap(
      'is-live',
      'TODAY',
      '첫 일정까지 ' + fmtLeft(st.minsTo),
      escapeHtml(st.stop.name) + ' · ' + minToHHMM(st.at) + ' 시작',
      heroWarn(st.stop, st.at),
      '<a class="mb-now-btn primary" href="' + directionsHref(st.stop) + '" target="_blank" rel="noopener">' + IC.navigate + '길찾기</a>'
    );
  }

  if (st.kind === 'at') {
    const late = st.minsLeft < 0;
    // 체류 진행 바 — 예상 체류 중 얼마나 지났는지
    const dwell = s.dwellMin[st.index] || 0;
    const pct = dwell > 0 ? Math.min(100, Math.max(0, Math.round(((dwell - st.minsLeft) / dwell) * 100))) : 0;
    const bar = dwell > 0
      ? '  <div class="mb-now-bar"><span class="mb-now-bar-fill' + (late ? ' is-late' : '') + '" style="width:' + pct + '%"></span></div>'
      : '';
    return wrap(
      'is-live',
      'NOW',
      escapeHtml(st.stop.name) + '에 있어요',
      late
        ? '출발 예정 시각을 ' + fmtLeft(-st.minsLeft) + ' 지났어요'
        : fmtLeft(st.minsLeft) + ' 뒤 출발 · ' + minToHHMM(s.departMin[st.index]),
      bar,
      '<button class="mb-now-btn primary" data-hero-depart="' + escapeHtml(st.stop.key) + '">' + IC.check + '출발</button>' +
        (st.next ? '<a class="mb-now-btn ghost" href="' + directionsHref(st.next) + '" target="_blank" rel="noopener">' + IC.navigate + '다음 장소</a>' : '')
    );
  }

  if (st.kind === 'moving') {
    const legText = st.leg ? modeLabel(st.leg.mode) + ' ' + fmtMin(st.leg.min) : null;
    const late = st.minsTo < 0;
    return wrap(
      'is-live',
      'NEXT',
      escapeHtml(st.stop.name) + '으로 이동',
      (legText ? escapeHtml(legText) + ' · ' : '') +
        (late ? '도착 예정 시각을 ' + fmtLeft(-st.minsTo) + ' 지났어요' : minToHHMM(s.arriveMin[st.index]) + ' 도착 예정'),
      heroWarn(st.stop, s.arriveMin[st.index], s.departMin[st.index]),
      '<a class="mb-now-btn primary" href="' + directionsHref(st.stop) + '" target="_blank" rel="noopener">' + IC.navigate + '길찾기</a>' +
        '<button class="mb-now-btn ghost" data-hero-arrive="' + escapeHtml(st.stop.key) + '">' + IC.check + '도착</button>'
    );
  }

  // done
  return wrap(
    'is-live',
    '오늘 일정 끝',
    '오늘 하루 수고했어요',
    st.visited > 0 ? st.totalStops + '곳 중 ' + st.visited + '곳 다녀왔어요' : '오늘 일정 ' + st.totalStops + '곳',
    '',
    ''
  );
}

/**
 * 계획 대비 얼마나 밀렸는지 한 줄. 실제 기록이 반영된 일정과 계획만의 일정을 같은 함수로
 * 두 번 계산해 끝나는 시각을 비교한다 — 도착 기록이 실제로 무슨 차이를 만드는지 보여주는 자리다.
 */
function driftLineHtml(day: TlDay): string {
  if (!progress.size) return '';
  const plan = scheduleFor(day, realLegs);
  const real = scheduleFor(day, realLegs, progress);
  const delta = real.spanEndMin - plan.spanEndMin;
  if (Math.abs(delta) < 10) return '';
  return delta > 0
    ? '<p class="mb-drift is-late">이 속도면 계획보다 ' + fmtMin(delta) + ' 늦게 끝나요 · ' + minToHHMM(real.spanEndMin) + ' 종료</p>'
    : '<p class="mb-drift">계획보다 ' + fmtMin(-delta) + ' 빨라요 · ' + minToHHMM(real.spanEndMin) + ' 종료</p>';
}

/* ── 오늘 화면의 머리 두 조각: 요약 카드 + 날짜 선택 바 ───────────
 *
 * 레퍼런스 디자인의 상단 구조를 따른다. 둘 다 **이미 가진 값만** 쓴다 —
 * 날씨는 연결된 데이터가 없어서 아예 그리지 않는다(없는 걸 그리면 그 순간 거짓이 된다).
 */

/**
 * 이 DAY에 걸리는 예약 서류 수. day_start~day_end 범위로만 셀 수 있다(아래 주석 참고).
 *
 * `dayNumber`는 **여행 전체 기준** DAY 번호(`TlDay.dayNumber`)여야 한다. 서류의 day_start/day_end가
 * 여행지를 이어 붙인 번호이기 때문이다 — 여행지 안의 순번(`dayIndex`)을 넣으면 두 번째 여행지부터
 * 서류가 엉뚱한 날에 붙는다.
 */
function docCountForDay(dayNumber: number): number {
  if (!walletDocsLoaded) return -1; // 아직 모름 — 숫자를 지어내지 않고 줄을 생략한다
  const n = dayNumber;
  return walletDocs.filter((d) => {
    if (d.day_start == null && d.day_end == null) return false; // 전체 일정 문서는 "오늘 예약"이 아니다
    const from = d.day_start ?? d.day_end ?? 0;
    const to = d.day_end ?? d.day_start ?? 0;
    return n >= from && n <= to;
  }).length;
}

function daySummaryCardHtml(day: TlDay): string {
  // 그 날이 속한 여행지 — 여행지가 여럿이면 날마다 다르다
  const dest = day.destName ?? tripDestName();
  // 대표 이미지 — 그 날 정류지 중 **실제로 저장된 사진**이 있는 첫 곳. 없으면 단색으로 둔다.
  const photo = day.stops.find((st) => st.place?.photo_url)?.place?.photo_url ?? null;
  const docs = docCountForDay(day.dayNumber);

  const meta = [day.stops.length + '곳'];
  if (docs > 0) meta.push('예약 서류 ' + docs + '건');

  return [
    '<section class="mb-sum' + (photo ? '' : ' no-photo') + '">',
    photo ? '  <div class="mb-sum-photo" data-photo="' + escapeHtml(photo) + '"></div>' : '',
    '  <div class="mb-sum-scrim"></div>',
    '  <div class="mb-sum-body">',
    '    <h2 class="mb-sum-title">오늘은 ' + escapeHtml(dest) + '에서 보내요</h2>',
    '    <p class="mb-sum-meta">' + escapeHtml(meta.join(' · ')) + '</p>',
    '  </div>',
    '</section>',
  ].join('');
}

/** 앞뒤로 훑어보기 좋은 날짜 띠 — 선택된 날은 브랜드 블루로 채운다 */
function dateStripHtml(): string {
  if (!days.length) return '';
  // 활성 DAY를 가운데 두되 양 끝에서는 밀어 넣어 항상 4칸이 차게 한다
  const WINDOW = 4;
  let from = Math.max(0, activeDayIndex - 1);
  if (from + WINDOW > days.length) from = Math.max(0, days.length - WINDOW);
  const shown = days.slice(from, from + WINDOW);
  const t = todayISO();
  // 창 안이 아니라 **여행 전체**가 기준이다 — 창을 밀 때 칸 높이가 들썩이지 않게
  const multi = isMultiDest();

  return [
    '<div class="mb-dates">',
    shown
      .map((d, i) => {
        const idx = from + i;
        const active = idx === activeDayIndex;
        const dd = d.date ? new Date(d.date + 'T00:00:00') : null;
        const num = dd ? String(dd.getDate()) : String(idx + 1);
        const wd = dd ? WEEKDAY[dd.getDay()] : 'DAY';
        return (
          '<button class="mb-date-cell' + (active ? ' active' : '') + (d.date === t ? ' is-today' : '') + (multi ? ' has-dest' : '') + '" data-day="' + idx + '">' +
          '<span class="mb-date-num">' + escapeHtml(num) + '</span>' +
          '<span class="mb-date-wd">' + escapeHtml(wd) + '</span>' +
          // 여행지가 여럿일 때만 어느 여행지인지 적는다. 바뀌는 날은 같은 날짜가 두 칸이라
          // 이게 없으면 "29 수"가 두 번 나와 구분이 안 된다.
          (multi && d.destName ? '<span class="mb-date-dest">' + escapeHtml(d.destName) + '</span>' : '') +
          '</button>'
        );
      })
      .join(''),
    '  <button class="mb-date-cal" id="mb-daypick" aria-label="날짜 선택">' + IC.calendar + '</button>',
    '</div>',
  ].join('');
}

function todayTabHtml(): string {
  const day = activeDay();
  if (!day) return emptyHtml('일정이 아직 없어요', 'PC에서 ROUTE로 동선을 먼저 만들어 주세요.');
  if (!day.stops.length) return emptyHtml('이 날은 비어 있어요', '다른 DAY를 보거나, PC에서 일정을 채워 주세요.');

  const s = scheduleFor(day, realLegs, progress);
  const isToday = day.date === todayISO();
  const now = nowMinutes();

  // "지금 진행 중"인 정류지 — 사용자가 직접 "도착"을 기록했으면 그게 가장 확실한 신호다.
  // 아직 아무도 기록하지 않았으면 지금 시각이 예상 도착~출발 사이인 정류지로 추정한다
  // (원칙 3-1: 실제 기록 > 추정. 여행 중이 아니면 아예 띄우지 않는다).
  let nowIdx = -1;
  if (isToday) {
    const arrivedIdx = day.stops.findIndex((st) => progress.get(st.key)?.status === 'arrived');
    nowIdx = arrivedIdx >= 0 ? arrivedIdx : day.stops.findIndex((_, i) => now >= s.arriveMin[i] && now < s.departMin[i]);
  }

  const rows: string[] = [];
  day.stops.forEach((stop, i) => {
    rows.push(stopRowHtml(stop, i, s, day.date, i === nowIdx, isToday, progress.get(stop.key)));
    // 구간 이동은 행과 행 **사이**에 작게 — 실측이 있으면 실측, 없으면 "추정"을 달고 보여준다
    if (i < day.stops.length - 1) rows.push(legRowHtml(s.legs[i]));
  });

  const nowState = computeNowState(day, s);

  return [
    daySummaryCardHtml(day),
    dateStripHtml(),
    geoBarHtml(day),
    isToday ? driftLineHtml(day) : '',
    '<div class="mb-sec-head">',
    '  <h3 class="mb-sec-title">' + (isToday ? '오늘의 일정' : escapeHtml(day.label) + ' 일정') + '</h3>',
    '  <span class="mb-sec-meta">' + minToHHMM(s.spanStartMin) + ' – ' + minToHHMM(s.spanEndMin) + '</span>',
    '</div>',
    '<div class="mb-thread">' + rows.join('') + '</div>',
    // 원칙 3-1 — 개별 구간마다 "추정"을 반복하는 대신 하루 단위로 한 번 밝힌다
    s.legCount > s.realLegCount
      ? '<p class="mb-estimate-note">* 이동·체류 시간은 추정치예요.</p>'
      : '',
    // 레퍼런스의 하단 "다음 일정까지" 바 — 지금 상태를 알 때만 뜬다
    nowState ? nextUpBarHtml(nowState, s) : '',
  ].join('');
}

/* ── GPS 자동 체크인 ────────────────────────────────────────
 *
 * "공항에 있으면 현재 위치가 공항으로 잡히게" — 판정은 `geo.ts`의 순수 함수가 하고,
 * 여기서는 켜고 끄기, 화면 표시, 도착 기록만 다룬다.
 *
 * **자동 기록은 오늘 DAY에서만** 한다. 지난 날·미래 날의 정류지 좌표에 우연히 가까워졌다고
 * 도착을 찍으면 그 날 일정이 통째로 어긋난다.
 */
function toggleGeo(): void {
  if (geoOn) {
    stopWatch();
    geoOn = false;
    geoFix = null;
    geoAtKey = null;
    geoError = '';
    render();
    return;
  }
  geoError = '';
  const ok = startWatch(
    (fix) => { geoFix = fix; geoError = ''; evaluateGeo(); },
    (msg) => { geoError = msg; geoAtKey = null; render(); }
  );
  geoOn = ok && isWatching();
  render();
}

/** 새 위치가 올 때마다: 어느 정류지인지 가리고, 오늘이면 도착을 기록한다. */
function evaluateGeo(): void {
  const day = activeDay();
  if (!geoFix || !day) { geoAtKey = null; render(); return; }

  const candidates = day.stops
    .filter((st) => st.lat != null && st.lng != null)
    .map((st) => ({ key: st.key, lat: st.lat!, lng: st.lng!, cat: st.cat }));

  const hit = matchStop(geoFix, candidates);
  const prevKey = geoAtKey;
  geoAtKey = hit?.key ?? null;

  // 오늘이 아니면 표시만 하고 기록하지 않는다
  const isToday = day.date === todayISO();
  if (isToday && hit && hit.key !== prevKey && !geoRecorded.has(hit.key)) {
    const prog = progress.get(hit.key);
    // 이미 사용자가 직접 기록한 정류지는 건드리지 않는다 — 사람이 누른 게 GPS보다 믿을 만하다
    if (!prog || prog.status === 'pending') {
      geoRecorded.add(hit.key);
      void recordAction('arrive', hit.key);
    }
  }
  render();
}

/** 상단의 위치 토글 + 지금 어디인지 한 줄 */
function geoBarHtml(day: TlDay): string {
  if (!isGeoSupported()) return '';

  const atStop = geoAtKey ? day.stops.find((st) => st.key === geoAtKey) : null;
  const label = !geoOn
    ? '위치로 자동 체크인'
    : geoError
      ? geoError
      : atStop
        ? '지금 여기 · ' + atStop.name
        : geoFix
          ? '일정 중인 장소 근처가 아니에요'
          : '위치 확인 중…';

  return [
    '<button class="mb-geo' + (geoOn ? ' is-on' : '') + (geoError ? ' is-err' : '') + '" id="mb-geo">',
    '  <span class="mb-geo-ic">' + IC.pin + '</span>',
    '  <span class="mb-geo-text">' + escapeHtml(label) + '</span>',
    '  <span class="mb-geo-sw">' + (geoOn ? '끄기' : '켜기') + '</span>',
    '</button>',
  ].join('');
}

/** 하단의 "다음 일정까지" 한 줄 — 여행 중이고 다음 목적지를 알 때만. */
function nextUpBarHtml(st: NowState, s: DaySchedule): string {
  if (st.kind === 'moving') {
    const left = st.minsTo > 0 ? fmtLeft(st.minsTo) + ' 뒤 도착 예정' : minToHHMM(s.arriveMin[st.index]) + ' 도착 예정';
    return '<button class="mb-nextup" data-stop="' + escapeHtml(st.stop.key) + '">' +
      '<span class="mb-nextup-ic">' + IC.pin + '</span>' +
      '<span class="mb-nextup-text">다음 · ' + escapeHtml(st.stop.name) + ' · ' + escapeHtml(left) + '</span>' +
      '<span class="mb-nextup-chev">' + IC.chevRight + '</span></button>';
  }
  if (st.kind === 'at' && st.next) {
    return '<button class="mb-nextup" data-stop="' + escapeHtml(st.next.key) + '">' +
      '<span class="mb-nextup-ic">' + IC.pin + '</span>' +
      '<span class="mb-nextup-text">다음 · ' + escapeHtml(st.next.name) + ' · ' + fmtLeft(Math.max(0, st.minsLeft)) + ' 뒤 출발</span>' +
      '<span class="mb-nextup-chev">' + IC.chevRight + '</span></button>';
  }
  if (st.kind === 'pre') {
    return '<button class="mb-nextup" data-stop="' + escapeHtml(st.stop.key) + '">' +
      '<span class="mb-nextup-ic">' + IC.pin + '</span>' +
      '<span class="mb-nextup-text">첫 일정 · ' + escapeHtml(st.stop.name) + ' · ' + fmtLeft(st.minsTo) + ' 뒤</span>' +
      '<span class="mb-nextup-chev">' + IC.chevRight + '</span></button>';
  }
  return '';
}

/**
 * 일정 한 줄 — 레퍼런스의 밀도를 따른다.
 *   시각 │ 마디 │ 썸네일 + 이름/지역 │ 길찾기·상세 버튼
 * 사진을 카드 전체에 깔던 예전 디자인보다 훨씬 얕아서 하루가 한 화면에 더 많이 들어온다.
 */
function stopRowHtml(
  stop: TlStop,
  i: number,
  s: DaySchedule,
  dateISO: string | null,
  isNow: boolean,
  showTrack: boolean,
  prog: StopProgress | undefined
): string {
  const place = stop.place;
  const photo = place?.photo_url ?? null;
  const done = prog?.status === 'departed' || prog?.status === 'skipped';
  const skipped = prog?.status === 'skipped';
  const warn = hoursWarning(place ?? null, dateISO, s.arriveMin[i], s.departMin[i]);
  // 지역 한 줄 — 저장된 주소에서 앞쪽만. 없으면 카테고리, 그것도 없으면 줄을 지운다(원칙 3-1)
  const sub = place?.address ? place.address.split(',').slice(0, 2).join(', ') : place?.category ?? '';

  return [
    '<div class="mb-row' + (isNow ? ' is-now' : '') + (done ? ' is-done' : '') + (skipped ? ' is-skipped' : '') + '">',
    '  <div class="mb-row-time">',
    '    <span class="mb-row-clock">' + minToHHMM(s.arriveMin[i]) + '</span>',
    isNow ? '    <span class="mb-row-nowtag">NOW</span>' : '',
    '  </div>',
    '  <span class="mb-row-node" aria-hidden="true"></span>',
    '  <div class="mb-row-card" data-stop="' + escapeHtml(stop.key) + '" role="button" tabindex="0">',
    photo
      ? '    <span class="mb-row-thumb" data-photo="' + escapeHtml(photo) + '"></span>'
      : '    <span class="mb-row-thumb is-blank">' + IC.pin + '</span>',
    '    <div class="mb-row-main">',
    '      <div class="mb-row-name">' + escapeHtml(stop.name) + '</div>',
    sub ? '      <div class="mb-row-sub">' + escapeHtml(sub) + '</div>' : '',
    warn ? '      <div class="mb-row-warn">' + escapeHtml(hoursWarnText(warn)) + '</div>' : '',
    '    </div>',
    '    <div class="mb-row-acts">',
    '      <a class="mb-row-nav" href="' + directionsHref(stop) + '" target="_blank" rel="noopener" data-nav="' + escapeHtml(stop.key) + '">' + IC.navigate + ' 길찾기</a>',
    '      <span class="mb-row-detail">' + IC.doc + ' 상세</span>',
    '    </div>',
    '  </div>',
    showTrack ? '  <div class="mb-row-track">' + trackHtml(stop, prog) + '</div>' : '',
    '</div>',
  ].join('');
}

/** 두 일정 사이의 이동 — 레퍼런스의 얇은 회색 줄 */
function legRowHtml(leg: ReturnType<typeof scheduleFor>['legs'][number]): string {
  if (!leg) return '<div class="mb-leglite is-gap"></div>';
  const cls = leg.mode === 'WALK' ? 'walk' : leg.mode === 'TRANSIT' ? 'transit' : 'taxi';
  return [
    '<div class="mb-leglite">',
    '  <span class="mb-leglite-ic ' + cls + '">' + MODE_ICON[leg.mode] + '</span>',
    '  <span>' + escapeHtml(modeLabel(leg.mode)) + ' ' + fmtMin(leg.min) + ' · ' + fmtKm(leg.km) + '</span>',
    leg.real ? '' : '  <span class="mb-leglite-est">추정</span>',
    '</div>',
  ].join('');
}

/**
 * 일정 카드 한 장. 사진이 카드 전체를 채우고 그 위에 어둡게 깔린 그라데이션 위로 글자가 올라간다.
 * 번호 배지는 좌상단, 북마크는 우상단 — 사진 레퍼런스와 같은 배치.
 *
 * `showTrack`(오늘 DAY일 때만 true)이면 도착/출발/건너뛰기 버튼을 카드 하단에 붙인다 —
 * 지난 날·미래 날에는 "도착"이 의미가 없으므로 아예 렌더링하지 않는다.
 */
/* ── 영업시간 경고 ──
 *
 * 영업시간은 전부터 카드에 떠 있었지만 **도착 시각과 맞춰보진 않았다** — "19:40 도착"과
 * "18:00 마감"이 나란히 있어도 사람이 직접 비교해야 했다. 대조는 `dayModel.hoursWarning`이
 * 하고(새 데이터 없음, 가진 두 값의 비교), 여기서는 문장으로만 바꾼다.
 * 판단할 수 없으면 아예 안 뜬다 — 틀린 "닫혀 있어요"는 침묵보다 나쁘다(원칙 3-1).
 */
function hoursWarnText(w: HoursWarning): string {
  switch (w.kind) {
    case 'closed-day':
      return '이 날은 휴무예요';
    case 'before-open':
      return '도착 예정 시각엔 아직 안 열어요 (' + minToHHMM(w.at) + ' 오픈)';
    case 'after-close':
      return '도착 예정 시각엔 이미 닫아요 (' + minToHHMM(w.at) + ' 마감)';
    case 'closes-during':
      return '머무는 중에 닫아요 (' + minToHHMM(w.at) + ' 마감)';
  }
}


/** ISO 타임스탬프를 "HH:MM"으로 — 여행자의 폰이 현지 시간대를 따라간다고 가정한다 */
function fmtClock(iso: string): string {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/**
 * 카드 하단의 도착/출발/건너뛰기 버튼 줄. 네 가지 상태를 오간다 —
 *   pending(기본) → [도착] → arrived → [출발] → departed
 *                 → [건너뛰기] → skipped
 * 어느 상태에서든 "되돌리기"로 pending으로 되돌릴 수 있다(잘못 눌렀을 때).
 */
function trackHtml(stop: TlStop, prog: StopProgress | undefined): string {
  const key = escapeHtml(stop.key);
  const status = prog?.status ?? 'pending';

  if (status === 'arrived') {
    const t = prog?.actualArriveAt ? fmtClock(prog.actualArriveAt) : '';
    return [
      '<div class="mb-track">',
      '  <span class="mb-track-status">' + t + ' 도착</span>',
      '  <button class="mb-track-btn primary" data-depart="' + key + '">' + IC.check + '출발</button>',
      '  <button class="mb-track-undo" data-reset="' + key + '">되돌리기</button>',
      '</div>',
    ].join('');
  }
  if (status === 'departed') {
    const a = prog?.actualArriveAt ? fmtClock(prog.actualArriveAt) : '';
    const d = prog?.actualDepartAt ? fmtClock(prog.actualDepartAt) : '';
    return [
      '<div class="mb-track">',
      '  <span class="mb-track-status done">' + IC.check + a + ' – ' + d + ' 다녀옴</span>',
      '  <button class="mb-track-undo" data-reset="' + key + '">되돌리기</button>',
      '</div>',
    ].join('');
  }
  if (status === 'skipped') {
    return [
      '<div class="mb-track">',
      '  <span class="mb-track-status muted">건너뜀</span>',
      '  <button class="mb-track-undo" data-reset="' + key + '">되돌리기</button>',
      '</div>',
    ].join('');
  }
  return [
    '<div class="mb-track">',
    '  <button class="mb-track-btn primary" data-arrive="' + key + '">' + IC.check + '도착</button>',
    '  <button class="mb-track-btn ghost" data-skip="' + key + '">건너뛰기</button>',
    '</div>',
  ].join('');
}


/* ══════════════ TIMELINE 탭 — 옆으로 넘겨 보는 DAY ══════════════
 *
 * 세로 목록이던 걸 **가로 스와이프 페이저**로 바꿨다. 여행 계획을 폰으로 볼 때 하는 일은
 * "DAY를 고른다"가 아니라 "다음 날은 뭐였지" — 즉 **옆 날과 비교**하는 행위다. 목록은 그때마다
 * 눌러 들어갔다 나와야 하지만, 페이저는 엄지로 밀기만 하면 된다.
 *
 * TODAY와 역할이 겹치지 않게 **밀도를 다르게** 둔다. TODAY는 사진 카드 + 시간축 + 도착 기록이
 * 있는 "지금 따라가는 화면"이고, 여기는 사진 없이 시각·이름만 있는 압축 표라 하루가 한 화면에
 * 들어온다. 그래서 자세히 볼 땐 페이지 아래 버튼으로 TODAY로 넘긴다.
 *
 * 스와이프는 CSS scroll-snap이 전부다 — 제스처 라이브러리를 넣지 않는다. JS가 하는 일은
 * "멈춘 뒤 어느 페이지인지" 읽어 상태에 반영하는 것뿐이다(아래 bindPager).
 */

/**
 * 여행 탭 안의 두 화면 전환 — 전체 일정 / 여행 정보(숙소·준비물·예약 링크).
 * 이 스위치가 없으면 여행 정보 화면은 열 방법이 없다(PR #209 이후 한동안 그랬다).
 */
function tripSegHtml(): string {
  const btn = (sub: TripSub, label: string) =>
    '<button class="mb-trip-seg-btn' + (tripSub === sub ? ' active' : '') + '" data-tripsub="' + sub + '">' + label + '</button>';
  return '<div class="mb-trip-seg" role="tablist">' + btn('days', '전체 일정') + btn('info', '여행 정보') + '</div>';
}

function allDaysTabHtml(): string {
  if (!days.some((d) => d.stops.length)) {
    return tripSegHtml() + emptyHtml('일정이 아직 없어요', 'PC에서 ROUTE로 동선을 먼저 만들어 주세요.');
  }
  const t = todayISO();

  const multi = isMultiDest();
  const chips = days
    .map((d, i) => {
      // 여행지가 바뀌는 자리에 이름표를 끼운다 — 칩이 아니라서(`.mb-tl-chip`이 아님) 칩 개수·순서와
      // 페이지 번호(data-page)를 어긋나게 하지 않는다
      const marker =
        multi && (i === 0 || days[i - 1].destId !== d.destId) && d.destName
          ? '<span class="mb-tl-dest">' + escapeHtml(d.destName) + '</span>'
          : '';
      return (
        marker +
        '<button class="mb-tl-chip' + (i === activeDayIndex ? ' active' : '') + (d.date === t ? ' is-today' : '') + '" data-page="' + i + '">' +
        escapeHtml(d.label) +
        '</button>'
      );
    })
    .join('');

  return [
    tripSegHtml(),
    tripProgressHtml(),
    '<div class="mb-tl-chips" id="mb-tl-chips">' + chips + '</div>',
    '<div class="mb-tl-pager" id="mb-tl-pager">' + days.map((d, i) => dayPageHtml(d, i)).join('') + '</div>',
  ].join('');
}

/**
 * 여행 전체에서 지금 어디쯤인지 한 줄. **날짜로만 계산한다** — 진행 기록(progress)은 활성 DAY만
 * 불러와 있어서(원칙 3-2) "총 몇 곳 방문"을 여기서 세면 틀린 수가 나온다(원칙 3-1).
 * 대신 날짜와 정류지 수는 항상 정확하므로 그것만 쓴다.
 */
function tripProgressHtml(): string {
  const total = days.length;
  const totalStops = days.reduce((n, d) => n + d.stops.length, 0);
  const todayIdx = todayDayIndex();
  const start = days.find((d) => d.date)?.date ?? null;

  let label: string;
  let pct: number;
  if (todayIdx >= 0) {
    label = 'DAY ' + (todayIdx + 1) + ' / ' + total + ' 진행 중';
    pct = Math.round(((todayIdx + 1) / total) * 100);
  } else if (start && daysBetween(todayISO(), start) > 0) {
    label = start ? 'D-' + daysBetween(todayISO(), start) + ' · ' + total + '일 일정' : total + '일 일정';
    pct = 0;
  } else {
    label = '여행 완료 · ' + total + '일';
    pct = 100;
  }

  return [
    '<section class="mb-tl-sum">',
    '  <div class="mb-tl-sum-top">',
    '    <span class="mb-tl-sum-label">' + escapeHtml(label) + '</span>',
    '    <span class="mb-tl-sum-count">' + totalStops + '곳</span>',
    '  </div>',
    '  <div class="mb-tl-sum-bar"><span class="mb-tl-sum-fill" style="width:' + pct + '%"></span></div>',
    '</section>',
  ].join('');
}

/** 한 DAY = 한 페이지. 사진 없이 시각·이름만 있는 압축 표라 하루가 한 화면에 들어온다. */
function dayPageHtml(day: TlDay, idx: number): string {
  const isToday = day.date === todayISO();
  // 진행 기록은 활성 DAY 것만 불러와 있다(원칙 3-2). progressOf가 활성 DAY에만 넘기고 나머지는
  // 빈 맵을 준다 — 여행지가 다르면 키가 겹칠 수 있어서 "그냥 넘겨도 안전"하지 않다.
  const s = scheduleFor(day, realLegs, progressOf(day));

  const head = [
    '  <header class="mb-tl-head">',
    '    <div class="mb-tl-head-main">',
    '      <span class="mb-tl-day">' + escapeHtml(day.label) + '</span>',
    isMultiDest() && day.destName ? '      <span class="mb-tl-desttag">' + escapeHtml(day.destName) + '</span>' : '',
    isToday ? '      <span class="mb-today-chip">TODAY</span>' : '',
    '    </div>',
    '    <span class="mb-tl-date">' + escapeHtml(dateLabel(day.date)) + '</span>',
    '  </header>',
  ].join('');

  if (!day.stops.length) {
    return [
      '<article class="mb-tl-page" data-page="' + idx + '">',
      head,
      '  <div class="mb-tl-blank">이 날은 아직 비어 있어요</div>',
      '</article>',
    ].join('');
  }

  const rows = day.stops
    .map((stop, i) => {
      const prog = progressOf(day).get(stop.key);
      const skipped = prog?.status === 'skipped';
      const visited = prog?.status === 'arrived' || prog?.status === 'departed';
      const leg = s.legs[i];
      const warn = hoursWarning(stop.place ?? null, day.date, s.arriveMin[i], s.departMin[i]);
      return [
        '<div class="mb-tl-row' + (skipped ? ' is-skipped' : '') + (visited ? ' is-visited' : '') + '" data-stop="' + escapeHtml(stop.key) + '" role="button" tabindex="0">',
        '  <span class="mb-tl-time">' + minToHHMM(s.arriveMin[i]) + '</span>',
        '  <span class="mb-tl-dot" aria-hidden="true"></span>',
        '  <div class="mb-tl-main">',
        '    <div class="mb-tl-name">' + escapeHtml(stop.name) + '</div>',
        warn
          ? '    <div class="mb-tl-warn">' + escapeHtml(hoursWarnText(warn)) + '</div>'
          : '    <div class="mb-tl-meta">' + escapeHtml(CAT_LABEL[stop.cat] ?? '') + ' · ' + fmtMin(s.dwellMin[i]) + ' 머무름</div>',
        '  </div>',
        '</div>',
        // 구간 이동은 행 사이에 작게 — 여기선 "얼마나 걸리나"만 알면 된다
        leg
          ? '<div class="mb-tl-leg"><span class="mb-tl-leg-ic ' + leg.mode.toLowerCase() + '">' + MODE_ICON[leg.mode] + '</span>' +
            escapeHtml(modeLabel(leg.mode)) + ' ' + fmtMin(leg.min) +
            (leg.real ? '' : ' <span class="mb-tl-est">추정</span>') +
            '</div>'
          : '',
      ].join('');
    })
    .join('');

  return [
    '<article class="mb-tl-page" data-page="' + idx + '">',
    head,
    '  <div class="mb-tl-rows">' + rows + '</div>',
    '  <div class="mb-tl-foot">',
    '    <span>' + minToHHMM(s.spanStartMin) + '–' + minToHHMM(s.spanEndMin) + '</span>',
    '    <span>' + day.stops.length + '곳' + (s.legCount ? ' · 이동 ' + fmtMin(s.totalMoveMin) : '') + '</span>',
    '  </div>',
    '  <button class="mb-tl-open" data-goday="' + idx + '">이 날 자세히 보기 ' + IC.chevRight + '</button>',
    '</article>',
  ].join('');
}

/* ── 페이저 동작 ──
 *
 * 스와이프 자체는 CSS(scroll-snap)가 처리한다. JS는 "멈춘 뒤 어느 페이지인지"만 읽는다.
 * 스크롤 이벤트마다 render()를 부르면 그리는 도중 스크롤이 끊기므로, **멈춘 뒤 한 번만** 반영한다.
 */
function bindPager(root: HTMLElement): void {
  const pager = root.querySelector('#mb-tl-pager') as HTMLElement | null;
  if (!pager) return;

  // 칩을 누르면 그 페이지로 부드럽게 민다. 여기서 render()를 부르면 애니메이션이 끊기므로
  // 하이라이트만 손으로 옮기고, 상태 반영은 아래 onPagerSettle에 맡긴다.
  root.querySelectorAll('.mb-tl-chip[data-page]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const i = Number((chip as HTMLElement).dataset.page);
      root.querySelectorAll('.mb-tl-chip').forEach((c, ci) => c.classList.toggle('active', ci === i));
      centerActiveChip();
      pager.scrollTo({ left: i * pager.clientWidth, behavior: 'smooth' });
    });
  });

  pager.addEventListener(
    'scroll',
    () => {
      if (pagerSettleTimer) clearTimeout(pagerSettleTimer);
      pagerSettleTimer = setTimeout(() => onPagerSettle(pager), 120);
    },
    { passive: true }
  );
}

/**
 * 칩 줄이 옆으로 길어졌을 때(여행지가 여럿이면 DAY가 열 개를 넘는다) 지금 보는 칩이 화면 밖에
 * 있으면 어디를 보고 있는지 알 수 없다 — 활성 칩을 가운데로 가져온다.
 * `scrollIntoView`는 바깥 세로 스크롤까지 건드릴 수 있어서 칩 줄의 scrollLeft만 직접 맞춘다.
 */
function centerActiveChip(): void {
  const strip = container?.querySelector('#mb-tl-chips') as HTMLElement | null;
  const chip = strip?.querySelector('.mb-tl-chip.active') as HTMLElement | null;
  if (!strip || !chip) return;
  strip.scrollLeft = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
}

function onPagerSettle(pager: HTMLElement): void {
  const w = pager.clientWidth;
  if (!w || !days.length) return;
  const idx = Math.max(0, Math.min(days.length - 1, Math.round(pager.scrollLeft / w)));
  if (idx === activeDayIndex) return;

  activeDayIndex = idx;
  render();

  // 빠르게 여러 장을 넘기면 지나친 DAY까지 전부 조회하게 된다 — 손이 멈춘 뒤 한 번만
  // 부른다(원칙 3-2: 안 보는 DAY를 미리 조회하지 않는다는 절제를 스와이프에도 적용).
  if (pagerLoadTimer) clearTimeout(pagerLoadTimer);
  pagerLoadTimer = setTimeout(() => {
    void loadRealLegsForActiveDay();
    void loadProgressForActiveDay();
    void loadWeatherForActiveDay();
  }, 350);
}

/* ══════════════════════ 지도 탭 ══════════════════════
 *
 * 오늘(활성 DAY)의 정류지를 실제 지도 위에 찍어 보여준다. **자체 내비게이션은 만들지 않는다** —
 * 길을 안내하는 건 여전히 Google Maps 딥링크의 몫이고, 여기는 "오늘 동선이 대충 어떻게 생겼나"를
 * 한눈에 보는 자리다.
 *
 * Maps JS는 **이 탭을 처음 열 때만** 받는다(원칙 3-2). index.html에서 동기 로드를 걷어낸 이유와
 * 같은 맥락이라, 여기서 미리 불러오면 그 작업이 무의미해진다.
 */

let mapEl: HTMLElement | null = null;
let mapInstance: any = null;
let mapMarkers: Array<{ setMap: (m: unknown) => void }> = [];
let mapLoading = false;
let mapError = '';

function mapTabHtml(): string {
  const day = activeDay();
  const pins = (day?.stops ?? []).filter((s) => s.lat != null && s.lng != null);

  if (!day || !day.stops.length) {
    return emptyHtml('이 날은 일정이 없어요', 'PC에서 ROUTE로 동선을 먼저 만들어 주세요.');
  }
  if (!pins.length) {
    return emptyHtml('지도에 찍을 좌표가 없어요', '정류지에 좌표가 저장되어 있어야 지도에 표시할 수 있어요.');
  }

  return [
    '<div class="mb-map-wrap">',
    '  <div class="mb-map-head">',
    '    <span class="mb-map-day">' + escapeHtml(day.label) + '</span>',
    '    <span class="mb-map-count">' + pins.length + '곳</span>',
    '  </div>',
    mapError
      ? '  <div class="mb-map-err">' + escapeHtml(mapError) + '</div>'
      : '  <div class="mb-map" id="mb-map">' + (mapLoading ? '<span class="mb-spinner"></span>' : '') + '</div>',
    '  <div class="mb-map-list">',
    pins
      .map(
        (s, i) =>
          '<button class="mb-map-row" data-mapgo="' + escapeHtml(s.key) + '">' +
          '<span class="mb-map-num">' + (i + 1) + '</span>' +
          '<span class="mb-map-name">' + escapeHtml(s.name) + '</span>' +
          '<span class="mb-map-chev">' + IC.chevRight + '</span>' +
          '</button>'
      )
      .join(''),
    '  </div>',
    '</div>',
  ].join('');
}

/** 지도를 실제로 띄운다 — 렌더 직후 호출된다(마크업이 DOM에 있어야 Map을 붙일 수 있다). */
async function mountMap(): Promise<void> {
  if (activeTab !== 'map' || !container) return;
  const host = container.querySelector('#mb-map') as HTMLElement | null;
  if (!host) return;

  const day = activeDay();
  const pins = (day?.stops ?? []).filter((s) => s.lat != null && s.lng != null);
  if (!pins.length) return;

  // 같은 DOM 노드에 이미 지도가 붙어 있으면 마커만 다시 그린다
  if (mapInstance && mapEl === host) { drawMapMarkers(pins); return; }

  if (mapLoading) return;
  mapLoading = true;
  mapError = '';
  try {
    await loadGoogleMapsScript();
    if (activeTab !== 'map' || !container) return;
    const live = container.querySelector('#mb-map') as HTMLElement | null;
    if (!live) return;

    const g = (window as unknown as { google?: any }).google;
    if (!g?.maps) throw new Error('지도를 불러오지 못했어요');

    live.innerHTML = '';
    mapEl = live;
    mapInstance = new g.maps.Map(live, {
      center: { lat: pins[0].lat!, lng: pins[0].lng! },
      zoom: 13,
      gestureHandling: 'greedy',
      clickableIcons: false,
      zoomControl: false,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      rotateControl: false,
    });
    drawMapMarkers(pins);
  } catch (e) {
    // 지도를 못 띄워도 아래 목록과 길찾기는 그대로 쓸 수 있다 — 그래서 탭 전체를 죽이지 않는다
    console.error('[Mobile] 지도 로드 실패:', e);
    mapError = '지도를 불러오지 못했어요. 아래 목록에서 길찾기는 그대로 쓸 수 있어요.';
    mapInstance = null;
    mapEl = null;
    render();
  } finally {
    mapLoading = false;
  }
}

function drawMapMarkers(pins: TlStop[]): void {
  const g = (window as unknown as { google?: any }).google;
  if (!g?.maps || !mapInstance) return;

  mapMarkers.forEach((m) => m.setMap(null));
  mapMarkers = [];

  const bounds = new g.maps.LatLngBounds();
  pins.forEach((s, i) => {
    const pos = { lat: s.lat!, lng: s.lng! };
    const marker: any = new g.maps.Marker({
      position: pos,
      map: mapInstance,
      label: { text: String(i + 1), color: '#FFFFFF', fontSize: '12px', fontWeight: '700' },
      title: s.name,
    });
    marker.addListener('click', () => {
      detailKey = s.key;
      detailTab = 'overview';
      render();
    });
    mapMarkers.push(marker);
    bounds.extend(pos);
  });

  if (pins.length > 1) (mapInstance as any).fitBounds(bounds, 48);
}

function teardownMap(): void {
  mapMarkers.forEach((m) => m.setMap(null));
  mapMarkers = [];
  mapInstance = null;
  mapEl = null;
  mapLoading = false;
  mapError = '';
}

/* ══════════════════════ WALLET 탭 ══════════════════════ */

/** 지출 데이터를 아직 안 불렀으면 불러온다 — WALLET을 처음 열 때만(원칙 3-2) */
async function ensureExpenseCtx(): Promise<void> {
  if (expenseCtx || expenseLoading || !currentTripId) return;
  expenseLoading = true;
  render();
  try {
    expenseCtx = await loadExpenseCtx(currentTripId);
    // 마지막으로 쓴 통화를 기본값으로 — 방콕 여행이면 두 번째 지출부터 THB가 미리 잡힌다
    const last = [...expenseCtx.expenses].reverse().find((e) => e.currency);
    if (last?.currency) padCurrency = last.currency;
    subscribeExpenses();
  } catch (e) {
    console.error('[Mobile] 지출 로드 실패:', e);
  } finally {
    expenseLoading = false;
    render();
  }
}

/** 다른 멤버가 지출을 넣으면 지갑도 즉시 따라간다 (links·expenses와 같은 패턴) */
function subscribeExpenses(): void {
  if (expenseChannel || !currentTripId) return;
  expenseChannel = supabase
    .channel('mb-expenses:' + currentTripId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trip_expenses', filter: 'trip_id=eq.' + currentTripId },
      () => { void reloadExpenses(); }
    )
    .subscribe();
}

async function reloadExpenses(): Promise<void> {
  if (!currentTripId) return;
  try {
    expenseCtx = await loadExpenseCtx(currentTripId);
    if (activeTab === 'wallet') render();
  } catch (e) {
    console.error('[Mobile] 지출 새로고침 실패:', e);
  }
}

/* ── 여행 지갑: 예약·문서 ──────────────────────────────────
 *
 * 레퍼런스의 "여행 지갑"은 **여행 중 자주 꺼내 보는 예약 서류**를 모은 화면이다. 다행히
 * 이 데이터는 이미 있다 — DOCUMENTS 게이트의 `trip_documents`(FLIGHT/STAY/TICKET/
 * INSURANCE/VISA…)와 비공개 버킷 `trip-docs`. 그래서 새 테이블을 만들지 않고 그대로 읽는다.
 *
 * 지키는 선 세 가지:
 *   · **바코드·QR을 그리지 않는다.** 우리에겐 탑승권 이미지가 있을 수도, 없을 수도 있다.
 *     있으면 그 파일을 열어 주고, 없으면 없다고 말한다 — 가짜 바코드는 공항에서 안 찍힌다.
 *   · **"오프라인 저장 완료"를 표시하지 않는다.** `sw.js`가 캐싱을 안 하므로 사실이 아니다.
 *   · **개인 문서(여권 등)는 잠금을 존중한다.** 이 기기에서 PIN을 푼 적이 있을 때만 보이고,
 *     아니면 잠긴 상태로 두고 PC Documents로 안내한다.
 *
 * 기존 "지출 지갑"은 사라지지 않는다 — 같은 탭 아래쪽 섹션으로 들어간다(돈도 지갑이다).
 */

/** 레퍼런스의 카드 순서 — 여행 중 꺼내 보는 빈도순이다 */
const WALLET_SECTIONS: Array<{ cat: DocCategory; label: string; icon: string }> = [
  { cat: 'FLIGHT', label: '항공권', icon: IC.plane },
  { cat: 'STAY', label: '숙소 예약', icon: IC.bed },
  { cat: 'TICKET', label: '관광지 티켓', icon: IC.ticket },
  { cat: 'TRANSPORT', label: '교통', icon: IC.transit },
];

/** 위 네 가지에 안 들어가는 나머지는 "중요 문서"로 묶는다 */
const WALLET_DOC_CATS: DocCategory[] = ['INSURANCE', 'VISA', 'RECEIPT', 'OTHER'];

async function ensureWalletDocs(): Promise<void> {
  if (walletDocsLoaded || walletDocsLoading || !currentTripId) return;
  walletDocsLoading = true;
  render();
  try {
    const shared = await loadSharedDocuments(currentTripId);
    // 이 기기에서 이미 잠금을 푼 개인 문서만 추가로 가져온다(아니면 잠긴 채로 둔다)
    const unlocked = getUnlockedUserId(currentTripId);
    const personal = unlocked ? await loadPersonalDocuments(currentTripId, unlocked) : [];
    walletDocs = [...shared, ...personal];
    walletPersonalUnlocked = unlocked != null;
    walletDocsLoaded = true;
  } catch (e) {
    console.error('[Mobile] 문서 로드 실패:', e);
  } finally {
    walletDocsLoading = false;
    render();
  }
}

function docsOf(cat: DocCategory): TripDocument[] {
  return walletDocs.filter((d) => normalizeDocCategory(d.category) === cat);
}

/**
 * 서류 한 건 열기. 파일은 비공개 버킷에 있으므로 **열 때마다 짧게 사는 signed URL**을 받는다
 * (공개 URL을 만들어 두면 링크를 가진 누구나 여권을 볼 수 있다).
 * 파일이 없는 문서는 예약 정보만 있는 것이므로 PC Documents로 보낸다.
 */
async function openDoc(docId: string): Promise<void> {
  const doc = walletDocs.find((d) => d.id === docId);
  if (!doc) return;
  if (!doc.file_path) { gotoGate('docs'); return; }

  // 팝업 차단을 피하려면 탭을 **사용자 제스처 안에서** 먼저 열고 나중에 주소를 채워야 한다
  const tab = window.open('', '_blank');
  try {
    const url = await signedUrlFor(doc.file_path, 600);
    if (!url) throw new Error('signed URL 발급 실패');
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (e) {
    console.error('[Mobile] 서류 열기 실패:', e);
    tab?.close();
    gotoGate('docs');
  }
}

/** 문서 한 건을 카드 줄로. 파일이 있으면 열 수 있고, 없으면 예약 정보만 보여준다. */
function docRowHtml(doc: TripDocument, icon: string): string {
  const hasFile = !!doc.file_path;
  const sub: string[] = [];
  if (doc.reference_code) sub.push('예약번호 ' + doc.reference_code);
  const range = dayDateRangeLabel(currentTrip, doc.day_start, doc.day_end);
  if (range) sub.push(range);

  return [
    '<button class="mb-wd-row" data-doc="' + escapeHtml(doc.id) + '">',
    '  <span class="mb-wd-ic">' + icon + '</span>',
    '  <div class="mb-wd-main">',
    '    <div class="mb-wd-title">' + escapeHtml(doc.title) + '</div>',
    // 설명·예약번호·기간은 저장된 값이 있을 때만 (원칙 3-1)
    doc.description ? '    <div class="mb-wd-desc">' + escapeHtml(doc.description) + '</div>' : '',
    sub.length ? '    <div class="mb-wd-sub">' + escapeHtml(sub.join(' · ')) + '</div>' : '',
    hasFile ? '' : '    <div class="mb-wd-nofile">첨부 파일 없음 · 예약 정보만</div>',
    '  </div>',
    '  <span class="mb-wd-chev">' + IC.chevRight + '</span>',
    '</button>',
  ].join('');
}

function walletDocsHtml(): string {
  if (walletDocsLoading && !walletDocsLoaded) {
    return '<div class="mb-wallet-loading"><span class="mb-spinner"></span>예약 정보 불러오는 중…</div>';
  }

  const out: string[] = [];

  for (const sec of WALLET_SECTIONS) {
    const list = docsOf(sec.cat);
    if (!list.length) continue;
    out.push(
      '<section class="mb-more-sec">',
      '  <div class="mb-more-sec-head"><h4 class="mb-more-sec-title">' + sec.label + '</h4>' +
        (list.length > 1 ? '<span class="mb-more-sec-note">' + list.length + '건</span>' : '') + '</div>',
      '  <div class="mb-wd-list">' + list.map((d) => docRowHtml(d, sec.icon)).join('') + '</div>',
      '</section>'
    );
  }

  const others = walletDocs.filter((d) => WALLET_DOC_CATS.includes(normalizeDocCategory(d.category)));
  if (others.length) {
    out.push(
      '<section class="mb-more-sec">',
      '  <div class="mb-more-sec-head"><h4 class="mb-more-sec-title">중요 문서</h4></div>',
      '  <div class="mb-wd-list">' + others.map((d) => docRowHtml(d, IC.doc)).join('') + '</div>',
      '</section>'
    );
  }

  // 개인 문서(여권 등)는 이 기기에서 잠금을 푼 적이 있을 때만 보인다 — 아니면 잠겼다고 말한다
  if (!walletPersonalUnlocked) {
    out.push(
      '<section class="mb-more-sec">',
      '  <div class="mb-more-sec-head"><h4 class="mb-more-sec-title">개인 문서</h4></div>',
      '  <button class="mb-wd-locked" id="mb-wd-unlock">',
      '    <span class="mb-wd-ic">' + IC.lock + '</span>',
      '    <div class="mb-wd-main">',
      '      <div class="mb-wd-title">여권 사본 같은 개인 문서는 잠겨 있어요</div>',
      '      <div class="mb-wd-sub">PC Documents에서 PIN을 풀면 이 기기에서도 보여요</div>',
      '    </div>',
      '    <span class="mb-wd-chev">' + IC.chevRight + '</span>',
      '  </button>',
      '</section>'
    );
  }

  if (!out.length) {
    out.push(
      '<section class="mb-more-sec">',
      '  <div class="mb-wd-empty">',
      '    <div class="mb-wd-empty-title">아직 저장된 예약 서류가 없어요</div>',
      '    <p class="mb-wd-empty-sub">항공권·숙소 바우처·입장권을 PC Documents에 올려두면<br />여행 중엔 여기서 바로 꺼내 볼 수 있어요.</p>',
      '    <button class="mb-ghost-btn" id="mb-wd-add">PC에서 서류 올리기</button>',
      '  </div>',
      '</section>'
    );
  }

  return out.join('');
}

function walletTabHtml(): string {
  return [
    '<section class="mb-wd-head">',
    '  <h2 class="mb-wd-h1">여행 지갑</h2>',
    // 레퍼런스엔 "오프라인 저장 완료" 배지가 있지만 우리는 아직 캐싱을 안 한다 — 쓰지 않는다
    '  <p class="mb-wd-h2">예약 서류와 지출을 한곳에</p>',
    '</section>',
    walletDocsHtml(),
    walletMoneyHtml(),
  ].join('');
}

/** 기존 "지출 지갑" — 탭이 문서 중심으로 바뀌어도 돈은 그대로 여기 남는다 */
function walletMoneyHtml(): string {
  if (expenseLoading && !expenseCtx) {
    return '<div class="mb-wallet-loading"><span class="mb-spinner"></span>지출 불러오는 중…</div>';
  }
  if (!expenseCtx) return '';

  const ctx = expenseCtx;
  const today = sumPaidOn(ctx, todayISO());
  const total = sumPaid(ctx);
  const budget = getTotalBudget(ctx);
  const pct = budget && budget > 0 ? Math.min(100, Math.round((total / budget) * 100)) : null;
  const over = budget != null && total > budget;
  const unconverted = unconvertedCount(ctx);

  return [
    '<section class="mb-more-sec">',
    '  <div class="mb-more-sec-head"><h4 class="mb-more-sec-title">지출</h4></div>',
    '<section class="mb-wal-hero">',
    '  <div class="mb-wal-hero-label">오늘 쓴 돈</div>',
    '  <div class="mb-wal-hero-value">' + fmtKRW(today) + '</div>',
    budget != null
      ? [
          '  <div class="mb-wal-gauge"><span class="mb-wal-gauge-fill' + (over ? ' is-over' : '') + '" style="width:' + (pct ?? 0) + '%"></span></div>',
          '  <div class="mb-wal-hero-sub">',
          '    <span>전체 ' + fmtKRW(total) + '</span>',
          '    <span>' + (over ? '예산 ' + fmtKRW(total - budget) + ' 초과' : '예산 ' + fmtKRW(budget) + '의 ' + pct + '%') + '</span>',
          '  </div>',
        ].join('')
      : '  <div class="mb-wal-hero-sub"><span>전체 ' + fmtKRW(total) + '</span><span>예산 미설정</span></div>',
    // 원칙 3-1 — 환산 못 한 항목이 있으면 합계가 그만큼 빠졌다고 밝힌다
    unconverted > 0
      ? '  <p class="mb-wal-note">환율을 못 받은 ' + unconverted + '건은 합계에서 빠졌어요.</p>'
      : '',
    '</section>',
    settleLineHtml(ctx),
    recentExpensesHtml(ctx),
    // 여행 중 지갑에서 하는 일은 둘뿐이다 — 쓴 걸 넣거나, 얼마인지 보거나.
    '<div class="mb-wal-acts">',
    '  <button class="mb-wal-add" id="mb-wal-add">' + IC.plus + ' 지출 추가</button>',
    '  <button class="mb-wal-calc" id="mb-wal-calc">' + IC.swap + ' 얼마예요?</button>',
    '</div>',
    '</section>',
  ].join('');
}

/** 정산은 한 줄 요약만 — 자세한 건 PC에서 (모바일에서 필요한 건 "얼마 주고받나" 하나) */
function settleLineHtml(ctx: ExpenseCtx): string {
  const me = store.get('user')?.id ?? null;
  const { transfers } = computeSettlement(ctx);
  if (!transfers.length) return '';

  const mine = me ? transfers.filter((t) => t.from === me || t.to === me) : [];
  const shown = mine.length ? mine : transfers;
  const t = shown[0];
  const text =
    me && t.from === me ? memberName(ctx, t.to) + '에게 ' + fmtKRW(t.amount) + ' 보내야 해요'
    : me && t.to === me ? memberName(ctx, t.from) + '에게 ' + fmtKRW(t.amount) + ' 받을 게 있어요'
    : memberName(ctx, t.from) + ' → ' + memberName(ctx, t.to) + ' ' + fmtKRW(t.amount);
  const more = shown.length > 1 ? ' 외 ' + (shown.length - 1) + '건' : '';

  return [
    '<button class="mb-wal-settle" id="mb-wal-settle">',
    '  <span class="mb-wal-settle-ic">' + IC.wallet + '</span>',
    '  <span class="mb-wal-settle-text">' + escapeHtml(text + more) + '</span>',
    '  <span class="mb-wal-settle-chev">' + IC.chevRight + '</span>',
    '</button>',
  ].join('');
}

/** 최근 지출 몇 개만 — 전체 목록·필터·차트는 PC의 몫이다 */
function recentExpensesHtml(ctx: ExpenseCtx): string {
  const items = [...ctx.expenses]
    .filter((e) => e.is_paid)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, 6);

  if (!items.length) {
    return [
      '<section class="mb-wal-sec">',
      '  <h4 class="mb-wal-sec-title">최근 지출</h4>',
      '  <p class="mb-wal-empty">아직 기록한 지출이 없어요. 아래 버튼으로 첫 지출을 남겨보세요.</p>',
      '</section>',
    ].join('');
  }

  const rows = items.map((e) => {
    const cat = categoryOf(e);
    const meta = CATEGORY_META[cat];
    const krw = krwOf(e);
    const isForeign = e.currency !== 'KRW';
    return [
      '<div class="mb-wal-row">',
      '  <span class="mb-wal-row-ic" style="color:' + meta.color + ';background:' + meta.color + '1f">' + meta.icon + '</span>',
      '  <div class="mb-wal-row-main">',
      '    <div class="mb-wal-row-title">' + escapeHtml(e.title) + '</div>',
      '    <div class="mb-wal-row-sub">' + escapeHtml(meta.label) + (e.paid_by_name ? ' · ' + escapeHtml(e.paid_by_name) : '') + '</div>',
      '  </div>',
      '  <div class="mb-wal-row-amt">',
      '    <div class="mb-wal-row-primary">' + escapeHtml(fmtAmount(e.amount, e.currency)) + '</div>',
      // 외화면 환산값을 아래에 — 환산 실패면 지어내지 않고 물음표로 남긴다(원칙 3-1)
      isForeign
        ? '    <div class="mb-wal-row-krw">' + (krw != null ? escapeHtml(fmtKRW(krw)) : '환산 불가') + '</div>'
        : '',
      '  </div>',
      '</div>',
    ].join('');
  });

  return [
    '<section class="mb-wal-sec">',
    '  <h4 class="mb-wal-sec-title">최근 지출</h4>',
    '  <div class="mb-wal-list">' + rows.join('') + '</div>',
    '  <button class="mb-wal-more" id="mb-wal-pc">전체 내역·예산 설정은 PC에서 ' + IC.chevRight + '</button>',
    '</section>',
  ].join('');
}

/* ── 숫자패드 시트 ── */

/**
 * 지금 있는 정류지로 카테고리·제목을 미리 채운다. 값을 "지어내는" 게 아니라 입력 폼의
 * 기본값일 뿐이고 사용자가 바로 바꿀 수 있다 — 여행 중엔 이 한 번의 절약이 크다.
 */
function guessFromCurrentStop(): { category: ExpenseCategory; title: string } | null {
  const day = activeDay();
  if (!day || day.date !== todayISO()) return null;
  const stop = day.stops.find((st) => progress.get(st.key)?.status === 'arrived');
  if (!stop) return null;

  const hay = ((stop.place?.category ?? '') + ' ' + stop.name).toLowerCase();
  const cat: ExpenseCategory =
    /식당|음식|카페|레스토랑|푸드|맛집|바|주점|베이커리|restaurant|cafe|food|bar/.test(hay) ? 'FOOD'
    : /호텔|숙소|게스트|리조트|hotel|hostel|resort/.test(hay) ? 'STAY'
    : /공항|역|터미널|정류장|airport|station|terminal/.test(hay) ? 'TRANSPORT'
    : /쇼핑|몰|시장|백화점|면세|market|mall|shopping/.test(hay) ? 'SHOPPING'
    : 'ACTIVITY';
  return { category: cat, title: stop.name };
}

function openPad(): void {
  const guess = guessFromCurrentStop();
  padAmount = '';
  padCategory = guess?.category ?? 'ETC';
  padSaving = false;
  padMode = 'expense';
  padOpen = true;
  padRate = null;
  render();
  void refreshPadRate();
}

/** 계산기 모드로 열기 — 기록할 생각 없이 "이거 얼마야"만 볼 때 */
function openCalc(): void {
  padAmount = '';
  padSaving = false;
  padMode = 'calc';
  padOpen = true;
  padRate = null;
  render();
  void refreshPadRate();
}

/** 외화면 ≈₩ 미리보기를 채운다. 통화당 1회만 조회되고 캐시된다(원칙 3-2) */
async function refreshPadRate(): Promise<void> {
  if (padCurrency === 'KRW') { padRate = { rate: 1, source: 'live' }; render(); return; }
  padRate = null;
  render();
  padRate = await fetchRate(padCurrency);
  if (padOpen) render();
}

function padSheetHtml(): string {
  const amount = padAmount ? Number(padAmount) : 0;
  const guess = guessFromCurrentStop();
  const krw = padRate?.rate != null ? Math.round(amount * padRate.rate) : null;

  const currencyChips = CURRENCIES.slice(0, 6)
    .map((c) => '<button class="mb-pad-chip' + (c.code === padCurrency ? ' active' : '') + '" data-cur="' + c.code + '">' + c.code + '</button>')
    .join('');

  const catChips = EXPENSE_CATEGORIES.map((cat) => {
    const meta = CATEGORY_META[cat];
    const on = cat === padCategory;
    return (
      '<button class="mb-pad-cat' + (on ? ' active' : '') + '" data-cat="' + cat + '"' +
      (on ? ' style="border-color:' + meta.color + ';background:' + meta.color + '22;color:' + meta.color + '"' : '') +
      '><span class="mb-pad-cat-ic">' + meta.icon + '</span>' + escapeHtml(meta.label) + '</button>'
    );
  }).join('');

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];
  const pad = keys
    .map((k) =>
      k === 'del'
        ? '<button class="mb-pad-key" data-key="del" aria-label="지우기">' + IC.padDel + '</button>'
        : '<button class="mb-pad-key" data-key="' + k + '">' + k + '</button>'
    )
    .join('');

  const isCalc = padMode === 'calc';

  // 계산기 모드의 본문 — 환산 결과가 주인공이라 크게 띄우고, 환율은 출처까지 같이 밝힌다.
  // 환율을 못 받으면 숫자를 지어내지 않고 "환산할 수 없다"고 말한다(원칙 3-1).
  const calcBody = [
    '  <div class="mb-calc-out">',
    padCurrency === 'KRW'
      ? '    <div class="mb-calc-note">원화는 환산할 게 없어요. 위에서 외화를 골라주세요.</div>'
      : krw != null
        ? '    <div class="mb-calc-value">' + escapeHtml(fmtKRW(krw)) + '</div>' +
          '    <div class="mb-calc-rate">1 ' + escapeHtml(padCurrency) + ' ≈ ' + (padRate!.rate as number).toFixed(2) + '원' +
          (padRate?.source === 'fallback' ? ' <span class="mb-tag-est">참고용</span>' : '') + '</div>'
        : padRate === null
          ? '    <div class="mb-calc-note">환율 확인 중…</div>'
          : '    <div class="mb-calc-note">환율을 못 받았어요 · 지금은 환산할 수 없어요</div>',
    '  </div>',
  ].join('');

  return [
    '<div class="mb-sheet-back" id="mb-pad-back"></div>',
    '<div class="mb-pad" role="dialog" aria-label="' + (isCalc ? '환율 계산기' : '지출 추가') + '">',
    '  <div class="mb-pad-head">',
    '    <button class="mb-pad-close" id="mb-pad-close" aria-label="닫기">' + IC.close + '</button>',
    '    <span class="mb-pad-title">' + (isCalc ? '얼마예요?' : '지출 추가') + '</span>',
    '  </div>',
    '  <div class="mb-pad-amount">',
    '    <span class="mb-pad-sym">' + escapeHtml(symbolOf(padCurrency)) + '</span>',
    '    <span class="mb-pad-num' + (padAmount ? '' : ' is-empty') + '">' + escapeHtml(padAmount || '0') + '</span>',
    '  </div>',
    isCalc
      ? calcBody
      : padCurrency !== 'KRW'
        ? '  <div class="mb-pad-krw">' +
          (krw != null
            ? '≈ ' + escapeHtml(fmtKRW(krw)) + (padRate?.source === 'fallback' ? ' <span class="mb-tag-est">참고용 환율</span>' : '')
            : padRate === null ? '환율 확인 중…' : '<span class="mb-pad-warn">환율을 못 받았어요 · 원화 환산 없이 저장돼요</span>') +
          '</div>'
        : '',
    '  <div class="mb-pad-currencies">' + currencyChips + '</div>',
    isCalc ? '' : '  <div class="mb-pad-cats">' + catChips + '</div>',
    !isCalc && guess
      ? '  <p class="mb-pad-hint">' + escapeHtml(guess.title) + '에서 쓴 걸로 저장돼요</p>'
      : '',
    '  <div class="mb-pad-keys">' + pad + '</div>',
    // 계산해놓고 실제로 샀으면 금액을 그대로 들고 기록 모드로 — 다시 입력할 이유가 없다
    isCalc
      ? '  <button class="mb-pad-save" id="mb-pad-tolog"' + (amount > 0 ? '' : ' disabled') + '>' + IC.plus + ' 이 금액을 지출로 기록</button>'
      : '  <button class="mb-pad-save" id="mb-pad-save"' + (amount > 0 && !padSaving ? '' : ' disabled') + '>' +
        (padSaving ? '<span class="mb-spinner"></span>저장 중…' : '저장') + '</button>',
    '</div>',
  ].join('');
}

function padPress(key: string): void {
  if (key === 'del') {
    padAmount = padAmount.slice(0, -1);
  } else if (key === '.') {
    if (!padAmount.includes('.')) padAmount = (padAmount || '0') + '.';
  } else {
    // 소수점 둘째 자리까지만, 그리고 앞자리 0이 쌓이지 않게
    if (padAmount.includes('.') && padAmount.split('.')[1].length >= 2) return;
    if (padAmount === '0') padAmount = key;
    else padAmount = padAmount + key;
  }
  render();
}

/** 저장 — 여행 중 기록이므로 "결제 완료 + 공동 지출 + 오늘 날짜"가 기본이다 */
async function savePadExpense(): Promise<void> {
  const amount = Number(padAmount);
  if (!expenseCtx || !Number.isFinite(amount) || amount <= 0 || padSaving) return;

  padSaving = true;
  render();

  const guess = guessFromCurrentStop();
  const me = store.get('user')?.id ?? null;
  const allIds = new Set(expenseCtx.members.map((m) => m.user_id));

  try {
    const payload = await buildExpensePayload(expenseCtx, {
      category: padCategory,
      title: guess?.title || CATEGORY_META[padCategory].label,
      amount,
      currency: padCurrency,
      expenseDate: todayISO(),
      isPaid: true,
      splitMode: 'SHARED',
      payer: me,
      split: allIds,
      memo: null,
    });
    const { error } = await supabase.from('trip_expenses').insert(payload);
    if (error) {
      console.error('[Mobile] 지출 저장 실패:', error.message);
      padSaving = false;
      render();
      return;
    }
    padOpen = false;
    padSaving = false;
    padAmount = '';
    await reloadExpenses();
    render();
  } catch (e) {
    console.error('[Mobile] 지출 저장 실패:', e);
    padSaving = false;
    render();
  }
}

/* ══════════════ MORE 탭 — 하루 바깥의 것들 ══════════════
 *
 * TODAY·TIMELINE·WALLET은 전부 "지금 이 하루"를 다룬다. MORE는 하루에 매이지 않는 것들
 * (숙소, 준비물, 예약 흔적, 같이 가는 사람) 자리다. 잡동사니 서랍이 되기 쉬운 탭이라
 * 넣는 기준을 하나로 정했다 — **여행 중 폰에서 "지금 당장" 필요한 것만.**
 * 그래서 트립 설정·멤버 초대·전체 링크 목록 같은 관리 기능은 PC에 남기고 링크로만 넘긴다.
 *
 * 섹션 순서는 여행 상태에 따라 바뀐다. 여행 전에는 체크리스트가, 여행 중에는 숙소가 위로
 * 온다 — 밤에 택시를 잡으며 폰을 여는 사람에게 필요한 건 준비물 목록이 아니라 숙소 주소다.
 */

/** 채팅에 공유된 링크 중 "예약 흔적"으로 볼 수 있는 카테고리만. 나머지(영상·블로그 등)는
 *  참고 자료라 여행 중에 급히 열 일이 없다 — 전체 목록은 PC의 LINKS 게이트에 있다. */
const BOOKING_LINK_CATEGORIES = new Set(['STAY', 'ACTIVITY']);

/**
 * 추천 준비물 — **자동으로 넣지 않는다.** 눌러야 추가되는 입력 도우미일 뿐이라
 * 원칙 3-1(없는 데이터를 지어내지 않는다)에 걸리지 않는다. 빈 목록 앞에서
 * "뭘 적지"로 막히는 걸 없애는 게 목적이고, 이미 목록에 있는 항목은 칩에서 사라진다.
 */
const CHECKLIST_SUGGESTIONS = ['여권', '항공권', '유심 · eSIM', '여행자보험', '보조배터리', '멀티어댑터', '상비약', '환전'];

/** MORE를 처음 열 때 한 번만 — 체크리스트와 공유 링크를 같이 불러온다(원칙 3-2). */
async function ensureMoreCtx(): Promise<void> {
  if (moreLoaded || moreLoading || !currentTripId) return;
  moreLoading = true;
  render();
  try {
    const [items, linkRes] = await Promise.all([
      loadChecklist(currentTripId),
      supabase
        .from('trip_links')
        .select('*')
        .eq('trip_id', currentTripId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    // null이면 마이그레이션 전 — 섹션을 접고 나머지는 그대로 보여준다
    checklistReady = items != null;
    checklist = items ?? [];
    if (linkRes.error) console.error('[Mobile] 링크 로드 실패:', linkRes.error.message);
    tripLinks = ((linkRes.data ?? []) as TripLink[]).filter((l) => BOOKING_LINK_CATEGORIES.has(l.category));

    moreLoaded = true;
    if (checklistReady) subscribeChecklist(currentTripId, () => { void reloadChecklist(); });
    subscribeLinks();
  } catch (e) {
    console.error('[Mobile] MORE 로드 실패:', e);
  } finally {
    moreLoading = false;
    render();
  }
}

async function reloadChecklist(): Promise<void> {
  if (!currentTripId) return;
  const items = await loadChecklist(currentTripId);
  if (items == null) return;
  checklist = items;
  if (activeTab === 'trip') render();
}

/** 다른 멤버가 채팅에 예약 링크를 올리면 MORE에도 즉시 뜬다 (expenses와 같은 패턴) */
function subscribeLinks(): void {
  if (linksChannel || !currentTripId) return;
  linksChannel = supabase
    .channel('mb-links:' + currentTripId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trip_links', filter: 'trip_id=eq.' + currentTripId },
      () => { void reloadLinks(); }
    )
    .subscribe();
}

async function reloadLinks(): Promise<void> {
  if (!currentTripId) return;
  const { data, error } = await supabase
    .from('trip_links')
    .select('*')
    .eq('trip_id', currentTripId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return;
  tripLinks = ((data ?? []) as TripLink[]).filter((l) => BOOKING_LINK_CATEGORIES.has(l.category));
  if (activeTab === 'trip') render();
}

function moreTabHtml(): string {
  if (moreLoading && !moreLoaded) {
    return '<div class="mb-wallet-loading"><span class="mb-spinner"></span>불러오는 중…</div>';
  }

  // 여행 중이면 숙소가, 여행 전이면 준비물이 먼저다 (섹션 주석 참고)
  const traveling = todayDayIndex() >= 0;
  const stay = stayCardHtml();
  const check = checklistSecHtml();

  return [
    tripSegHtml(),
    tripHeadHtml(),
    traveling ? stay + check : check + stay,
    bookingLinksHtml(),
    moreLinksHtml(),
  ].join('');
}

/** 여행 요약 한 줄 — 어디로, 언제, 며칠 남았나. 전부 trips/destinations에 이미 있는 값이다. */
function tripHeadHtml(): string {
  const start = days.find((d) => d.date)?.date ?? null;
  const end = [...days].reverse().find((d) => d.date)?.date ?? null;
  const todayIdx = todayDayIndex();

  let badge = '';
  if (todayIdx >= 0) {
    badge = '<span class="mb-more-badge is-live">여행 중 · ' + escapeHtml(days[todayIdx].label) + '</span>';
  } else if (start) {
    const left = daysBetween(todayISO(), start);
    if (left > 0) badge = '<span class="mb-more-badge">D-' + left + '</span>';
    else badge = '<span class="mb-more-badge">여행 완료</span>';
  }

  const range = start && end ? dateLabel(start) + ' – ' + dateLabel(end) : '';

  return [
    '<section class="mb-more-head">',
    '  <div class="mb-more-head-top">',
    '    <h2 class="mb-more-title">' + escapeHtml(currentTrip?.name || tripDestName()) + '</h2>',
    badge,
    '  </div>',
    range ? '  <div class="mb-more-sub">' + escapeHtml(tripDestName()) + ' · ' + escapeHtml(range) + '</div>' : '',
    '</section>',
  ].join('');
}

/* ── 숙소 ── */

/** 그날 밤 묵는 구간. end_date는 체크아웃 날이므로 "start ≤ 날짜 < end"가 숙박한 밤이다. */
function staySegmentOn(dateISO: string | null): StaySegment | null {
  if (!dateISO) return null;
  return (
    staySegments.find(
      (seg) => seg.start_date != null && seg.end_date != null && seg.start_date <= dateISO && dateISO < seg.end_date
    ) ?? null
  );
}

function stayPlaceOf(seg: StaySegment): Place | null {
  return seg.basecamp_place_id ? placeById.get(seg.basecamp_place_id) ?? null : null;
}

/**
 * 오늘 밤(여행 전이면 첫날 밤) 묵는 숙소 하나. 확정된 숙소가 없으면 지어내지 않고
 * "아직 확정 안 됨"으로 남기고 PC의 STAY로 넘긴다(원칙 3-1).
 */
function stayCardHtml(): string {
  if (!staySegments.length) return '';

  const todayIdx = todayDayIndex();
  const refDate = todayIdx >= 0 ? todayISO() : days.find((d) => d.date)?.date ?? null;
  const seg = staySegmentOn(refDate) ?? staySegments[0];
  const place = stayPlaceOf(seg);
  const isTonight = todayIdx >= 0 && staySegmentOn(todayISO()) === seg;

  const head =
    '  <div class="mb-more-sec-head">' +
    '<h4 class="mb-more-sec-title">' + (isTonight ? '오늘 밤 숙소' : '숙소') + '</h4>' +
    (staySegments.length > 1 ? '<span class="mb-more-sec-note">구간 ' + staySegments.length + '개</span>' : '') +
    '</div>';

  if (!place) {
    return [
      '<section class="mb-more-sec">',
      head,
      '  <button class="mb-stay-card is-empty" id="mb-goto-stay">',
      '    <span class="mb-stay-ic">' + IC.bag + '</span>',
      '    <div class="mb-stay-main">',
      '      <div class="mb-stay-name">숙소가 아직 확정되지 않았어요</div>',
      '      <div class="mb-stay-meta">' + escapeHtml(seg.zone_name ?? tripDestName()) + ' · PC의 STAY에서 정할 수 있어요</div>',
      '    </div>',
      '    <span class="mb-stay-chev">' + IC.chevRight + '</span>',
      '  </button>',
      '</section>',
    ].join('');
  }

  const nights =
    seg.start_date && seg.end_date
      ? Math.max(0, daysBetween(seg.start_date, seg.end_date))
      : 0;
  const stayRange =
    seg.start_date && seg.end_date
      ? dateLabel(seg.start_date) + ' – ' + dateLabel(seg.end_date) + (nights > 0 ? ' · ' + nights + '박' : '')
      : '';
  const href =
    'https://www.google.com/maps/dir/?api=1&destination=' +
    encodeURIComponent(place.lat != null && place.lng != null ? place.lat + ',' + place.lng : place.name);

  return [
    '<section class="mb-more-sec">',
    head,
    '  <div class="mb-stay-card">',
    '    <span class="mb-stay-ic">' + IC.bag + '</span>',
    '    <div class="mb-stay-main">',
    '      <div class="mb-stay-name">' + escapeHtml(place.name) + '</div>',
    // 주소는 DB에 있을 때만 — 없으면 그 줄이 사라진다(원칙 3-1)
    place.address ? '      <div class="mb-stay-addr">' + escapeHtml(place.address) + '</div>' : '',
    stayRange ? '      <div class="mb-stay-meta">' + escapeHtml(stayRange) + '</div>' : '',
    '    </div>',
    '  </div>',
    '  <div class="mb-stay-actions">',
    '    <a class="mb-stay-btn is-primary" href="' + href + '" target="_blank" rel="noopener">' + IC.navigate + ' 길찾기</a>',
    place.address
      ? '    <button class="mb-stay-btn" data-copy="' + escapeHtml(place.address) + '">' + IC.share + ' 주소 복사</button>'
      : '',
    '  </div>',
    '</section>',
  ].join('');
}

/* ── 준비 체크리스트 ── */

function checklistSecHtml(): string {
  // 마이그레이션 전이면 섹션을 통째로 접는다 — 저장이 안 되는 입력창을 띄우면 적은 게 사라진다
  if (!checklistReady) return '';

  const done = checklist.filter((c) => c.checked_at != null).length;
  const total = checklist.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const rows = checklist
    .map((c) => {
      const checked = c.checked_at != null;
      return [
        '<div class="mb-ck-row' + (checked ? ' is-done' : '') + '">',
        '  <button class="mb-ck-box" data-ck-toggle="' + c.id + '" aria-pressed="' + checked + '" aria-label="' + escapeHtml(c.title) + '">',
        checked ? IC.check : '',
        '  </button>',
        '  <div class="mb-ck-main">',
        '    <div class="mb-ck-title">' + escapeHtml(c.title) + '</div>',
        // TIMELINE에서 "이 장소 준비물"로 넣은 항목 — 제목만으론 어느 장소 것인지 모르므로 붙여 준다
        c.place_name ? '    <div class="mb-ck-place">' + escapeHtml(c.place_name) + '</div>' : '',
        // 누가 했는지는 저장된 이름이 있을 때만 (원칙 3-1)
        checked && c.checked_by_name
          ? '    <div class="mb-ck-by">' + escapeHtml(c.checked_by_name) + ' 완료</div>'
          : '',
        '  </div>',
        '  <button class="mb-ck-del" data-ck-del="' + c.id + '" aria-label="삭제">' + IC.close + '</button>',
        '</div>',
      ].join('');
    })
    .join('');

  const taken = new Set(checklist.map((c) => c.title));
  const suggestions = CHECKLIST_SUGGESTIONS.filter((s) => !taken.has(s));

  return [
    '<section class="mb-more-sec">',
    '  <div class="mb-more-sec-head">',
    '    <h4 class="mb-more-sec-title">준비 체크리스트</h4>',
    total ? '    <span class="mb-more-sec-note">' + done + ' / ' + total + '</span>' : '',
    '  </div>',
    total
      ? '  <div class="mb-ck-gauge"><span class="mb-ck-gauge-fill" style="width:' + pct + '%"></span></div>'
      : '  <p class="mb-ck-empty">같이 가는 사람 모두가 보는 목록이에요. 아래에서 눌러 담아보세요.</p>',
    total ? '  <div class="mb-ck-list">' + rows + '</div>' : '',
    suggestions.length
      ? '  <div class="mb-ck-chips">' +
        suggestions.map((s) => '<button class="mb-ck-chip" data-ck-add="' + escapeHtml(s) + '">' + IC.plus + escapeHtml(s) + '</button>').join('') +
        '  </div>'
      : '',
    checklistAdding
      ? [
          '  <form class="mb-ck-form" id="mb-ck-form">',
          '    <input class="mb-ck-input" id="mb-ck-input" type="text" placeholder="직접 입력" value="' + escapeHtml(checklistDraft) + '" maxlength="60" />',
          '    <button class="mb-ck-submit" type="submit">추가</button>',
          '  </form>',
        ].join('')
      : '  <button class="mb-ck-open" id="mb-ck-open">' + IC.plus + ' 직접 추가</button>',
    '</section>',
  ].join('');
}

/* ── 예약·티켓 링크 ── */

/**
 * "티켓 지갑"이라고 부르지 않는다 — 우리가 가진 건 예약 확인서가 아니라 **채팅에 공유된
 * 링크**뿐이고, 그 이상인 척하면 사용자가 없는 걸 믿게 된다(원칙 3-1). 대신 여행 중에
 * 급히 열 만한 숙소·액티비티 링크만 골라 크게 눌리게 둔다.
 */
function bookingLinksHtml(): string {
  if (!tripLinks.length) return '';

  const rows = tripLinks
    .slice(0, 6)
    .map((l) => {
      let host = l.url;
      try { host = new URL(l.url).hostname.replace(/^www\./, ''); } catch { /* 잘못된 URL이면 원문 그대로 */ }
      const label = l.title || l.site_name || host;
      return [
        '<a class="mb-bk-row" href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener">',
        l.image_url
          ? '  <span class="mb-bk-thumb" style="background-image:url(' + escapeHtml(l.image_url) + ')"></span>'
          : '  <span class="mb-bk-thumb is-blank">' + IC.bookmark + '</span>',
        '  <div class="mb-bk-main">',
        '    <div class="mb-bk-title">' + escapeHtml(label) + '</div>',
        '    <div class="mb-bk-host">' + escapeHtml(host) + '</div>',
        '  </div>',
        '  <span class="mb-bk-ext">' + IC.ext + '</span>',
        '</a>',
      ].join('');
    })
    .join('');

  return [
    '<section class="mb-more-sec">',
    '  <div class="mb-more-sec-head">',
    '    <h4 class="mb-more-sec-title">예약 · 티켓 링크</h4>',
    '    <span class="mb-more-sec-note">채팅에서 모임</span>',
    '  </div>',
    '  <div class="mb-bk-list">' + rows + '</div>',
    tripLinks.length > 6
      ? '  <button class="mb-wal-more" id="mb-more-links">공유된 링크 전체 보기 ' + IC.chevRight + '</button>'
      : '',
    '</section>',
  ].join('');
}

/** PC로 넘기는 줄들 — 모바일에서 만들지 않기로 한 기능은 숨기지 말고 어디 있는지 알려준다 */
function moreLinksHtml(): string {
  const rows: Array<{ id: string; icon: string; label: string; sub: string }> = [
    { id: 'mb-more-chat', icon: IC.bell, label: '채팅 · 공유 링크', sub: '같이 가는 사람들과 나눈 이야기' },
    { id: 'mb-more-plan', icon: IC.route, label: '일정 편집', sub: '순서·이동수단 변경은 PC에서' },
    { id: 'mb-more-expense', icon: IC.wallet, label: '전체 지출 · 예산 설정', sub: '차트와 필터가 있는 대시보드' },
  ];
  return [
    '<section class="mb-more-sec">',
    '  <div class="mb-more-list">',
    rows
      .map(
        (r) =>
          '<button class="mb-more-row" id="' + r.id + '">' +
          '<span class="mb-more-row-ic">' + r.icon + '</span>' +
          '<div class="mb-more-row-main">' +
          '<div class="mb-more-row-label">' + escapeHtml(r.label) + '</div>' +
          '<div class="mb-more-row-sub">' + escapeHtml(r.sub) + '</div>' +
          '</div>' +
          '<span class="mb-more-row-chev">' + IC.chevRight + '</span>' +
          '</button>'
      )
      .join(''),
    '  </div>',
    '</section>',
  ].join('');
}

/* ── 체크리스트 동작 (낙관적 갱신 — 카드의 도착 기록과 같은 이유) ── */

async function toggleChecklistItem(id: string): Promise<void> {
  const item = checklist.find((c) => c.id === id);
  if (!item) return;
  const next = item.checked_at == null;

  checklist = checklist.map((c) =>
    c.id === id ? { ...c, checked_at: next ? new Date().toISOString() : null, checked_by_name: next ? c.checked_by_name : null } : c
  );
  render();

  const ok = await setChecklistChecked(id, next);
  if (ok) await reloadChecklist();
}

async function addChecklist(title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed || !currentTripId) return;
  if (checklist.some((c) => c.title === trimmed)) return;

  const maxOrder = checklist.reduce((m, c) => Math.max(m, c.sort_order), 0);
  const created = await addChecklistItem(currentTripId, trimmed, maxOrder + 1);
  if (created) await reloadChecklist();
}

async function removeChecklist(id: string): Promise<void> {
  checklist = checklist.filter((c) => c.id !== id);
  render();
  const ok = await deleteChecklistItem(id);
  if (ok) await reloadChecklist();
}

function emptyHtml(title: string, sub: string): string {
  return [
    '<div class="mb-empty">',
    '  <div class="mb-empty-title">' + escapeHtml(title) + '</div>',
    '  <p class="mb-empty-sub">' + sub + '</p>',
    '  <button class="mb-ghost-btn" id="mb-goto-route">ROUTE로 이동</button>',
    '</div>',
  ].join('');
}

/* ── DAY 선택 시트 ── */

function daySheetHtml(): string {
  const t = todayISO();
  return [
    '<div class="mb-sheet-back" id="mb-sheet-back"></div>',
    '<div class="mb-sheet" role="dialog" aria-label="DAY 선택">',
    '  <div class="mb-sheet-grip"></div>',
    '  <div class="mb-sheet-title">DAY 선택</div>',
    '  <div class="mb-sheet-list">',
    days
      .map((d, i) =>
        // 여행지가 바뀌는 자리에 머리를 끼운다(여행지가 하나뿐이면 안 나온다)
        (isMultiDest() && (i === 0 || days[i - 1].destId !== d.destId) && d.destName
          ? '<div class="mb-sheet-dest">' + escapeHtml(d.destName) + '</div>'
          : '') +
        '<button class="mb-sheet-item' + (i === activeDayIndex ? ' active' : '') + '" data-day="' + i + '">' +
        '<span class="mb-sheet-day">' + escapeHtml(d.label) + '</span>' +
        '<span class="mb-sheet-date">' + escapeHtml(dateLabel(d.date)) + (d.date === t ? ' · TODAY' : '') + '</span>' +
        '<span class="mb-sheet-count">' + (d.stops.length ? d.stops.length + '곳' : '—') + '</span>' +
        '</button>'
      )
      .join(''),
    '  </div>',
    '</div>',
  ].join('');
}

/* ══════════════ 장소 상세 ══════════════ */

function findStop(key: string): { stop: TlStop; index: number; day: TlDay } | null {
  // 키는 여행지 안에서만 유일하다 — 다른 여행지의 같은 키가 있어도 지금 보는 DAY를 먼저 맞춘다
  const a = activeDay();
  const order = a ? [a, ...days.filter((d) => d !== a)] : days;
  for (const d of order) {
    const idx = d.stops.findIndex((s) => s.key === key);
    if (idx >= 0) return { stop: d.stops[idx], index: idx, day: d };
  }
  return null;
}

function briefRequestFor(stop: TlStop, destination: string): PlaceBriefRequest {
  const p = stop.place;
  return {
    name: stop.name,
    googlePlaceId: p?.google_place_id ?? null,
    category: p?.category ?? null,
    address: p?.address ?? null,
    destination,
    rating: typeof p?.google_rating === 'number' ? p.google_rating : null,
    hours: Array.isArray(p?.opening_hours) ? (p!.opening_hours as string[]) : null,
  };
}

/* ══════════════ 장소 상세 (레퍼런스 화면 B) ══════════════
 *
 * 상단 네비 → 대표 사진 → 이름·주소 → 액션 3개 → 정보 행 목록 → 지도 CTA 순서.
 * 레퍼런스에 있던 **즐겨찾기(하트)는 넣지 않았다** — 저장할 데이터 모델이 없어서, 눌러도
 * 아무 일이 없는 버튼이 된다(명세: 죽은 버튼 금지).
 *
 * 기존 OVERVIEW/GUIDE/REVIEWS 탭(AI 브리핑)은 **그대로 아래에 남긴다** — 레퍼런스에 없다고
 * 이미 동작하는 기능을 버릴 이유가 없다.
 */
function detailHtml(): string {
  const found = detailKey ? findStop(detailKey) : null;
  if (!found) return '<div class="mb-loading">장소를 찾을 수 없어요.</div>';
  const { stop, index, day } = found;
  const place = stop.place;
  const s = scheduleFor(day, realLegs, progressOf(day));
  const rating = typeof place?.google_rating === 'number' ? place.google_rating : null;
  const photo = place?.photo_url ?? null;
  const dwell = s.dwellMin[index] ?? dwellMinutes(stop.cat);
  const leg = s.legs[index];
  const nextStop = day.stops[index + 1] ?? null;
  const warn = hoursWarning(place ?? null, day.date, s.arriveMin[index], s.departMin[index]);
  const tickets = ticketsForDay(day.dayNumber);

  // 정보 행 — **저장된 값이 있는 줄만** 만든다. 빈 줄을 "—"로 채우지 않는다(원칙 3-1).
  const rows: string[] = [];
  rows.push(infoRowHtml(IC.clock, '방문 예정', minToHHMM(s.arriveMin[index]) + ' – ' + minToHHMM(s.departMin[index])));
  if (place?.address) rows.push(infoRowHtml(IC.pin, '주소', place.address, 'copy', place.address));
  const hours = todaysHoursLine(place ?? null, day.date);
  if (hours) rows.push(infoRowHtml(IC.clock, '영업시간', hours, undefined, undefined, !!warn));
  if (leg && nextStop) {
    rows.push(infoRowHtml(MODE_ICON[leg.mode], '다음 장소까지', modeLabel(leg.mode) + ' ' + fmtMin(leg.min) + ' · ' + escapeHtml(nextStop.name)));
  }
  if (stop.memo) rows.push(infoRowHtml(IC.pencil, '메모', stop.memo));

  return [
    '<div class="mb-detail">',
    // ── 상단 네비 ──
    '  <header class="mb-pdnav">',
    '    <button class="mb-pdnav-btn" id="mb-pd-close" aria-label="뒤로">' + IC.back + '</button>',
    '    <h1 class="mb-pdnav-title">' + escapeHtml(stop.name) + '</h1>',
    '    <button class="mb-pdnav-btn" id="mb-pd-share" aria-label="공유">' + IC.share + '</button>',
    '  </header>',
    '  <div class="mb-pdscroll">',
    // ── 대표 사진 ──
    '    <div class="mb-pdhero' + (photo ? '' : ' no-photo') + '"' + (photo ? ' data-photo="' + escapeHtml(photo) + '"' : '') + '>',
    photo ? '' : '      <span class="mb-pdhero-blank">' + IC.pin + '</span>',
    '      <div class="mb-pdhero-foot">',
    '        <span class="mb-pdhero-time">' + IC.clock + minToHHMM(s.arriveMin[index]) + ' – ' + minToHHMM(s.departMin[index]) + '</span>',
    // 티켓 배지는 그 날 예약 서류가 **실제로 있을 때만**. 없으면 아예 안 띄운다.
    tickets.length ? '        <span class="mb-pdhero-tag">' + IC.ticket + '티켓 ' + tickets.length + '건</span>' : '',
    '      </div>',
    '    </div>',
    '    <div class="mb-pd">',
    // ── 이름 · 주소 ──
    '      <div class="mb-pd-head">',
    '        <h2 class="mb-pd-name">' + escapeHtml(stop.name) + '</h2>',
    rating != null ? '        <span class="mb-pd-rating">' + IC.star + rating.toFixed(1) + '</span>' : '',
    '      </div>',
    place?.address
      ? '      <p class="mb-pd-addr">' + IC.pin + '<span>' + escapeHtml(place.address) + '</span></p>'
      : place?.category
        ? '      <p class="mb-pd-addr">' + IC.pin + '<span>' + escapeHtml(place.category) + '</span></p>'
        : '',
    warn ? '      <div class="mb-pd-warn">' + escapeHtml(hoursWarnText(warn)) + '</div>' : '',
    // ── 액션 3개 ──
    '      <div class="mb-pd-acts">',
    '        <a class="mb-pd-act is-primary" href="' + directionsHref(stop) + '" target="_blank" rel="noopener">' +
      '<span class="mb-pd-act-ic">' + IC.navigate + '</span>길찾기</a>',
    '        <button class="mb-pd-act" id="mb-pd-ticket">' +
      '<span class="mb-pd-act-ic">' + IC.ticket + '</span>티켓 보기</button>',
    '        <button class="mb-pd-act" id="mb-pd-share2">' +
      '<span class="mb-pd-act-ic">' + IC.share + '</span>공유</button>',
    '      </div>',
    // ── 정보 행 ──
    '      <div class="mb-pd-rows">' + rows.join('') + '</div>',
    '      <div class="mb-pd-chip">' + IC.clock + '예상 체류 ' + fmtMin(dwell) + ' <span class="mb-tag-est">추정</span></div>',
    // ── 기존 AI 브리핑 탭 (유지) ──
    '      <div class="mb-pd-tabs">',
    (['overview', 'guide', 'reviews'] as PdTab[])
      .map(
        (t) =>
          '<button class="mb-pd-tab' + (detailTab === t ? ' active' : '') + '" data-pdtab="' + t + '">' +
          t.toUpperCase() +
          '</button>'
      )
      .join(''),
    '      </div>',
    '      <div class="mb-pd-body">' + pdBodyHtml(stop, index, s, day) + '</div>',
    '    </div>',
    '  </div>',
    // ── 하단 CTA — 이 화면에서 가장 중요한 동작 ──
    '  <div class="mb-pd-cta">',
    '    <a class="mb-pd-cta-btn" href="' + directionsHref(stop) + '" target="_blank" rel="noopener">' +
      IC.map + ' 지도 앱으로 길찾기</a>',
    '  </div>',
    '</div>',
  ].join('');
}

/** 그 DAY에 걸리는 티켓/입장권 서류 — 지갑과 **같은 데이터**를 본다(중복 저장 없음). */
function ticketsForDay(dayNumber: number): TripDocument[] {
  if (!walletDocsLoaded) return [];
  const n = dayNumber; // 여행 전체 기준 번호(docCountForDay 주석 참고)
  return walletDocs.filter((d) => {
    if (normalizeDocCategory(d.category) !== 'TICKET') return false;
    if (d.day_start == null && d.day_end == null) return false;
    const from = d.day_start ?? d.day_end ?? 0;
    const to = d.day_end ?? d.day_start ?? 0;
    return n >= from && n <= to;
  });
}

/** 정보 행 하나. `action='copy'`면 우측에 복사 버튼이 붙는다. */
function infoRowHtml(
  icon: string,
  label: string,
  value: string,
  action?: 'copy',
  copyText?: string,
  warn?: boolean
): string {
  return [
    '<div class="mb-pd-row' + (warn ? ' is-warn' : '') + '">',
    '  <span class="mb-pd-row-ic">' + icon + '</span>',
    '  <span class="mb-pd-row-label">' + escapeHtml(label) + '</span>',
    '  <span class="mb-pd-row-val">' + escapeHtml(value) + '</span>',
    action === 'copy' && copyText
      ? '  <button class="mb-pd-row-copy" data-copy="' + escapeHtml(copyText) + '" aria-label="복사">' + IC.share + '</button>'
      : '',
    '</div>',
  ].join('');
}

function pdBodyHtml(stop: TlStop, index: number, s: DaySchedule, day: TlDay): string {
  if (detailTab === 'guide') return pdGuideHtml(stop, day);
  if (detailTab === 'reviews') return pdReviewsHtml(stop);
  return pdOverviewHtml(stop, index, s, day);
}

/* ── Overview ── */

function pdOverviewHtml(stop: TlStop, index: number, s: DaySchedule, day: TlDay): string {
  const key = placeBriefKey(briefRequestFor(stop, day.destName ?? tripDestName()));
  const brief = placeBriefs.get(key) ?? null;
  const loading = placeBriefLoading.has(key);
  const err = placeBriefErrors.get(key) ?? null;

  return [
    pdSectionHtml(IC.bulb, '한눈에 보기', aboutHtml(brief, loading, err, key)),
    pdSectionHtml(IC.starLine, 'Don\'t Miss', dontMissHtml(stop, brief, loading, key)),
    pdCardSectionHtml(IC.bag, 'Before You Go', beforeYouGoHtml(stop, index, s, day, brief)),
    pdCardSectionHtml(IC.pencil, '메모', memoHtml(stop)),
  ].join('');
}

/** 위계는 카드 개수가 아니라 배경 차이로 만든다 — 상위 섹션은 배경 위에 그대로 */
function pdSectionHtml(icon: string, title: string, body: string): string {
  return [
    '<section class="mb-pd-sec">',
    '  <h4 class="mb-pd-sec-title">' + icon + escapeHtml(title) + '</h4>',
    body,
    '</section>',
  ].join('');
}

/** 보조 정보는 한 단계 내려서 카드로 감싼다 */
function pdCardSectionHtml(icon: string, title: string, body: string): string {
  return [
    '<section class="mb-pd-sec">',
    '  <h4 class="mb-pd-sec-title">' + icon + escapeHtml(title) + '</h4>',
    '  <div class="mb-pd-card">' + body + '</div>',
    '</section>',
  ].join('');
}

function aboutHtml(brief: PlaceBrief | null, loading: boolean, err: string | null, key: string): string {
  if (loading) {
    return '<div class="mb-ai-loading"><span class="mb-spinner"></span>AI가 이 장소를 정리하고 있어요</div>';
  }
  if (brief?.summary) {
    return [
      '<p class="mb-pd-text">' + escapeHtml(brief.summary) + '</p>',
      brief.keywords.length
        ? '<div class="mb-kw">' + brief.keywords.map((k) => '<span class="mb-kw-item">' + escapeHtml(k) + '</span>').join('') + '</div>'
        : '',
      '<p class="mb-caveat">요금·운영 정책은 현장에서 확인해 주세요. <span class="mb-tag-ai">' + IC.spark + 'AI</span></p>',
    ].join('');
  }
  return [
    err ? '<p class="mb-ai-err">' + escapeHtml(err) + '</p>' : '',
    '<button class="mb-ai-btn" data-brief="' + escapeHtml(key) + '">' + IC.spark + 'AI로 이 장소 정리하기</button>',
  ].join('');
}

function dontMissHtml(stop: TlStop, brief: PlaceBrief | null, loading: boolean, key: string): string {
  const links = searchLinksHtml(stop);
  if (loading) return links;
  if (brief && brief.dontMiss.length) {
    return [
      '<ul class="mb-miss">',
      brief.dontMiss
        .map(
          (d) =>
            '<li class="mb-miss-item"><span class="mb-miss-ic">' + IC.check + '</span>' +
            '<div><span class="mb-miss-title">' + escapeHtml(d.title) + '</span>' +
            (d.detail ? '<span class="mb-miss-detail">' + escapeHtml(d.detail) + '</span>' : '') +
            '</div></li>'
        )
        .join(''),
      '</ul>',
      brief.bestTime
        ? '<div class="mb-best"><span class="mb-best-label">BEST TIME</span>' + escapeHtml(brief.bestTime) +
          ' <span class="mb-tag-ai">' + IC.spark + 'AI</span></div>'
        : '',
      links,
    ].join('');
  }
  // 브리핑은 있는데 이 섹션만 비어 있으면 "다시 생성" — 반쪽 캐시를 건너뛰는 경로(5-3의 실제 버그)
  if (brief) {
    return [
      '<button class="mb-ai-btn ghost" data-brief="' + escapeHtml(key) + '" data-force="1">' + IC.refresh + '다시 생성</button>',
      links,
    ].join('');
  }
  return links;
}

/** URL 조합뿐이라 API 비용이 0 (원칙 3-2) */
function searchLinksHtml(stop: TlStop): string {
  const q = encodeURIComponent(stop.name);
  return [
    '<div class="mb-links">',
    '  <a class="mb-link" target="_blank" rel="noopener" href="' + directionsHref(stop) + '">' + IC.navigate + '길찾기</a>',
    '  <a class="mb-link" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=' + q + '">' + IC.ext + '영상</a>',
    '  <a class="mb-link" target="_blank" rel="noopener" href="https://search.naver.com/search.naver?query=' + q + '+후기">' + IC.ext + '후기</a>',
    '</div>',
  ].join('');
}

/**
 * 값의 출처를 세 가지로 구분한다(원칙 3-1) —
 *   실제 저장값 → 파란 체크 / AI가 채운 값 → 스파클 + AI 태그 / 근거 없음 → 옅은 ? + "확인 필요"
 * 빈칸을 감추지 않고 빈칸인 채로 보여주는 게 이 앱의 방식이다.
 */
function beforeYouGoHtml(stop: TlStop, index: number, s: DaySchedule, day: TlDay, brief: PlaceBrief | null): string {
  const place = stop.place;
  const hours = todaysHoursLine(place ?? null, day.date);
  const rows: string[] = [];

  rows.push(bygRow('운영시간', hours, hours ? 'real' : 'unknown'));
  rows.push(bygRow('위치', place?.address ?? null, place?.address ? 'real' : 'unknown'));
  rows.push(bygRow('예상 체류', fmtMin(s.dwellMin[index] ?? dwellMinutes(stop.cat)), 'est'));
  rows.push(bygRow('예약·입장', brief?.beforeYouGo.booking || null, brief?.beforeYouGo.booking ? 'ai' : 'unknown'));
  rows.push(bygRow('복장 규정', brief?.beforeYouGo.dress || null, brief?.beforeYouGo.dress ? 'ai' : 'unknown'));
  rows.push(bygRow('현금 준비', brief?.beforeYouGo.cash || null, brief?.beforeYouGo.cash ? 'ai' : 'unknown'));

  return rows.join('');
}

function bygRow(label: string, value: string | null, kind: 'real' | 'ai' | 'est' | 'unknown'): string {
  const mark =
    kind === 'real' ? '<span class="mb-byg-ic real">' + IC.check + '</span>'
    : kind === 'ai' ? '<span class="mb-byg-ic ai">' + IC.spark + '</span>'
    : kind === 'est' ? '<span class="mb-byg-ic est">' + IC.clock + '</span>'
    : '<span class="mb-byg-ic unknown">?</span>';
  const text =
    value != null
      ? escapeHtml(value) + (kind === 'ai' ? ' <span class="mb-tag-ai">AI</span>' : kind === 'est' ? ' <span class="mb-tag-est">추정</span>' : '')
      : '<span class="mb-byg-unknown">확인 필요</span>';
  return [
    '<div class="mb-byg-row">',
    '  ' + mark,
    '  <span class="mb-byg-label">' + escapeHtml(label) + '</span>',
    '  <span class="mb-byg-value">' + text + '</span>',
    '</div>',
  ].join('');
}

function memoHtml(stop: TlStop): string {
  const memo = stop.memo ?? '';
  return [
    '<textarea class="mb-memo" id="mb-memo" maxlength="200" rows="3" placeholder="이 장소에 대한 메모를 남겨보세요">' + escapeHtml(memo) + '</textarea>',
    '<div class="mb-memo-foot"><span id="mb-memo-count">' + memo.length + '/200</span></div>',
  ].join('');
}

/* ── Guide ── */

function pdGuideHtml(stop: TlStop, day: TlDay): string {
  const place = stop.place;
  const lines = Array.isArray(place?.opening_hours) ? (place!.opening_hours as unknown[]) : null;
  const todayIdx = day.date ? (new Date(day.date + 'T00:00:00').getDay() + 6) % 7 : -1;

  const hoursBlock =
    lines && lines.length === 7 && lines.every((l) => typeof l === 'string')
      ? '<div class="mb-hours">' +
        (lines as string[])
          .map((l, i) => '<div class="mb-hours-row' + (i === todayIdx ? ' today' : '') + '">' + escapeHtml(l) + '</div>')
          .join('') +
        '</div>'
      : '<p class="mb-pd-muted">저장된 영업시간이 없어요.</p>';

  return [
    pdCardSectionHtml(IC.clock, '영업시간', hoursBlock),
    pdCardSectionHtml(
      IC.pin,
      '위치',
      (place?.address ? '<p class="mb-pd-text">' + escapeHtml(place.address) + '</p>' : '<p class="mb-pd-muted">저장된 주소가 없어요.</p>') +
        '<div class="mb-links">' +
        '<a class="mb-link" target="_blank" rel="noopener" href="' + directionsHref(stop) + '">' + IC.navigate + '길찾기</a>' +
        '</div>'
    ),
  ].join('');
}

/* ── Reviews ── */

function pdReviewsHtml(stop: TlStop): string {
  const rating = typeof stop.place?.google_rating === 'number' ? stop.place.google_rating : null;
  const q = encodeURIComponent(stop.name);
  return pdCardSectionHtml(
    IC.starLine,
    '평점 · 후기',
    (rating != null
      ? '<div class="mb-rating-big">' + IC.star + '<strong>' + rating.toFixed(1) + '</strong><span>Google 평점</span></div>'
      : '<p class="mb-pd-muted">저장된 평점이 없어요.</p>') +
      '<div class="mb-links">' +
      '<a class="mb-link" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + q + '">' + IC.ext + 'Google 지도 리뷰</a>' +
      '<a class="mb-link" target="_blank" rel="noopener" href="https://search.naver.com/search.naver?query=' + q + '+후기">' + IC.ext + '블로그 후기</a>' +
      '</div>'
  );
}

/* ══════════════ 사진 주입 ══════════════ */

/** 사진 주소를 style 속성에 직접 끼워 넣지 않는다 — 따옴표·괄호가 섞이면 CSS가 깨진다(5-3) */
function applyPhotos(): void {
  container?.querySelectorAll('[data-photo]').forEach((el) => {
    const url = (el as HTMLElement).dataset.photo;
    if (url) (el as HTMLElement).style.backgroundImage = 'url("' + url + '")';
  });
}

/* ══════════════ 이벤트 ══════════════ */

function bind(): void {
  if (!container) return;
  const root = container;

  // ── 탭 이동 ──
  root.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = (btn as HTMLElement).dataset.tab as MbTab;
      activeTab = tab;
      render();
      if (tab === 'wallet') { void ensureExpenseCtx(); void ensureWalletDocs(); }
      if (tab === 'trip' && tripSub === 'info') void ensureMoreCtx();
      // 다른 탭으로 나가면 지도 인스턴스를 버린다 — 다시 들어오면 새로 붙인다
      if (tab !== 'map') teardownMap();
    });
  });

  // ── 여행 탭 안 전환 (전체 일정 ↔ 여행 정보) ──
  root.querySelectorAll('[data-tripsub]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tripSub = (btn as HTMLElement).dataset.tripsub as TripSub;
      render();
      if (tripSub === 'info') void ensureMoreCtx(); // 여행 정보를 처음 열 때만 읽는다
    });
  });

  // ── DAY 선택 ──
  root.querySelector('#mb-daypick')?.addEventListener('click', () => {
    daySheetOpen = true;
    render();
  });
  root.querySelector('#mb-sheet-back')?.addEventListener('click', () => {
    daySheetOpen = false;
    render();
  });
  root.querySelectorAll('[data-day]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeDayIndex = Number((btn as HTMLElement).dataset.day);
      daySheetOpen = false;
      render();
      void loadRealLegsForActiveDay();
      void loadProgressForActiveDay();
      void loadWeatherForActiveDay();
    });
  });
  root.querySelectorAll('[data-goday]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeDayIndex = Number((btn as HTMLElement).dataset.goday);
      activeTab = 'today';
      render();
      void loadRealLegsForActiveDay();
      void loadProgressForActiveDay();
      void loadWeatherForActiveDay();
    });
  });

  bindPager(root);

  // ── 카드 → 상세 ──
  root.querySelectorAll('[data-stop]').forEach((card) => {
    const open = (e: Event) => {
      // 북마크·길찾기·도착 기록 버튼을 눌렀을 땐 상세를 열지 않는다
      const t = e.target as HTMLElement;
      if (t.closest('[data-bm]') || t.closest('[data-nav]') || t.closest('.mb-track')) return;
      detailKey = (card as HTMLElement).dataset.stop ?? null;
      detailTab = 'overview';
      render();
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        ke.preventDefault();
        open(e);
      }
    });
  });

  // ── 실제 도착/출발 기록 ──
  root.querySelectorAll('[data-arrive]').forEach((btn) => {
    btn.addEventListener('click', () => { void recordAction('arrive', (btn as HTMLElement).dataset.arrive!); });
  });
  root.querySelectorAll('[data-depart]').forEach((btn) => {
    btn.addEventListener('click', () => { void recordAction('depart', (btn as HTMLElement).dataset.depart!); });
  });
  root.querySelectorAll('[data-skip]').forEach((btn) => {
    btn.addEventListener('click', () => { void recordAction('skip', (btn as HTMLElement).dataset.skip!); });
  });
  root.querySelectorAll('[data-reset]').forEach((btn) => {
    btn.addEventListener('click', () => { void recordAction('reset', (btn as HTMLElement).dataset.reset!); });
  });

  // ── 상세 닫기 · 탭 ──
  root.querySelector('#mb-pd-close')?.addEventListener('click', () => {
    detailKey = null;
    render();
  });
  root.querySelectorAll('[data-pdtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      detailTab = (btn as HTMLElement).dataset.pdtab as PdTab;
      render();
    });
  });
  root.querySelector('#mb-pd-share')?.addEventListener('click', () => { void sharePlace(); });
  root.querySelector('#mb-pd-share2')?.addEventListener('click', () => { void sharePlace(); });
  root.querySelector('#mb-pd-ticket')?.addEventListener('click', () => { void openTicketForDetail(); });

  // ── AI 브리핑 ──
  root.querySelectorAll('[data-brief]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const force = (btn as HTMLElement).dataset.force === '1';
      void loadBrief(force);
    });
  });

  // ── 메모 ──
  const memo = root.querySelector('#mb-memo') as HTMLTextAreaElement | null;
  if (memo) {
    memo.addEventListener('input', () => {
      const c = root.querySelector('#mb-memo-count');
      if (c) c.textContent = memo.value.length + '/200';
    });
  }

  // ── 그 외 ──
  root.querySelector('#mb-goto-route')?.addEventListener('click', () => gotoGate('route'));
  root.querySelector('#mb-trips')?.addEventListener('click', () => navigate('trips'));
  root.querySelector('#mb-geo')?.addEventListener('click', () => toggleGeo());

  // ── TODAY 히어로 ──
  root.querySelectorAll('[data-hero-arrive]').forEach((btn) => {
    btn.addEventListener('click', () => { void recordAction('arrive', (btn as HTMLElement).dataset.heroArrive!); });
  });
  root.querySelectorAll('[data-hero-depart]').forEach((btn) => {
    btn.addEventListener('click', () => { void recordAction('depart', (btn as HTMLElement).dataset.heroDepart!); });
  });

  // ── WALLET ──
  root.querySelector('#mb-wal-add')?.addEventListener('click', () => openPad());
  root.querySelector('#mb-wal-pc')?.addEventListener('click', () => gotoGate('expense'));
  root.querySelector('#mb-wal-settle')?.addEventListener('click', () => gotoGate('expense'));

  // ── MORE ──
  root.querySelector('#mb-goto-stay')?.addEventListener('click', () => gotoGate('shortlist'));
  root.querySelector('#mb-more-links')?.addEventListener('click', () => gotoGate('links'));
  root.querySelector('#mb-more-chat')?.addEventListener('click', () => gotoGate('links'));
  root.querySelector('#mb-more-plan')?.addEventListener('click', () => gotoGate('route'));
  root.querySelector('#mb-more-expense')?.addEventListener('click', () => gotoGate('expense'));

  root.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => { void copyToClipboard((btn as HTMLElement).dataset.copy!, btn as HTMLElement); });
  });

  // ── 체크리스트 ──
  root.querySelectorAll('[data-ck-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => { void toggleChecklistItem((btn as HTMLElement).dataset.ckToggle!); });
  });
  root.querySelectorAll('[data-ck-del]').forEach((btn) => {
    btn.addEventListener('click', () => { void removeChecklist((btn as HTMLElement).dataset.ckDel!); });
  });
  root.querySelectorAll('[data-ck-add]').forEach((btn) => {
    btn.addEventListener('click', () => { void addChecklist((btn as HTMLElement).dataset.ckAdd!); });
  });
  root.querySelector('#mb-ck-open')?.addEventListener('click', () => {
    checklistAdding = true;
    checklistDraft = '';
    render();
    (container?.querySelector('#mb-ck-input') as HTMLInputElement | null)?.focus();
  });
  const ckForm = root.querySelector('#mb-ck-form') as HTMLFormElement | null;
  if (ckForm) {
    const input = ckForm.querySelector('#mb-ck-input') as HTMLInputElement | null;
    // 입력 중 realtime 재렌더로 글자가 날아가지 않게 초안을 상태에 붙들어 둔다
    input?.addEventListener('input', () => { checklistDraft = input.value; });
    ckForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = input?.value ?? '';
      checklistDraft = '';
      checklistAdding = false;
      render();
      void addChecklist(value);
    });
  }

  // ── 숫자패드 ──
  root.querySelector('#mb-pad-back')?.addEventListener('click', () => { padOpen = false; render(); });
  root.querySelector('#mb-pad-close')?.addEventListener('click', () => { padOpen = false; render(); });
  root.querySelectorAll('[data-key]').forEach((btn) => {
    btn.addEventListener('click', () => padPress((btn as HTMLElement).dataset.key!));
  });
  root.querySelectorAll('[data-cur]').forEach((btn) => {
    btn.addEventListener('click', () => {
      padCurrency = (btn as HTMLElement).dataset.cur!;
      void refreshPadRate();
    });
  });
  root.querySelectorAll('[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      padCategory = (btn as HTMLElement).dataset.cat as ExpenseCategory;
      render();
    });
  });
  root.querySelector('#mb-pad-save')?.addEventListener('click', () => { void savePadExpense(); });
  // 계산기 → 기록: 금액·통화는 그대로 두고 모드만 바꾼다(다시 칠 이유가 없다)
  root.querySelector('#mb-pad-tolog')?.addEventListener('click', () => {
    padMode = 'expense';
    padCategory = guessFromCurrentStop()?.category ?? 'ETC';
    render();
  });
  root.querySelector('#mb-wal-calc')?.addEventListener('click', () => openCalc());

  // ── 지갑: 예약 서류 ──
  root.querySelectorAll('[data-doc]').forEach((btn) => {
    btn.addEventListener('click', () => { void openDoc((btn as HTMLElement).dataset.doc!); });
  });
  root.querySelector('#mb-wd-unlock')?.addEventListener('click', () => gotoGate('docs'));
  root.querySelector('#mb-wd-add')?.addEventListener('click', () => gotoGate('docs'));

  // ── 지도 ──
  root.querySelectorAll('[data-mapgo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      detailKey = (btn as HTMLElement).dataset.mapgo!;
      detailTab = 'overview';
      render();
    });
  });
}

/**
 * 도착/출발/건너뛰기/되돌리기를 기록한다. **낙관적으로 먼저 화면에 반영하고 그다음 저장한다**
 * — 해외에서는 연결이 느리거나 끊길 수 있어서, 버튼을 눌렀는데 반응이 늦으면 "눌렸는지 안
 * 눌렸는지" 몰라 다시 누르게 된다. 저장이 실패해도 되돌리지 않는다: 다음 realtime 이벤트나
 * 재조회가 오면 서버 상태로 자연히 맞춰진다(route_stops 저장의 self-write echo 억제와
 * 같은 전제 — 쓰기는 기본적으로 성공한다고 보고, 실패는 로그만 남긴다).
 */
async function recordAction(kind: 'arrive' | 'depart' | 'skip' | 'reset', stopKey: string): Promise<void> {
  const day = activeDay();
  if (!day?.destId || !currentTripId) return;

  const nowIso = new Date().toISOString();
  const prev = progress.get(stopKey);
  const optimistic: StopProgress =
    kind === 'arrive' ? { status: 'arrived', actualArriveAt: nowIso, actualDepartAt: null }
    : kind === 'depart' ? { status: 'departed', actualArriveAt: prev?.actualArriveAt ?? nowIso, actualDepartAt: nowIso }
    : kind === 'skip' ? { status: 'skipped', actualArriveAt: null, actualDepartAt: null }
    : { status: 'pending', actualArriveAt: null, actualDepartAt: null };
  progress.set(stopKey, optimistic);
  render();

  const save = kind === 'arrive' ? markArrived : kind === 'depart' ? markDeparted : kind === 'skip' ? markSkipped : resetProgress;
  const ok = await save(currentTripId, day.destId, day.dayIndex, stopKey);
  if (!ok) console.error('[Mobile] 진행 기록 저장 실패:', kind, stopKey);
}

/**
 * "티켓 보기" — 그 DAY의 티켓 서류를 연다. 지갑과 **같은 `trip_documents`**를 보므로 같은
 * 예약이 두 군데에 따로 저장되지 않는다. 한 건이면 바로 열고, 여러 건이면 지갑으로 보낸다.
 * 없으면 **없다고 말한다** — 티켓이 있는 척하지 않는다(원칙 3-1).
 */
async function openTicketForDetail(): Promise<void> {
  const found = detailKey ? findStop(detailKey) : null;
  if (!found) return;
  const tickets = ticketsForDay(found.day.dayNumber);
  if (tickets.length === 1) { await openDoc(tickets[0].id); return; }
  if (tickets.length > 1) { detailKey = null; activeTab = 'wallet'; render(); void ensureWalletDocs(); return; }
  // 한 건도 없으면 지갑으로 보내 직접 올리게 한다(빈 화면에 안내가 떠 있다)
  detailKey = null;
  activeTab = 'wallet';
  render();
  void ensureWalletDocs();
}

async function sharePlace(): Promise<void> {
  const found = detailKey ? findStop(detailKey) : null;
  if (!found) return;
  const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(found.stop.name);
  if (navigator.share) {
    try {
      await navigator.share({ title: found.stop.name, url });
      return;
    } catch {
      /* 사용자가 취소한 경우 — 아래 클립보드 복사로 떨어지지 않고 그냥 종료 */
      return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    /* 클립보드도 막혀 있으면 조용히 넘어간다 */
  }
}

/**
 * 요약·Don't Miss·가기 전 확인사항을 **한 번의 호출로 같이** 받는다(원칙 3-2).
 * `force`면 로컬 가드와 서버 캐시를 둘 다 건너뛴다 — 안 그러면 반쪽 결과를 그대로 다시 받는다.
 */
async function loadBrief(force = false): Promise<void> {
  const found = detailKey ? findStop(detailKey) : null;
  if (!found) return;
  const req = briefRequestFor(found.stop, found.day.destName ?? tripDestName());
  const key = placeBriefKey(req);
  if (placeBriefLoading.has(key)) return;
  if (!force && placeBriefs.has(key)) return;

  placeBriefLoading.add(key);
  placeBriefErrors.delete(key);
  render();

  try {
    const brief = await requestPlaceBrief(req, force);
    placeBriefs.set(key, brief);
  } catch (e) {
    placeBriefErrors.set(key, e instanceof Error ? e.message : 'AI 요청에 실패했어요.');
  } finally {
    placeBriefLoading.delete(key);
    render();
  }
}
