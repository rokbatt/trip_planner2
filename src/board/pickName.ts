/**
 * AI Monthly Picks의 장소 이름 다듬기.
 *
 * 추천은 Gemini + Google 웹 검색이 고른 **이름(글자)** 이고, ＋를 누를 때 그 이름으로 Google 지도에서 장소를 찾는다.
 * 모델이 마크다운을 섞어 "**왕궁 (The Grand Palace)**: 방콕의 대표 명소…"처럼 주면 화면에 **가 보이고,
 * 설명까지 통째로 검색어가 돼 장소를 못 찾는다. 그래서 굵게 표시·번호·설명을 떼고 이름만 남긴다.
 * 서버(`api/monthly-picks.ts`)에도 같은 규칙이 인라인으로 있다(api 파일은 자립형) — 고치면 같이 고친다.
 * 이미 캐시된 옛 추천도 화면에서 이 함수를 거치므로 바로 깨끗하게 보인다.
 */

/** 추천 한 줄 → 장소 이름만 (없으면 빈 문자열) */
export function cleanPickName(raw: string): string {
  let s = String(raw ?? '').normalize('NFC');
  s = s.replace(/\*\*|__|`/g, '');
  s = s.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '');
  // 이름 뒤의 설명: "이름: 설명", "이름 - 설명", "이름 — 설명"
  s = s.split(/[:：]|\s[-–—]\s/)[0];
  return s.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * 지도 검색어 후보(앞에서부터 시도). "왕궁 (The Grand Palace)"처럼 괄호가 있으면
 * 전체 → 괄호 안(대개 현지·영문 이름) → 괄호 밖 순서로 하나씩 더 시도한다.
 */
export function pickSearchQueries(name: string, destination: string): string[] {
  const base = cleanPickName(name);
  if (!base) return [];
  const variants = [base];
  const m = base.match(/^(.*?)\s*[(（]([^()（）]+)[)）]\s*$/);
  if (m) variants.push(m[2].trim(), m[1].trim());
  const dest = String(destination ?? '').trim();
  const out: string[] = [];
  for (const v of variants) {
    if (!v) continue;
    const q = dest ? v + ' ' + dest : v;
    if (!out.includes(q)) out.push(q);
  }
  return out;
}
