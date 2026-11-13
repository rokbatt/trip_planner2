/**
 * `/api/<이름>` 주소 → api/<이름>.ts 핸들러 표 (docs/CLOUDFLARE_MIGRATION.md 1단계 PR-2).
 * Vercel은 파일 이름으로 주소를 자동으로 만들지만 Worker는 직접 연결해야 한다.
 * api/에 파일을 추가하면 여기에도 한 줄 추가한다 — 빠뜨리면 routes.test.ts가 실패한다.
 */
import type { VercelStyleHandler } from './vercelAdapter';

import ai from '../api/ai';
import backfillPhotos from '../api/backfill-photos';
import cachePhoto from '../api/cache-photo';
import cleanupSearchCache from '../api/cleanup-search-cache';
import destinationZones from '../api/destination-zones';
import exchangeRate from '../api/exchange-rate';
import hotelScore from '../api/hotel-score';
import importHotel from '../api/import-hotel';
import monthlyPicks from '../api/monthly-picks';
import nearbyInfra from '../api/nearby-infra';
import nearbySearch from '../api/nearby-search';
import routeMatrix from '../api/route-matrix';

const h = (fn: unknown) => fn as VercelStyleHandler;

export const API_ROUTES: Record<string, VercelStyleHandler> = {
  '/api/ai': h(ai),
  '/api/backfill-photos': h(backfillPhotos),
  '/api/cache-photo': h(cachePhoto),
  '/api/cleanup-search-cache': h(cleanupSearchCache),
  '/api/destination-zones': h(destinationZones),
  '/api/exchange-rate': h(exchangeRate),
  '/api/hotel-score': h(hotelScore),
  '/api/import-hotel': h(importHotel),
  '/api/monthly-picks': h(monthlyPicks),
  '/api/nearby-infra': h(nearbyInfra),
  '/api/nearby-search': h(nearbySearch),
  '/api/route-matrix': h(routeMatrix),
};

export const CLEANUP_HANDLER = h(cleanupSearchCache);

/** 끝의 `/` 하나는 무시한다(Vercel도 `/api/ai/`를 같은 함수로 보낸다) */
export function findApiHandler(pathname: string): VercelStyleHandler | null {
  const key = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  return Object.prototype.hasOwnProperty.call(API_ROUTES, key) ? API_ROUTES[key] : null;
}
