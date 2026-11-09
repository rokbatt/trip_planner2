/**
 * 온보딩 상태 — 환영 안내·페이지별 가이드를 **이미 본 사람에게 다시 띄우지 않기** 위한 기록.
 *
 * 저장 위치는 localStorage다(사용자 결정, 2026-11). 서버 테이블을 새로 만들지 않는다.
 *   · 키에 사용자 id를 넣는다(`mongsil:onboarding:<userId>`) — 한 브라우저에서 계정을 바꿔도
 *     서로의 기록이 섞이지 않고, 로그아웃 후 같은 계정으로 다시 들어오면 그대로 이어진다.
 *   · 기기를 바꾸면 처음부터다(서버에 없으므로). 그 한계는 받아들인 결정이다.
 *   · 버전을 같이 저장한다 — 안내 내용을 크게 바꾸면 tourContent/welcome의 버전만 올리면
 *     이미 본 사람에게도 한 번 더 뜬다.
 *
 * "건너뛰기"와 "다시 보지 않기"는 하나다(사용자 결정) — 어떤 식으로 닫든 그 버전은 본 것으로 기록한다.
 * 다시 보고 싶으면 도움말 센터에서 직접 실행한다(그건 기록과 상관없이 언제든 된다).
 *
 * 이 파일은 DOM을 모른다 — 저장소(Storage)만 주입받아 테스트한다(onboardingStore.test.ts).
 */

export const WELCOME_VERSION = 1;

export interface SeenRecord {
  version: number;
  /** 본(닫은) 시각 ISO — 디버깅·추후 분석용 */
  at: string;
}

export interface OnboardingState {
  welcome: SeenRecord | null;
  tours: Record<string, SeenRecord>;
}

/** localStorage와 같은 모양만 요구한다 — 테스트에선 메모리 저장소를 넣는다 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const PREFIX = 'mongsil:onboarding:';

export function storageKey(userId: string): string {
  return PREFIX + userId;
}

function empty(): OnboardingState {
  return { welcome: null, tours: {} };
}

function isRecord(v: unknown): v is SeenRecord {
  return !!v && typeof v === 'object' && typeof (v as SeenRecord).version === 'number';
}

/** 깨진 값·옛 형식이 들어 있어도 앱을 멈추지 않는다 — 읽을 수 있는 것만 살린다 */
export function parseState(raw: string | null): OnboardingState {
  if (!raw) return empty();
  try {
    const v = JSON.parse(raw) as Partial<OnboardingState>;
    const tours: Record<string, SeenRecord> = {};
    if (v && typeof v.tours === 'object' && v.tours) {
      for (const [k, r] of Object.entries(v.tours)) if (isRecord(r)) tours[k] = r;
    }
    return { welcome: isRecord(v?.welcome) ? v!.welcome! : null, tours };
  } catch {
    return empty();
  }
}

export function loadState(store: KeyValueStore | null, userId: string | null): OnboardingState {
  if (!store || !userId) return empty();
  try {
    return parseState(store.getItem(storageKey(userId)));
  } catch {
    return empty(); // 사생활 보호 모드 등에서 접근 자체가 막힌 경우
  }
}

function save(store: KeyValueStore | null, userId: string | null, state: OnboardingState): void {
  if (!store || !userId) return;
  try {
    store.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    /* 저장이 막혀도 안내는 그대로 동작한다 — 다음에 한 번 더 뜰 뿐 */
  }
}

export function needsWelcome(state: OnboardingState, version = WELCOME_VERSION): boolean {
  return !state.welcome || state.welcome.version < version;
}

export function needsTour(state: OnboardingState, tourId: string, version: number): boolean {
  const r = state.tours[tourId];
  return !r || r.version < version;
}

export function markWelcomeSeen(store: KeyValueStore | null, userId: string | null, now = new Date(), version = WELCOME_VERSION): OnboardingState {
  const state = loadState(store, userId);
  state.welcome = { version, at: now.toISOString() };
  save(store, userId, state);
  return state;
}

export function markTourSeen(store: KeyValueStore | null, userId: string | null, tourId: string, version: number, now = new Date()): OnboardingState {
  const state = loadState(store, userId);
  state.tours[tourId] = { version, at: now.toISOString() };
  save(store, userId, state);
  return state;
}
