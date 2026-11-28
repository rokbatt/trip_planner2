/**
 * Companion "가이드" 탭(PRO) — 오늘 갈 곳을 알고 가면 더 많이 보인다.
 *
 *  · 관광지(VISIT 등): 역사 · 관람 포인트 · 팁을 가이드처럼. 식당(FOOD): 대표 메뉴 · 가격대 · 팁.
 *  · 장소와 다음 장소 사이 "가는 길": 길 양옆에서 지나치기 쉬운 곳의 유래를 짚어 준다.
 *  · 글은 서버(/api/ai kind 'place-story' · 'route-story')가 웹 검색으로 쓰고 장소 신원별로 한 번만 만들어 모두가 나눠 쓴다.
 *    이 기기에도 30일 저장해서 다시 열면 호출이 없고 오프라인에서도 읽힌다.
 *  · 사진은 장소의 저장된 사진 + Google 장소 사진(브라우저, 열 때만), 가는 길 곳은 AI가 말한 이름을 **실제 장소로 확인**하고
 *    길에서 너무 먼 곳은 버린다(원칙 3-1). 가격·연도는 서버가 글에 적힌 것만 받고 화면에 "참고용"으로 밝힌다.
 *
 * 순수 계산(대상 고르기·구간 쌍·길 위 확인·저장)은 아래에, 화면은 맨 아래에 있다 — guide.test.ts.
 */

import type { TlDay, TlStop } from '../timeline/dayModel';
import { apiFetch } from '../utils/apiFetch';
import { escapeHtml, safeHttpUrl } from '../utils/html';
import { estimateLegBetween } from '../utils/travelEstimate';
import { straightMeters } from './explore';
import { fetchDetail, searchText, type ExplorePlace } from './exploreApi';

/* ══════════════ 이름 — 한 곳에서 바꾼다 ══════════════ */
export const GUIDE_TAB_LABEL = '가이드';
export const GUIDE_TITLE = '오늘의 가이드';
export const GUIDE_TAGLINE = '아는 만큼 보이는 하루';

/* ══════════════ 순수 계산 ══════════════ */

export type GuideKind = 'visit' | 'food';

/** 이 정류지에 이야기를 붙일 수 있나 — 실제 장소(이름·좌표)가 있는 관광지·식당·체험·쇼핑만 */
export function guideKind(s: TlStop): GuideKind | null {
  if (s.purpose || !s.place || s.lat == null || s.lng == null) return null;
  if (s.cat === 'FOOD') return 'food';
  if (s.cat === 'VISIT' || s.cat === 'ACTIVITY' || s.cat === 'SHOPPING') return 'visit';
  return null;
}

export interface GuideLeg {
  key: string;
  from: TlStop;
  to: TlStop;
  meters: number;
  mode: 'WALK' | 'TRANSIT' | 'TAXI';
  min: number;
}

/** 이 DAY에서 바로 이어지는 두 실제 장소(숙소·공항 포함) 사이 — 숙소 들르기·식사 자리 같은 "장소 미정"은 건너뛴다 */
export function guideLegs(day: TlDay): GuideLeg[] {
  const real = day.stops.filter((s) => !s.purpose && s.lat != null && s.lng != null);
  const out: GuideLeg[] = [];
  for (let i = 0; i < real.length - 1; i++) {
    const from = real[i];
    const to = real[i + 1];
    const meters = straightMeters({ lat: from.lat!, lng: from.lng! }, { lat: to.lat!, lng: to.lng! });
    if (meters < 120 || meters > 8000) continue; // 바로 옆이거나 너무 먼 구간은 짚을 게 없거나 짚을 수 없다
    const leg = estimateLegBetween({ lat: from.lat!, lng: from.lng! }, { lat: to.lat!, lng: to.lng! }, to.travelMode ?? undefined);
    out.push({ key: from.key + '>' + to.key, from, to, meters, mode: leg.mode as GuideLeg['mode'], min: leg.min });
  }
  return out;
}

/** 점 p에서 선분 a-b까지의 거리(m) — 짧은 구간이라 평면 근사 */
export function distToSegmentMeters(p: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
  const ky = 110540;
  const ax = 0, ay = 0;
  const bx = (b.lng - a.lng) * kx, by = (b.lat - a.lat) * ky;
  const px = (p.lng - a.lng) * kx, py = (p.lat - a.lat) * ky;
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2));
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}

/** 선분을 따라 어디쯤인지(0~1) — 가는 길 곳들을 지나는 순서로 세우려고 */
export function alongSegment(p: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
  const ky = 110540;
  const bx = (b.lng - a.lng) * kx, by = (b.lat - a.lat) * ky;
  const px = (p.lng - a.lng) * kx, py = (p.lat - a.lat) * ky;
  const len2 = bx * bx + by * by;
  return len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
}

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** 이름이 비슷한가 — 한쪽이 다른 쪽을 품으면 같은 곳으로 본다(둘 다 너무 짧으면 아님) */
export function similarName(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (x.length < 2 || y.length < 2) return false;
  return x.includes(y) || y.includes(x);
}

export const CORRIDOR_METERS = 350;

/** AI가 말한 이름에 맞는 실제 장소를 후보에서 고른다 — 이름이 비슷하고 길에서 가까운 것만, 가까운 순 */
export function pickCorridorPlace<T extends { name: string; lat: number; lng: number }>(
  name: string,
  found: readonly T[],
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  maxMeters = CORRIDOR_METERS
): T | null {
  return (
    found
      .filter((p) => similarName(p.name, name))
      .map((p) => ({ p, d: distToSegmentMeters(p, from, to) }))
      .filter((x) => x.d <= maxMeters)
      .sort((a, b) => a.d - b.d)[0]?.p ?? null
  );
}

/* ── 이 기기 저장 ── */

export const STORY_TTL_MS = 30 * 24 * 3600 * 1000;
const PREFIX = 'mongsil:guide:v1:';

interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function readStored<T>(kv: KV | null, key: string, now: number): T | null {
  try {
    const raw = kv?.getItem(PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at: number; data: T };
    return v && typeof v.at === 'number' && now - v.at < STORY_TTL_MS ? v.data : null;
  } catch {
    return null;
  }
}

export function writeStored(kv: KV | null, key: string, data: unknown, now: number): void {
  try {
    kv?.setItem(PREFIX + key, JSON.stringify({ at: now, data }));
  } catch {
    /* 저장 공간이 없으면 이 탭 안에서만 쓴다 */
  }
}

const ls = (): KV | null => {
  try { return window.localStorage; } catch { return null; }
};

export function storyKey(s: TlStop, kind: GuideKind): string {
  return 'p:' + kind + ':' + (s.place?.google_place_id || s.placeId || s.name);
}
export function legStoryKey(l: GuideLeg): string {
  const r = (n: number | null) => (n ?? 0).toFixed(3);
  return 'l:' + r(l.from.lat) + ',' + r(l.from.lng) + '>' + r(l.to.lat) + ',' + r(l.to.lng);
}

/* ══════════════ 서버 호출 ══════════════ */

export interface Source { title: string; uri: string }
export interface PlaceStory {
  mode: GuideKind;
  headline: string;
  intro: string;
  history: Array<{ when: string; text: string }>;
  points: Array<{ title: string; text: string }>;
  menu: Array<{ name: string; text: string; price: string }>;
  priceRange: string;
  tips: string[];
  time: string;
}
export interface StoryResult { story: PlaceStory; sources: Source[] }

export class GuideError extends Error {
  constructor(message: string, readonly code: string | null) { super(message); }
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new GuideError('네트워크 연결을 확인해 주세요.', null);
  }
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new GuideError(typeof json?.error === 'string' ? json.error : '이야기를 불러오지 못했어요. (' + res.status + ')', typeof json?.code === 'string' ? json.code : null);
  return json as T;
}

export function requestPlaceStory(s: TlStop, kind: GuideKind, city: string): Promise<StoryResult> {
  return post<StoryResult>({
    kind: 'place-story',
    mode: kind,
    name: s.place?.name ?? s.name,
    address: s.place?.address ?? '',
    city,
    googlePlaceId: s.place?.google_place_id ?? '',
    category: s.place?.category ?? '',
  });
}

export interface LegSpot {
  name: string;
  where: string;
  story: string;
  photo: string | null;
  mapsUrl: string | null;
}
export interface LegResult { spots: LegSpot[]; sources: Source[] }

/** 가는 길 이야기 — AI가 말한 이름을 실제 장소로 확인해 길 위에 있는 것만 남긴다 */
export async function requestLegStory(l: GuideLeg, city: string): Promise<LegResult> {
  const a = { lat: l.from.lat!, lng: l.from.lng! };
  const b = { lat: l.to.lat!, lng: l.to.lng! };
  const res = await post<{ points: Array<{ name: string; where: string; story: string }>; sources: Source[] }>({
    kind: 'route-story',
    from: { name: l.from.name, ...a },
    to: { name: l.to.name, ...b },
    mode: l.mode,
    city,
  });
  const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
  const radius = Math.min(3000, l.meters / 2 + 400);
  const spots: Array<LegSpot & { t: number }> = [];
  for (const p of res.points ?? []) {
    try {
      const found = await searchText('leg:' + p.name + ':' + mid.lat.toFixed(3) + ',' + mid.lng.toFixed(3), p.name, mid, radius);
      const hit = pickCorridorPlace(p.name, found, a, b);
      if (!hit || spots.some((s) => s.name === hit.name)) continue;
      spots.push({
        name: hit.name,
        where: p.where,
        story: p.story,
        photo: hit.photo,
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(hit.name) + '&query_place_id=' + encodeURIComponent(hit.id),
        t: alongSegment(hit, a, b),
      });
    } catch (e) {
      console.warn('[guide] 가는 길 장소 확인 실패:', p.name, (e as Error).message);
    }
  }
  spots.sort((x, y) => x.t - y.t);
  return { spots: spots.map(({ t: _t, ...s }) => s), sources: res.sources ?? [] };
}

/* ══════════════ 화면 ══════════════ */

type Load<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'err'; message: string; code: string | null };

const stories = new Map<string, Load<StoryResult>>();
const legStories = new Map<string, Load<LegResult>>();
const galleries = new Map<string, string[]>();
let openKey: string | null = null;

export interface GuideCtx {
  days: TlDay[];
  dayIndex: number;
  destName: string;
  dateText: string;
  isPro: boolean;
  planKnown: boolean;
  /** 화면을 다시 그린다 */
  rerender: () => void;
  /** 잠긴 기능 → 요금제 화면 */
  onLocked: () => void;
  onDay: (i: number) => void;
}

const IC = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  walk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4.5" r="1.8"/><path d="M9 21l2.5-6.5-2-3 1.5-4 3 2 2.5 1M11.5 14.5L15 21M10 8L7 10.5"/></svg>',
  ride: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="13" rx="3"/><path d="M5 12h14M8 20l1.5-3M16 20l-1.5-3"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  fork: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v7a2 2 0 0 0 2 2v9M7 3v7M10 3v7M16 3c-1.5 1-2 3-2 5s1 3 2 3v10"/></svg>',
  landmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V10M19 21V10M2 10l10-6 10 6M9 21v-7h6v7"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
};

const MODE_LABEL: Record<GuideLeg['mode'], string> = { WALK: '걸어서', TRANSIT: '대중교통', TAXI: '차로' };
const lockPill = '<span class="gd-lock">' + IC.lock + 'PRO</span>';

function sourcesHtml(src: Source[]): string {
  const links = src
    .map((s) => ({ t: s.title, u: safeHttpUrl(s.uri) }))
    .filter((x): x is { t: string; u: string } => !!x.u)
    .map((x) => '<a href="' + escapeHtml(x.u) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(x.t) + '</a>')
    .join('');
  return (
    '<p class="gd-note">웹 자료를 바탕으로 정리한 참고 이야기예요. 가격·운영 정보는 바뀔 수 있어요.</p>' +
    (links ? '<div class="gd-src">' + links + '</div>' : '')
  );
}

function storyBodyHtml(s: StoryResult, photos: string[]): string {
  const st = s.story;
  const gallery = photos.length > 1
    ? '<div class="gd-gallery">' + photos.slice(0, 5).map((u) => '<img src="' + escapeHtml(u) + '" alt="" loading="lazy" referrerpolicy="no-referrer"/>').join('') + '</div>'
    : '';
  const head = (st.headline ? '<h3 class="gd-headline">' + escapeHtml(st.headline) + '</h3>' : '') + (st.intro ? '<p class="gd-intro">' + escapeHtml(st.intro) + '</p>' : '');
  if (st.mode === 'food') {
    const menu = st.menu.length
      ? '<section class="gd-sec"><h4>대표 메뉴</h4>' +
        st.menu.map((m) =>
          '<div class="gd-menu"><div><b>' + escapeHtml(m.name) + '</b>' + (m.text ? '<span>' + escapeHtml(m.text) + '</span>' : '') + '</div>' +
          (m.price ? '<em>' + escapeHtml(m.price) + '</em>' : '') + '</div>').join('') +
        '</section>'
      : '';
    const price = st.priceRange ? '<div class="gd-chips"><span class="gd-chip">' + IC.fork + '1인 ' + escapeHtml(st.priceRange) + ' <small>참고</small></span></div>' : '';
    return gallery + head + price + menu + tipsHtml(st.tips) + sourcesHtml(s.sources);
  }
  const time = st.time ? '<div class="gd-chips"><span class="gd-chip">' + IC.clock + escapeHtml(st.time) + '</span></div>' : '';
  const history = st.history.length
    ? '<section class="gd-sec"><h4>알고 가면 달라 보이는 이야기</h4><ol class="gd-history">' +
      st.history.map((h) => '<li><i>' + escapeHtml(h.when) + '</i><p>' + escapeHtml(h.text) + '</p></li>').join('') + '</ol></section>'
    : '';
  const points = st.points.length
    ? '<section class="gd-sec"><h4>이건 꼭 보고 오세요</h4><ol class="gd-points">' +
      st.points.map((p, i) => '<li><span>' + (i + 1) + '</span><div><b>' + escapeHtml(p.title) + '</b><p>' + escapeHtml(p.text) + '</p></div></li>').join('') + '</ol></section>'
    : '';
  return gallery + head + time + history + points + tipsHtml(st.tips) + sourcesHtml(s.sources);
}

function tipsHtml(tips: string[]): string {
  return tips.length ? '<aside class="gd-tips"><h4>' + IC.bulb + '알아 두면 좋은 팁</h4><ul>' + tips.map((t) => '<li>' + escapeHtml(t) + '</li>').join('') + '</ul></aside>' : '';
}

function stateHtml<T>(ld: Load<T> | undefined, ok: (d: T) => string, retryKey: string, hint: string): string {
  if (!ld || ld.state === 'loading') return '<div class="gd-wait"><span class="gd-spin"></span>' + escapeHtml(hint) + '</div>';
  if (ld.state === 'err') {
    return '<div class="gd-err"><p>' + escapeHtml(ld.message) + '</p>' + (ld.code === 'pro_required' ? '<button class="gd-btn" data-gd-pro="1">PRO 보기</button>' : '<button class="gd-btn" data-gd-retry="' + escapeHtml(retryKey) + '">다시 불러오기</button>') + '</div>';
  }
  return ok(ld.data);
}

function cardHtml(ctx: GuideCtx, s: TlStop, kind: GuideKind, n: number): string {
  const key = 'p:' + s.key;
  const open = openKey === key;
  const photo = s.place?.photo_url ?? null;
  const ld = stories.get(storyKey(s, kind));
  const label = kind === 'food' ? '맛집' : '둘러볼 곳';
  const cached = ld?.state === 'ok' ? ld.data.story.headline : '';
  return [
    '<article class="gd-card' + (open ? ' is-open' : '') + (kind === 'food' ? ' is-food' : '') + '">',
    '  <button class="gd-hero" data-gd-open="' + escapeHtml(key) + '" aria-expanded="' + open + '">',
    photo
      ? '    <img src="' + escapeHtml(photo) + '" alt="" loading="lazy" referrerpolicy="no-referrer"/>'
      : '    <span class="gd-hero-blank">' + (kind === 'food' ? IC.fork : IC.landmark) + '</span>',
    '    <span class="gd-hero-shade"></span>',
    '    <span class="gd-hero-top"><span class="gd-no">' + n + '</span><span class="gd-kind">' + (kind === 'food' ? IC.fork : IC.landmark) + label + '</span>' + (ctx.isPro ? '' : lockPill) + '</span>',
    '    <span class="gd-hero-bottom"><b>' + escapeHtml(s.name) + '</b>' + (cached ? '<em>' + escapeHtml(cached) + '</em>' : '<em>' + (ctx.isPro ? '눌러서 이야기 펼치기' : 'PRO에서 이야기를 볼 수 있어요') + '</em>') + '</span>',
    '  </button>',
    open && ctx.isPro
      ? '  <div class="gd-body">' + stateHtml(ld, (d) => storyBodyHtml(d, galleries.get(storyKey(s, kind)) ?? []), s.key, kind === 'food' ? '가게 정보를 모으는 중이에요' : '이야기를 모으는 중이에요') + '</div>'
      : '',
    '</article>',
  ].join('');
}

function legHtml(ctx: GuideCtx, l: GuideLeg): string {
  const key = 'l:' + l.key;
  const open = openKey === key;
  const ld = legStories.get(legStoryKey(l));
  const dist = l.meters >= 1000 ? (l.meters / 1000).toFixed(1) + 'km' : Math.round(l.meters / 10) * 10 + 'm';
  const count = ld?.state === 'ok' ? ld.data.spots.length : null;
  return [
    '<div class="gd-leg' + (open ? ' is-open' : '') + '">',
    '  <button class="gd-leg-row" data-gd-open="' + escapeHtml(key) + '" aria-expanded="' + open + '">',
    '    <span class="gd-leg-ic">' + (l.mode === 'WALK' ? IC.walk : IC.ride) + '</span>',
    '    <span class="gd-leg-txt"><b>가는 길 이야기</b><small>' + MODE_LABEL[l.mode] + ' ' + l.min + '분 · ' + dist + '</small></span>',
    '    <span class="gd-leg-end">' + (!ctx.isPro ? lockPill : count === 0 ? '<small>짚을 곳 없음</small>' : count ? '<small>' + count + '곳</small>' : '<small>펼치기</small>') + '</span>',
    '  </button>',
    open && ctx.isPro
      ? '  <div class="gd-leg-body">' +
        stateHtml(
          ld,
          (d) =>
            d.spots.length
              ? '<ol class="gd-spots">' +
                d.spots.map((p) =>
                  '<li>' + (p.photo ? '<img src="' + escapeHtml(p.photo) + '" alt="" loading="lazy" referrerpolicy="no-referrer"/>' : '<span class="gd-spot-ph">' + IC.pin + '</span>') +
                  '<div><b>' + escapeHtml(p.name) + '</b>' + (p.where ? '<small>' + escapeHtml(p.where) + '</small>' : '') + '<p>' + escapeHtml(p.story) + '</p>' +
                  (p.mapsUrl ? '<a href="' + escapeHtml(p.mapsUrl) + '" target="_blank" rel="noopener noreferrer">지도에서 보기</a>' : '') + '</div></li>').join('') +
                '</ol>' + sourcesHtml(d.sources)
              : '<p class="gd-empty">이 길에는 따로 짚어 드릴 곳이 없어요. 편하게 걸어가세요.</p>',
          l.key,
          '길 위의 이야기를 찾는 중이에요'
        ) +
        '</div>'
      : '',
    '</div>',
  ].join('');
}

/** 탭 본문 */
export function guideTabHtml(ctx: GuideCtx): string {
  const day = ctx.days[ctx.dayIndex] ?? null;
  const nav = day
    ? '<div class="gd-nav">' +
      '<button class="gd-arrow" data-gd-day="' + (ctx.dayIndex - 1) + '"' + (ctx.dayIndex <= 0 ? ' disabled' : '') + ' aria-label="이전 DAY">' + IC.back + '</button>' +
      '<div class="gd-day"><b>' + escapeHtml(day.label) + '</b><span>' + escapeHtml(ctx.destName) + (ctx.dateText ? ' · ' + escapeHtml(ctx.dateText) : '') + '</span></div>' +
      '<button class="gd-arrow is-next" data-gd-day="' + (ctx.dayIndex + 1) + '"' + (ctx.dayIndex >= ctx.days.length - 1 ? ' disabled' : '') + ' aria-label="다음 DAY">' + IC.back + '</button></div>'
    : '';
  const head = '<header class="gd-head"><h2>' + escapeHtml(GUIDE_TITLE) + '</h2><p>' + escapeHtml(GUIDE_TAGLINE) + '</p></header>';
  if (!day) return '<section class="gd">' + head + '<div class="mb-day-empty"><p class="mb-day-empty-title">아직 일정이 없어요</p><p class="mb-day-empty-sub">일정에 장소를 담으면 그날의 이야기를 보여 드려요.</p></div></section>';

  const legs = new Map(guideLegs(day).map((l) => [l.from.key, l]));
  const rows: string[] = [];
  let n = 0;
  for (const s of day.stops) {
    const kind = guideKind(s);
    if (kind) { n += 1; rows.push(cardHtml(ctx, s, kind, n)); }
    else if (!s.purpose && s.lat != null) rows.push('<div class="gd-anchor"><span>' + (s.cat === 'STAY' ? '숙소' : s.cat === 'AIRPORT' ? '공항·역' : '출발') + '</span><b>' + escapeHtml(s.name) + '</b></div>');
    const leg = legs.get(s.key);
    if (leg) rows.push(legHtml(ctx, leg));
  }
  const cards = n;
  if (!cards) {
    return '<section class="gd">' + head + nav + '<div class="mb-day-empty"><p class="mb-day-empty-title">이날은 이야기를 붙일 장소가 없어요</p><p class="mb-day-empty-sub">관광지나 식당을 일정에 담으면 여기서 가이드를 볼 수 있어요.</p></div></section>';
  }
  const lock = !ctx.isPro && ctx.planKnown
    ? '<button class="gd-pro" data-gd-pro="1"><span>' + IC.lock + '</span><div><b>PRO로 열어 보세요</b><small>역사 · 관람 포인트 · 대표 메뉴 · 가는 길의 숨은 이야기</small></div></button>'
    : '';
  return '<section class="gd">' + head + nav + lock + '<div class="gd-list">' + rows.join('') + '</div></section>';
}

/* ── 열기 · 불러오기 ── */

function cityOf(ctx: GuideCtx): string {
  return ctx.destName;
}

async function loadStory(ctx: GuideCtx, s: TlStop, kind: GuideKind, force = false): Promise<void> {
  const key = storyKey(s, kind);
  if (!force && stories.get(key)?.state === 'ok') return;
  const saved = force ? null : readStored<StoryResult>(ls(), key, Date.now());
  if (saved) {
    stories.set(key, { state: 'ok', data: saved });
  } else {
    stories.set(key, { state: 'loading' });
    ctx.rerender();
    try {
      const data = await requestPlaceStory(s, kind, cityOf(ctx));
      stories.set(key, { state: 'ok', data });
      writeStored(ls(), key, data, Date.now());
    } catch (e) {
      const ge = e as GuideError;
      stories.set(key, { state: 'err', message: ge.message, code: ge.code ?? null });
    }
  }
  ctx.rerender();
  // 사진은 열었을 때만, 이 기기에서 장소당 한 번 — 실패해도 글은 그대로
  const gid = s.place?.google_place_id;
  if (gid && !galleries.has(key)) {
    try {
      const d = await fetchDetail(gid);
      galleries.set(key, [s.place?.photo_url, ...d.photos.map((p) => p.url)].filter((u): u is string => !!u));
      ctx.rerender();
    } catch {
      galleries.set(key, []);
    }
  }
}

async function loadLeg(ctx: GuideCtx, l: GuideLeg, force = false): Promise<void> {
  const key = legStoryKey(l);
  if (!force && legStories.get(key)?.state === 'ok') return;
  const saved = force ? null : readStored<LegResult>(ls(), key, Date.now());
  if (saved) {
    legStories.set(key, { state: 'ok', data: saved });
  } else {
    legStories.set(key, { state: 'loading' });
    ctx.rerender();
    try {
      const data = await requestLegStory(l, cityOf(ctx));
      legStories.set(key, { state: 'ok', data });
      writeStored(ls(), key, data, Date.now());
    } catch (e) {
      const ge = e as GuideError;
      legStories.set(key, { state: 'err', message: ge.message, code: ge.code ?? null });
    }
  }
  ctx.rerender();
}

/** 탭의 버튼들을 묶는다 — 화면을 그릴 때마다 호출 */
export function bindGuide(root: HTMLElement, ctx: GuideCtx): void {
  root.querySelectorAll<HTMLElement>('[data-gd-day]').forEach((b) =>
    b.addEventListener('click', () => { const n = Number(b.dataset.gdDay); if (ctx.days[n]) { openKey = null; ctx.onDay(n); } })
  );
  root.querySelectorAll<HTMLElement>('[data-gd-pro]').forEach((b) => b.addEventListener('click', () => ctx.onLocked()));
  const day = ctx.days[ctx.dayIndex];
  if (!day) return;
  const legs = new Map(guideLegs(day).map((l) => [l.key, l]));
  root.querySelectorAll<HTMLElement>('[data-gd-open]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!ctx.isPro) { if (ctx.planKnown) ctx.onLocked(); return; }
      const key = b.dataset.gdOpen!;
      if (openKey === key) { openKey = null; ctx.rerender(); return; }
      openKey = key;
      if (key.startsWith('p:')) {
        const s = day.stops.find((x) => 'p:' + x.key === key);
        const kind = s ? guideKind(s) : null;
        if (s && kind) void loadStory(ctx, s, kind);
      } else {
        const l = legs.get(key.slice(2));
        if (l) void loadLeg(ctx, l);
      }
      ctx.rerender();
    })
  );
  root.querySelectorAll<HTMLElement>('[data-gd-retry]').forEach((b) =>
    b.addEventListener('click', () => {
      const key = b.dataset.gdRetry!;
      const s = day.stops.find((x) => x.key === key);
      const kind = s ? guideKind(s) : null;
      if (s && kind) { void loadStory(ctx, s, kind, true); return; }
      const l = legs.get(key);
      if (l) void loadLeg(ctx, l, true);
    })
  );
}

/** 여행을 바꾸거나 나갈 때 */
export function resetGuide(): void {
  openKey = null;
  stories.clear();
  legStories.clear();
  galleries.clear();
}

export type { ExplorePlace };
