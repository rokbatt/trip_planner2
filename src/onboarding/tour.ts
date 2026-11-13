/**
 * 페이지 가이드 엔진 — 실제 화면 요소를 강조하고 그 옆에 설명을 띄운다(문구는 tourContent.ts).
 *
 * 동작 원칙
 *   · **화면을 막지 않는다.** 덮개 전체가 `pointer-events: none`이고 설명 상자만 클릭을 받는다.
 *     어두운 배경은 강조 상자의 큰 그림자(box-shadow)로 만든다 — 덮개가 클릭을 가로채지 않으니
 *     가이드를 보면서 실제 버튼을 눌러 봐도 된다.
 *   · 대상은 `[data-tour="…"]`로만 찾는다. 대상이 없거나 숨겨져 있으면 그 단계는 건너뛰고,
 *     `fallback`이 있으면 그걸 대신 보여준다. 단계 번호(n / N)는 **보여줄 수 있는 단계만** 센다.
 *   · 화면이 다시 그려져 대상이 바뀌어도(실시간 갱신 등) 매 프레임 다시 찾아 위치를 맞춘다.
 *   · 대상이 화면 밖이면 스크롤해서 가운데로 가져온다(안쪽 스크롤 영역도 따라간다).
 *   · 대상이 닫힌 패널 안에 있으면 `prepare` 동작으로 먼저 연다(PREPARE 표).
 *   · 설명 상자는 대상의 오른쪽 → 왼쪽 → 아래 → 위 순서로 자리를 찾고, 화면 밖으로 나가지 않게 붙잡는다.
 *
 * 이 엔진은 기록(본 것/안 본 것)을 모른다 — 끝날 때 이유만 알려 주고, 기록은 onboarding.ts가 한다.
 */

import type { TourDef, TourStepContent } from './tourContent';
import { escapeHtml as esc } from '../utils/html';

export type TourEndReason = 'done' | 'skip' | 'close';

export interface TourOptions {
  onEnd: (reason: TourEndReason) => void;
  /** 여러 페이지를 이어서 보는 중이면 "건너뛰기"가 다음 페이지로 넘어간다 — 버튼 문구만 바꾼다 */
  chainLabel?: string;
}

export interface TourHandle {
  stop: (reason?: TourEndReason) => void;
}

/**
 * 대상이 닫힌 컨테이너 안에 있을 때 먼저 실행할 동작. 화면을 바꿨다면 되돌리는 함수를 돌려준다 —
 * 가이드가 끝나면 실행해서 사용자가 보던 화면으로 돌려놓는다.
 */
const PREPARE: Record<NonNullable<TourStepContent['prepare']>, () => (() => void) | void> = {
  // 오른쪽 패널을 Assistant 탭으로 연다(workspace.ts bindChat이 듣는 이벤트).
  // 채팅(Collaborate) 탭을 보던 중이었다면 끝날 때 채팅 탭으로 돌려놓는다.
  openPanelAssistant: () => {
    const wasChat = !!document.querySelector('#tab-chat.active');
    window.dispatchEvent(new CustomEvent('mongsil:openAssistant'));
    if (wasChat) return () => document.querySelector<HTMLElement>('#tab-chat')?.click();
  },
};

const MARGIN = 12; // 화면 가장자리와 설명 상자 사이
const GAP = 14; // 대상과 설명 상자 사이
const PAD = 6; // 강조 상자가 대상보다 큰 정도

function q(target: string): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-tour="' + target + '"]');
}

/** 실제로 보이는가 — display:none·visibility:hidden·크기 0·조상 숨김을 모두 걸러낸다 */
export function isShown(el: HTMLElement | null): el is HTMLElement {
  if (!el || !el.isConnected) return false;
  if (el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
  return el.getClientRects().length > 0;
}

/** 요소가 실제로 보일 수 있는 영역 — 화면과, 넘침을 잘라내는 조상(스크롤 영역)들의 교집합 */
function clipRect(el: HTMLElement): { top: number; left: number; bottom: number; right: number } {
  let top = 0;
  let left = 0;
  let bottom = window.innerHeight;
  let right = window.innerWidth;
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const cs = getComputedStyle(a);
    // display: contents는 상자가 없어 아무것도 잘라내지 않는다(좁은 화면에서 열을 풀 때 쓰인다)
    if (cs.display === 'contents' || (cs.overflowX === 'visible' && cs.overflowY === 'visible')) continue;
    const r = a.getBoundingClientRect();
    if (cs.overflowY !== 'visible') { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); }
    if (cs.overflowX !== 'visible') { left = Math.max(left, r.left); right = Math.min(right, r.right); }
  }
  return { top, left, bottom, right };
}

interface Resolved {
  target: string;
  title: string;
  body: string;
}

/** 지금 보여줄 수 있는 내용 — 대상이 있으면 그것, 없으면 fallback, 둘 다 없으면 null */
function resolveNow(step: TourStepContent): Resolved | null {
  if (isShown(q(step.target))) return { target: step.target, title: step.title, body: step.body };
  if (step.fallback && isShown(q(step.fallback.target))) return { ...step.fallback };
  return null;
}

/** 시작 시점에 보여줄 수 있는 단계인가 — prepare가 있는 단계는 열어 보기 전엔 알 수 없으니 일단 센다 */
function availableAtStart(step: TourStepContent): boolean {
  return !!resolveNow(step) || !!step.prepare;
}

/** 가이드를 시작할 수 있는가(보여줄 단계가 하나라도 있는가) — 자동 실행 전 대기용 */
export function tourHasTargets(def: TourDef): boolean {
  return def.steps.some((s) => !!resolveNow(s));
}

function waitFor(fn: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      if (fn()) return resolve(true);
      if (performance.now() - t0 > timeoutMs) return resolve(false);
      requestAnimationFrame(tick);
    };
    tick();
  });
}


let active: TourHandle | null = null;

export function isTourRunning(): boolean {
  return !!active;
}

export function stopActiveTour(reason: TourEndReason = 'close'): void {
  active?.stop(reason);
}

export function runTour(def: TourDef, opts: TourOptions): TourHandle | null {
  active?.stop('close');

  const steps = def.steps.filter(availableAtStart);
  if (!steps.length) return null;

  const root = document.createElement('div');
  root.className = 'ob-tour';
  root.innerHTML =
    '<div class="ob-tour-spot" aria-hidden="true"></div>' +
    '<div class="ob-tour-tip" role="dialog" aria-modal="false" aria-labelledby="ob-tour-title" tabindex="-1">' +
    '  <div class="ob-tour-head">' +
    '    <span class="ob-tour-eyebrow"></span>' +
    '    <button type="button" class="ob-tour-x" data-act="close" aria-label="종료" title="종료">' +
    '      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
    '    </button>' +
    '  </div>' +
    '  <h3 class="ob-tour-title" id="ob-tour-title"></h3>' +
    '  <p class="ob-tour-body"></p>' +
    '  <div class="ob-tour-foot">' +
    '    <button type="button" class="ob-tour-skip" data-act="skip"></button>' +
    '    <div class="ob-tour-nav">' +
    '      <button type="button" class="ob-btn ob-btn-ghost" data-act="prev">이전</button>' +
    '      <button type="button" class="ob-btn ob-btn-primary" data-act="next">다음</button>' +
    '    </div>' +
    '  </div>' +
    '</div>';
  document.body.appendChild(root);

  const spot = root.querySelector('.ob-tour-spot') as HTMLElement;
  const tip = root.querySelector('.ob-tour-tip') as HTMLElement;
  const eyebrow = root.querySelector('.ob-tour-eyebrow') as HTMLElement;
  const titleEl = root.querySelector('.ob-tour-title') as HTMLElement;
  const bodyEl = root.querySelector('.ob-tour-body') as HTMLElement;
  const skipBtn = root.querySelector('[data-act="skip"]') as HTMLButtonElement;
  const prevBtn = root.querySelector('[data-act="prev"]') as HTMLButtonElement;
  const nextBtn = root.querySelector('[data-act="next"]') as HTMLButtonElement;
  skipBtn.textContent = opts.chainLabel ? '이 페이지 건너뛰기' : '건너뛰기';

  let index = -1;
  let current: Resolved | null = null;
  let el: HTMLElement | null = null;
  let raf = 0;
  let lastKey = '';
  let stopped = false;
  let busy = false; // 단계 전환(prepare 대기) 중 중복 클릭 방지
  const undos: Array<() => void> = []; // prepare로 바꾼 화면을 끝날 때 되돌린다

  function place(): void {
    if (stopped) return;
    raf = requestAnimationFrame(place);
    if (!current) return;
    // 다시 그려져 요소가 바뀌었으면 새로 찾는다
    if (!el || !el.isConnected) el = q(current.target);
    if (!isShown(el)) {
      // 대상이 사라졌다 — 잠시 숨기고 돌아오면 다시 보여준다(바로 건너뛰면 재렌더 순간에 깜빡 넘어간다)
      if (lastKey !== 'hidden') {
        root.classList.add('is-lost');
        lastKey = 'hidden';
      }
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = el.getBoundingClientRect();
    // 스크롤 영역에 가려진 부분은 빼고 **실제로 보이는 부분만** 강조한다
    const c = clipRect(el);
    const top = Math.max(r.top - PAD, c.top, 4);
    const left = Math.max(r.left - PAD, c.left, 4);
    const bottom = Math.min(r.bottom + PAD, c.bottom, vh - 4);
    const right = Math.min(r.right + PAD, c.right, vw - 4);
    if (bottom - top < 8 || right - left < 8) {
      // 스크롤되어 완전히 가려졌다(스크롤이 끝나면 다시 보인다)
      if (lastKey !== 'hidden') {
        root.classList.add('is-lost');
        lastKey = 'hidden';
      }
      return;
    }
    root.classList.remove('is-lost');
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const key = [top, left, bottom, right, tw, th, vw, vh].map(Math.round).join(',');
    if (key === lastKey) return;
    lastKey = key;

    spot.style.transform = 'translate(' + left + 'px,' + top + 'px)';
    spot.style.width = Math.max(right - left, 0) + 'px';
    spot.style.height = Math.max(bottom - top, 0) + 'px';

    const cy = (top + bottom) / 2;
    const cx = (left + right) / 2;
    let x: number;
    let y: number;
    let side: string;
    if (right + GAP + tw <= vw - MARGIN) {
      side = 'right'; x = right + GAP; y = cy - th / 2;
    } else if (left - GAP - tw >= MARGIN) {
      side = 'left'; x = left - GAP - tw; y = cy - th / 2;
    } else if (bottom + GAP + th <= vh - MARGIN) {
      side = 'below'; x = cx - tw / 2; y = bottom + GAP;
    } else if (top - GAP - th >= MARGIN) {
      side = 'above'; x = cx - tw / 2; y = top - GAP - th;
    } else {
      // 대상이 화면 대부분을 차지한다 — 대상 안쪽 아래 가장자리에 띄운다
      side = 'inside'; x = right - tw - MARGIN; y = bottom - th - MARGIN;
    }
    x = Math.min(Math.max(x, MARGIN), vw - tw - MARGIN);
    y = Math.min(Math.max(y, MARGIN), vh - th - MARGIN);
    tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    tip.dataset.side = side;
    // 첫 자리를 잡은 뒤에야 보여 준다 — 그 전엔 왼쪽 위(0,0)에서 미끄러져 들어오는 게 보인다.
    // 단계 사이 이동만 애니메이션한다(is-placed).
    if (!root.classList.contains('is-ready')) {
      root.classList.add('is-ready');
      requestAnimationFrame(() => root.classList.add('is-placed'));
    }
  }

  function scrollIntoViewIfNeeded(target: HTMLElement): void {
    const r = target.getBoundingClientRect();
    const c = clipRect(target);
    const tall = r.height > (c.bottom - c.top) * 0.8;
    if (tall) {
      // 보이는 영역보다 큰 대상은 윗부분이 보이기만 하면 그대로 둔다(쓸데없이 화면을 끌어올리지 않게)
      if (r.top < c.top - 1 || r.top > c.bottom - 80) target.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'smooth' });
      return;
    }
    const fully = r.top >= c.top - 1 && r.bottom <= c.bottom + 1 && r.left >= c.left - 1 && r.right <= c.right + 1;
    if (!fully) target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }

  async function show(i: number, dir: 1 | -1): Promise<void> {
    if (busy || stopped) return;
    busy = true;
    try {
      let j = i;
      while (j >= 0 && j < steps.length) {
        const step = steps[j];
        let res = resolveNow(step);
        if (!res && step.prepare) {
          const undo = PREPARE[step.prepare]();
          if (undo && !undos.length) undos.push(undo); // 처음 상태 하나만 기억하면 된다
          await waitFor(() => !!resolveNow(step), 1500);
          if (stopped) return;
          res = resolveNow(step);
        }
        if (res) {
          index = j;
          current = res;
          el = q(res.target);
          lastKey = '';
          eyebrow.textContent = def.label + ' · ' + (j + 1) + ' / ' + steps.length;
          titleEl.textContent = res.title;
          bodyEl.textContent = res.body;
          // 앞 단계 대상이 지금 없으면(예: 패널을 열어 채팅 버튼이 숨었다) 이전으로 갈 곳이 없다
          prevBtn.disabled = !steps.slice(0, j).some((x) => !!resolveNow(x) || !!x.prepare);
          nextBtn.textContent = j === steps.length - 1 ? '종료' : '다음';
          if (el) scrollIntoViewIfNeeded(el);
          // 키보드 사용자를 위해 설명 상자로 초점을 옮긴다(스크롤은 건드리지 않게)
          nextBtn.focus({ preventScroll: true });
          return;
        }
        j += dir;
      }
      // 더 갈 단계가 없다 — 앞으로 가던 중이면 끝까지 본 것, 뒤로 가던 중이면 지금 단계에 머문다
      if (dir === 1) stop('done');
      else prevBtn.disabled = true; // 앞 단계 대상이 그새 사라졌다 — 누를 수 없는 버튼으로 남기지 않는다
    } finally {
      busy = false;
    }
  }

  function onClick(e: MouseEvent): void {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'next') {
      if (index >= steps.length - 1) stop('done');
      else void show(index + 1, 1);
    } else if (act === 'prev') {
      if (index > 0) void show(index - 1, -1);
    } else if (act === 'skip') {
      stop('skip');
    } else if (act === 'close') {
      stop('close');
    }
  }

  function onKey(e: KeyboardEvent): void {
    // 페이지에서 글을 쓰는 중이면 화살표는 그쪽 몫이다
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (e.key === 'Escape') {
      stop('close');
    } else if (!typing && e.key === 'ArrowRight') {
      e.preventDefault();
      if (index >= steps.length - 1) stop('done');
      else void show(index + 1, 1);
    } else if (!typing && e.key === 'ArrowLeft') {
      e.preventDefault();
      if (index > 0) void show(index - 1, -1);
    }
  }

  function stop(reason: TourEndReason = 'close'): void {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    root.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    for (const u of undos) u();
    if (active === handle) active = null;
    opts.onEnd(reason);
  }

  root.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey, true);

  const handle: TourHandle = { stop };
  active = handle;
  raf = requestAnimationFrame(place);
  void show(0, 1);
  return handle;
}

/** 다른 모듈에서 대기 조건으로 쓰도록 공개 */
export { waitFor, esc };
