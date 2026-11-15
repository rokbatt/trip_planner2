/**
 * 온보딩 조율 — 언제 환영 안내·페이지 가이드를 띄울지, 도움말 센터의 "다시 보기"를 어떻게 처리할지.
 *
 * 진입점(이 파일 밖에서 부르는 것)
 *   · onTripsShown()                — 내 여행 화면이 그려진 뒤(main.ts)
 *   · onGateRendered(tripId, gate)  — 워크스페이스 게이트 본문이 그려진 뒤(workspace.ts renderGate)
 *   · onPanelOpened()               — 오른쪽 채팅 패널이 열린 뒤(workspace.ts openDrawer)
 *   · openHelp()                    — 헤더의 ? 버튼(폰 Companion은 상단 바의 ? 버튼)
 *
 * 규칙
 *   · PC와 폰 모두에서 동작한다. 폰(폭 768px 이하)에서는 같은 안내를 바닥 시트 모양으로 띄우고,
 *     화면 구조가 다른 가이드는 폰 단계(`mobileSteps`)를 쓴다. 폰에서 여행을 열면 처음 보는 화면이
 *     Companion이라 폰 사용자의 첫 가이드는 Companion 가이드다.
 *   · 처음 들어오면 환영 안내 → (시작하기를 누르면) 지금 화면의 가이드.
 *   · 페이지 가이드는 그 게이트에 **처음** 들어왔을 때 한 번 자동으로 뜬다. 가이드끼리는 따로 기록한다.
 *   · 어떻게 닫든(끝까지 보기·건너뛰기·종료·Esc·다른 화면으로 이동) 본 것으로 기록한다.
 *   · 도움말 센터에서 직접 실행하는 가이드·환영 안내는 기록과 상관없이 언제든 뜬다.
 *   · 가입 동의 창이 떠 있으면 그게 닫힐 때까지 기다린다(창이 겹치지 않게).
 */

import { store } from '../store';
import { navigate } from '../router';
import { loadState, markTourSeen, markWelcomeSeen, needsTour, needsWelcome, type KeyValueStore } from './onboardingStore';
import { recordIdFor, stepsFor, tourById, tourForGate, type TourDef } from './tourContent';
import { isTourRunning, runTour, stopActiveTour, tourHasTargets, waitFor } from './tour';
import { isWelcomeOpen, showWelcome } from './welcome';
import { closeHelpCenter, isHelpOpen, openHelpCenter } from './help';
import './onboarding.css';

const PHONE_QUERY = '(max-width: 768px)';
/** 게이트 본문이 그려진 뒤 가이드 대상이 나타나기까지 기다리는 최대 시간 */
const TARGET_WAIT_MS = 3000;
/**
 * "전체 사용법 다시 보기" 순서 — 계획 흐름대로, 오른쪽 패널은 마지막.
 * 폰은 여행 중에 쓰는 Companion이 첫 화면이라 그걸 맨 앞에 둔다.
 */
const FULL_ORDER = ['ideas', 'stay', 'route', 'timeline', 'checklist', 'docs', 'notes', 'expense', 'links', 'assistant'];
const FULL_ORDER_PHONE = ['companion', ...FULL_ORDER];

/** 폰 배치인가 — 워크스페이스가 폰 구조로 바뀌는 중단점(768px)과 같다 */
function isPhone(): boolean {
  return window.matchMedia(PHONE_QUERY).matches;
}

/** 이 가이드를 이 기기에서 이미 봤는가 */
function tourNeeded(def: TourDef): boolean {
  return needsTour(loadState(kv(), userId()), recordIdFor(def, isPhone()), def.version);
}

function userId(): string | null {
  return store.get('user')?.id ?? null;
}

function kv(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function currentLoc(): { tripId: string | null; gate: string | null } {
  const seg = window.location.hash.replace(/^#\/?/, '').split('/');
  if (seg[0] !== 'trip' || !seg[1]) return { tripId: null, gate: null };
  return { tripId: seg[1], gate: seg[2] || null };
}

/** 다른 화면으로 이동한 뒤 실행할 가이드(도움말·전체 다시 보기에서 예약) */
let pending: { tripId: string; gate: string; tourId: string } | null = null;
/** 전체 사용법 다시 보기 — 남은 가이드 id */
let chain: string[] | null = null;
/** 화면이 바뀌면 오르는 번호 — 기다리던 작업이 낡았는지 판단한다 */
let seq = 0;

/* ── 환영 안내 ── */

async function waitForConsentClosed(mySeq: number): Promise<boolean> {
  await waitFor(() => !document.querySelector('.cs-overlay') || seq !== mySeq, 120_000);
  return seq === mySeq && !document.querySelector('.cs-overlay');
}

function openWelcome(afterStart: () => void): void {
  showWelcome((result) => {
    markWelcomeSeen(kv(), userId());
    if (result === 'start') afterStart();
  });
}

/** 내 여행 화면에서 "시작하기" — 여행이 없으면 새 여행 만들기를 연다 */
function startFromTrips(): void {
  const hasTrips = !!document.querySelector('#trip-grid .trip-card');
  if (!hasTrips) document.querySelector<HTMLButtonElement>('#btn-new-trip')?.click();
}

/* ── 페이지 가이드 ── */

/**
 * 대상이 나타나면 가이드를 띄운다. `auto`(처음 들어와서 저절로 뜨는 경우)면 이미 다른 가이드가
 * 떠 있을 때 끼어들지 않는다 — 끼어들면 보던 가이드가 닫히고 본 것으로 기록돼 버린다.
 * 도움말에서 직접 고른 가이드는 지금 것을 닫고 바로 띄운다.
 */
async function runWhenReady(def: TourDef, mySeq: number, auto = false): Promise<boolean> {
  // 기기는 띄우는 순간 기준으로 정한다(기다리는 사이 창 크기가 바뀔 수 있다)
  const ok = await waitFor(() => {
    if (seq !== mySeq) return true;
    const steps = stepsFor(def, isPhone());
    return tourHasTargets(steps) || steps.some((s) => !!s.prepare);
  }, TARGET_WAIT_MS);
  if (seq !== mySeq || !ok) return false;
  // 레이아웃(지도·이미지)이 자리 잡을 시간을 조금 준다
  await new Promise((r) => setTimeout(r, 250));
  if (seq !== mySeq || isWelcomeOpen() || isHelpOpen()) return false;
  if (auto && isTourRunning()) return false;
  const phone = isPhone();
  const handle = runTour(def, {
    chainLabel: chain ? '전체 사용법' : undefined,
    steps: stepsFor(def, phone),
    onEnd: (reason) => {
      // 자동 실행이든 다시 보기든, 어떻게 닫았든 본 것으로 기록한다(폰 단계는 따로)
      markTourSeen(kv(), userId(), recordIdFor(def, phone), def.version);
      if (chain) {
        if (reason === 'close') chain = null;
        else advanceChain();
      }
    },
  });
  return !!handle;
}

/** 도움말에서 고른 가이드 실행 — 다른 화면 가이드면 그 화면으로 옮긴 뒤 실행한다 */
function startTour(tourId: string): void {
  const def = tourById(tourId);
  if (!def) return;
  const loc = currentLoc();
  if (!def.gate || def.gate === loc.gate) {
    const mySeq = ++seq;
    void runWhenReady(def, mySeq).then((started) => {
      if (!started && chain && seq === mySeq) advanceChain();
    });
    return;
  }
  if (!loc.tripId) return;
  pending = { tripId: loc.tripId, gate: def.gate, tourId };
  navigate('trip/' + loc.tripId + '/' + def.gate);
}

function advanceChain(): void {
  const next = chain?.shift();
  if (!next) {
    chain = null;
    return;
  }
  startTour(next);
}

function replayAll(): void {
  if (!currentLoc().tripId) return;
  chain = (isPhone() ? FULL_ORDER_PHONE : FULL_ORDER).filter((id) => !!tourById(id));
  advanceChain();
}

function replayWelcome(): void {
  stopActiveTour('close');
  const loc = currentLoc();
  openWelcome(() => {
    if (loc.gate) {
      const def = tourForGate(loc.gate);
      if (def) startTour(def.id);
    } else {
      startFromTrips();
    }
  });
}

/* ── 진입점 ── */

export async function onTripsShown(): Promise<void> {
  const mySeq = ++seq;
  pending = null;
  chain = null;
  if (!userId()) return;
  if (!needsWelcome(loadState(kv(), userId()))) return;
  if (!(await waitForConsentClosed(mySeq)) || isWelcomeOpen()) return;
  openWelcome(startFromTrips);
}

export async function onGateRendered(tripId: string, gate: string): Promise<void> {
  const mySeq = ++seq;
  if (!userId()) return;
  // 처음 여는 워크스페이스는 본문을 다 그린 뒤에 화면에 붙는다(main.ts) — 붙을 때까지 기다린다
  await waitFor(() => seq !== mySeq || !!document.querySelector('.ws-page #ws-body'), TARGET_WAIT_MS);
  if (seq !== mySeq) return;

  // 도움말·전체 다시 보기에서 예약한 가이드
  if (pending) {
    const p = pending;
    pending = null;
    if (p.tripId === tripId && p.gate === gate) {
      const def = tourById(p.tourId);
      if (def) {
        const started = await runWhenReady(def, mySeq);
        if (!started && chain && seq === mySeq) advanceChain();
      }
      return;
    }
    chain = null; // 사용자가 다른 곳으로 옮겼다 — 이어 보기를 그만둔다
  }
  if (chain) return;

  const state = loadState(kv(), userId());
  const def = tourForGate(gate);

  if (needsWelcome(state)) {
    if (!(await waitForConsentClosed(mySeq)) || isWelcomeOpen()) return;
    openWelcome(() => {
      if (def && seq === mySeq) void runWhenReady(def, mySeq, true);
    });
    return;
  }

  if (def && tourNeeded(def) && !isTourRunning()) {
    await runWhenReady(def, mySeq, true);
  }
}

/**
 * 오른쪽 채팅 패널이 열릴 때(workspace.ts openDrawer) — 처음이면 옆의 Assistant를 소개한다.
 * 게이트와 상관없는 가이드라 화면 번호(seq)를 올리지 않는다(올리면 기다리던 게이트 가이드가 취소된다).
 */
export function onPanelOpened(): void {
  if (!userId()) return;
  if (isTourRunning() || isWelcomeOpen() || isHelpOpen() || chain) return; // 도움말에서 실행한 가이드가 패널을 연 경우 포함
  const def = tourById('assistant');
  if (!def || !tourNeeded(def)) return;
  void runWhenReady(def, seq, true);
}

export function openHelp(): void {
  if (isHelpOpen()) return closeHelpCenter();
  stopActiveTour('close');
  const loc = currentLoc();
  openHelpCenter({ tripId: loc.tripId, gate: loc.gate, phone: isPhone(), startTour, replayAll, replayWelcome });
}

// 다른 화면으로 옮기면 돌던 가이드를 멈춘다(그 화면의 요소를 가리키고 있으므로).
// 모듈을 불러오기만 하는 테스트(node 환경)에서는 window가 없다 — 그때는 건너뛴다.
if (typeof window !== 'undefined') {
  let lastHash = window.location.hash;
  window.addEventListener('hashchange', () => {
    const prev = lastHash;
    lastHash = window.location.hash;
    if (prev !== lastHash && isTourRunning()) stopActiveTour('close');
  });
}
