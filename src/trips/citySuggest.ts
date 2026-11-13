/**
 * 목적지 도시 자동완성의 "무엇을 추천할지" — DOM 없이 순수 함수만 둔다(화면은 cityAutocomplete.ts).
 *
 * 후보는 airports.ts의 도시→공항 표를 그대로 쓴다. 표에 있는 이름으로 저장되면 보딩패스의
 * 공항코드(방콕 → BKK)도 같이 맞아떨어지므로, 오타 방지와 코드 매칭이 한 번에 해결된다.
 * 네트워크 요청이 없어서 타이핑마다 불러도 비용이 들지 않는다.
 */
import { airportCityEntries } from './airports';

export interface CitySuggestion {
  name: string;
  en: string;
  code: string;
}

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const CHO = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
// 겹모음·겹받침은 타이핑 순서대로 풀어 둔다 — "괌"을 치는 도중의 "고", "멜버른"을 치는 도중의
// "멟"(ㄹ+ㅂ이 잠깐 한 받침으로 묶인 상태)이 각각 앞부분으로 인식되려면 필요하다.
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅗㅏ', 'ㅗㅐ', 'ㅗㅣ', 'ㅛ', 'ㅜ', 'ㅜㅓ', 'ㅜㅔ', 'ㅜㅣ', 'ㅠ', 'ㅡ', 'ㅡㅣ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄱㅅ', 'ㄴ', 'ㄴㅈ', 'ㄴㅎ', 'ㄷ', 'ㄹ', 'ㄹㄱ', 'ㄹㅁ', 'ㄹㅂ', 'ㄹㅅ', 'ㄹㅌ', 'ㄹㅍ', 'ㄹㅎ', 'ㅁ', 'ㅂ', 'ㅂㅅ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/**
 * 한글 음절을 자판으로 친 순서의 낱자로 푼다(방콕 → ㅂㅏㅇㅋㅗㄱ). 한글이 아닌 글자는 그대로.
 *
 * 글자 단위로 비교하면 조합 중인 입력이 걸리지 않는다 — "방ㅋ"는 "방콕"의 앞부분이 아니고,
 * "사"도 "삿포로"의 앞부분이 아니다. 낱자로 풀어 비교하면 둘 다 앞부분이 된다.
 */
export function toJamo(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < HANGUL_BASE || code > HANGUL_LAST) {
      out += ch;
      continue;
    }
    const idx = code - HANGUL_BASE;
    out += CHO[Math.floor(idx / 588)] + JUNG[Math.floor((idx % 588) / 28)] + JONG[idx % 28];
  }
  return out;
}

const compact = (s: string) => s.replace(/\s+/g, '').toLowerCase();

interface Candidate extends CitySuggestion {
  key: string;
  jamo: string;
  enKey: string;
  codeKey: string;
}

let cache: Candidate[] | null = null;
function candidates(): Candidate[] {
  cache ??= airportCityEntries().map((c) => {
    const key = compact(c.name);
    return { ...c, key, jamo: toJamo(key), enKey: compact(c.en), codeKey: c.code.toLowerCase() };
  });
  return cache;
}

/**
 * 입력 중인 글자로 시작하는 도시를 추천한다. 순서는 ①입력과 똑같은 도시 ②글자 그대로 앞부분이
 * 같은 도시 ③낱자 기준으로 앞부분이 같은 도시 ④영문 이름·공항코드로 찾은 도시이고, 같은 단계
 * 안에서는 표에 적힌 순서(가까운 지역 먼저)를 따른다.
 *
 * ①이 따로 있는 이유: 첫 후보는 Enter 한 번으로 선택되는데, "인도"를 다 치고 Enter를 눌렀을 때
 * 표에서 먼저 나오는 "인도네시아"로 바뀌면 안 된다.
 *
 * exclude에는 같은 칸에 이미 적어 둔 다른 도시를 넘긴다 — 방금 고른 도시를 또 추천하지 않기 위함.
 */
export function suggestCities(query: string, exclude: string[] = [], limit = 6): CitySuggestion[] {
  const q = compact(query);
  if (!q) return [];
  const qJamo = toJamo(q);
  const skip = new Set(exclude.map(compact));

  const tiers: Candidate[][] = [[], [], [], []];
  for (const c of candidates()) {
    if (skip.has(c.key)) continue;
    if (c.key === q) tiers[0].push(c);
    else if (c.key.startsWith(q)) tiers[1].push(c);
    else if (c.jamo.startsWith(qJamo)) tiers[2].push(c);
    else if (c.enKey.startsWith(q) || c.codeKey.startsWith(q)) tiers[3].push(c);
  }

  // 표에는 같은 곳을 가리키는 다른 표기가 섞여 있다(상하이/상해, 빈/비엔나) — 한 번만 보여준다
  const seenEn = new Set<string>();
  const out: CitySuggestion[] = [];
  for (const c of tiers.flat()) {
    if (seenEn.has(c.en)) continue;
    seenEn.add(c.en);
    out.push({ name: c.name, en: c.en, code: c.code });
    if (out.length === limit) break;
  }

  // 이미 그 도시를 정확히 다 쳤고 다른 후보도 없으면 더 추천할 게 없다
  if (out.length === 1 && compact(out[0].name) === q) return [];
  return out;
}

export interface CityToken {
  start: number;
  end: number;
  /** 커서가 놓인 조각(앞뒤 공백 제외) */
  text: string;
  /** 같은 칸에 적힌 나머지 도시들 */
  others: string[];
}

/** "방콕, 파ㅌ"처럼 콤마로 여러 도시를 적는 칸에서, 커서가 놓인 조각 하나를 찾는다. */
export function tokenAtCaret(value: string, caret: number): CityToken {
  const start = caret > 0 ? value.lastIndexOf(',', caret - 1) + 1 : 0;
  const nextComma = value.indexOf(',', caret);
  const end = nextComma === -1 ? value.length : nextComma;
  const others = (value.slice(0, start) + value.slice(end))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { start, end, text: value.slice(start, end).trim(), others };
}

/** 그 조각만 고른 도시 이름으로 바꾼다. 콤마 뒤 띄어쓰기는 사용자가 친 그대로 둔다. */
export function replaceToken(
  value: string,
  token: Pick<CityToken, 'start' | 'end'>,
  name: string,
): { value: string; caret: number } {
  const lead = /^\s*/.exec(value.slice(token.start, token.end))![0];
  const head = value.slice(0, token.start) + lead + name;
  return { value: head + value.slice(token.end), caret: head.length };
}
