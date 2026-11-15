/**
 * 어시스턴트가 개인 문서를 어떻게 다룰지 정하는 순수 규칙(import 없음 — 테스트가 Supabase 없이 돈다).
 *
 * 개인 문서는 두 조건이 맞아야 어시스턴트에 들어간다.
 *  1. 이 탭에서 그 보관함의 PIN을 풀었다(화면 칸막이, docsStore.getUnlockedUserId)
 *  2. 그 보관함이 지금 로그인한 구글 계정에 연결돼 있다(trip_doc_users.user_id) — 서버(doc-digest)가
 *     이걸로 본인 여부를 확인한다. 예전에 만든 보관함은 연결이 비어 있을 수 있다.
 * 어느 쪽이 안 맞는지 사용자에게 알려 주려고 상태를 나눈다.
 */

export interface VaultLike {
  id: string;
  user_id: string | null;
}

export type PersonalState =
  /** 보여줄 개인 문서 보관함이 없다 */
  | 'none'
  /** 내 보관함이 있지만 이 탭에서 PIN을 안 풀었다 → 포함 안 됨, 안내 */
  | 'locked'
  /** PIN을 풀었고 내 계정과 연결돼 있다 → 모두 포함 */
  | 'ready'
  /** PIN을 풀었지만 계정과 연결이 비어 있다(예전 보관함) → 파일 문서는 서버가 거절하므로 제외 */
  | 'unlinked'
  /** PIN을 풀었지만 다른 계정에 연결된 보관함이다 → 파일 문서 제외 */
  | 'foreign';

export interface PersonalPlan {
  state: PersonalState;
  /** 문서를 불러올 보관함(ready·unlinked·foreign일 때만) */
  vaultId: string | null;
}

export function planPersonalVault(input: {
  unlockedId: string | null;
  vaults: readonly VaultLike[];
  myUserId: string | null;
}): PersonalPlan {
  const { unlockedId, vaults, myUserId } = input;

  if (unlockedId) {
    const vault = vaults.find((v) => v.id === unlockedId);
    if (vault) {
      if (myUserId && vault.user_id === myUserId) return { state: 'ready', vaultId: vault.id };
      if (!vault.user_id) return { state: 'unlinked', vaultId: vault.id };
      return { state: 'foreign', vaultId: vault.id };
    }
    // 저장된 잠금 해제 기록이 없는 보관함을 가리킨다(지워졌거나 오래된 기록) → 잠긴 것으로 본다
  }

  const mine = myUserId ? vaults.filter((v) => v.user_id === myUserId) : [];
  return mine.length > 0 ? { state: 'locked', vaultId: null } : { state: 'none', vaultId: null };
}

/** 어시스턴트 위에 띄울 안내 문장 — 없으면 null. skippedFiles = 읽지 못하고 건너뛴 파일 문서 수 */
export function personalNotice(state: PersonalState, skippedFiles: number): string | null {
  if (state === 'locked') return '개인 문서 보관함이 잠겨 있어요. PIN을 풀면 개인 문서도 함께 확인해요.';
  if (state === 'unlinked') {
    return skippedFiles > 0
      ? '이 보관함은 구글 계정과 연결되지 않은 예전 보관함이라, 파일이 있는 개인 문서 ' + skippedFiles + '개는 읽을 수 없어요. (파일 없이 적어 둔 정보는 포함돼요)'
      : null;
  }
  if (state === 'foreign') {
    return skippedFiles > 0 ? '다른 계정에 연결된 보관함이라, 파일이 있는 개인 문서 ' + skippedFiles + '개는 읽을 수 없어요.' : null;
  }
  return null;
}
