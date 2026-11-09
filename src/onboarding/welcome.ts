/**
 * 최초 환영 안내 — 화면 가운데 창 하나(문구는 welcomeContent.ts).
 *
 * "시작하기"·"건너뛰기"·✕·Esc·바깥 클릭, 어떻게 닫든 결과만 알려 준다(기록은 onboarding.ts).
 * "건너뛰기"와 "다시 보지 않기"는 하나로 합쳤다(사용자 결정) — 그래서 버튼은 둘뿐이다.
 */

import { WELCOME_COPY } from './welcomeContent';
import { esc } from './tour';

export type WelcomeResult = 'start' | 'skip';

const IC_FLOW = [
  // 모으기 — 핀
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/></svg>',
  // 정하기 — 경로
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 18h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h6" transform="translate(0 2)"/></svg>',
  // 떠나기 — 휴대폰
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/></svg>',
];

let openEl: HTMLElement | null = null;

export function isWelcomeOpen(): boolean {
  return !!openEl;
}

export function showWelcome(onClose: (result: WelcomeResult) => void): void {
  if (openEl) return;
  const c = WELCOME_COPY;
  const overlay = document.createElement('div');
  overlay.className = 'ob-welcome-overlay';
  overlay.innerHTML =
    '<div class="ob-welcome" role="dialog" aria-modal="true" aria-labelledby="ob-welcome-title">' +
    '  <button type="button" class="ob-welcome-x" data-act="skip" aria-label="닫기">' +
    '    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
    '  </button>' +
    '  <div class="ob-welcome-label">' + esc(c.label) + '</div>' +
    '  <h2 class="ob-welcome-title" id="ob-welcome-title">' + esc(c.title) + '</h2>' +
    '  <p class="ob-welcome-intro">' + esc(c.intro) + '</p>' +
    '  <ol class="ob-welcome-flow">' +
    c.flow.map((f, i) =>
      '<li class="ob-flow-item">' +
      '  <div class="ob-flow-icon">' + IC_FLOW[i] + '</div>' +
      '  <div class="ob-flow-step"><span>' + String(i + 1).padStart(2, '0') + '</span>' + esc(f.step) + '</div>' +
      '  <div class="ob-flow-title">' + esc(f.title) + '</div>' +
      '  <p class="ob-flow-body">' + esc(f.body) + '</p>' +
      '  <div class="ob-flow-gates">' + f.gates.map((g) => '<span>' + esc(g) + '</span>').join('') + '</div>' +
      '</li>',
    ).join('') +
    '  </ol>' +
    '  <div class="ob-welcome-actions">' +
    '    <button type="button" class="ob-btn ob-btn-ghost" data-act="skip">' + esc(c.skip) + '</button>' +
    '    <button type="button" class="ob-btn ob-btn-primary ob-btn-lg" data-act="start">' + esc(c.start) + '</button>' +
    '  </div>' +
    '</div>';

  const prevFocus = document.activeElement as HTMLElement | null;

  function close(result: WelcomeResult): void {
    if (!openEl) return;
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    openEl = null;
    prevFocus?.focus?.({ preventScroll: true });
    onClose(result);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      close('skip');
    } else if (e.key === 'Tab') {
      // 창 안에서만 초점이 돈다
      const f = Array.from(overlay.querySelectorAll<HTMLElement>('button'));
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) return close('skip');
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'start') close('start');
    else if (act === 'skip') close('skip');
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  openEl = overlay;
  (overlay.querySelector('[data-act="start"]') as HTMLElement).focus({ preventScroll: true });
}
