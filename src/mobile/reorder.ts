/**
 * 길게 눌러 끌어서 순서 바꾸기 — 모바일 일정 목록용 제스처.
 *
 * 동작
 *   1. 카드를 **0.45초 누르고 있으면** 카드가 떠오른다(진동 한 번). 그 전에 손가락이 움직이면 그냥
 *      스크롤이다 — 목록을 넘기려는 손과 구분하려는 것이다.
 *   2. 떠오른 뒤에는 손가락을 따라 위아래로 움직이고, 놓을 자리에 파란 줄이 보인다. 화면 위·아래
 *      끝에 가면 목록이 저절로 스크롤된다.
 *   3. 놓으면 `onDrop(from, to)`를 한 번 부른다. `to`는 **옮긴 뒤의 위치(0부터)** 다.
 *
 * 순서를 계산하는 함수(`dropIndex`, `moveItem`)는 DOM을 몰라서 따로 테스트한다(reorder.test.ts).
 * 키보드로도 쓸 수 있게 카드에서 Alt+↑/↓를 누르면 한 칸씩 옮긴다.
 */

/** 배열에서 `from` 번째를 빼서 `to` 번째로 끼운 **새 배열** */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, item);
  return out;
}

/**
 * 손가락의 세로 위치(`y`)가 나머지 카드들 사이 어디인지 → 끼워 넣을 자리(0부터).
 * `centers`는 **끌고 있는 카드를 뺀** 카드들의 세로 중심 좌표(위에서 아래 순서)다.
 */
export function dropIndex(centers: readonly number[], y: number): number {
  let n = 0;
  for (const c of centers) if (y > c) n += 1;
  return n;
}

export interface ReorderOptions {
  /** 카드들의 부모 — 놓을 자리 표시 줄이 이 안에 그려진다(position: relative여야 한다) */
  thread: HTMLElement;
  /** 세로 스크롤 컨테이너 — 끝에 가면 자동 스크롤한다 */
  scroller: HTMLElement;
  /** 순서 단위인 카드 요소 선택자 (thread 안에서) */
  rowSelector: string;
  /** 눌러도 끌기를 시작하지 않을 요소(버튼·링크) */
  ignoreSelector: string;
  /** 지금 끌기를 시작해도 되나 — 저장 중이거나 순서를 못 바꾸는 날이면 false */
  canStart: () => boolean;
  onStart: () => void;
  /** 끌기가 끝났다(놓았든 취소됐든) — 미뤄 둔 화면 갱신을 이때 한다 */
  onEnd: () => void;
  /** 순서가 실제로 바뀌게 놓았다. to = 옮긴 뒤 위치 */
  onDrop: (from: number, to: number) => void;
  longPressMs?: number;
}

const MOVE_SLOP_PX = 9;
const EDGE_PX = 72;
const MAX_SCROLL_PX = 14;

/** 제스처를 붙인다. 돌려주는 함수를 부르면 모두 떼어 낸다(화면을 다시 그리기 전에 호출). */
export function bindLongPressReorder(opts: ReorderOptions): () => void {
  const { thread, scroller, rowSelector, ignoreSelector } = opts;
  const holdMs = opts.longPressMs ?? 450;
  const rows = (): HTMLElement[] => Array.from(thread.querySelectorAll<HTMLElement>(rowSelector));

  let pending: { row: HTMLElement; pointerId: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  let drag: {
    row: HTMLElement;
    from: number;
    pointerId: number;
    startY: number;
    startScroll: number;
    lastY: number;
    to: number;
    raf: number | null;
    line: HTMLElement;
  } | null = null;
  /** 끌기를 끝낸 직후의 클릭(카드의 "상세 열기")은 무시한다 */
  let suppressClickUntil = 0;

  const cancelPending = () => {
    if (pending) { clearTimeout(pending.timer); pending = null; }
  };

  const others = (): HTMLElement[] => rows().filter((r) => r !== drag?.row);

  /** 지금 손가락 위치 기준으로 놓을 자리를 갱신하고 표시 줄을 옮긴다 */
  const refreshTarget = () => {
    if (!drag) return;
    const list = others();
    const centers = list.map((r) => {
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2;
    });
    drag.to = dropIndex(centers, drag.lastY);

    const tb = thread.getBoundingClientRect();
    let y: number;
    if (!list.length) y = 0;
    else if (drag.to >= list.length) y = list[list.length - 1].getBoundingClientRect().bottom - tb.top + 2;
    else y = list[drag.to].getBoundingClientRect().top - tb.top - 3;
    drag.line.style.transform = 'translateY(' + Math.round(y) + 'px)';
  };

  const applyTransform = () => {
    if (!drag) return;
    const dy = drag.lastY - drag.startY + (scroller.scrollTop - drag.startScroll);
    drag.row.style.transform = 'translate3d(0,' + Math.round(dy) + 'px,0) scale(1.015)';
  };

  /** 화면 위·아래 끝에 손가락이 가면 목록을 저절로 넘긴다 */
  const autoScroll = () => {
    if (!drag) return;
    const sb = scroller.getBoundingClientRect();
    let v = 0;
    if (drag.lastY < sb.top + EDGE_PX) v = -Math.min(1, (sb.top + EDGE_PX - drag.lastY) / EDGE_PX) * MAX_SCROLL_PX;
    else if (drag.lastY > sb.bottom - EDGE_PX) v = Math.min(1, (drag.lastY - (sb.bottom - EDGE_PX)) / EDGE_PX) * MAX_SCROLL_PX;
    if (v !== 0) {
      const before = scroller.scrollTop;
      scroller.scrollTop += v;
      if (scroller.scrollTop !== before) { applyTransform(); refreshTarget(); }
    }
    drag.raf = requestAnimationFrame(autoScroll);
  };

  const startDrag = (p: NonNullable<typeof pending>) => {
    const list = rows();
    const from = list.indexOf(p.row);
    if (from < 0 || !opts.canStart()) { pending = null; return; }
    pending = null;

    const line = document.createElement('div');
    line.className = 'mb-drop-line';
    line.setAttribute('aria-hidden', 'true');
    thread.appendChild(line);

    drag = { row: p.row, from, pointerId: p.pointerId, startY: p.y, startScroll: scroller.scrollTop, lastY: p.y, to: from, raf: null, line };
    p.row.classList.add('is-lifted');
    thread.classList.add('is-reordering');
    try { p.row.setPointerCapture(p.pointerId); } catch { /* 이미 놓았거나 지원 안 함 */ }
    try { navigator.vibrate?.(12); } catch { /* 진동 없는 기기 */ }
    opts.onStart();
    applyTransform();
    refreshTarget();
    drag.raf = requestAnimationFrame(autoScroll);
  };

  const finish = (commit: boolean) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.raf != null) cancelAnimationFrame(d.raf);
    try { d.row.releasePointerCapture(d.pointerId); } catch { /* noop */ }
    d.row.classList.remove('is-lifted');
    d.row.style.transform = '';
    thread.classList.remove('is-reordering');
    d.line.remove();
    suppressClickUntil = Date.now() + 450;
    opts.onEnd();
    if (commit && d.to !== d.from) opts.onDrop(d.from, d.to);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (drag || pending) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (!target || target.closest(ignoreSelector)) return;
    const row = target.closest<HTMLElement>(rowSelector);
    if (!row || !thread.contains(row)) return;
    const p = {
      row,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => { if (pending) startDrag(pending); }, holdMs),
    };
    pending = p;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (pending && e.pointerId === pending.pointerId) {
      // 누르고 있는 동안 손가락이 움직이면 스크롤하려는 것 — 끌기가 아니다
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > MOVE_SLOP_PX) cancelPending();
      return;
    }
    if (drag && e.pointerId === drag.pointerId) {
      drag.lastY = e.clientY;
      applyTransform();
      refreshTarget();
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (pending && e.pointerId === pending.pointerId) cancelPending();
    if (drag && e.pointerId === drag.pointerId) finish(true);
  };

  const onPointerCancel = (e: PointerEvent) => {
    if (pending && e.pointerId === pending.pointerId) cancelPending();
    if (drag && e.pointerId === drag.pointerId) finish(false);
  };

  /** 끌고 있는 동안에는 손가락 움직임이 화면 스크롤로 넘어가지 않게 막는다(떠오르기 전엔 스크롤이 그대로 된다) */
  const onTouchMove = (e: TouchEvent) => {
    if (drag && e.cancelable) e.preventDefault();
  };

  const onContextMenu = (e: Event) => {
    if (pending || drag) e.preventDefault(); // 안드로이드 길게 누르기 메뉴
  };

  const onClickCapture = (e: Event) => {
    if (Date.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  /** 키보드: 카드에 초점을 두고 Alt+↑/↓로 한 칸씩 */
  const onKeyDown = (e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>(rowSelector);
    if (!row || !opts.canStart()) return;
    const list = rows();
    const from = list.indexOf(row);
    const to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (from < 0 || to < 0 || to >= list.length) return;
    e.preventDefault();
    opts.onDrop(from, to);
  };

  thread.addEventListener('pointerdown', onPointerDown);
  thread.addEventListener('pointermove', onPointerMove);
  thread.addEventListener('pointerup', onPointerUp);
  thread.addEventListener('pointercancel', onPointerCancel);
  thread.addEventListener('contextmenu', onContextMenu);
  thread.addEventListener('click', onClickCapture, true);
  thread.addEventListener('keydown', onKeyDown);
  scroller.addEventListener('touchmove', onTouchMove, { passive: false });

  return () => {
    cancelPending();
    if (drag) finish(false);
    thread.removeEventListener('pointerdown', onPointerDown);
    thread.removeEventListener('pointermove', onPointerMove);
    thread.removeEventListener('pointerup', onPointerUp);
    thread.removeEventListener('pointercancel', onPointerCancel);
    thread.removeEventListener('contextmenu', onContextMenu);
    thread.removeEventListener('click', onClickCapture, true);
    thread.removeEventListener('keydown', onKeyDown);
    scroller.removeEventListener('touchmove', onTouchMove);
  };
}
