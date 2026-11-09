/**
 * 도움말 검색 — 정적 데이터에서 제목·키워드·요약·본문을 비교한다(AI 검색 없음, 사용자 결정).
 *
 * 한국어는 띄어쓰기가 들쭉날쭉해서("새여행"/"새 여행") 공백을 지우고 비교한다.
 * 검색어가 여러 낱말이면 **모든 낱말이 어딘가에 있어야** 결과에 든다(하나만 맞는 글이 위로 섞이지 않게).
 * 점수: 제목 > 키워드 > 요약 > 본문.
 */

import type { HelpArticle } from './helpContent';

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

function fieldScore(a: HelpArticle, token: string): number {
  const t = norm(token);
  if (!t) return 0;
  let score = 0;
  if (norm(a.title).includes(t)) score += 10;
  if (a.keywords.some((k) => norm(k).includes(t) || (t.length >= 2 && t.includes(norm(k))))) score += 6;
  if (norm(a.summary).includes(t)) score += 3;
  const body = [...(a.steps ?? []), ...(a.paragraphs ?? [])].join(' ');
  if (norm(body).includes(t)) score += 1;
  return score;
}

export function searchHelp(articles: readonly HelpArticle[], query: string, limit = 20): HelpArticle[] {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const scored: Array<{ a: HelpArticle; score: number; i: number }> = [];
  articles.forEach((a, i) => {
    let total = 0;
    for (const tok of tokens) {
      const s = fieldScore(a, tok);
      if (s === 0) return; // 낱말 하나라도 없으면 제외
      total += s;
    }
    // 전체 검색어를 한 덩어리로도 비교(띄어쓰기 없이 친 "새여행" 같은 경우)
    if (tokens.length > 1) total += fieldScore(a, tokens.join(''));
    scored.push({ a, score: total, i });
  });
  return scored.sort((x, y) => y.score - x.score || x.i - y.i).slice(0, limit).map((x) => x.a);
}
