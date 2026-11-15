/**
 * 도움말 검색·게이트별 우선 항목·가이드 내용의 정합성.
 */

import { describe, it, expect } from 'vitest';
import { searchHelp } from './helpSearch';
import { HELP_ARTICLES, articlesForGate, articleById } from './helpContent';
import { TOURS, tourById, tourForGate, stepsFor, recordIdFor } from './tourContent';

const ids = (list: { id: string }[]) => list.map((a) => a.id);

describe('검색', () => {
  it("'숙소' → STAY 사용법이 맨 위", () => {
    expect(ids(searchHelp(HELP_ARTICLES, '숙소'))[0]).toBe('plan-stay');
  });
  it("'동행자' → 초대가 결과에 있다", () => {
    expect(ids(searchHelp(HELP_ARTICLES, '동행자'))).toContain('invite');
  });
  it("'예약' → 문서 사용법이 결과에 있다", () => {
    const r = ids(searchHelp(HELP_ARTICLES, '예약'));
    expect(r).toContain('documents');
  });
  it('띄어쓰기 없이 쳐도 찾는다', () => {
    expect(ids(searchHelp(HELP_ARTICLES, '새여행'))).toContain('first-trip');
  });
  it('여러 낱말은 모두 맞는 글만', () => {
    const r = searchHelp(HELP_ARTICLES, '문서 업로드');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((a) => JSON.stringify(a).includes('문서') && /업로드/.test(JSON.stringify(a)))).toBe(true);
  });
  it('없는 말이면 빈 결과, 빈 검색어도 빈 결과', () => {
    expect(searchHelp(HELP_ARTICLES, '우주정거장')).toEqual([]);
    expect(searchHelp(HELP_ARTICLES, '   ')).toEqual([]);
  });
});

describe('현재 페이지 우선', () => {
  it('IDEAS: 사용법 → GATE → 장소 추가 → Monthly Picks → 지도', () => {
    expect(ids(articlesForGate('ideas')).slice(0, 5)).toEqual(['plan-ideas', 'ideas-gates', 'ideas-add', 'ideas-picks', 'ideas-map']);
  });
  it('게이트가 없으면(내 여행 화면) 빈 목록', () => {
    expect(articlesForGate(null)).toEqual([]);
  });
});

describe('내용 정합성', () => {
  it('글 id가 겹치지 않는다', () => {
    expect(new Set(ids(HELP_ARTICLES)).size).toBe(HELP_ARTICLES.length);
  });
  it('글이 가리키는 가이드는 실제로 있다', () => {
    for (const a of HELP_ARTICLES) if (a.tour) expect(tourById(a.tour), a.id).not.toBeNull();
  });
  it('가이드는 2~6단계, 게이트당 하나', () => {
    for (const t of TOURS) {
      for (const steps of [t.steps, t.mobileSteps ?? t.steps]) {
        expect(steps.length, t.id).toBeGreaterThanOrEqual(2);
        expect(steps.length, t.id).toBeLessThanOrEqual(6);
      }
    }
    const gates = TOURS.map((t) => t.gate).filter(Boolean);
    expect(new Set(gates).size).toBe(gates.length);
    expect(tourForGate('shortlist')?.id).toBe('stay');
    expect(tourForGate('go')?.id).toBe('companion'); // 폰에서 여행을 열면 처음 보는 화면
    // Assistant 가이드는 게이트에 붙지 않는다 — 채팅 패널을 처음 열 때 뜬다
    expect(tourById('assistant')?.gate).toBeUndefined();
    expect(tourById('assistant')?.steps.length).toBe(2);
  });
  it('폰 단계 — 폰 단계를 둔 가이드만 폰에서 바뀌고, 본 기록도 따로 남긴다', () => {
    const ideas = tourById('ideas')!;
    expect(stepsFor(ideas, true)).toBe(ideas.mobileSteps);
    expect(stepsFor(ideas, false)).toBe(ideas.steps);
    expect(recordIdFor(ideas, true)).toBe('ideas:m');
    expect(recordIdFor(ideas, false)).toBe('ideas');
    // Companion은 원래 폰 화면이라 PC·폰이 같은 단계·같은 기록
    const comp = tourById('companion')!;
    expect(stepsFor(comp, true)).toBe(comp.steps);
    expect(recordIdFor(comp, true)).toBe('companion');
    // IDEAS 폰 단계는 PC 전용 게이트 열 대신 폰의 게이트 탭을 가리킨다
    expect(ideas.mobileSteps!.map((x) => x.target)).toContain('brainstorm-mtabs');
    expect(ideas.mobileSteps!.map((x) => x.target)).not.toContain('brainstorm-gates');
  });
  it('FAQ에는 지원 상태가 붙어 있다', () => {
    for (const a of HELP_ARTICLES.filter((x) => x.category === 'faq')) expect(a.status, a.id).toBeTruthy();
    expect(articleById('faq-receipt')?.status).toBe('no');
  });
});
