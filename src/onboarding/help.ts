/**
 * 도움말 센터 — 공통 헤더의 ? 버튼으로 여는 오른쪽 서랍(문구는 helpContent.ts, 검색은 helpSearch.ts).
 *
 * 화면 구성
 *   · 머리: HELP CENTER · "무엇을 도와드릴까요?" · 검색창
 *   · 첫 화면: (게이트 안이면) 이 페이지 카드 + "이 페이지 사용법 보기" → 5개 카테고리 → 다시 보기 3종
 *   · 카테고리 화면 → 글 화면. 글에 가이드가 붙어 있으면 "이 페이지 사용법 보기" 버튼이 있다.
 *   · 검색어가 있으면 결과 목록(없으면 빈 결과 안내)이 첫 화면 자리를 대신한다.
 *
 * 가이드 실행·환영 안내 다시 보기는 직접 하지 않고 onboarding.ts가 넘겨준 함수로 부탁한다.
 */

import { HELP_ARTICLES, HELP_CATEGORIES, articleById, articlesForGate, articlesInCategory, type HelpArticle, type HelpCategory, type HelpStatus } from './helpContent';
import { searchHelp } from './helpSearch';
import { tourById, tourForGate } from './tourContent';
import { esc } from './tour';

export interface HelpContext {
  tripId: string | null;
  gate: string | null;
  startTour: (tourId: string) => void;
  replayAll: () => void;
  replayWelcome: () => void;
}

type View = { kind: 'home' } | { kind: 'category'; cat: HelpCategory } | { kind: 'article'; id: string; from: View };

const STATUS_LABEL: Record<HelpStatus, string> = { ok: '지원', part: '일부 지원', no: '미지원' };

/** 게이트 주소 → 사람이 읽는 화면 이름(헤더 eyebrow와 같은 표기) */
const GATE_NAME: Record<string, string> = {
  ideas: 'IDEAS · BRAINSTORM BOARD', shortlist: 'STAY', route: 'ROUTE', timeline: 'TIMELINE',
  go: 'Companion', checklist: 'Checklist', docs: 'Documents', notes: 'Notes', expense: 'Expense', links: 'Links',
};

const IC = {
  x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  replay: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
};

let root: HTMLElement | null = null;

export function isHelpOpen(): boolean {
  return !!root;
}

export function closeHelpCenter(): void {
  if (!root) return;
  const r = root;
  root = null;
  r.classList.remove('is-open');
  document.removeEventListener('keydown', onDocKey, true);
  window.setTimeout(() => r.remove(), 200);
  returnFocus?.focus?.({ preventScroll: true });
}

let returnFocus: HTMLElement | null = null;

function onDocKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeHelpCenter();
  }
}

export function openHelpCenter(ctx: HelpContext): void {
  if (root) return closeHelpCenter();
  returnFocus = document.activeElement as HTMLElement | null;

  const el = document.createElement('div');
  el.className = 'ob-help-layer';
  el.innerHTML =
    '<div class="ob-help-scrim" data-act="close"></div>' +
    '<aside class="ob-help" role="dialog" aria-modal="true" aria-labelledby="ob-help-heading">' +
    '  <header class="ob-help-head">' +
    '    <div class="ob-help-headrow">' +
    '      <span class="ob-help-eyebrow">HELP CENTER</span>' +
    '      <button type="button" class="ob-help-x" data-act="close" aria-label="도움말 닫기">' + IC.x + '</button>' +
    '    </div>' +
    '    <h2 class="ob-help-heading" id="ob-help-heading">무엇을 도와드릴까요?</h2>' +
    '    <label class="ob-help-search">' + IC.search +
    '      <input type="search" id="ob-help-q" placeholder="궁금한 기능을 검색한다 (예: 숙소, 동행자, 문서)" autocomplete="off" />' +
    '    </label>' +
    '  </header>' +
    '  <div class="ob-help-body" id="ob-help-body"></div>' +
    '</aside>';
  document.body.appendChild(el);
  root = el;
  // 다음 프레임에 열어야 미끄러지는 전환이 보인다
  requestAnimationFrame(() => el.classList.add('is-open'));

  const body = el.querySelector('#ob-help-body') as HTMLElement;
  const input = el.querySelector('#ob-help-q') as HTMLInputElement;
  let view: View = { kind: 'home' };

  const gateTour = tourForGate(ctx.gate);

  function articleRow(a: HelpArticle): string {
    const badge = a.status ? '<span class="ob-status ob-status-' + a.status + '">' + STATUS_LABEL[a.status] + '</span>' : '';
    return (
      '<button type="button" class="ob-help-row" data-article="' + a.id + '">' +
      '  <span class="ob-help-row-main"><span class="ob-help-row-title">' + badge + esc(a.title) + '</span>' +
      '  <span class="ob-help-row-sum">' + esc(a.summary) + '</span></span>' + IC.chevron +
      '</button>'
    );
  }

  function homeHtml(): string {
    const parts: string[] = [];
    if (ctx.gate) {
      const name = GATE_NAME[ctx.gate] ?? ctx.gate.toUpperCase();
      const top = articlesForGate(ctx.gate).slice(0, 4);
      parts.push(
        '<section class="ob-help-sec ob-help-here">' +
        '  <div class="ob-help-sec-label">이 페이지 · ' + esc(name) + '</div>' +
        (gateTour
          ? '<button type="button" class="ob-btn ob-btn-primary ob-help-tourbtn" data-tour-run="' + gateTour.id + '">' + IC.play + '이 페이지 사용법 보기</button>'
          : '') +
        (top.length ? '<div class="ob-help-list">' + top.map(articleRow).join('') + '</div>' : '') +
        '</section>',
      );
    }
    parts.push(
      '<section class="ob-help-sec">' +
      '  <div class="ob-help-sec-label">카테고리</div>' +
      '  <div class="ob-help-list">' +
      HELP_CATEGORIES.map((c) =>
        '<button type="button" class="ob-help-row ob-help-cat" data-cat="' + c.key + '">' +
        '  <span class="ob-help-row-main"><span class="ob-help-row-title">' + esc(c.label) +
        '  <span class="ob-help-count">' + articlesInCategory(c.key).length + '</span></span>' +
        '  <span class="ob-help-row-sum">' + esc(c.desc) + '</span></span>' + IC.chevron +
        '</button>',
      ).join('') +
      '  </div>' +
      '</section>',
    );
    const inTrip = !!ctx.tripId;
    parts.push(
      '<section class="ob-help-sec">' +
      '  <div class="ob-help-sec-label">다시 보기</div>' +
      '  <div class="ob-help-replays">' +
      '    <button type="button" class="ob-help-replay" data-replay="all"' + (inTrip ? '' : ' disabled') + '>' + IC.replay +
      '      <span><b>전체 사용법 다시 보기</b><small>' + (inTrip ? 'IDEAS부터 페이지별 가이드를 차례로 본다' : '여행을 열면 실행할 수 있다') + '</small></span></button>' +
      '    <button type="button" class="ob-help-replay" data-replay="page"' + (gateTour ? '' : ' disabled') + '>' + IC.replay +
      '      <span><b>현재 페이지 가이드 다시 실행</b><small>' + (gateTour ? esc(gateTour.label) : '이 화면에는 가이드가 없다') + '</small></span></button>' +
      '    <button type="button" class="ob-help-replay" data-replay="welcome">' + IC.replay +
      '      <span><b>최초 환영 안내 다시 보기</b><small>모으기 · 정하기 · 떠나기</small></span></button>' +
      '  </div>' +
      '</section>',
    );
    return parts.join('');
  }

  function categoryHtml(cat: HelpCategory): string {
    const c = HELP_CATEGORIES.find((x) => x.key === cat)!;
    return (
      '<button type="button" class="ob-help-back" data-back>' + IC.back + '도움말 홈</button>' +
      '<h3 class="ob-help-title">' + esc(c.label) + '</h3>' +
      '<p class="ob-help-lead">' + esc(c.desc) + '</p>' +
      '<div class="ob-help-list">' + articlesInCategory(cat).map(articleRow).join('') + '</div>'
    );
  }

  function articleHtml(a: HelpArticle, from: View): string {
    const cat = HELP_CATEGORIES.find((x) => x.key === a.category)!;
    const backLabel = from.kind === 'category' ? cat.label : '도움말 홈';
    const tour = a.tour ? tourById(a.tour) : null;
    // 가이드는 그 화면에서만 돈다 — 다른 화면 가이드면 여행 안에서만(이동해서) 실행할 수 있다
    const canRun = !!tour && (!tour.gate || tour.gate === ctx.gate || !!ctx.tripId);
    const statusHtml = a.status ? '<span class="ob-status ob-status-' + a.status + '">' + STATUS_LABEL[a.status] + '</span>' : '';
    return (
      '<button type="button" class="ob-help-back" data-back>' + IC.back + esc(backLabel) + '</button>' +
      '<div class="ob-help-sec-label">' + esc(cat.label) + '</div>' +
      '<h3 class="ob-help-title">' + statusHtml + esc(a.title) + '</h3>' +
      '<p class="ob-help-lead">' + esc(a.summary) + '</p>' +
      (a.steps?.length ? '<ol class="ob-help-steps">' + a.steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>' : '') +
      (a.paragraphs?.length ? a.paragraphs.map((p) => '<p class="ob-help-p">' + esc(p) + '</p>').join('') : '') +
      (tour
        ? '<div class="ob-help-tourbox">' +
          '<button type="button" class="ob-btn ob-btn-primary ob-help-tourbtn" data-tour-run="' + tour.id + '"' + (canRun ? '' : ' disabled') + '>' + IC.play + '이 페이지 사용법 보기</button>' +
          '<span class="ob-help-tourhint">' + (canRun ? esc(tour.label) + ' 화면에서 실제 버튼을 짚어 준다' : '여행을 열면 실행할 수 있다') + '</span>' +
          '</div>'
        : '')
    );
  }

  function searchHtml(qstr: string): string {
    const results = searchHelp(HELP_ARTICLES, qstr);
    if (!results.length) {
      return (
        '<div class="ob-help-empty">' +
        '  <div class="ob-help-empty-title">‘' + esc(qstr.trim()) + '’에 맞는 도움말이 없다</div>' +
        '  <p>낱말을 줄이거나 다른 말로 찾아본다. 예: 숙소, 동선, 초대, 문서, 정산</p>' +
        '  <button type="button" class="ob-btn ob-btn-ghost" data-clear>카테고리에서 찾기</button>' +
        '</div>'
      );
    }
    return '<div class="ob-help-sec-label">검색 결과 ' + results.length + '건</div><div class="ob-help-list">' + results.map(articleRow).join('') + '</div>';
  }

  function render(): void {
    const qstr = input.value;
    if (qstr.trim()) body.innerHTML = searchHtml(qstr);
    else if (view.kind === 'home') body.innerHTML = homeHtml();
    else if (view.kind === 'category') body.innerHTML = categoryHtml(view.cat);
    else {
      const a = articleById(view.id);
      body.innerHTML = a ? articleHtml(a, view.from) : homeHtml();
    }
    body.scrollTop = 0;
  }

  function go(v: View): void {
    view = v;
    render();
  }

  input.addEventListener('input', () => {
    // 검색 결과에서 글을 열었다가 검색어를 바꾸면 결과 목록으로 돌아간다
    view = { kind: 'home' };
    render();
  });

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-act="close"]')) return closeHelpCenter();
    const art = t.closest<HTMLElement>('[data-article]');
    if (art) {
      const from: View = input.value.trim() ? { kind: 'home' } : view;
      input.value = '';
      return go({ kind: 'article', id: art.dataset.article!, from });
    }
    const cat = t.closest<HTMLElement>('[data-cat]');
    if (cat) return go({ kind: 'category', cat: cat.dataset.cat as HelpCategory });
    if (t.closest('[data-back]')) return go(view.kind === 'article' ? view.from : { kind: 'home' });
    if (t.closest('[data-clear]')) {
      input.value = '';
      input.focus();
      return go({ kind: 'home' });
    }
    const run = t.closest<HTMLButtonElement>('[data-tour-run]');
    if (run && !run.disabled) {
      closeHelpCenter();
      return ctx.startTour(run.dataset.tourRun!);
    }
    const rep = t.closest<HTMLButtonElement>('[data-replay]');
    if (rep && !rep.disabled) {
      closeHelpCenter();
      const kind = rep.dataset.replay;
      if (kind === 'all') ctx.replayAll();
      else if (kind === 'page' && gateTour) ctx.startTour(gateTour.id);
      else if (kind === 'welcome') ctx.replayWelcome();
    }
  });

  document.addEventListener('keydown', onDocKey, true);
  render();
  input.focus({ preventScroll: true });
}
