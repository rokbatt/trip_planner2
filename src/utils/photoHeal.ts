/**
 * 예전에 Google 주소 그대로 저장된 장소 사진을 우리 Storage 주소로 바꿀 대상을 고르는 순수 규칙.
 * (import가 없다 — 테스트가 Supabase 없이 돌아야 한다)
 *
 * 왜 필요한가: Google 사진 주소는 (1) API 키가 붙어 있고 (2) 언젠가 만료되며 (3) 화면에 그릴 때마다
 * Google에 요청이 나가 과금되고, 만료되면 오류로 쌓인다(Cloud Console의 "Places API (New) 오류율 100%").
 * 새로 담는 길은 rehostPhoto가 막지만, 이미 저장된 행은 그대로라 화면을 열 때 한 번씩 바꿔 준다.
 */

/** 사진이 Google 원본 주소인지 — 우리 Storage 주소(supabase.co/storage)는 해당 없음 */
export function isGooglePhotoUrl(url: string | null | undefined): boolean {
  return !!url && url.includes('googleapis.com');
}

/** 한 번 실패한 장소는 이만큼 다시 시도하지 않는다 — 실패도 Google 호출을 쓰기 때문 */
export const HEAL_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** 화면을 한 번 열 때 옮길 최대 장소 수 — 오래된 데이터가 한꺼번에 몰려도 호출이 튀지 않게 */
export const HEAL_MAX_PER_RUN = 8;

export interface HealCandidate {
  id: string;
  google_place_id: string | null;
  photo_url: string | null;
}

export interface HealOptions {
  now: number;
  /** 그 google_place_id가 마지막으로 실패한 시각(없으면 null) */
  failedAt: (googlePlaceId: string) => number | null;
  /** 이번 세션에서 이미 시도한 행 id */
  tried: ReadonlySet<string>;
  max?: number;
}

export function pickHealTargets<T extends HealCandidate>(places: readonly T[], opts: HealOptions): T[] {
  const out: T[] = [];
  const max = opts.max ?? HEAL_MAX_PER_RUN;
  for (const p of places) {
    if (out.length >= max) break;
    if (!isGooglePhotoUrl(p.photo_url)) continue;
    if (!p.google_place_id) continue; // 어느 장소의 사진인지 모르면 새 사진을 받아 올 수 없다
    if (opts.tried.has(p.id)) continue;
    const failed = opts.failedAt(p.google_place_id);
    if (failed != null && opts.now - failed < HEAL_COOLDOWN_MS) continue;
    out.push(p);
  }
  return out;
}
