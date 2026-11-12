import { describe, it, expect } from 'vitest';
import { HEAL_COOLDOWN_MS, HEAL_MAX_PER_RUN, isGooglePhotoUrl, pickHealTargets } from './photoHeal';

const G = 'https://places.googleapis.com/v1/places/X/photos/Y/media?maxWidthPx=480&key=K';
const S = 'https://abc.supabase.co/storage/v1/object/public/place-photos/places/X.jpg';

function row(id: string, photo: string | null, gid: string | null = 'g-' + id) {
  return { id, google_place_id: gid, photo_url: photo };
}
const base = { now: 1_000_000_000, failedAt: () => null, tried: new Set<string>() };

describe('isGooglePhotoUrl', () => {
  it('Google 원본 주소만 true', () => {
    expect(isGooglePhotoUrl(G)).toBe(true);
    expect(isGooglePhotoUrl(S)).toBe(false);
    expect(isGooglePhotoUrl(null)).toBe(false);
    expect(isGooglePhotoUrl('')).toBe(false);
  });
});

describe('pickHealTargets', () => {
  it('Google 주소를 가진 행만 고른다 (Storage·사진 없음은 제외)', () => {
    const r = pickHealTargets([row('1', G), row('2', S), row('3', null)], base);
    expect(r.map((p) => p.id)).toEqual(['1']);
  });

  it('장소 id가 없으면 고르지 않는다', () => {
    expect(pickHealTargets([row('1', G, null)], base)).toEqual([]);
  });

  it('이번 세션에 이미 시도한 행은 다시 고르지 않는다', () => {
    const r = pickHealTargets([row('1', G), row('2', G)], { ...base, tried: new Set(['1']) });
    expect(r.map((p) => p.id)).toEqual(['2']);
  });

  it('최근에 실패한 장소는 쉬었다가, 쿨다운이 지나면 다시 고른다', () => {
    const recent = { ...base, failedAt: () => base.now - 1000 };
    expect(pickHealTargets([row('1', G)], recent)).toEqual([]);
    const old = { ...base, failedAt: () => base.now - HEAL_COOLDOWN_MS - 1 };
    expect(pickHealTargets([row('1', G)], old).map((p) => p.id)).toEqual(['1']);
  });

  it('한 번에 최대 개수만 고른다', () => {
    const many = Array.from({ length: HEAL_MAX_PER_RUN + 5 }, (_, i) => row(String(i), G));
    expect(pickHealTargets(many, base)).toHaveLength(HEAL_MAX_PER_RUN);
    expect(pickHealTargets(many, { ...base, max: 2 })).toHaveLength(2);
  });
});
