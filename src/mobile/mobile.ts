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
import { subscribeRoutePlan, unsubscribeRoutePlan, resetRouteStorageProbe, loadRoutePlan, saveRouteDay } from '../route/routeStore';
import type { StoredStop } from '../route/routeStore';
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
import { attachRevisitPlaces } from './revisit';
import { isLegCoolingDown, markLegsFailed, reportRouteError } from '../utils/legCooldown';
import { offlineState, subscribeOffline, onReconnect } from '../offline/status';
import { idbGet, idbSet } from '../offline/idb';
import { savedDocPaths, saveDocOffline, loadOfflineDoc, removeOfflineDoc, type OfflineDocFile } from '../offline/docs';
import { fetchWeather, resetWeatherCache } from './weather';
import type { Weather } from './weather';
import { loadGoogleMapsScript, suggestGateFromCategory } from '../utils/googleMaps';
import { insertGooglePlace, rehostPhoto } from '../trips/addGooglePlace';
import {
  EXPLORE_CATS, CAT_SHORT, DEFAULT_FILTERS, RADIUS_OPTIONS, catDef, priceLabel, straightMeters, straightLabel, fmtMeters,
  applyFilters, sortPlaces, activeFilterCount, searchKey, movedFar,
  type ExploreCat, type ExploreFilters, type ExploreSort, type PriceLevel,
} from './explore';
import { searchNearbyCat, searchText, fetchDetail, fetchTravelTimes, toGooglePlaceResult, type ExplorePlace, type ExploreDetail } from './exploreApi';
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
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  locate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/></svg>',
  heartFill: '<svg viewBox="0 0 24 24" fill="#E2574C" stroke="#E2574C" stroke-width="1.8" stroke-linejoin="round"><path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5h3l1.5 4-2 1.3a10 10 0 0 0 6.2 6.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z"/></svg>',
  food: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 3v8m-2.5-8v4.5a2.5 2.5 0 0 0 5 0V3M7 11v10M16.5 3c-1.7 0-2.8 2.2-2.8 5s1.1 4.5 2.8 4.5V21"/></svg>',
  coffee: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM15.5 10.5h1.8a2.4 2.4 0 0 1 0 4.8h-1.8M8 3.5v2M11 3.5v2"/></svg>',
  landmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 9.5 12 4l8.5 5.5zM6 9.5v8M10 9.5v8M14 9.5v8M18 9.5v8M3.5 20h17"/></svg>',
  shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1 12H6zM9 8V6.5a3 3 0 0 1 6 0V8"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>',
  // 오프라인/저장 — 구름에 사선
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 19a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 18 9.5a4.7 4.7 0 0 1 .5 9.5z"/><path d="M4 4l16 16"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 3 8l4 4"/><path d="M3 8h13a4 4 0 0 1 0 8h-1"/><path d="m17 20 4-4-4-4"/></svg>',
};

/** 주변 탐색 카테고리 아이콘 */
const EX_ICON: Record<ExploreCat, string> = { all: IC.grid, food: IC.food, cafe: IC.coffee, sight: IC.landmark, stay: IC.bed, amenity: IC.shop };

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
 * 위치 자동 확인은 **여행 중(오늘이 여행 DAY일 때)에는 기본 켜짐**이다. 집에서 계획만 볼 때는
 * 켜지 않는다 — 쓸모 없이 권한을 묻고 배터리를 쓰기 때문이다. 사용자가 한 번 끄면 그 선택을
 * 이 기기에 기억하고 다시 자동으로 켜지 않는다(`GEO_OFF_KEY`).
 * 저정밀(`enableHighAccuracy: false`)로 구독해 배터리 부담을 줄였다.
 */
const GEO_OFF_KEY = 'mb-geo-off';
function geoPrefOff(): boolean {
  try { return localStorage.getItem(GEO_OFF_KEY) === '1'; } catch { return false; }
}
function setGeoPrefOff(off: boolean): void {
  try { if (off) localStorage.setItem(GEO_OFF_KEY, '1'); else localStorage.removeItem(GEO_OFF_KEY); } catch { /* 저장 불가면 이번 방문에만 적용 */ }
}
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
/** 이 기기에 받아 둔 서류 — id → 받을 당시 file_path (파일이 바뀌면 저장 안 된 것으로 본다) */
let savedDocs = new Map<string, string>();
/** 서류 오프라인 저장 진행 — 저장 중이면 { done, total } */
let docSaving: { done: number; total: number } | null = null;
/** 지갑 안내 한 줄(오프라인이라 못 연 서류 등) */
let walletNotice = '';
/** 앱 안 서류 보기 — 오프라인 저장본을 여는 화면 */
let docViewer: { url: string; type: string; title: string; file: OfflineDocFile } | null = null;

/* ── 오프라인 ── */
let offlineUnsubs: Array<() => void> = [];
/** 사진 미리 받기는 여행마다 한 번 */
let photosWarmedFor = '';

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
  offlineUnsubs.forEach((fn) => fn());
  offlineUnsubs = [];
  closeDocViewer();
  walletNotice = '';
  docSaving = null;
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
  datesCenteredFor = -1;
  datesScrollLeft = 0;
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

/** "10월 26일 (월)" — 상단 메타 줄 */
function dateShort(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WEEKDAY[d.getDay()] + ')';
}

/** "10월 26일 · 월요일" — 대표 사진 위 */
function dateLong(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 · ' + WEEKDAY[d.getDay()] + '요일';
}

/** "10월 26일" — 일정 제목 */
function dateMonthDay(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
}

/** 여행지 안에서 며칠째인지 — "첫째 날", "둘째 날" … 열째 뒤로는 "11일째" */
const ORDINAL_DAY = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째', '여덟째', '아홉째', '열째'];
function dayOrdinal(dayIndex: number): string {
  return dayIndex < ORDINAL_DAY.length ? ORDINAL_DAY[dayIndex] + ' 날' : dayIndex + 1 + '일째';
}

/**
 * 자정을 넘긴 시각 표시. 일정 시각은 "그 날 0시부터의 분"이라 1440 이상이면 다음 날이다.
 * `minToHHMM`은 24시간 안으로 접기만 하므로(00:54), 다음 날이라는 표시를 따로 붙인다 —
 * 안 붙이면 "21:30 – 00:54"가 거꾸로 된 범위처럼 읽힌다.
 */
function clockHtml(min: number, long = false): string {
  if (min < 1440) return escapeHtml(minToHHMM(min));
  // 좁은 시각 칸(일정 줄)에서는 아래 줄에 "다음 날"로, 한 줄짜리 범위에서는 "+1"로
  return escapeHtml(minToHHMM(min)) + (long ? '<span class="mb-nextday">다음 날</span>' : '<span class="mb-plus1" title="다음 날">+1</span>');
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
  // "숙소 들르기"는 이름·좌표만 저장된 합성 지점이라 사진·주소가 비어 있다 — 그 숙소의 실제 장소를 붙인다
  days = attachRevisitPlaces(model.days, model.ctx.placeById, model.ctx.basecampIds);
  allDestinations = model.destinations;
  activeDestId = model.activeDestId;
  staySegments = model.staySegments;
  placeById = model.ctx.placeById;

  // 지난번에 받아 둔 실측 이동시간 — 오프라인에서도 추정치 대신 지도 경로 값을 보여준다
  const savedLegs = await idbGet<Record<string, Record<string, RealLeg>>>('kv', 'legs:' + tripId);
  if (savedLegs && currentTripId === tripId) Object.entries(savedLegs).forEach(([k, v]) => { if (!realLegs.has(k)) realLegs.set(k, v); });

  // 여행 중이면 오늘 DAY로, 아니면 일정이 처음 들어 있는 DAY로 연다
  const today = todayDayIndex();
  const firstFilled = days.findIndex((d) => d.stops.length > 0);
  activeDayIndex = today >= 0 ? today : firstFilled >= 0 ? firstFilled : 0;

  render();

  subscribeRoutePlan(tripId, () => { void reloadFromRemote(); });
  subscribeStopProgress(tripId, () => { void loadProgressForActiveDay(); });
  void loadRealLegsForActiveDay();
  // 도착 자동 기록이 사람이 이미 남긴 기록을 덮어쓰지 않도록, 진행 기록을 읽은 뒤에 위치를 켠다
  void loadProgressForActiveDay().finally(autoStartGeo);
  void loadWeatherForActiveDay();
  // 요약 카드의 "예약 서류 N건"이 이 값을 쓴다 — 지갑 탭과 같은 데이터를 한 번만 받는다
  void ensureWalletDocs();

  // "지금" 표시는 분 단위로만 움직이면 충분하다
  nowTimer = setInterval(() => { if (todayDayIndex() >= 0 && !detailKey) render(); }, 60_000);

  // 오프라인 표시줄은 상태가 바뀔 때마다 다시 그리고, 다시 연결되면 서버 기준으로 다시 읽는다
  offlineUnsubs.push(subscribeOffline(() => { if (container) render(); }));
  offlineUnsubs.push(onReconnect(() => { void refreshAfterReconnect(); }));
  warmTripPhotos();
}

/** 다시 연결됐을 때(또는 대기열을 다 보냈을 때) — 지금 화면에 걸린 것만 다시 읽는다(원칙 3-2) */
async function refreshAfterReconnect(): Promise<void> {
  if (!currentTripId) return;
  await reloadFromRemote();
  void loadProgressForActiveDay();
  void loadRealLegsForActiveDay();
  void loadWeatherForActiveDay();
  if (expenseCtx) void reloadExpenses();
  if (walletDocsLoaded) { walletDocsLoaded = false; void ensureWalletDocs(); }
  if (moreLoaded) { moreLoaded = false; void ensureMoreCtx(); }
}

/**
 * 여행 사진 미리 받기 — 한 번이라도 받은 사진은 서비스워커가 저장해 두므로(sw-template.js),
 * 온라인일 때 이 여행의 장소 사진을 미리 한 번씩 받아 두면 오프라인에서도 사진이 보인다.
 * 여행마다 한 번, 최대 80장, 화면이 다 그려진 뒤 한 장씩 천천히 받는다.
 */
function warmTripPhotos(): void {
  if (photosWarmedFor === currentTripId || offlineState().offline) return;
  photosWarmedFor = currentTripId;
  // **우리 Storage에 재호스팅된 사진만** 미리 받는다. 예전에 저장된 장소는 photo_url이 Google 원본
  // (places.googleapis.com …/media)일 수 있는데, 그걸 앱을 열 때마다 80장씩 미리 받으면 요청마다
  // Places API 과금이 된다. Google 주소는 화면에 실제로 보일 때만 받는다.
  const urls = [...new Set(days.flatMap((d) => d.stops.map((st) => st.place?.photo_url).filter((u): u is string => !!u && u.includes('/storage/v1/object/public/'))))].slice(0, 80);
  let i = 0;
  const next = () => {
    if (i >= urls.length || photosWarmedFor !== currentTripId) return;
    const img = new Image();
    img.onload = img.onerror = () => setTimeout(next, 120);
    img.src = urls[i++];
  };
  setTimeout(next, 2500);
}

async function reloadFromRemote(): Promise<void> {
  if (!currentTrip) return;
  const model = await loadTripDayModel(currentTrip);
  days = attachRevisitPlaces(model.days, model.ctx.placeById, model.ctx.basecampIds);
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
    // 최근에 실패한 구간은 다시 묻지 않는다 — 안 그러면 화면을 열 때마다 같은 실패를 되풀이한다
    if (realLegs.has(key) || isLegCoolingDown(key) || pending.some((p) => p.id === key)) continue;
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
    if (!res.ok) { markLegsFailed(pending.map((p) => p.id)); return; }
    const json = await res.json();
    reportRouteError('Mobile', json);
    const results: Array<{ id: string; modes: Record<string, RealLeg> }> = json?.results ?? [];
    let got = false;
    results.forEach((r) => {
      if (r.modes && Object.keys(r.modes).length) {
        realLegs.set(r.id, r.modes);
        got = true;
      }
    });
    markLegsFailed(pending.filter((p) => !realLegs.has(p.id)).map((p) => p.id));
    if (got) {
      render();
      if (currentTripId) void idbSet('kv', 'legs:' + currentTripId, Object.fromEntries(realLegs));
    }
  } catch (e) {
    markLegsFailed(pending.map((p) => p.id));
    console.error('[Mobile] /api/route-matrix 요청 실패:', e);
  } finally {
    realLegPending = false;
  }
}

/* ══════════════ 렌더 ══════════════ */

/** 날짜 띠를 마지막으로 가운데 맞춘 DAY — 같은 날을 다시 그릴 땐 사용자가 넘겨 둔 위치를 지킨다 */
let datesCenteredFor = -1;
let datesScrollLeft = 0;

function render(): void {
  if (!container) return;
  const scrollTop = (container.querySelector('.mb-scroll') as HTMLElement | null)?.scrollTop ?? 0;
  const datesEl = container.querySelector('#mb-dates-scroll') as HTMLElement | null;
  if (datesEl) datesScrollLeft = datesEl.scrollLeft;
  // 위치 갱신·1분 타이머로 다시 그려도 입력 중이던 검색어와 커서를 잃지 않게
  const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.id === 'mb-ex-q'
    ? { value: document.activeElement.value, pos: document.activeElement.selectionStart } : null;
  const exList = container.querySelector('#mb-ex-list');
  const exScroll = (container.querySelector('.mb-exd-scroll') as HTMLElement | null)?.scrollTop ?? 0;

  container.innerHTML = '<div class="mb-app">' + appHtml() + '</div>';
  applyPhotos();
  bind();

  // 목록으로 돌아왔을 때 보던 위치를 잃지 않게(상세를 열고 닫으면 위로 튀는 걸 막음)
  const scroller = container.querySelector('.mb-scroll') as HTMLElement | null;
  if (scroller && !detailKey) scroller.scrollTop = scrollTop;
  if (typing) {
    const q = container.querySelector('#mb-ex-q') as HTMLInputElement | null;
    if (q) { q.value = typing.value; q.focus(); if (typing.pos != null) q.setSelectionRange(typing.pos, typing.pos); }
  }
  void exList;
  const exd = container.querySelector('.mb-exd-scroll') as HTMLElement | null;
  if (exd) exd.scrollTop = exScroll;

  // TIMELINE 페이저는 innerHTML을 새로 그리면 첫 페이지로 돌아간다 — 상태(activeDayIndex)가
  // 곧 페이지 위치이므로 매 렌더마다 거기로 되돌려 놓는다(애니메이션 없이: 이미 그 자리다).
  const pager = container.querySelector('#mb-tl-pager') as HTMLElement | null;
  if (pager) pager.scrollLeft = activeDayIndex * pager.clientWidth;
  centerActiveChip();
  centerActiveDate();

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
    offlineBarHtml(),
    '<main class="' + scrollCls + '">' + tabBodyHtml() + '</main>',
    tabBarHtml(),
    docViewer ? docViewerHtml() : '',
    activeTab === 'map' && exDetailId ? exDetailHtml() : '',
    activeTab === 'map' && exDraft ? exFilterHtml() : '',
    daySheetOpen ? daySheetHtml() : '',
    padOpen ? padSheetHtml() : '',
  ].join('');
}

/**
 * 오프라인 표시줄 — 지금 보이는 내용이 **언제 기준**인지, 못 보낸 기록이 몇 건인지 밝힌다.
 * 저장본을 최신인 척 보여주면 그게 곧 거짓이 된다(원칙 3-1). 온라인이고 다 보냈으면 안 뜬다.
 */
function offlineBarHtml(): string {
  const st = offlineState();
  if (!st.offline && !st.pending) return '';
  const parts: string[] = [];
  if (st.offline) {
    parts.push(st.cachedAt ? '오프라인 · ' + fmtSavedAt(st.cachedAt) + ' 기준 저장된 내용이에요' : '오프라인 · 저장된 내용을 보여주고 있어요');
  }
  if (st.pending) {
    parts.push(st.offline ? '기록 ' + st.pending + '건은 연결되면 자동으로 저장돼요' : '기록 ' + st.pending + '건 보내는 중…');
  }
  return '<div class="mb-offline' + (st.offline ? ' is-off' : '') + '" role="status">' + IC.cloud + '<span>' + escapeHtml(parts.join(' · ')) + '</span></div>';
}

/** 저장 시각 — 오늘이면 "14:05", 아니면 "10월 26일 14:05" */
function fmtSavedAt(ms: number): string {
  const d = new Date(ms);
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? hm : (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + hm;
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

  // 여행 **전체** 제목(위)과 **이 날** 머무는 도시(아래)를 다른 줄에 둔다 — "방콕·푸켓"이
  // 제목인지 오늘 위치인지 헷갈리지 않게. 날씨는 받았을 때만 붙는다(원칙 3-1).
  const dest = day?.destName ?? tripDestName();
  const date = dateShort(day?.date ?? null);
  return [
    brandRow,
    '<div class="mb-daybar"><span class="mb-screen-title">' + escapeHtml(currentTrip?.name || tripDestName()) + '</span></div>',
    '<div class="mb-daymeta">',
    dest ? '  <span class="mb-meta-item mb-meta-dest">' + IC.pin + escapeHtml(dest) + '</span>' : '',
    date ? '  <span class="mb-meta-item mb-date">' + escapeHtml(date) + '</span>' : '',
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
  return '  <span class="mb-meta-item mb-wx">' + WX_ICON[weather.icon] + escapeHtml(text) + '</span>';
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

/**
 * 대표 사진 — 이 날의 분위기를 맡는다(개별 장소 정보는 아래 일정 카드가 맡는다).
 *
 * 사진은 **이 날 정류지에 실제로 저장된 사진**만 쓴다. 공항·숙소 사진은 그 날의 얼굴로 약하니
 * 관광·액티비티 쪽을 먼저 고르고, 없으면 아무 사진이나, 그것도 없으면 사진 없는 배경으로 둔다 —
 * 관련 없는 사진을 대신 넣지 않는다(원칙 3-1).
 *
 * 제목은 "방콕 여행 첫째 날". 영문 도시명(BANGKOK)은 저장돼 있지 않아서 만들어 넣으면 지어낸
 * 값이 된다 — 한국어 표기 하나로 통일했다. "오늘은 방콕에서 보내요" 같은 문장은 이미 아는
 * 사실을 감성적으로 다시 말할 뿐이라 뺐다.
 */
function daySummaryCardHtml(day: TlDay): string {
  const dest = day.destName ?? tripDestName();
  const photoOf = (st: TlStop) => st.place?.photo_url ?? null;
  const photo =
    photoOf(day.stops.find((st) => !st.purpose && (st.cat === 'VISIT' || st.cat === 'ACTIVITY') && photoOf(st)) ?? ({} as TlStop)) ??
    day.stops.map(photoOf).find(Boolean) ??
    null;
  const docs = docCountForDay(day.dayNumber);
  const isToday = day.date === todayISO();

  const title = (dest ? dest + ' 여행 ' : '여행 ') + dayOrdinal(day.dayIndex);
  const meta = [(isToday ? '오늘 일정 ' : '일정 ') + day.stops.length + '곳'];
  if (docs > 0) meta.push('예약 서류 ' + docs + '건');
  const date = dateLong(day.date);

  return [
    '<section class="mb-sum' + (photo ? '' : ' no-photo') + '">',
    photo ? '  <div class="mb-sum-photo" data-photo="' + escapeHtml(photo) + '"></div>' : '',
    '  <div class="mb-sum-scrim"></div>',
    '  <div class="mb-sum-body">',
    '    <h2 class="mb-sum-title">' + escapeHtml(title) + '</h2>',
    date ? '    <p class="mb-sum-date">' + escapeHtml(date) + '</p>' : '',
    '    <p class="mb-sum-meta">' + IC.calendar + escapeHtml(meta.join(' · ')) + '</p>',
    '  </div>',
    '</section>',
  ].join('');
}

/**
 * 날짜 띠 — 여행 전체 날짜를 가로로 넘겨 본다(한 화면에 4칸). 선택된 날만 브랜드 블루로 채우고,
 * 일정이 있는 날엔 작은 점을 찍는다. 달력 버튼은 띠 밖 오른쪽에 고정해 언제나 닿게 둔다.
 * 선택된 칸이 보이도록 가운데로 옮기는 건 render()의 `centerActiveDate`가 한다.
 */
function dateStripHtml(): string {
  if (!days.length) return '';
  const t = todayISO();
  // 여행지가 여럿일 때만 칸 아래에 여행지 이름 — 바뀌는 날은 같은 날짜가 두 칸이라 이게 없으면
  // "29 수"가 두 번 나와 구분이 안 된다. 기준은 **여행 전체**라 칸 높이가 들썩이지 않는다.
  const multi = isMultiDest();

  const cells = days
    .map((d, idx) => {
      const active = idx === activeDayIndex;
      const dd = d.date ? new Date(d.date + 'T00:00:00') : null;
      const num = dd ? String(dd.getDate()) : String(idx + 1);
      const wd = dd ? WEEKDAY[dd.getDay()] : 'DAY';
      const label = (dd ? dateShort(d.date) : d.label) + (d.stops.length ? ', 일정 ' + d.stops.length + '곳' : ', 일정 없음');
      return (
        '<button class="mb-date-cell' + (active ? ' active' : '') + (d.date === t ? ' is-today' : '') + (multi ? ' has-dest' : '') + '" data-day="' + idx + '" aria-label="' + escapeHtml(label) + '"' + (active ? ' aria-current="date"' : '') + '>' +
        '<span class="mb-date-num">' + escapeHtml(num) + '</span>' +
        '<span class="mb-date-wd">' + escapeHtml(wd) + '</span>' +
        (multi && d.destName ? '<span class="mb-date-dest">' + escapeHtml(d.destName) + '</span>' : '') +
        '<span class="mb-date-dot' + (d.stops.length ? '' : ' is-empty') + '" aria-hidden="true"></span>' +
        '</button>'
      );
    })
    .join('');

  return [
    '<div class="mb-dates">',
    '  <div class="mb-dates-scroll" id="mb-dates-scroll">' + cells + '</div>',
    '  <button class="mb-date-cal" id="mb-daypick" aria-label="날짜 목록 열기">' + IC.calendar + '</button>',
    '</div>',
  ].join('');
}

function todayTabHtml(): string {
  const day = activeDay();
  if (!day) return emptyHtml('일정이 아직 없어요', 'PC에서 ROUTE로 동선을 먼저 만들어 주세요.');
  // 빈 날에도 날짜 띠는 남긴다 — 예전엔 빈 날을 고르면 띠까지 사라져서 다른 날로 돌아갈 길이
  // 이 화면에서 없어졌다(여행 탭으로 우회해야 했다)
  if (!day.stops.length) {
    return [
      dateStripHtml(),
      '<div class="mb-sec-head"><h3 class="mb-sec-title">' + escapeHtml((dateMonthDay(day.date) || day.label) + ' 일정') + '</h3></div>',
      '<div class="mb-day-empty">',
      '  <p class="mb-day-empty-title">이 날은 아직 일정이 없어요</p>',
      '  <p class="mb-day-empty-sub">PC의 ROUTE에서 일정을 채우면 여기에 나타나요.</p>',
      '</div>',
    ].join('');
  }

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

  // 도착/건너뛰기 버튼은 **지금 다룰 한 곳**에만 단다. 모든 줄에 같은 버튼을 반복하면
  // 장소 정보보다 버튼이 먼저 보인다. 이미 기록이 있는 줄(도착함·다녀옴·건너뜀)은 상태와
  // 되돌리기를 그대로 보여준다.
  //   · 도착한 곳이 있으면 → 그 줄의 [출발]만
  //   · 없으면 → 마지막으로 끝낸 곳 다음의 첫 '대기' 정류지에 [도착][건너뛰기]
  const status = (i: number) => progress.get(day.stops[i].key)?.status ?? 'pending';
  let focusIdx = -1;
  if (isToday && !day.stops.some((_, i) => status(i) === 'arrived')) {
    let lastDone = -1;
    day.stops.forEach((_, i) => { if (status(i) === 'departed' || status(i) === 'skipped') lastDone = i; });
    for (let i = lastDone + 1; i < day.stops.length; i++) {
      if (status(i) === 'pending') { focusIdx = i; break; }
    }
  }

  const rows: string[] = [];
  day.stops.forEach((stop, i) => {
    const showTrack = isToday && (status(i) !== 'pending' || i === focusIdx);
    rows.push(stopRowHtml(stop, i, s, day.date, i === nowIdx, showTrack, progress.get(stop.key)));
    // 구간 이동은 두 장소 **사이**에 — 앞 장소와 다음 장소를 잇는 요소다
    if (i < day.stops.length - 1) rows.push(legRowHtml(s.legs[i]));
  });

  const nowState = computeNowState(day, s);
  const title = (dateMonthDay(day.date) || day.label) + ' 일정';

  return [
    daySummaryCardHtml(day),
    dateStripHtml(),
    geoBarHtml(day),
    isToday ? driftLineHtml(day) : '',
    '<div class="mb-sec-head">',
    '  <h3 class="mb-sec-title">' + escapeHtml(title) + '</h3>',
    '  <span class="mb-sec-meta">' + clockHtml(s.spanStartMin) + ' – ' + clockHtml(s.spanEndMin) + '</span>',
    '</div>',
    '<div class="mb-thread">' + rows.join('') + '</div>',
    sourceNoteHtml(day, s),
    // 하단 "다음 일정까지" 바 — 지금 상태를 알 때만 뜬다
    nowState ? nextUpBarHtml(nowState, s) : '',
  ].join('');
}

/**
 * 숫자가 어디서 왔는지 — 이동과 체류는 출처가 달라서 따로 밝힌다(원칙 3-1).
 *   · 이동: 지도 경로(Routes API, 실시간 교통 미반영) 또는 직선거리 기반 추정
 *   · 체류: 사용자가 정한 값 / 실제 도착·출발 기록 / 장소 유형별 기본값
 * 해당하는 줄만 나온다 — 전부 실측이면 아무 말도 하지 않는다.
 */
function sourceNoteHtml(day: TlDay, s: DaySchedule): string {
  const lines: string[] = [];
  if (s.realLegCount > 0) lines.push('이동 시간·거리는 지도 경로 기준이에요. 실시간 교통은 반영하지 않아요.');
  if (s.legCount > s.realLegCount) lines.push('“약”이 붙은 이동 정보 중 일부는 직선거리로 계산한 추정치예요.');
  const defaultDwell = day.stops.some((st) => st.customDwellMin == null && progress.get(st.key)?.status !== 'departed');
  if (defaultDwell) lines.push('정하지 않은 체류 시간은 장소 유형별 기본값으로 잡았어요.');
  if (!lines.length) return '';
  return '<ul class="mb-estimate-note">' + lines.map((l) => '<li>' + escapeHtml(l) + '</li>').join('') + '</ul>';
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
    setGeoPrefOff(true); // 사용자가 끈 것 — 다음에 열어도 자동으로 켜지 않는다
    stopWatch();
    geoOn = false;
    geoFix = null;
    geoAtKey = null;
    geoError = '';
    render();
    return;
  }
  setGeoPrefOff(false);
  startGeo();
}

function startGeo(): void {
  geoError = '';
  const ok = startWatch(
    (fix) => { geoFix = fix; geoError = ''; evaluateGeo(); },
    (msg) => { geoError = msg; geoAtKey = null; render(); }
  );
  geoOn = ok && isWatching();
  render();
}

/** 여행 중이고 사용자가 끈 적이 없으면 자동으로 켠다. 진행 기록을 읽은 **뒤에** 불러야 한다. */
function autoStartGeo(): void {
  if (geoOn || geoPrefOff() || !isGeoSupported() || !currentTripId) return;
  if (todayDayIndex() < 0) return;
  startGeo();
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
/**
 * 위치 기반 체크인 — **설정**이다(실행 버튼이 아니다). 그래서 이름 + 켜짐/꺼짐 스위치로 그리고,
 * 아래 한 줄에 지금 상태를 쓴다. 일정 확인을 방해하지 않게 한 줄짜리 보조 요소로 둔다.
 */
function geoBarHtml(day: TlDay): string {
  if (!isGeoSupported()) return '';

  const atStop = geoAtKey ? day.stops.find((st) => st.key === geoAtKey) : null;
  const status = !geoOn
    ? '켜 두면 일정 장소에 도착할 때 자동으로 기록해요'
    : geoError
      ? geoError
      : atStop
        ? '지금 여기 · ' + atStop.name
        : geoFix
          ? '일정 장소 근처가 아니에요'
          : '위치 확인 중…';

  return [
    '<button class="mb-geo' + (geoOn ? ' is-on' : '') + (geoError ? ' is-err' : '') + '" id="mb-geo" role="switch" aria-checked="' + (geoOn ? 'true' : 'false') + '">',
    '  <span class="mb-geo-ic">' + IC.pin + '</span>',
    '  <span class="mb-geo-body">',
    '    <span class="mb-geo-title">위치 기반 체크인</span>',
    '    <span class="mb-geo-text">' + escapeHtml(status) + '</span>',
    '  </span>',
    '  <span class="mb-switch" aria-hidden="true"><span class="mb-switch-knob"></span></span>',
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
  // 주소 한 줄 — 저장된 원문 그대로(번역·가공하지 않는다). 길면 한 줄에서 자르고, 전체는 상세에서
  // 본다. 없으면 공항·숙소처럼 유형만, 그것도 없으면 줄을 지운다(빈 자리를 남기지 않는다).
  const sub = place?.address || (stop.cat === 'AIRPORT' || stop.cat === 'STAY' ? CAT_LABEL[stop.cat] : '');
  // "숙소 들르기"(짐 두기 등)는 일반 방문과 구분되게 목적을 한 줄로 — 주소는 상세에서 본다
  const revisit = stop.purpose ? '숙소 들르기' + (stop.purpose.trim() ? ' · ' + stop.purpose.trim() : '') : '';

  return [
    '<div class="mb-row' + (isNow ? ' is-now' : '') + (done ? ' is-done' : '') + (skipped ? ' is-skipped' : '') + '">',
    '  <div class="mb-row-time">',
    '    <span class="mb-row-clock">' + clockHtml(s.arriveMin[i], true) + '</span>',
    isNow ? '    <span class="mb-row-nowtag">지금</span>' : '',
    '  </div>',
    '  <span class="mb-row-node" aria-hidden="true"></span>',
    '  <div class="mb-row-card" data-stop="' + escapeHtml(stop.key) + '" role="button" tabindex="0">',
    photo
      ? '    <span class="mb-row-thumb" data-photo="' + escapeHtml(photo) + '"></span>'
      : '    <span class="mb-row-thumb is-blank">' + (stop.purpose || stop.cat === 'STAY' ? IC.bed : IC.pin) + '</span>',
    '    <div class="mb-row-main">',
    '      <div class="mb-row-name">' + escapeHtml(stop.name) + '</div>',
    revisit ? '      <div class="mb-row-revisit">' + IC.bed + escapeHtml(revisit) + '</div>' : sub ? '      <div class="mb-row-sub">' + escapeHtml(sub) + '</div>' : '',
    warn ? '      <div class="mb-row-warn">' + escapeHtml(hoursWarnText(warn)) + '</div>' : '',
    '    </div>',
    '    <div class="mb-row-acts">',
    '      <a class="mb-row-nav" href="' + directionsHref(stop) + '" target="_blank" rel="noopener" data-nav="' + escapeHtml(stop.key) + '">' + IC.navigate + ' 길찾기</a>',
    '      <span class="mb-row-detail">상세' + IC.chevRight + '</span>',
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
  // "택시 · 약 21분 · 8.5km". 지도 경로 값도 실시간 교통을 반영하지 않으므로 "약"을 붙인다 —
  // 어디서 온 숫자인지는 일정 아래 출처 줄이 밝힌다(sourceNoteHtml)
  return [
    '<div class="mb-leglite' + (leg.real ? ' is-real' : '') + '">',
    '  <span class="mb-leglite-ic ' + cls + '">' + MODE_ICON[leg.mode] + '</span>',
    '  <span class="mb-leglite-mode">' + escapeHtml(modeLabel(leg.mode)) + '</span>',
    '  <span class="mb-leglite-val">약 ' + escapeHtml(fmtMin(leg.min)) + ' · ' + escapeHtml(fmtKm(leg.km)) + '</span>',
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
/**
 * 날짜 띠 위치. 고른 날이 바뀌었을 때만 그 칸을 가운데로 옮기고, 그 외의 다시 그리기
 * (1분 타이머·위치 갱신 등)에서는 사용자가 넘겨 둔 위치를 그대로 둔다 — 안 그러면 띠를 넘겨
 * 보는 도중에 계속 제자리로 튕긴다.
 */
function centerActiveDate(): void {
  const strip = container?.querySelector('#mb-dates-scroll') as HTMLElement | null;
  if (!strip) return;
  if (datesCenteredFor !== activeDayIndex) {
    const cell = strip.querySelector('.mb-date-cell.active') as HTMLElement | null;
    if (cell) strip.scrollLeft = cell.offsetLeft - (strip.clientWidth - cell.offsetWidth) / 2;
    datesCenteredFor = activeDayIndex;
  } else {
    strip.scrollLeft = datesScrollLeft;
  }
}

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
 * 두 가지 보기가 같은 지도를 쓴다.
 *   · 일정 — 활성 DAY의 정류지를 찍어 "오늘 동선이 대충 어떻게 생겼나"를 본다(예전 그대로).
 *   · 주변 탐색 — 현재 위치(없으면 일정 장소) 주변의 맛집·카페·관광지·숙소·편의시설을
 *     Google Places로 찾아 지도와 목록에 띄운다. 상세에서 저장·일정 추가·예약 페이지로 이어진다.
 *
 * 지도 노드는 **한 번 만들고 다시 쓴다.** 이 화면은 상태가 바뀔 때마다 innerHTML을 통째로 다시
 * 그리는데, 예전엔 그때마다 지도를 새로 만들었다(1분 타이머·위치 갱신마다 Maps 로드 = 비용).
 * 이제 지도 div를 따로 들고 있다가 다시 그린 자리(#mb-map)에 옮겨 붙인다.
 *
 * Maps JS는 **이 탭을 처음 열 때만** 받는다(원칙 3-2).
 */

let mapEl: HTMLElement | null = null;
let mapInstance: any = null;
let mapMarkers: Array<{ setMap: (m: unknown) => void }> = [];
let mapLoading = false;
let mapError = '';
/** 지금 지도에 찍힌 마커가 무엇인지 — 같으면 마커를 다시 만들지 않는다 */
let markerSig = '';
let userDot: any = null;
let exMarkerById = new Map<string, any>();

/* ── 주변 탐색 상태 ── */
type MapView = 'plan' | 'explore';
let mapView: MapView = 'plan';
let exCat: ExploreCat = 'food';
/** 검색어 검색 중이면 그 검색어(카테고리 대신) */
let exQuery = '';
let exResults: ExplorePlace[] = [];
let exLoading = false;
let exError = '';
let exSearchedAt: { lat: number; lng: number } | null = null;
let exCenterLabel = '';
let exMoved = false;
let exSelected: string | null = null;
let exFilters: ExploreFilters = { ...DEFAULT_FILTERS };
let exDraft: ExploreFilters | null = null;
let exSort: ExploreSort = 'relevance';
let exDetailId: string | null = null;
let exDetail: ExploreDetail | null = null;
let exDetailState: 'idle' | 'loading' | 'error' = 'idle';
let exTravel: { walk: { meters: number; seconds: number } | null; drive: { meters: number; seconds: number } | null } | null = null;
let exTravelState: 'idle' | 'loading' | 'error' = 'idle';
let exDayPicker = false;
let exNotice = '';
let exSaving = false;
/** 이번에 일정에 추가한 DAY — "DAY 2에 추가됨" 표시용(장소 id → DAY 번호들) */
const exAddedDays = new Map<string, number[]>();

/** 현재 위치 — GPS 자동 체크인이 켜져 있으면 그 값을 같이 쓴다 */
let userLoc: { lat: number; lng: number } | null = null;
let userLocState: 'idle' | 'asking' | 'ok' | 'denied' | 'unavailable' = 'idle';

function currentUserLoc(): { lat: number; lng: number } | null {
  if (geoFix) return { lat: geoFix.lat, lng: geoFix.lng };
  return userLoc;
}

/** 위치를 한 번 묻는다(사용자가 탐색을 고르거나 내 위치 버튼을 눌렀을 때만) */
function requestUserLoc(): Promise<{ lat: number; lng: number } | null> {
  const known = currentUserLoc();
  if (known) return Promise.resolve(known);
  if (!isGeoSupported()) { userLocState = 'unavailable'; return Promise.resolve(null); }
  userLocState = 'asking';
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        userLocState = 'ok';
        resolve(userLoc);
      },
      (err) => {
        userLocState = err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable';
        resolve(null);
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 12_000 }
    );
  });
}

/** 위치를 못 쓸 때 기준점 — 활성 DAY의 첫 정류지, 없으면 여행 아무 정류지 */
function fallbackCenter(): { lat: number; lng: number } | null {
  const pick = (d: TlDay | null | undefined) => d?.stops.find((s) => s.lat != null && s.lng != null);
  const st = pick(activeDay()) ?? days.map(pick).find(Boolean);
  return st ? { lat: st.lat!, lng: st.lng! } : null;
}

/** 거리 기준점 — 현재 위치가 있으면 그것, 없으면 검색한 자리 */
function distanceOrigin(): { lat: number; lng: number } | null {
  return currentUserLoc() ?? exSearchedAt;
}

function withMeters(list: ExplorePlace[]): ExplorePlace[] {
  const o = distanceOrigin();
  return list.map((p) => ({ ...p, meters: o ? straightMeters(o, p) : null }));
}

function visibleResults(): ExplorePlace[] {
  return sortPlaces(applyFilters(withMeters(exResults), exFilters), exSort);
}

/**
 * 검색 — 칩·검색어·"이 지역에서 다시 검색"을 눌렀을 때만 부른다(지도를 움직였다고 부르지 않는다).
 * `where`가 없으면 현재 위치 → 실패하면 일정 장소 기준으로 찾는다.
 */
async function runExploreSearch(where?: { lat: number; lng: number }, label?: string): Promise<void> {
  exLoading = true;
  exError = '';
  exNotice = '';
  render();

  let center = where ?? null;
  let centerLabel = label ?? '';
  if (!center) {
    const loc = await requestUserLoc();
    if (loc) { center = loc; centerLabel = '현재 위치'; }
    else {
      center = fallbackCenter();
      centerLabel = '일정 장소';
      exNotice = userLocState === 'denied'
        ? '현재 위치를 사용할 수 없어요 — 위치 권한이 꺼져 있어 일정 장소 기준으로 찾았어요.'
        : '현재 위치를 확인하지 못해 일정 장소 기준으로 찾았어요.';
    }
  }
  if (!center) {
    exLoading = false;
    exError = '찾을 기준 위치가 없어요. 위치 권한을 켜거나, 일정에 장소를 먼저 넣어 주세요.';
    render();
    return;
  }

  const radius = exFilters.radius;
  try {
    const key = exQuery ? searchKey('text', exQuery, center, radius) : searchKey('cat', exCat, center, radius);
    exResults = exQuery ? await searchText(key, exQuery, center, radius) : await searchNearbyCat(key, exCat, center, radius);
    exSearchedAt = center;
    exCenterLabel = centerLabel;
    exMoved = false;
    exSelected = null;
    markerSig = '';
  } catch (e) {
    console.error('[Explore] 검색 실패:', e);
    exError = offlineState().offline ? '오프라인이라 주변 장소를 찾을 수 없어요.' : '주변 장소를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  } finally {
    exLoading = false;
    render();
    fitExploreBounds(center);
  }
}

function fitExploreBounds(center: { lat: number; lng: number } | null): void {
  const g = (window as unknown as { google?: any }).google;
  if (!g?.maps || !mapInstance || mapView !== 'explore') return;
  const list = visibleResults();
  if (!list.length) { if (center) mapInstance.panTo(center); return; }
  const b = new g.maps.LatLngBounds();
  list.forEach((p) => b.extend({ lat: p.lat, lng: p.lng }));
  const me = currentUserLoc();
  if (me) b.extend(me);
  mapInstance.fitBounds(b, 40);
}

/* ── 화면 ── */

function mapTabHtml(): string {
  return [
    '<div class="mb-map-wrap">',
    mapChipsHtml(),
    mapView === 'plan' ? planMapHtml() : exploreHtml(),
    '</div>',
  ].join('');
}

/** 보기 고르기 — 일정 | 맛집 | 카페 | 관광지 | 숙소 | 편의시설 | 전체 (가로 스크롤) */
function mapChipsHtml(): string {
  const chip = (key: string, label: string, icon: string, active: boolean) =>
    '<button class="mb-ex-chip' + (active ? ' active' : '') + '" data-mapview="' + key + '">' + icon + '<span>' + label + '</span></button>';
  return [
    '<div class="mb-ex-chips" role="tablist">',
    chip('plan', '일정', IC.route, mapView === 'plan'),
    EXPLORE_CATS.map((c) => chip(c.key, c.label, EX_ICON[c.key], mapView === 'explore' && !exQuery && exCat === c.key)).join(''),
    '</div>',
  ].join('');
}

function mapBoxHtml(extra = ''): string {
  return mapError
    ? '<div class="mb-map-err">' + escapeHtml(mapError) + '</div>'
    : '<div class="mb-map-box"><div class="mb-map" id="mb-map">' + (mapLoading && !mapInstance ? '<span class="mb-spinner"></span>' : '') + '</div>' + extra + '</div>';
}

/** 일정 보기 — 예전 지도 탭 그대로(활성 DAY 핀 + 목록) */
function planMapHtml(): string {
  const day = activeDay();
  const pins = (day?.stops ?? []).filter((s) => s.lat != null && s.lng != null);
  if (!day || !day.stops.length) {
    return '<div class="mb-day-empty"><p class="mb-day-empty-title">이 날은 일정이 없어요</p><p class="mb-day-empty-sub">위의 맛집·카페로 주변을 찾아보거나, PC에서 일정을 채워 주세요.</p></div>';
  }
  if (!pins.length) {
    return '<div class="mb-day-empty"><p class="mb-day-empty-title">지도에 찍을 좌표가 없어요</p><p class="mb-day-empty-sub">정류지에 좌표가 저장되어 있어야 지도에 표시할 수 있어요.</p></div>';
  }
  return [
    '  <div class="mb-map-head">',
    '    <span class="mb-map-day">' + escapeHtml(day.label) + '</span>',
    '    <span class="mb-map-count">' + pins.length + '곳</span>',
    '  </div>',
    mapBoxHtml(),
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
  ].join('');
}

/** 주변 탐색 보기 — 지도(검색창·다시 검색·내 위치) + 기준 줄 + 장소 카드 */
function exploreHtml(): string {
  const list = visibleResults();
  const nFilter = activeFilterCount(exFilters);
  const overlay = [
    '<form class="mb-ex-search" id="mb-ex-form" role="search">',
    '  <span class="mb-ex-search-ic">' + IC.search + '</span>',
    '  <input id="mb-ex-q" type="search" enterkeyhint="search" autocomplete="off" placeholder="' + (exCenterLabel === '현재 위치' || !exCenterLabel ? '현재 위치에서 검색하기' : '이 근처에서 검색하기') + '" value="' + escapeHtml(exQuery) + '" />',
    exQuery ? '  <button type="button" class="mb-ex-clear" id="mb-ex-clear" aria-label="검색어 지우기">' + IC.close + '</button>' : '',
    '</form>',
    '<button class="mb-ex-filter-btn' + (nFilter ? ' on' : '') + '" id="mb-ex-filter" aria-label="필터">' + IC.sliders + (nFilter ? '<b>' + nFilter + '</b>' : '<span>필터</span>') + '</button>',
    exMoved && !exLoading ? '<button class="mb-ex-again" id="mb-ex-again">' + IC.refresh + '이 지역에서 다시 검색</button>' : '',
    '<button class="mb-ex-me" id="mb-ex-me" aria-label="내 위치로">' + IC.locate + '</button>',
  ].join('');

  const status = exLoading
    ? '<span class="mb-spinner"></span>찾는 중…'
    : exSearchedAt
      ? escapeHtml(exCenterLabel) + ' 기준 · ' + (exQuery ? '"' + escapeHtml(exQuery) + '" ' : escapeHtml(catDef(exCat).label) + ' ') + list.length + '곳' + (list.length !== exResults.length ? ' (필터 ' + (exResults.length - list.length) + '곳 숨김)' : '')
      : '';

  return [
    mapBoxHtml(overlay),
    exNotice ? '<p class="mb-ex-notice">' + escapeHtml(exNotice) + '</p>' : '',
    '<div class="mb-ex-bar">',
    '  <span class="mb-ex-status">' + status + '</span>',
    exResults.length ? '  <div class="mb-ex-sort">' + (['relevance', 'distance', 'rating'] as ExploreSort[]).map((k) => '<button class="mb-ex-sortbtn' + (exSort === k ? ' active' : '') + '" data-exsort="' + k + '">' + ({ relevance: '추천순', distance: '거리순', rating: '평점순' } as const)[k] + '</button>').join('') + '</div>' : '',
    '</div>',
    exError ? '<div class="mb-map-err">' + escapeHtml(exError) + '</div>' : '',
    !exLoading && exSearchedAt && !exError && !list.length
      ? '<div class="mb-day-empty"><p class="mb-day-empty-title">' + (exResults.length ? '필터에 맞는 곳이 없어요' : '주변에서 찾지 못했어요') + '</p><p class="mb-day-empty-sub">' + (exResults.length ? '필터를 줄여 보세요.' : '반경을 넓히거나 다른 검색어로 찾아보세요.') + '</p></div>'
      : '',
    '<div class="mb-ex-list" id="mb-ex-list">' + list.map(exCardHtml).join('') + '</div>',
    list.length ? '<p class="mb-ex-src">장소 정보 · 사진: Google. 거리는 직선거리예요 — 실제 도보·차량 시간은 상세에서 확인할 수 있어요.</p>' : '',
  ].join('');
}

function isSavedPlace(googleId: string): boolean {
  for (const p of placeById.values()) if (p.google_place_id === googleId) return true;
  return false;
}

function exCardHtml(p: ExplorePlace): string {
  const meta: string[] = [];
  if (p.typeLabel) meta.push(escapeHtml(p.typeLabel));
  if (p.meters != null) meta.push(escapeHtml(straightLabel(p.meters)));
  const meta2: string[] = [];
  const price = priceLabel(p.priceLevel);
  if (price) meta2.push('가격대 ' + escapeHtml(price));
  if (p.openNow === true) meta2.push('<span class="mb-ex-open">영업 중</span>');
  else if (p.openNow === false) meta2.push('<span class="mb-ex-closed">영업 종료</span>');
  if (p.todayHours) meta2.push(escapeHtml(p.todayHours));
  return [
    '<button class="mb-ex-card' + (exSelected === p.id ? ' is-selected' : '') + '" data-explace="' + escapeHtml(p.id) + '">',
    p.photo
      ? '  <span class="mb-ex-thumb" data-photo="' + escapeHtml(p.photo) + '"></span>'
      : '  <span class="mb-ex-thumb is-blank">' + EX_ICON[p.cat] + '</span>',
    '  <span class="mb-ex-main">',
    '    <span class="mb-ex-name-row"><span class="mb-ex-name">' + escapeHtml(p.name) + '</span><span class="mb-ex-tag cat-' + p.cat + '">' + CAT_SHORT[p.cat] + '</span></span>',
    p.rating != null
      ? '    <span class="mb-ex-rating">' + IC.star + '<b>' + p.rating.toFixed(1) + '</b>' + (p.ratingCount != null ? '<span>(' + p.ratingCount.toLocaleString('ko-KR') + ')</span>' : '') + '</span>'
      : '',
    meta.length ? '    <span class="mb-ex-meta">' + meta.join(' · ') + '</span>' : '',
    meta2.length ? '    <span class="mb-ex-meta">' + meta2.join(' · ') + '</span>' : '',
    p.reservable === true ? '    <span class="mb-ex-resv">' + IC.calendar + '예약 가능 (Google 정보)</span>' : '',
    '  </span>',
    isSavedPlace(p.id) ? '  <span class="mb-ex-saved" aria-label="저장됨">' + IC.heartFill + '</span>' : '',
    '</button>',
  ].join('');
}

/* ── 상세 시트 ── */

function exPlaceById(id: string | null): ExplorePlace | null {
  if (!id) return null;
  return withMeters(exResults).find((p) => p.id === id) ?? null;
}

function fmtTravel(t: { meters: number; seconds: number }): string {
  return '약 ' + fmtMin(Math.max(1, Math.round(t.seconds / 60))) + ' · ' + fmtMeters(t.meters);
}

function exDetailHtml(): string {
  const p = exPlaceById(exDetailId);
  if (!p) return '';
  const d = exDetail;
  const photos = d?.photos.length ? d.photos : p.photo ? [{ url: p.photo, by: p.photoBy }] : [];
  const saved = isSavedPlace(p.id);
  const phone = d?.phoneIntl ?? d?.phone ?? null;
  const resvLink = d?.website ?? d?.mapsUrl ?? null;
  const reservable = (d?.reservable ?? p.reservable) === true;
  const price = priceLabel(p.priceLevel);
  const hours = d?.weekdayHours ?? p.weekdayHours;
  const added = exAddedDays.get(p.id) ?? [];

  const travel = exTravelState === 'loading'
    ? '<span class="mb-spinner"></span>실제 경로 시간 확인 중…'
    : exTravel && (exTravel.walk || exTravel.drive)
      ? [exTravel.walk ? '도보 ' + fmtTravel(exTravel.walk) : '', exTravel.drive ? '차량 ' + fmtTravel(exTravel.drive) : ''].filter(Boolean).join('  ·  ')
      : p.meters != null ? straightLabel(p.meters) + ' (경로 시간은 확인하지 못했어요)' : '';

  return [
    '<div class="mb-sheet-back" id="mb-exd-back"></div>',
    '<section class="mb-exd" role="dialog" aria-modal="true" aria-label="' + escapeHtml(p.name) + '">',
    '  <div class="mb-sheet-grip"></div>',
    '  <header class="mb-exd-nav">',
    '    <button class="mb-icon-btn" id="mb-exd-close" aria-label="닫기">' + IC.close + '</button>',
    '    <span class="mb-exd-navgap"></span>',
    '    <button class="mb-icon-btn' + (saved ? ' is-on' : '') + '" id="mb-exd-save" aria-pressed="' + saved + '" aria-label="' + (saved ? '저장됨' : '저장') + '">' + (saved ? IC.heartFill : IC.heart) + '</button>',
    '    <button class="mb-icon-btn" id="mb-exd-share" aria-label="공유">' + IC.share + '</button>',
    '  </header>',
    '  <div class="mb-exd-scroll">',
    photos.length
      ? '    <div class="mb-exd-photos" id="mb-exd-photos">' + photos.map((ph, i) =>
          '<figure class="mb-exd-photo" data-photo="' + escapeHtml(ph.url) + '">' +
          '<span class="mb-exd-count">' + (i + 1) + ' / ' + photos.length + '</span>' +
          (ph.by ? '<figcaption>사진: ' + escapeHtml(ph.by) + '</figcaption>' : '') +
          '</figure>').join('') + '</div>'
      : '',
    '    <div class="mb-exd-body">',
    '      <div class="mb-exd-title-row"><h2 class="mb-exd-title">' + escapeHtml(p.name) + '</h2><span class="mb-ex-tag cat-' + p.cat + '">' + CAT_SHORT[p.cat] + '</span></div>',
    p.rating != null || p.typeLabel
      ? '      <p class="mb-exd-line">' + (p.rating != null ? '<span class="mb-ex-rating">' + IC.star + '<b>' + p.rating.toFixed(1) + '</b>' + (p.ratingCount != null ? '<span>(' + p.ratingCount.toLocaleString('ko-KR') + '개 리뷰)</span>' : '') + '</span>' : '') + (p.typeLabel ? '<span class="mb-exd-dot">·</span>' + escapeHtml(p.typeLabel) : '') + '</p>'
      : '',
    price || p.openNow != null || p.todayHours
      ? '      <p class="mb-exd-line">' + [price ? '가격대 ' + escapeHtml(price) : '', p.openNow === true ? '<span class="mb-ex-open">영업 중</span>' : p.openNow === false ? '<span class="mb-ex-closed">영업 종료</span>' : '', p.todayHours ? '오늘 ' + escapeHtml(p.todayHours) : ''].filter(Boolean).join('<span class="mb-exd-dot">·</span>') + '</p>'
      : '',
    travel ? '      <p class="mb-exd-line mb-exd-travel">' + IC.walk + '<span>' + travel + '</span></p>' : '',
    p.address ? '      <p class="mb-exd-line mb-exd-addr">' + IC.pin + '<span>' + escapeHtml(p.address) + '</span></p>' : '',
    '      <div class="mb-exd-actions">',
    phone ? '        <a class="mb-exd-act" href="tel:' + escapeHtml(phone.replace(/[^+\d]/g, '')) + '">' + IC.phone + '<span>전화</span></a>' : '',
    '        <a class="mb-exd-act" href="' + escapeHtml(d?.mapsUrl ?? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.name) + '&query_place_id=' + encodeURIComponent(p.id)) + '" target="_blank" rel="noopener">' + IC.map + '<span>Google 지도</span></a>',
    '        <a class="mb-exd-act" href="https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(p.lat + ',' + p.lng) + '&destination_place_id=' + encodeURIComponent(p.id) + '" target="_blank" rel="noopener">' + IC.navigate + '<span>길찾기</span></a>',
    d?.website ? '        <a class="mb-exd-act" href="' + escapeHtml(d.website) + '" target="_blank" rel="noopener">' + IC.ext + '<span>웹사이트</span></a>' : '',
    '      </div>',
    exNotice ? '      <p class="mb-ex-notice">' + escapeHtml(exNotice) + '</p>' : '',
    // 예약 — Google은 "예약을 받는 곳인지"만 알려준다. 예약 가능 시간은 없으니 만들지 않는다.
    reservable
      ? [
          '      <div class="mb-exd-resv">',
          '        <div class="mb-exd-resv-head">' + IC.calendar + '<b>예약을 받는 곳이에요</b></div>',
          '        <p>Google 정보 기준이에요. 예약 가능한 시간은 예약 페이지에서 확인해 주세요.</p>',
          '        <div class="mb-exd-resv-acts">',
          resvLink ? '          <a class="mb-exd-resv-btn" href="' + escapeHtml(resvLink) + '" target="_blank" rel="noopener">예약 페이지 열기</a>' : '',
          phone ? '          <a class="mb-exd-resv-ghost" href="tel:' + escapeHtml(phone.replace(/[^+\d]/g, '')) + '">전화로 예약</a>' : '',
          '        </div>',
          '      </div>',
        ].join('')
      : '',
    exDetailState === 'loading' ? '      <p class="mb-exd-loading"><span class="mb-spinner"></span>상세 정보 불러오는 중…</p>' : '',
    exDetailState === 'error' ? '      <p class="mb-ex-notice">상세 정보를 불러오지 못했어요. 기본 정보만 보여드려요.</p>' : '',
    d?.summary ? '      <section class="mb-exd-sec"><h3>장소 소개 <small>Google</small></h3><p class="mb-exd-text">' + escapeHtml(d.summary) + '</p></section>' : '',
    hours && hours.length
      ? '      <section class="mb-exd-sec"><h3>영업시간</h3><ul class="mb-exd-hours">' + hours.map((h) => '<li>' + escapeHtml(h) + '</li>').join('') + '</ul></section>'
      : '',
    d?.reviews.length
      ? '      <section class="mb-exd-sec"><h3>리뷰 <small>Google · ' + (p.ratingCount != null ? p.ratingCount.toLocaleString('ko-KR') + '개 중 ' : '') + d.reviews.length + '개</small></h3>' +
        d.reviews.map((r) =>
          '<article class="mb-exd-review"><div class="mb-exd-review-head">' +
          (r.authorUrl ? '<a href="' + escapeHtml(r.authorUrl) + '" target="_blank" rel="noopener">' + escapeHtml(r.author) + '</a>' : '<b>' + escapeHtml(r.author) + '</b>') +
          (r.rating != null ? '<span class="mb-exd-stars" aria-label="' + r.rating + '점">' + '★'.repeat(Math.round(r.rating)) + '<i>' + '★'.repeat(5 - Math.round(r.rating)) + '</i></span>' : '') +
          (r.when ? '<span class="mb-exd-when">' + escapeHtml(r.when) + '</span>' : '') +
          '</div><p class="mb-exd-text">' + escapeHtml(r.text) + '</p></article>'
        ).join('') + '</section>'
      : '',
    '    </div>',
    '  </div>',
    '  <footer class="mb-exd-cta">',
    '    <button class="mb-exd-add" id="mb-exd-add"' + (exSaving ? ' disabled' : '') + '>' + IC.plus + (added.length ? 'DAY ' + added.join(', ') + '에 추가됨 · 다른 날에도' : '여행 일정에 추가') + '</button>',
    reservable && resvLink ? '    <a class="mb-exd-cta-resv" href="' + escapeHtml(resvLink) + '" target="_blank" rel="noopener" aria-label="예약 페이지 열기">' + IC.calendar + '</a>' : '',
    '  </footer>',
    '</section>',
    exDayPicker ? exDayPickerHtml(p) : '',
  ].join('');
}

/** 일정에 추가 — 기존 DAY 목록(여행지별)에서 고른다 */
function exDayPickerHtml(p: ExplorePlace): string {
  const added = exAddedDays.get(p.id) ?? [];
  return [
    '<div class="mb-sheet-back mb-exd-pick-back" id="mb-exd-pick-back"></div>',
    '<div class="mb-sheet mb-exd-pick" role="dialog" aria-label="일정에 추가">',
    '  <div class="mb-sheet-grip"></div>',
    '  <div class="mb-sheet-title">어느 날에 넣을까요 · ' + escapeHtml(p.name) + '</div>',
    '  <div class="mb-sheet-list">',
    days
      .map((d, i) =>
        (isMultiDest() && (i === 0 || days[i - 1].destId !== d.destId) && d.destName ? '<div class="mb-sheet-dest">' + escapeHtml(d.destName) + '</div>' : '') +
        '<button class="mb-sheet-item' + (added.includes(d.dayNumber) ? ' active' : '') + '" data-exaddday="' + i + '"' + (!d.destId || exSaving ? ' disabled' : '') + '>' +
        '<span class="mb-sheet-day">' + escapeHtml(d.label) + '</span>' +
        '<span class="mb-sheet-date">' + escapeHtml(dateLabel(d.date)) + '</span>' +
        '<span class="mb-sheet-count">' + (added.includes(d.dayNumber) ? '추가됨' : d.stops.length ? d.stops.length + '곳 · 맨 뒤에' : '첫 일정으로') + '</span>' +
        '</button>'
      )
      .join(''),
    '  </div>',
    '</div>',
  ].join('');
}

/** 필터 시트 — 거리(반경)는 새로 검색, 나머지는 받은 결과 안에서 거른다 */
function exFilterHtml(): string {
  const f = exDraft ?? exFilters;
  const seg = (name: string, opts: Array<[string, string]>, cur: string) =>
    '<div class="mb-exf-seg">' + opts.map(([v, l]) => '<button class="mb-exf-opt' + (v === cur ? ' active' : '') + '" data-exf="' + name + '" data-v="' + v + '">' + l + '</button>').join('') + '</div>';
  const prices: Array<[PriceLevel, string]> = [['INEXPENSIVE', '저렴'], ['MODERATE', '보통'], ['EXPENSIVE', '비쌈'], ['VERY_EXPENSIVE', '매우 비쌈']];
  return [
    '<div class="mb-sheet-back" id="mb-exf-back"></div>',
    '<div class="mb-sheet mb-exf" role="dialog" aria-label="필터">',
    '  <div class="mb-sheet-grip"></div>',
    '  <div class="mb-sheet-title">필터</div>',
    '  <div class="mb-exf-body">',
    '    <h4>거리 (검색 반경)</h4>',
    seg('radius', RADIUS_OPTIONS.map((r) => [String(r), fmtMeters(r)]), String(f.radius)),
    '    <h4>평점</h4>',
    seg('minRating', [['0', '전체'], ['4', '4.0 이상'], ['4.5', '4.5 이상']], String(f.minRating)),
    '    <h4>가격대 <small>Google 등급</small></h4>',
    '<div class="mb-exf-seg">' + prices.map(([v, l]) => '<button class="mb-exf-opt' + (f.prices.includes(v) ? ' active' : '') + '" data-exf="price" data-v="' + v + '">' + l + '</button>').join('') + '</div>',
    '    <h4>그 밖에</h4>',
    '<div class="mb-exf-seg">',
    '<button class="mb-exf-opt' + (f.openNow ? ' active' : '') + '" data-exf="openNow" data-v="1">지금 영업 중</button>',
    '<button class="mb-exf-opt' + (f.reservable ? ' active' : '') + '" data-exf="reservable" data-v="1">예약 받는 곳</button>',
    '</div>',
    '    <p class="mb-exf-note">영업 여부·가격대·예약 정보가 없는 곳은 그 조건을 켜면 목록에서 빠져요.</p>',
    '  </div>',
    '  <div class="mb-exf-foot">',
    '    <button class="mb-ghost-btn" id="mb-exf-reset">초기화</button>',
    '    <button class="mb-exf-apply" id="mb-exf-apply">적용</button>',
    '  </div>',
    '</div>',
  ].join('');
}

/* ── 상세 열기·저장·일정 추가 ── */

function openExDetail(id: string): void {
  exDetailId = id;
  exSelected = id;
  exDetail = null;
  exDetailState = 'loading';
  exTravel = null;
  exTravelState = 'idle';
  exNotice = '';
  exDayPicker = false;
  render();
  focusExMarker(id);
  void fetchDetail(id)
    .then((d) => { if (exDetailId === id) { exDetail = d; exDetailState = 'idle'; render(); } })
    .catch((e) => { console.error('[Explore] 상세 실패:', e); if (exDetailId === id) { exDetailState = 'error'; render(); } });
  const p = exPlaceById(id);
  const from = distanceOrigin();
  if (p && from) {
    exTravelState = 'loading';
    void fetchTravelTimes(p.id, from, p)
      .then((t) => { if (exDetailId === id) { exTravel = t; exTravelState = 'idle'; render(); } })
      .catch(() => { if (exDetailId === id) { exTravelState = 'error'; render(); } });
  }
}

function closeExDetail(): void {
  exDetailId = null;
  exDetail = null;
  exDayPicker = false;
  exNotice = '';
  render();
}

/** 저장 = 이 여행의 장소 목록(places, 아이디어 보드와 같은 곳)에 담기. 기존 저장 경로를 그대로 쓴다 */
async function ensureExSaved(p: ExplorePlace, destinationId: string | null): Promise<Place | null> {
  for (const pl of placeById.values()) if (pl.google_place_id === p.id) return pl;
  if (!currentTripId) return null;
  const g = toGooglePlaceResult(p);
  const photoUrl = g.photoUrl ? await rehostPhoto(g.photoUrl, p.id) : null;
  const res = await insertGooglePlace(currentTripId, destinationId ?? activeDay()?.destId ?? undefined, suggestGateFromCategory(g.category) ?? '가고싶어', { ...g, photoUrl }, 'mobile_explore');
  if (!res) return null;
  placeById.set(res.place.id, res.place);
  return res.place;
}

async function toggleExSave(): Promise<void> {
  const p = exPlaceById(exDetailId);
  if (!p || exSaving) return;
  const existing = [...placeById.values()].find((pl) => pl.google_place_id === p.id);
  exSaving = true;
  exNotice = '';
  render();
  try {
    if (!existing) {
      const saved = await ensureExSaved(p, null);
      exNotice = saved ? '이 여행의 장소 목록에 저장했어요 (PC 아이디어 보드에서도 보여요).' : '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    } else if (days.some((d) => d.stops.some((s) => s.placeId === existing.id))) {
      exNotice = '일정에 들어 있는 장소라 저장을 풀 수 없어요. 일정에서 먼저 빼 주세요.';
    } else {
      const { error } = await supabase.from('places').delete().eq('id', existing.id);
      if (error) exNotice = '저장을 풀지 못했어요.';
      else placeById.delete(existing.id);
    }
  } finally {
    exSaving = false;
    render();
  }
}

/** 일정에 추가 — 기존 ROUTE 저장 경로(loadRoutePlan → saveRouteDay)로 그 DAY 맨 뒤에 넣는다 */
async function addExToDay(dayIdx: number): Promise<void> {
  const p = exPlaceById(exDetailId);
  const day = days[dayIdx];
  if (!p || !day?.destId || !currentTripId || exSaving) return;
  exSaving = true;
  exNotice = '';
  render();
  try {
    const place = await ensureExSaved(p, day.destId);
    if (!place) { exNotice = '일정에 넣지 못했어요(장소 저장 실패).'; return; }
    // 다른 사람이 방금 고쳤을 수 있으니 DB의 최신 상태에 붙인다
    const plan = (await loadRoutePlan(day.destId)) ?? [];
    const stored = plan.find((d) => d.dayIndex === day.dayIndex)?.stops ?? [];
    const stops: StoredStop[] = [
      ...stored,
      { placeId: place.id, customName: null, customLat: null, customLng: null, arriveTime: null, memo: null, travelMode: null, purpose: null, customDwellMin: null },
    ];
    const result = await saveRouteDay(currentTripId, day.destId, day.dayIndex, stops);
    if (result !== 'ok') { exNotice = result === 'partial' ? '저장 중 문제가 생겼어요. PC ROUTE에서 그 날을 확인해 주세요.' : '일정에 넣지 못했어요. 잠시 뒤 다시 시도해 주세요.'; return; }
    exAddedDays.set(p.id, [...(exAddedDays.get(p.id) ?? []), day.dayNumber].sort((a, b) => a - b));
    exDayPicker = false;
    exNotice = day.label + ' 맨 뒤에 추가했어요. 시간·순서는 PC ROUTE나 타임라인에서 조정할 수 있어요.';
    void reloadFromRemote();
  } catch (e) {
    console.error('[Explore] 일정 추가 실패:', e);
    exNotice = '일정에 넣지 못했어요.';
  } finally {
    exSaving = false;
    render();
  }
}

async function shareExPlace(): Promise<void> {
  const p = exPlaceById(exDetailId);
  if (!p) return;
  const url = exDetail?.mapsUrl ?? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.name) + '&query_place_id=' + encodeURIComponent(p.id);
  try {
    if (navigator.share) { await navigator.share({ title: p.name, url }); return; }
    await navigator.clipboard.writeText(url);
    exNotice = 'Google 지도 링크를 복사했어요.';
    render();
  } catch {
    /* 닫음 */
  }
}

/* ── 지도 ── */

/** 지도를 띄우거나(처음) 다시 그린 자리에 옮겨 붙인다 — 렌더 직후 호출된다 */
async function mountMap(): Promise<void> {
  if (activeTab !== 'map' || !container || detailKey) return;
  const slot = container.querySelector('#mb-map') as HTMLElement | null;
  if (!slot) return;

  if (mapInstance && mapEl) {
    if (slot !== mapEl) slot.replaceWith(mapEl);
    syncMapMarkers();
    return;
  }
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

    const node = document.createElement('div');
    node.id = 'mb-map';
    node.className = 'mb-map';
    live.replaceWith(node);
    mapEl = node;
    const start = fallbackCenter() ?? currentUserLoc() ?? { lat: 13.7563, lng: 100.5018 };
    mapInstance = new g.maps.Map(node, {
      center: start,
      zoom: 14,
      gestureHandling: 'greedy',
      clickableIcons: false,
      zoomControl: false,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      rotateControl: false,
    });
    // 지도를 움직이면 "이 지역에서 다시 검색"만 띄운다 — 자동으로 검색하지 않는다(비용)
    mapInstance.addListener('idle', () => {
      if (mapView !== 'explore' || !exSearchedAt || exLoading) return;
      const c = mapInstance.getCenter();
      const moved = movedFar(exSearchedAt, { lat: c.lat(), lng: c.lng() }, exFilters.radius);
      if (moved !== exMoved) { exMoved = moved; render(); }
    });
    markerSig = '';
    syncMapMarkers();
  } catch (e) {
    // 지도를 못 띄워도 아래 목록과 길찾기는 그대로 쓸 수 있다 — 그래서 탭 전체를 죽이지 않는다
    console.error('[Mobile] 지도 로드 실패:', e);
    mapError = offlineState().offline
      ? '오프라인이라 지도를 불러올 수 없어요. 길찾기는 Google 지도 앱으로 열려요 — 앱에 오프라인 지도를 받아 두면 인터넷 없이도 길을 찾아요.'
      : '지도를 불러오지 못했어요. 아래 목록과 길찾기는 그대로 쓸 수 있어요.';
    mapInstance = null;
    mapEl = null;
    render();
  } finally {
    mapLoading = false;
  }
}

/** 마커를 지금 보기에 맞춘다. 같은 마커면 다시 만들지 않고 선택 강조만 바꾼다 */
function syncMapMarkers(): void {
  const g = (window as unknown as { google?: any }).google;
  if (!g?.maps || !mapInstance) return;
  syncUserDot(g);

  if (mapView === 'plan') {
    const day = activeDay();
    const pins = (day?.stops ?? []).filter((s) => s.lat != null && s.lng != null);
    const sig = 'plan:' + (day?.destId ?? '') + ':' + (day?.dayIndex ?? '') + ':' + pins.map((p) => p.key).join('|');
    if (sig !== markerSig) { markerSig = sig; drawMapMarkers(pins); }
    return;
  }

  const list = visibleResults();
  const sig = 'ex:' + list.map((p) => p.id).join('|');
  if (sig !== markerSig) {
    markerSig = sig;
    clearMarkers();
    list.forEach((p) => {
      const marker: any = new g.maps.Marker({ position: { lat: p.lat, lng: p.lng }, map: mapInstance, title: p.name, icon: exMarkerIcon(g, p, false), zIndex: 10 });
      marker.addListener('click', () => selectExPlace(p.id, true));
      exMarkerById.set(p.id, marker);
      mapMarkers.push(marker);
    });
  }
  // 선택 강조 — 더 크고 파란 테두리, 맨 위로
  list.forEach((p) => {
    const m = exMarkerById.get(p.id);
    if (!m) return;
    const sel = p.id === exSelected;
    m.setIcon(exMarkerIcon(g, p, sel));
    m.setZIndex(sel ? 100 : 10);
  });
}

function clearMarkers(): void {
  mapMarkers.forEach((m) => m.setMap(null));
  mapMarkers = [];
  exMarkerById = new Map();
}

/** 현재 위치 — 파란 점(테두리 흰색)만. 너무 튀지 않게 작게 */
function syncUserDot(g: any): void {
  const me = currentUserLoc();
  if (!me) { userDot?.setMap(null); userDot = null; return; }
  if (!userDot) {
    userDot = new g.maps.Marker({
      map: mapInstance,
      position: me,
      clickable: false,
      zIndex: 5,
      icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"><circle cx="13" cy="13" r="12" fill="#2F86D6" fill-opacity="0.16"/><circle cx="13" cy="13" r="6.5" fill="#2F86D6" stroke="#fff" stroke-width="2.5"/></svg>'), anchor: new g.maps.Point(13, 13) },
    });
  } else {
    userDot.setPosition(me);
    userDot.setMap(mapInstance);
  }
}

const EX_MARKER_COLOR: Record<ExplorePlace['cat'], string> = { food: '#E2574C', cafe: '#9A6B3F', sight: '#7F77DD', stay: '#0B2A5C', amenity: '#15966D' };
const EX_MARKER_GLYPH: Record<ExplorePlace['cat'], string> = {
  food: '<path d="M10 6v6m-2-6v3.5a2 2 0 0 0 4 0V6M10 12v6M15.5 6c-1.2 0-2 1.6-2 3.5S14.3 13 15.5 13V18" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  cafe: '<path d="M8 10h7v3.2a3 3 0 0 1-3 3h-1a3 3 0 0 1-3-3zM15 11h1.2a1.6 1.6 0 0 1 0 3.2H15" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  sight: '<path d="M8.2 10.4h7.6l-1.2-2.4H9.4zM9.5 10.4v5M14.5 10.4v5M7.8 15.8h8.4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  stay: '<path d="M7.5 16V9M7.5 13.5h9V16M10.5 13.5V11h4.5a1.5 1.5 0 0 1 1.5 1.5v1" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  amenity: '<path d="M8.5 10h7l-.7 6.5H9.2zM10 10V9a2 2 0 0 1 4 0v1" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
};

function exMarkerIcon(g: any, p: ExplorePlace, selected: boolean): any {
  const s = selected ? 44 : 32;
  const ring = selected ? '<circle cx="12" cy="12" r="11" fill="none" stroke="#2F86D6" stroke-width="2.2"/>' : '';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + Math.round(s * 1.25) + '" viewBox="0 0 24 30">' +
    '<path d="M12 29s9-8.4 9-16A9 9 0 0 0 3 13c0 7.6 9 16 9 16z" fill="' + EX_MARKER_COLOR[p.cat] + '" stroke="#fff" stroke-width="1.4"/>' +
    ring + '<g transform="translate(0 0.5)">' + EX_MARKER_GLYPH[p.cat] + '</g></svg>';
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new g.maps.Size(s, Math.round(s * 1.25)), anchor: new g.maps.Point(s / 2, Math.round(s * 1.25)) };
}

/** 마커를 누르면 → 목록에서 그 카드를 강조하고 보이게. 카드를 누르면 → 상세(지도는 그 장소로) */
function selectExPlace(id: string, fromMarker: boolean): void {
  exSelected = id;
  render();
  if (fromMarker) {
    const card = container?.querySelector('[data-explace="' + CSS.escape(id) + '"]') as HTMLElement | null;
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  focusExMarker(id);
}

function focusExMarker(id: string): void {
  const p = exPlaceById(id);
  if (p && mapInstance) mapInstance.panTo({ lat: p.lat, lng: p.lng });
}

function drawMapMarkers(pins: TlStop[]): void {
  const g = (window as unknown as { google?: any }).google;
  if (!g?.maps || !mapInstance) return;

  clearMarkers();

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
  else if (pins.length === 1) mapInstance.panTo(pins[0]);
}

function teardownMap(): void {
  clearMarkers();
  userDot?.setMap(null);
  userDot = null;
  mapInstance = null;
  mapEl = null;
  mapLoading = false;
  mapError = '';
  markerSig = '';
  exDetailId = null;
  exDayPicker = false;
  exDraft = null;
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
 *   · **"저장됨"은 실제로 받아 둔 서류에만** 붙인다(offline/docs.ts의 Cache Storage에 있을 때).
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
    savedDocs = await savedDocPaths();
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

  // 이 기기에 받아 둔 파일이 있으면 그걸 연다 — 오프라인에서도, 온라인에서도 더 빠르다
  if (savedDocs.get(doc.id) === doc.file_path) {
    const file = await loadOfflineDoc(doc.id, doc.file_path);
    if (file) { openDocViewer(file, doc.title); return; }
  }
  if (offlineState().offline) {
    walletNotice = '오프라인이라 "' + doc.title + '"을(를) 열 수 없어요. 온라인일 때 위의 "오프라인 저장"을 눌러 두면 인터넷 없이도 열려요.';
    render();
    return;
  }

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
    hasFile && savedDocs.get(doc.id) === doc.file_path ? '  <span class="mb-wd-saved">' + IC.check + '저장됨</span>' : '',
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
    '  <p class="mb-wd-h2">예약 서류와 지출을 한곳에</p>',
    '</section>',
    walletNotice ? '<p class="mb-wd-notice" role="alert">' + escapeHtml(walletNotice) + '</p>' : '',
    offlineDocsHtml(),
    walletDocsHtml(),
    walletMoneyHtml(),
  ].join('');
}

/* ── 서류 오프라인 저장 ──
 * 공유 서류의 파일을 이 기기에 받아 둔다(offline/docs.ts). 사용자가 눌러야 받는다 — PDF는 크고
 * 로밍 데이터일 수 있다. 개인 문서(PIN 잠금)는 받지 않는다 — 기기에 파일이 남으면 잠금의 의미가 없다.
 */
function savableDocs(): TripDocument[] {
  return walletDocs.filter((d) => !!d.file_path && d.visibility !== 'PERSONAL');
}

function offlineDocsHtml(): string {
  if (!walletDocsLoaded) return '';
  const list = savableDocs();
  if (!list.length) return '';
  const saved = list.filter((d) => savedDocs.get(d.id) === d.file_path).length;
  const all = saved === list.length;
  const offline = offlineState().offline;

  const text = docSaving
    ? '서류 받는 중 ' + docSaving.done + '/' + docSaving.total
    : all
      ? '서류 ' + list.length + '건이 이 기기에 저장돼 있어요 · 인터넷 없이 열려요'
      : saved
        ? '서류 ' + list.length + '건 중 ' + saved + '건 저장됨'
        : '공항·숙소에서 인터넷이 없어도 열 수 있게 서류를 저장해 두세요';
  const btn = docSaving || offline || all
    ? ''
    : '<button class="mb-wd-save" id="mb-wd-save">' + (saved ? '나머지 저장' : '오프라인 저장') + '</button>';
  const clear = !docSaving && saved ? '<button class="mb-wd-clear" id="mb-wd-clear">저장본 지우기</button>' : '';

  return [
    '<section class="mb-wd-offline' + (all ? ' is-done' : '') + '">',
    '  <div class="mb-wd-offline-row">',
    '    <span class="mb-wd-offline-ic">' + (all ? IC.check : IC.cloud) + '</span>',
    '    <span class="mb-wd-offline-text">' + escapeHtml(text) + '</span>',
    btn ? '    ' + btn : '',
    '  </div>',
    '  <div class="mb-wd-offline-sub">개인 문서(여권 등)는 잠금 보호를 위해 저장하지 않아요' + (clear ? ' · ' + clear : '') + '</div>',
    '</section>',
  ].join('');
}

async function saveDocsOffline(): Promise<void> {
  if (docSaving) return;
  const todo = savableDocs().filter((d) => savedDocs.get(d.id) !== d.file_path);
  if (!todo.length) return;
  walletNotice = '';
  docSaving = { done: 0, total: todo.length };
  render();
  let failed = 0;
  for (const doc of todo) {
    try {
      const url = await signedUrlFor(doc.file_path!, 600);
      const ok = url ? await saveDocOffline({ id: doc.id, filePath: doc.file_path!, fileName: doc.file_name, fileType: doc.file_type }, url) : false;
      if (!ok) failed += 1;
    } catch {
      failed += 1;
    }
    docSaving = { done: docSaving!.done + 1, total: todo.length };
    render();
  }
  savedDocs = await savedDocPaths();
  docSaving = null;
  if (failed) walletNotice = '서류 ' + failed + '건은 저장하지 못했어요. 연결이 안정적일 때 다시 눌러 주세요.';
  render();
}

async function clearSavedDocs(): Promise<void> {
  await Promise.all([...savedDocs.keys()].map((id) => removeOfflineDoc(id)));
  savedDocs = await savedDocPaths();
  render();
}

/** 앱 안 서류 보기 — 이미지는 그대로, PDF는 내장 뷰어로. 그 밖의 형식은 파일로 넘긴다 */
function openDocViewer(file: OfflineDocFile, title: string): void {
  closeDocViewer();
  docViewer = { url: URL.createObjectURL(file.blob), type: file.type, title, file };
  render();
}

function closeDocViewer(): void {
  if (docViewer) URL.revokeObjectURL(docViewer.url);
  docViewer = null;
}

function docViewerHtml(): string {
  const v = docViewer!;
  const isImage = v.type.startsWith('image/');
  const isPdf = v.type === 'application/pdf';
  const body = isImage
    ? '<img class="mb-dv-img" src="' + escapeHtml(v.url) + '" alt="' + escapeHtml(v.title) + '" />'
    : isPdf
      ? '<iframe class="mb-dv-frame" src="' + escapeHtml(v.url) + '" title="' + escapeHtml(v.title) + '"></iframe>'
      : '<p class="mb-dv-msg">이 형식은 앱 안에서 보여줄 수 없어요. 아래 "파일로 열기"를 눌러 주세요.</p>';
  return [
    '<div class="mb-dv" role="dialog" aria-modal="true" aria-label="' + escapeHtml(v.title) + '">',
    '  <header class="mb-dv-head">',
    '    <button class="mb-icon-btn" id="mb-dv-close" aria-label="닫기">' + IC.close + '</button>',
    '    <span class="mb-dv-title">' + escapeHtml(v.title) + '</span>',
    '    <span class="mb-dv-badge">' + IC.check + '저장본</span>',
    '  </header>',
    '  <div class="mb-dv-body">' + body + '</div>',
    '  <footer class="mb-dv-foot">',
    '    <a class="mb-ghost-btn" href="' + escapeHtml(v.url) + '" download="' + escapeHtml(v.file.name || v.title) + '" target="_blank" rel="noopener">파일로 열기</a>',
    typeof navigator !== 'undefined' && 'share' in navigator ? '    <button class="mb-ghost-btn" id="mb-dv-share">공유</button>' : '',
    '  </footer>',
    '</div>',
  ].join('');
}

async function shareViewerFile(): Promise<void> {
  const v = docViewer;
  if (!v) return;
  try {
    const f = new File([v.file.blob], v.file.name || v.title, { type: v.type });
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (nav.canShare && !nav.canShare({ files: [f] })) return;
    await navigator.share({ files: [f], title: v.title });
  } catch {
    /* 사용자가 닫음 */
  }
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
/** 불러오지 못한 사진 URL — 다시 그릴 때 깨진 사진 대신 처음부터 대체 화면을 보여준다 */
const brokenPhotos = new Set<string>();
/** 이미 한 번 확인 중이거나 확인한 URL(같은 사진을 렌더마다 다시 확인하지 않게) */
const probedPhotos = new Set<string>();

function markPhotoBroken(el: HTMLElement): void {
  el.style.backgroundImage = '';
  el.classList.add('photo-failed');
  // 썸네일은 핀 아이콘으로, 대표 사진은 배경만 남긴다(CSS)
  if (el.classList.contains('mb-row-thumb')) {
    el.classList.add('is-blank');
    el.innerHTML = IC.pin;
  }
}

/**
 * 화면에 **실제로 보일 때만** 받는 사진 — Google 장소 사진(주변 탐색 목록·상세)이 대상이다.
 * Google 사진은 이미지 한 장 = 요청 한 건 = 과금이라, 목록 20장·상세 5장을 렌더 즉시 전부 받으면
 * 화면 밖 카드의 사진까지 돈이 나간다(Places API(New) 요청 수가 예상보다 많았던 주된 원인).
 * 이미 받은 URL(`loadedPhotos`)은 브라우저 캐시에 있으니 다시 그릴 때 바로 쓴다.
 */
const loadedPhotos = new Set<string>();
let photoObserver: IntersectionObserver | null = null;

function isLazyPhoto(el: HTMLElement): boolean {
  return el.classList.contains('mb-ex-thumb') || el.classList.contains('mb-exd-photo');
}

function paintPhoto(el: HTMLElement, url: string): void {
  el.style.backgroundImage = 'url("' + url + '")';
  loadedPhotos.add(url);
  if (probedPhotos.has(url)) return;
  probedPhotos.add(url);
  // 배경 이미지는 실패해도 이벤트가 없다 — 같은 URL을 Image로 한 번 확인해 실패를 잡는다
  const probe = new Image();
  probe.onerror = () => {
    brokenPhotos.add(url);
    container?.querySelectorAll('[data-photo]').forEach((n) => {
      if ((n as HTMLElement).dataset.photo === url) markPhotoBroken(n as HTMLElement);
    });
  };
  probe.src = url;
}

function applyPhotos(): void {
  photoObserver?.disconnect();
  photoObserver = null;
  container?.querySelectorAll('[data-photo]').forEach((node) => {
    const el = node as HTMLElement;
    const url = el.dataset.photo;
    if (!url) return;
    if (brokenPhotos.has(url)) { markPhotoBroken(el); return; }
    if (isLazyPhoto(el) && !loadedPhotos.has(url) && typeof IntersectionObserver !== 'undefined') {
      photoObserver ??= new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const t = en.target as HTMLElement;
          photoObserver?.unobserve(t);
          if (t.dataset.photo) paintPhoto(t, t.dataset.photo);
        });
      }, { rootMargin: '120px 0px', threshold: 0.25 });
      photoObserver.observe(el);
      return;
    }
    paintPhoto(el, url);
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
  root.querySelector('#mb-wd-save')?.addEventListener('click', () => { void saveDocsOffline(); });
  root.querySelector('#mb-wd-clear')?.addEventListener('click', () => { void clearSavedDocs(); });
  root.querySelector('#mb-dv-close')?.addEventListener('click', () => { closeDocViewer(); render(); });
  root.querySelector('#mb-dv-share')?.addEventListener('click', () => { void shareViewerFile(); });
  root.querySelector('#mb-wd-add')?.addEventListener('click', () => gotoGate('docs'));

  // ── 지도: 보기 전환·주변 탐색 ──
  root.querySelectorAll('[data-mapview]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = (btn as HTMLElement).dataset.mapview!;
      if (v === 'plan') { mapView = 'plan'; exDetailId = null; render(); return; }
      mapView = 'explore';
      exCat = v as ExploreCat;
      exQuery = '';
      void runExploreSearch(exSearchedAt && !exMoved ? exSearchedAt : undefined, exSearchedAt && !exMoved ? exCenterLabel : undefined);
    });
  });
  root.querySelector('#mb-ex-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = ((root.querySelector('#mb-ex-q') as HTMLInputElement | null)?.value ?? '').trim();
    (root.querySelector('#mb-ex-q') as HTMLInputElement | null)?.blur();
    if (!q) return;
    exQuery = q.slice(0, 60);
    const c = mapInstance?.getCenter?.();
    void runExploreSearch(exMoved && c ? { lat: c.lat(), lng: c.lng() } : exSearchedAt ?? undefined, exMoved ? '지도 중심' : exSearchedAt ? exCenterLabel : undefined);
  });
  root.querySelector('#mb-ex-clear')?.addEventListener('click', () => {
    exQuery = '';
    void runExploreSearch(exSearchedAt ?? undefined, exSearchedAt ? exCenterLabel : undefined);
  });
  root.querySelector('#mb-ex-again')?.addEventListener('click', () => {
    const c = mapInstance?.getCenter?.();
    if (c) void runExploreSearch({ lat: c.lat(), lng: c.lng() }, '지도 중심');
  });
  root.querySelector('#mb-ex-me')?.addEventListener('click', () => {
    void requestUserLoc().then((loc) => {
      if (loc) {
        mapInstance?.panTo(loc);
        if (mapView === 'explore') void runExploreSearch(loc, '현재 위치');
        else syncMapMarkers();
      } else {
        exNotice = userLocState === 'denied' ? '현재 위치를 사용할 수 없어요 — 브라우저 설정에서 위치 권한을 허용해 주세요.' : '현재 위치를 확인하지 못했어요.';
        render();
      }
    });
  });
  root.querySelectorAll('[data-exsort]').forEach((btn) => {
    btn.addEventListener('click', () => { exSort = (btn as HTMLElement).dataset.exsort as ExploreSort; render(); });
  });
  root.querySelectorAll('[data-explace]').forEach((btn) => {
    btn.addEventListener('click', () => openExDetail((btn as HTMLElement).dataset.explace!));
  });
  root.querySelector('#mb-exd-close')?.addEventListener('click', closeExDetail);
  root.querySelector('#mb-exd-back')?.addEventListener('click', closeExDetail);
  root.querySelector('#mb-exd-save')?.addEventListener('click', () => { void toggleExSave(); });
  root.querySelector('#mb-exd-share')?.addEventListener('click', () => { void shareExPlace(); });
  root.querySelector('#mb-exd-add')?.addEventListener('click', () => { exDayPicker = true; render(); });
  root.querySelector('#mb-exd-pick-back')?.addEventListener('click', () => { exDayPicker = false; render(); });
  root.querySelectorAll('[data-exaddday]').forEach((btn) => {
    btn.addEventListener('click', () => { void addExToDay(Number((btn as HTMLElement).dataset.exaddday)); });
  });
  root.querySelector('#mb-ex-filter')?.addEventListener('click', () => { exDraft = { ...exFilters, prices: [...exFilters.prices] }; render(); });
  root.querySelector('#mb-exf-back')?.addEventListener('click', () => { exDraft = null; render(); });
  root.querySelector('#mb-exf-reset')?.addEventListener('click', () => { exDraft = { ...DEFAULT_FILTERS, prices: [] }; render(); });
  root.querySelectorAll('[data-exf]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!exDraft) return;
      const { exf, v } = (btn as HTMLElement).dataset;
      if (exf === 'radius') exDraft.radius = Number(v);
      else if (exf === 'minRating') exDraft.minRating = Number(v);
      else if (exf === 'openNow') exDraft.openNow = !exDraft.openNow;
      else if (exf === 'reservable') exDraft.reservable = !exDraft.reservable;
      else if (exf === 'price') {
        const pv = v as PriceLevel;
        exDraft.prices = exDraft.prices.includes(pv) ? exDraft.prices.filter((x) => x !== pv) : [...exDraft.prices, pv];
      }
      render();
    });
  });
  root.querySelector('#mb-exf-apply')?.addEventListener('click', () => {
    if (!exDraft) return;
    const radiusChanged = exDraft.radius !== exFilters.radius;
    exFilters = exDraft;
    exDraft = null;
    // 반경은 검색 조건이라 새로 찾는다. 나머지는 받은 결과 안에서 거르기만 한다(호출 없음)
    if (radiusChanged && exSearchedAt) void runExploreSearch(exSearchedAt, exCenterLabel);
    else { markerSig = ''; render(); }
  });

  // ── 지도: 일정 보기 ──
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
