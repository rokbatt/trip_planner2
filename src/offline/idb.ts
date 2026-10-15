/**
 * 아주 작은 IndexedDB 키-값 저장소 — 오프라인 데이터 보관용. 라이브러리를 들이지 않는다.
 *
 * 저장소(store)는 셋이다.
 *   rest  : Supabase REST 읽기 응답 스냅샷 (키 = 요청 URL + Accept)
 *   queue : 오프라인 동안 쌓인 쓰기 요청 (키 = 들어온 순서의 번호 — 순서대로 보낸다)
 *   kv    : 그 밖의 작은 값 (실측 이동시간 등)
 *
 * IndexedDB를 못 쓰는 환경(사생활 보호 모드 일부, 테스트의 node)에서는 모든 호출이 조용히
 * 실패한다 — 오프라인 저장은 "있으면 좋은 것"이라 앱 동작을 막으면 안 된다.
 */

const DB_NAME = 'mongsil-offline';
const DB_VERSION = 1;
export type StoreName = 'rest' | 'queue' | 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('rest')) db.createObjectStore('rest');
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { autoIncrement: true });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(store, mode);
          const req = fn(tx.objectStore(store));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      })
  );
}

export function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return run<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>);
}

export function idbSet(store: StoreName, key: IDBValidKey | undefined, value: unknown): Promise<IDBValidKey | undefined> {
  return run<IDBValidKey>(store, 'readwrite', (s) => (key === undefined ? s.add(value) : s.put(value, key)));
}

export function idbDelete(store: StoreName, key: IDBValidKey): Promise<undefined> {
  return run(store, 'readwrite', (s) => s.delete(key) as IDBRequest<undefined>);
}

export function idbClear(store: StoreName): Promise<undefined> {
  return run(store, 'readwrite', (s) => s.clear() as IDBRequest<undefined>);
}

/** [키, 값] 전부 — 키 순서(큐는 들어온 순서)대로 */
export async function idbEntries<T>(store: StoreName): Promise<Array<[IDBValidKey, T]>> {
  const [keys, values] = await Promise.all([
    run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()),
    run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
  ]);
  if (!keys || !values) return [];
  return keys.map((k, i) => [k, values[i]]);
}
