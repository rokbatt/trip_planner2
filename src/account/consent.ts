/**
 * 가입 동의 창.
 *
 * 두 번 쓰인다.
 *  - signup  : "Google 계정으로 시작하기"를 눌렀을 때. 취소하면 로그인 자체를 안 한다.
 *  - regate  : 이미 로그인된 사용자가 (이 기능이 생기기 전에 가입했거나, 약관 버전이 올라서)
 *              동의 기록이 없을 때. 닫을 수 없고, 동의하거나 로그아웃하거나 둘 중 하나다.
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
  isCurrentConsent,
  newConsentRecord,
  readLocalConsent,
  saveServerConsent,
  writeLocalConsent,
} from './consentStore';
import { signOut } from '../auth/auth';

type Mode = 'signup' | 'regate';

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
          <p>동의를 거부할 수 있으며, 거부하면 서비스를 이용할 수 없습니다.</p>
        </div>

        <div class="cs-actions">
          <button type="button" class="cs-btn cs-secondary" id="cs-cancel">
            ${mode === 'signup' ? '취소' : '로그아웃'}
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

    const onKey = (e: KeyboardEvent) => {
      // signup은 Esc로 닫을 수 있다. regate는 닫을 수 없다 — 동의 아니면 로그아웃이다.
      if (e.key === 'Escape' && mode === 'signup') finish(false);
    };
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
    if (mode === 'signup') {
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
    }

    boxes[0]?.focus();
  });
}

/**
 * 로그인 버튼을 눌렀을 때 — 이 기기에서 지금 버전에 이미 동의했으면 바로 통과,
 * 아니면 창을 띄우고 동의하면 기기에 기록한다. false면 로그인을 시작하지 않는다.
 */
export async function ensureConsentBeforeLogin(): Promise<boolean> {
  if (isCurrentConsent(readLocalConsent())) return true;
  const ok = await openConsentModal('signup');
  if (ok) writeLocalConsent(newConsentRecord());
  return ok;
}

/**
 * 로그인이 끝난 직후 — 서버에 동의 기록을 옮겨 적거나, 기록이 없는 기존 사용자에게 동의를 받는다.
 * 어떤 경우에도 예외를 던지지 않는다(여기서 앱이 멈추면 안 된다).
 */
export async function syncConsentAfterLogin(user: { id: string }): Promise<void> {
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

    // 기록 없음(또는 확인 불가) — 동의를 받는다
    if (regateOpen) return;
    regateOpen = true;
    try {
      const ok = await openConsentModal('regate');
      if (!ok) {
        await signOut();
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
