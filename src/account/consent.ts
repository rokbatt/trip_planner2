/**
 * 가입 동의 창.
 *
 * 로그인 **직후**, 서버에 동의 기록이 없는 사람에게만 뜬다(어느 기기에서든 한 번).
 *  - welcome : 방금 가입한 사람. 동의하지 않으면 방금 만든 계정을 바로 지운다(정보를 남기지 않음).
 *  - regate  : 기존 사용자인데 기록이 없을 때(이 기능 전 가입, 약관 버전 변경). 동의하지 않으면 로그아웃.
 * 둘 다 닫을 수 없다 — 동의하거나, 거절하거나.
 *
 * 동의 항목은 legal/versions.ts의 CONSENT_ITEMS에서 읽는다. 항목을 더하거나 빼려면(예: 국외이전
 * 동의를 따로 받아야 한다는 법률 검토 결과가 나오면) 그 배열만 고치면 된다.
 */

import './consent.css';
import { CONSENT_ITEMS } from '../legal/versions';
import {
  allRequiredChecked,
  canClaimLocalConsent,
  fetchServerConsent,
  isFreshSignup,
  newConsentRecord,
  shouldAskConsent,
  readLocalConsent,
  saveServerConsent,
  writeLocalConsent,
} from './consentStore';
import { signOut } from '../auth/auth';
import { supabase } from '../supabase';

type Mode = 'welcome' | 'regate';

let regateOpen = false;

export function openConsentModal(mode: Mode): Promise<boolean> {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const required = CONSENT_ITEMS.filter((i) => i.required).map((i) => i.key);
    const checked: Record<string, boolean> = {};

    const overlay = document.createElement('div');
    overlay.className = 'cs-overlay';
    overlay.innerHTML = `
      <div class="cs-modal" role="dialog" aria-modal="true" aria-labelledby="cs-title">
        <h2 class="cs-title" id="cs-title">서비스 이용 동의</h2>
        <p class="cs-lead">서비스 이용을 위해 아래 필수 항목에 동의해 주세요.</p>

        <label class="cs-row cs-all">
          <input type="checkbox" id="cs-all" />
          <span class="cs-box" aria-hidden="true"></span>
          <span class="cs-text">전체 동의</span>
        </label>

        <div class="cs-list">
          ${CONSENT_ITEMS.map(
            (i) => `
            <div class="cs-item">
              <label class="cs-row">
                <input type="checkbox" data-key="${i.key}" />
                <span class="cs-box" aria-hidden="true"></span>
                <span class="cs-text"><em class="cs-req">${i.required ? '[필수]' : '[선택]'}</em>${i.label}</span>
              </label>
              ${i.href ? `<a class="cs-view" href="${i.href}" target="_blank" rel="noopener">보기</a>` : ''}
            </div>`
          ).join('')}
        </div>

        <div class="cs-summary">
          <strong>개인정보 수집·이용 안내</strong>
          <dl>
            <div><dt>수집 항목</dt><dd>이름, 이메일, 프로필 사진</dd></div>
            <div><dt>이용 목적</dt><dd>로그인 및 여행 서비스 제공, 동행자와 정보 공유</dd></div>
            <div><dt>보유 기간</dt><dd>회원 탈퇴 시까지</dd></div>
          </dl>
          <p>동의를 거부할 수 있으며, 거부하면 서비스를 이용할 수 없습니다.${mode === 'welcome' ? ' 동의하지 않으면 방금 만들어진 계정과 받은 정보는 바로 삭제됩니다.' : ''}</p>
        </div>

        <div class="cs-actions">
          <button type="button" class="cs-btn cs-secondary" id="cs-cancel">
            ${mode === 'welcome' ? '동의하지 않음' : '로그아웃'}
          </button>
          <button type="button" class="cs-btn cs-primary" id="cs-agree" disabled>동의하고 계속</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const all = overlay.querySelector<HTMLInputElement>('#cs-all')!;
    const boxes = Array.from(overlay.querySelectorAll<HTMLInputElement>('input[data-key]'));
    const agree = overlay.querySelector<HTMLButtonElement>('#cs-agree')!;

    const refresh = () => {
      boxes.forEach((b) => { checked[b.dataset.key!] = b.checked; });
      all.checked = boxes.every((b) => b.checked);
      agree.disabled = !allRequiredChecked(checked, required);
    };
    all.addEventListener('change', () => { boxes.forEach((b) => { b.checked = all.checked; }); refresh(); });
    boxes.forEach((b) => b.addEventListener('change', refresh));

    // 닫을 수 없다(Esc·바깥 누르기 없음) — 동의하거나 거절하거나 둘 중 하나다
    const onKey = (_e: KeyboardEvent) => {};
    document.addEventListener('keydown', onKey);

    const finish = (result: boolean) => {
      document.removeEventListener('keydown', onKey);
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 200);
      previouslyFocused?.focus?.();
      resolve(result);
    };

    overlay.querySelector('#cs-cancel')!.addEventListener('click', () => finish(false));
    agree.addEventListener('click', () => { if (!agree.disabled) finish(true); });

    boxes[0]?.focus();
  });
}

/**
 * 로그인이 끝난 직후 — 서버에 동의 기록을 옮겨 적거나, 기록이 없는 기존 사용자에게 동의를 받는다.
 * 어떤 경우에도 예외를 던지지 않는다(여기서 앱이 멈추면 안 된다).
 */
export async function syncConsentAfterLogin(user: { id: string; created_at?: string }): Promise<void> {
  try {
    const local = readLocalConsent();

    // 방금 로그인 전에 동의한 경우(가장 흔함) — 이 사람 것으로 확정하고 서버에 옮겨 적는다.
    // 다른 사람 것으로 이미 확정된 기록이면(공용 기기) 건너뛰고 아래에서 이 사람에게 직접 묻는다.
    if (canClaimLocalConsent(local, user.id)) {
      const mine = { ...local!, userId: user.id };
      writeLocalConsent(mine);
      void saveServerConsent(user.id, mine);
      return;
    }

    // 오프라인이면 묻지 않는다 — 비행기 안에서 서류를 꺼내려는 사람 앞을 막으면 안 되고,
    // "동의하지 않고 로그아웃"이 이 기기의 오프라인 서류까지 지워 버린다.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const server = await fetchServerConsent(user.id);
    if (server.state === 'recorded') {
      // 다음부터 서버에 안 물어도 되게 이 기기에도 적어 둔다 — 날짜는 서버가 가진 실제 동의 시각
      writeLocalConsent({ ...newConsentRecord(server.agreedAt ? new Date(server.agreedAt) : new Date()), userId: user.id });
      return;
    }

    const fresh = isFreshSignup(user.created_at);
    if (!shouldAskConsent(server.state, fresh)) return;
    if (regateOpen) return;
    regateOpen = true;
    try {
      const ok = await openConsentModal(fresh ? 'welcome' : 'regate');
      if (!ok) {
        if (fresh) await discardFreshAccount();
        else await signOut();
        return;
      }
      const rec = { ...newConsentRecord(), userId: user.id };
      writeLocalConsent(rec);
      await saveServerConsent(user.id, rec);
    } finally {
      regateOpen = false;
    }
  } catch (e) {
    console.warn('[consent] 동의 확인 중 오류(앱 동작에는 영향 없음):', e);
  }
}

/**
 * 새 가입자가 동의하지 않았을 때 — 방금 만들어진 계정을 지운다(탈퇴와 같은 서버 함수, 아직 여행·파일이 없다).
 * 함수가 없거나 실패하면 로그아웃만 한다(계정은 남지만 동의 기록이 없어 다음 로그인 때 다시 묻는다).
 */
async function discardFreshAccount(): Promise<void> {
  try {
    const { error } = await supabase.rpc('delete_my_account');
    if (error) console.warn('[consent] 새 계정 삭제 실패 — 로그아웃만 합니다:', error.message);
  } catch (e) {
    console.warn('[consent] 새 계정 삭제 실패 — 로그아웃만 합니다:', e);
  }
  try { localStorage.removeItem('mongsil:consent'); } catch { /* 저장소 차단 환경 */ }
  await signOut();
}
