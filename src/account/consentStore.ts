/**
 * 가입 동의 기록 — 이 기기의 기록(localStorage)과 서버 기록(user_consents)을 함께 다룬다.
 *
 * 왜 둘 다인가
 *  - 동의는 **로그인 전에** 받아야 한다(구글 로그인으로 넘어가면 이미 계정이 만들어진다).
 *    그 시점엔 user id가 없으니 먼저 이 기기에 적어 두고, 로그인이 끝난 뒤 서버에 옮겨 적는다.
 *  - 서버 기록(supabase/user_consents.sql)은 "누가 언제 어느 버전에 동의했나"의 증빙이다.
 *    그 SQL을 아직 안 돌렸어도 앱은 멈추지 않는다 — 기기 기록만으로 동의 창을 한 번만 보여 주고,
 *    서버 기록은 조용히 건너뛴다(앱 전반의 "없어도 동작" 원칙).
 *
 * 절대 하지 말 것: 서버를 못 읽었다는 이유로 사용자를 막는다. 막는 건 서버가 "기록 없음"이라고
 * 분명히 답했을 때뿐이다. 오프라인·테이블 없음·네트워크 오류는 전부 "확인 불가"로 두고 통과시킨다 —
 * 비행기 안에서 항공권을 꺼내려는 사람 앞에 동의 창이 막아서면 안 된다.
 */

import { supabase } from '../supabase';
import { TERMS_VERSION, PRIVACY_VERSION } from '../legal/versions';

const LOCAL_KEY = 'mongsil:consent';

export interface ConsentRecord {
  terms: string;
  privacy: string;
  agreedAt: string;
  /**
   * 이 동의가 누구 것인지. 로그인 **전**에 받은 기록에는 아직 없다(누가 로그인할지 모르므로).
   * 로그인이 끝나면 그 사용자 id로 확정한다 — 그 뒤로는 그 사람 것이다.
   */
  userId?: string;
}

/** 지금 배포된 문서 버전과 같은 기록인가 — 버전이 하나라도 다르면 다시 동의받는다 */
export function isCurrentConsent(rec: { terms?: unknown; privacy?: unknown } | null | undefined): boolean {
  return !!rec && rec.terms === TERMS_VERSION && rec.privacy === PRIVACY_VERSION;
}

export function newConsentRecord(now: Date = new Date()): ConsentRecord {
  return { terms: TERMS_VERSION, privacy: PRIVACY_VERSION, agreedAt: now.toISOString() };
}

/**
 * 이 기기의 기록을 지금 로그인한 사용자의 동의로 인정해도 되는가.
 *
 * 동의는 **계정 단위**다. 공용 기기에서 A가 동의한 뒤 B가 로그인했을 때, B가 창을 한 번도 못 보고
 * B 명의의 동의 기록이 생기면 그건 B가 동의한 게 아니다. 그래서 이미 다른 사용자 것으로 확정된
 * 기록은 가져다 쓰지 않는다(그러면 B는 서버를 확인하고, 없으면 B에게 직접 동의를 받는다).
 * 아직 주인이 없는 기록(방금 로그인 전에 받은 것)만 지금 로그인한 사람의 것으로 확정한다.
 */
export function canClaimLocalConsent(rec: ConsentRecord | null, userId: string): boolean {
  if (!isCurrentConsent(rec)) return false;
  return !rec!.userId || rec!.userId === userId;
}

/** 필수 항목이 전부 체크됐는가 */
export function allRequiredChecked(checked: Record<string, boolean>, requiredKeys: readonly string[]): boolean {
  return requiredKeys.every((k) => checked[k] === true);
}

/* ── 이 기기의 기록 ── */

export function readLocalConsent(): ConsentRecord | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.terms !== 'string' || typeof v?.privacy !== 'string' || typeof v?.agreedAt !== 'string') return null;
    if (v.userId !== undefined && typeof v.userId !== 'string') return null;
    return v as ConsentRecord;
  } catch {
    // 사파리 비공개 모드·저장소 차단 등 — 기록이 없는 것과 같게 취급
    return null;
  }
}

export function writeLocalConsent(rec: ConsentRecord): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(rec));
  } catch {
    /* 저장 못 해도 이번 로그인은 진행한다 — 다음에 다시 물을 뿐이다 */
  }
}

/* ── 서버 기록 ── */

export type ServerConsentState = 'recorded' | 'missing' | 'unavailable';

/** 테이블이 없거나(마이그레이션 전) 네트워크가 안 되는 경우를 "확인 불가"로 분류한다 */
function isUnavailable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42P01: undefined_table(직접 SQL), PGRST205: PostgREST 스키마 캐시에 테이블 없음
  return error.code === '42P01' || error.code === 'PGRST205' || /relation .* does not exist|schema cache/i.test(error.message ?? '');
}

export async function fetchServerConsent(userId: string): Promise<{ state: ServerConsentState; agreedAt?: string }> {
  try {
    const { data, error } = await supabase
      .from('user_consents')
      .select('agreed_at')
      .eq('user_id', userId)
      .eq('terms_version', TERMS_VERSION)
      .eq('privacy_version', PRIVACY_VERSION)
      .limit(1);
    if (error) return { state: 'unavailable' };
    if (data && data.length > 0) return { state: 'recorded', agreedAt: data[0].agreed_at };
    return { state: 'missing' };
  } catch {
    return { state: 'unavailable' };
  }
}

/** 이미 있으면 그대로 둔다(같은 버전에 두 번 동의해도 기록은 하나) */
export async function saveServerConsent(userId: string, rec: ConsentRecord): Promise<'saved' | 'unavailable'> {
  try {
    const { error } = await supabase.from('user_consents').upsert(
      {
        user_id: userId,
        terms_version: rec.terms,
        privacy_version: rec.privacy,
        agreed_at: rec.agreedAt,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null,
      },
      { onConflict: 'user_id,terms_version,privacy_version', ignoreDuplicates: true }
    );
    if (error) {
      if (!isUnavailable(error)) console.warn('[consent] 서버 기록 실패(앱 동작에는 영향 없음):', error.message);
      return 'unavailable';
    }
    return 'saved';
  } catch {
    return 'unavailable';
  }
}
