/**
 * 새 배포 직후 옛 화면에서 생기는 "화면 조각을 못 불러옴" 오류를 자동으로 고친다.
 *
 * 화면은 `import()`로 필요할 때 조각 파일(`assistant-해시.js` 등)을 불러온다. 새 버전이 배포되면 옛
 * 조각 파일은 서버에서 사라지는데, 그 전에 열어 둔 탭은 옛 이름으로 요청하다 실패한다
 * ("Failed to fetch dynamically imported module"). 이때 한 번 새로고침하면 새 화면을 받아 해결된다.
 *
 * - 무한 새로고침을 막으려고 같은 탭에서는 RELOAD_COOLDOWN_MS 안에 두 번 하지 않는다.
 * - 새로고침을 못 하는 경우(저장소 접근 불가)에는 아무것도 하지 않는다 — 원래 오류가 그대로 보인다.
 */

export const RELOAD_KEY = 'mongsil:chunkReloadAt';
export const RELOAD_COOLDOWN_MS = 30_000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** 지금 새로고침해도 되는가(방금 한 적이 없을 때만). 하기로 했다면 시각을 적어 둔다 */
export function claimReload(storage: StorageLike, now: number): boolean {
  try {
    const prev = Number(storage.getItem(RELOAD_KEY));
    if (Number.isFinite(prev) && prev > 0 && now - prev < RELOAD_COOLDOWN_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** Vite가 조각 불러오기에 실패하면 `vite:preloadError`를 보낸다 */
export function installChunkReloadGuard(win: Window = window): void {
  win.addEventListener('vite:preloadError', (event) => {
    if (!claimReload(win.sessionStorage, Date.now())) return;
    event.preventDefault();
    win.location.reload();
  });
}
