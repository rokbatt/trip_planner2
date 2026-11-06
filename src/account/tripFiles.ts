/**
 * 여행 문서 파일(Storage 비공개 버킷 `trip-docs`) 지우기.
 *
 * 경로는 `{trip_id}/{shared|personal}/{uuid}.{ext}`(Claude.md 5-5). 여행을 지울 때(trip-edit.ts)와
 * 계정을 지울 때(accountStore.ts) 둘 다 필요해서 여기 한 곳에 둔다.
 *
 * ⚠️ 순서가 중요하다 — 반드시 **DB 행을 지우기 전에** 부른다. Storage의 삭제 정책
 * (trip_docs_member_delete)이 "그 여행의 멤버인가"를 보는데, 여행·멤버십 행이 먼저 사라지면
 * 파일을 지울 권한도 같이 사라져서 파일만 영영 남는다. 여권 사본 같은 서류가 주인 없는 채로
 * 남는 게 가장 나쁜 결과라, 실패해도 DB 삭제를 막지는 않되(best-effort) 순서만은 지킨다.
 *
 * SQL로 storage.objects 행만 지우는 건 답이 아니다 — 메타데이터만 지워지고 실제 파일은 남는다.
 */

import { supabase } from '../supabase';

const BUCKET = 'trip-docs';
const PAGE = 100;

/** Storage list()가 돌려주는 항목. id가 null이면 폴더다. */
interface ListedEntry {
  name: string;
  id: string | null;
}

/** list/remove만 쓰는 최소 인터페이스 — 테스트에서 가짜로 갈아 끼우려고 좁혀 둔다 */
export interface StorageBucketLike {
  list(path: string, opts: { limit: number; offset: number }): Promise<{ data: ListedEntry[] | null; error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
}

export function bucket(): StorageBucketLike {
  return supabase.storage.from(BUCKET) as unknown as StorageBucketLike;
}

/** 폴더 아래의 모든 파일 경로를 모은다(하위 폴더 포함, 100개씩 페이징) */
export async function listAllFiles(b: StorageBucketLike, prefix: string): Promise<{ paths: string[]; failed: boolean }> {
  const paths: string[] = [];
  let failed = false;
  const queue = [prefix];
  while (queue.length) {
    const dir = queue.shift()!;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await b.list(dir, { limit: PAGE, offset });
      if (error || !data) { failed = true; break; }
      for (const e of data) {
        if (e.id === null) queue.push(dir + '/' + e.name);   // 폴더
        else paths.push(dir + '/' + e.name);                 // 파일
      }
      if (data.length < PAGE) break;
    }
  }
  return { paths, failed };
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export interface RemoveResult {
  removed: number;
  /** 목록을 못 읽었거나 일부 삭제가 실패했다 — 호출부가 사용자에게 알릴 수 있게 */
  failed: boolean;
}

/** 파일 경로 목록을 지운다 */
export async function removeFiles(paths: string[], b: StorageBucketLike = bucket()): Promise<RemoveResult> {
  let removed = 0;
  let failed = false;
  for (const part of chunk(paths, PAGE)) {
    const { error } = await b.remove(part);
    if (error) failed = true;
    else removed += part.length;
  }
  return { removed, failed };
}

/** 여행 폴더 전체(공용·개인 문서 파일)를 지운다 */
export async function removeTripFiles(tripId: string, b: StorageBucketLike = bucket()): Promise<RemoveResult> {
  try {
    const { paths, failed: listFailed } = await listAllFiles(b, tripId);
    const res = await removeFiles(paths, b);
    return { removed: res.removed, failed: listFailed || res.failed };
  } catch (e) {
    console.warn('[tripFiles] 여행 파일 정리 중 오류:', e);
    return { removed: 0, failed: true };
  }
}
