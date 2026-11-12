import { describe, it, expect } from 'vitest';
import { isValidPlaceId, trustedPhotoFetchUrl } from '../../api/cache-photo';
// ?raw 는 Vite 가 파일 내용을 문자열로 넘겨 준다 — node:fs 를 쓰면 @types/node 가 따로 필요해진다(deletionDrift.test.ts와 같은 방식)
import cachePhotoSrc from '../../api/cache-photo.ts?raw';
import backfillSrc from '../../api/backfill-photos.ts?raw';

/**
 * 사진 재호스팅 서버가 서버 Google 키를 붙여도 되는 주소를 고르는 규칙.
 * 이 규칙이 느슨해지면 아무 서버에나 서버 키가 넘어간다(Claude.md 5-11).
 */

const PID = 'ChIJjYPUa8GZ4jARi9fgigQOiR8';
const REF = 'Aa-ngMac91m245sfaWuAozBsdveB_ZVLld';
const GOOD = 'https://places.googleapis.com/v1/places/' + PID + '/photos/' + REF + '/media?maxWidthPx=480&maxHeightPx=480&key=OLDKEY';

describe('isValidPlaceId', () => {
  it('Google 장소 ID 형식만 통과한다', () => {
    expect(isValidPlaceId(PID)).toBe(true);
    expect(isValidPlaceId('../../etc/passwd')).toBe(false);
    expect(isValidPlaceId('abc/def')).toBe(false);
    expect(isValidPlaceId('short')).toBe(false);
    expect(isValidPlaceId('')).toBe(false);
    expect(isValidPlaceId(null)).toBe(false);
    expect(isValidPlaceId('a'.repeat(301))).toBe(false);
  });
});

describe('trustedPhotoFetchUrl', () => {
  it('그 장소의 Places(New) 사진 주소면 키 없이 다시 만들어 돌려준다(원본 쿼리·예전 키는 버림)', () => {
    const out = trustedPhotoFetchUrl(GOOD, PID);
    expect(out).toBe('https://places.googleapis.com/v1/places/' + PID + '/photos/' + REF + '/media?maxWidthPx=480&maxHeightPx=480');
    expect(out).not.toContain('key=');
  });

  it('다른 호스트는 거절한다', () => {
    expect(trustedPhotoFetchUrl(GOOD.replace('places.googleapis.com', 'evil.example.com'), PID)).toBeNull();
    expect(trustedPhotoFetchUrl(GOOD.replace('places.googleapis.com', 'places.googleapis.com.evil.com'), PID)).toBeNull();
    expect(trustedPhotoFetchUrl(GOOD.replace('https://', 'https://user:pw@'), PID)).toBeNull();
    expect(trustedPhotoFetchUrl(GOOD.replace('places.googleapis.com', 'places.googleapis.com:8443'), PID)).toBeNull();
  });

  it('http·다른 경로·다른 장소의 사진은 거절한다', () => {
    expect(trustedPhotoFetchUrl(GOOD.replace('https://', 'http://'), PID)).toBeNull();
    expect(trustedPhotoFetchUrl('https://places.googleapis.com/v1/places/' + PID + '?fields=photos', PID)).toBeNull();
    expect(trustedPhotoFetchUrl(GOOD, 'ChIJ_other_place_id_000')).toBeNull();
    expect(trustedPhotoFetchUrl('https://maps.googleapis.com/maps/api/place/photo?photo_reference=x', PID)).toBeNull();
  });

  it('문자열이 아니거나 깨진 주소·너무 긴 주소는 거절한다', () => {
    expect(trustedPhotoFetchUrl(undefined, PID)).toBeNull();
    expect(trustedPhotoFetchUrl(123, PID)).toBeNull();
    expect(trustedPhotoFetchUrl('not a url', PID)).toBeNull();
    expect(trustedPhotoFetchUrl(GOOD + '&x=' + 'a'.repeat(4000), PID)).toBeNull();
  });
});

describe('두 서버 파일의 검증 코드가 같다', () => {
  // api/*.ts는 자립형이라(Claude.md 4장) 같은 코드를 복사해 둔다 — 한쪽만 고치면 이 테스트가 잡는다
  function guardBlock(src: string): string {
    const start = src.indexOf('// ── 사진 주소 검증 (BEGIN');
    const end = src.indexOf('// ── 사진 주소 검증 (END) ──');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  }

  it('cache-photo.ts와 backfill-photos.ts', () => {
    expect(guardBlock(backfillSrc)).toBe(guardBlock(cachePhotoSrc));
  });
});
