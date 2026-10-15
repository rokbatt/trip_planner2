/**
 * 예약 서류 오프라인 저장 — 항공권·바우처 파일을 이 기기(Cache Storage)에 받아 둔다.
 *
 * 서류 파일은 비공개 버킷에 있고 열 때마다 짧게 사는 주소(signed URL)를 받아야 한다. 오프라인에선
 * 그 주소를 못 받으니, 온라인일 때 **사용자가 눌러서** 파일 자체를 받아 둔다(자동으로 받지 않는다 —
 * PDF는 크고, 로밍 데이터일 수 있다).
 *
 * 개인 문서(여권 등, PIN 잠금)는 저장하지 않는다 — 기기에 파일이 남으면 잠금의 의미가 없다.
 * 파일이 바뀌면(file_path가 달라지면) 저장본은 "옛 파일"이라 저장 안 된 것으로 본다.
 */

const CACHE = 'mongsil-docs-v1';

export interface OfflineDocMeta {
  id: string;
  filePath: string;
  fileName: string | null;
  fileType: string | null;
}

function keyFor(id: string): string {
  return new URL('/__offline-docs/' + encodeURIComponent(id), location.origin).href;
}

function supported(): boolean {
  return typeof caches !== 'undefined' && typeof location !== 'undefined';
}

/** 저장해 둔 서류 — id → 저장 당시 file_path */
export async function savedDocPaths(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!supported()) return out;
  try {
    const cache = await caches.open(CACHE);
    const keys = await cache.keys();
    await Promise.all(
      keys.map(async (req) => {
        const res = await cache.match(req);
        const id = decodeURIComponent(new URL(req.url).pathname.replace('/__offline-docs/', ''));
        const path = res?.headers.get('x-file-path');
        if (path) out.set(id, decodeURIComponent(path));
      })
    );
  } catch {
    /* 저장소를 못 쓰면 저장된 게 없는 것으로 */
  }
  return out;
}

/** 파일을 받아 저장한다. `url`은 방금 받은 signed URL */
export async function saveDocOffline(meta: OfflineDocMeta, url: string): Promise<boolean> {
  if (!supported()) return false;
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const blob = await res.blob();
    const cache = await caches.open(CACHE);
    await cache.put(
      keyFor(meta.id),
      new Response(blob, {
        headers: {
          'content-type': blob.type || meta.fileType || 'application/octet-stream',
          'x-file-path': encodeURIComponent(meta.filePath),
          'x-file-name': encodeURIComponent(meta.fileName ?? ''),
          'x-saved-at': String(Date.now()),
        },
      })
    );
    return true;
  } catch (e) {
    console.error('[Offline] 서류 저장 실패:', e);
    return false;
  }
}

export interface OfflineDocFile {
  blob: Blob;
  type: string;
  name: string;
}

/** 저장된 파일. 없거나 file_path가 바뀌었으면 null */
export async function loadOfflineDoc(id: string, filePath: string): Promise<OfflineDocFile | null> {
  if (!supported()) return null;
  try {
    const cache = await caches.open(CACHE);
    const res = await cache.match(keyFor(id));
    if (!res) return null;
    if (decodeURIComponent(res.headers.get('x-file-path') ?? '') !== filePath) return null;
    const blob = await res.blob();
    return { blob, type: res.headers.get('content-type') ?? blob.type, name: decodeURIComponent(res.headers.get('x-file-name') ?? '') };
  } catch {
    return null;
  }
}

export async function removeOfflineDoc(id: string): Promise<void> {
  if (!supported()) return;
  try {
    const cache = await caches.open(CACHE);
    await cache.delete(keyFor(id));
  } catch {
    /* noop */
  }
}

/** 로그아웃 시 — 이 기기에 받아 둔 서류 파일을 전부 지운다 */
export async function clearOfflineDocs(): Promise<void> {
  if (!supported()) return;
  try {
    await caches.delete(CACHE);
  } catch {
    /* noop */
  }
}
