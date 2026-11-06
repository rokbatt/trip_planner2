/**
 * 계정 설정 화면(#settings) — 내 계정, 약관·방침, 로그아웃, 회원 탈퇴.
 *
 * 탈퇴 창의 원칙
 *  - "무엇이 지워지고 무엇이 남는지"를 내 실제 데이터로 계산해 보여 준 **뒤에만** 탈퇴를 허용한다.
 *    미리보기를 못 불러오면 버튼을 잠근다(모르는 채로 지우게 하지 않는다).
 *  - 되돌릴 수 없는 일이라 "탈퇴"를 직접 입력해야 버튼이 켜진다.
 *  - 서버 함수가 아직 없으면(SQL 미실행) 실패한 척하지 않고 이메일 요청 경로를 그대로 안내한다.
 */

import './settings.css';
import { store } from '../store';
import { navigate } from '../router';
import { signOut } from '../auth/auth';
import { readLocalConsent } from './consentStore';
import { deleteMyAccount, loadDeletionPreview, type DeletionPreview, type TripOutcome } from './accountStore';

const SUPPORT_EMAIL = 'help@mongsil.app';

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function renderSettings(): HTMLElement {
  window.scrollTo(0, 0);
  const user = store.get('user');
  const meta = (user?.user_metadata ?? {}) as Record<string, string | undefined>;
  const name = meta.full_name ?? meta.name ?? user?.email?.split('@')[0] ?? '사용자';
  const avatar = meta.avatar_url ?? meta.picture ?? '';
  const email = user?.email ?? '';
  const consent = readLocalConsent();

  const el = document.createElement('div');
  el.className = 'st-page';
  el.innerHTML = `
    <nav class="st-nav">
      <button type="button" class="st-back" id="st-back">← 돌아가기</button>
      <span class="st-brand">몽실이</span>
    </nav>

    <main class="st-main">
      <header class="st-head">
        <p class="st-eyebrow">ACCOUNT</p>
        <h1 class="st-title">계정 설정</h1>
      </header>

      <section class="st-card">
        <div class="st-profile">
          <span class="st-avatar">${avatar ? `<img src="${esc(avatar)}" alt="" referrerpolicy="no-referrer" />` : esc(name.charAt(0))}</span>
          <div class="st-who">
            <div class="st-name">${esc(name)}</div>
            <div class="st-email">${esc(email)}</div>
          </div>
        </div>
        <p class="st-note">Google 계정으로 로그인했어요. 비밀번호는 몽실이가 보관하지 않아요.</p>
      </section>

      <section class="st-card">
        <h2 class="st-h2">약관과 개인정보</h2>
        <a class="st-row" href="#terms">이용약관<span>›</span></a>
        <a class="st-row" href="#privacy">개인정보처리방침<span>›</span></a>
        <p class="st-note">${
          consent
            ? `동의 기록: ${fmtDate(consent.agreedAt)} · 약관 ${esc(consent.terms)} / 방침 ${esc(consent.privacy)}`
            : '이 기기에는 동의 기록이 없어요.'
        }</p>
      </section>

      <section class="st-card">
        <h2 class="st-h2">로그아웃</h2>
        <p class="st-note">이 기기에 저장해 둔 여행 데이터와 서류도 함께 지워져요. 다시 로그인하면 돌아와요.</p>
        <button type="button" class="st-btn" id="st-logout">로그아웃</button>
      </section>

      <section class="st-card st-danger">
        <h2 class="st-h2">회원 탈퇴</h2>
        <p class="st-note">계정과 내가 만든 여행을 지워요. 함께 쓰는 여행은 다른 멤버가 이어서 쓸 수 있도록 남아요. 되돌릴 수 없어요.</p>
        <button type="button" class="st-btn st-btn-danger" id="st-withdraw">회원 탈퇴</button>
      </section>
    </main>`;

  el.querySelector('#st-back')!.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else navigate('trips');
  });
  el.querySelector('#st-logout')!.addEventListener('click', () => { void signOut(); });
  el.querySelector('#st-withdraw')!.addEventListener('click', () => {
    if (user) openWithdrawModal(user.id, email);
  });
  return el;
}

/* ══════════════ 탈퇴 창 ══════════════ */

function outcomeLine(o: TripOutcome): string {
  if (o.kind === 'delete') return `<li><b>${esc(o.name)}</b> — 혼자 쓰던 여행이라 올린 문서 파일까지 통째로 삭제돼요</li>`;
  if (o.kind === 'transfer') {
    const who = o.successorName ? `${esc(o.successorName)}님` : '가장 먼저 참여한 멤버';
    return `<li><b>${esc(o.name)}</b> — 방장이 ${who}에게 넘어가요</li>`;
  }
  return `<li><b>${esc(o.name)}</b> — 나만 빠져요</li>`;
}

export function previewHtml(p: DeletionPreview): string {
  const gone = p.outcomes.filter((o) => o.kind === 'delete');
  const kept = p.outcomes.filter((o) => o.kind !== 'delete');

  const goneItems = [
    ...gone.map(outcomeLine),
    p.personalDocPaths.length ? `<li>내 개인 문서 보관함의 파일 ${p.personalDocPaths.length}개</li>` : '',
    '<li>내가 보낸 채팅 메시지와 장소 댓글</li>',
    '<li>로그인 정보와 동의 기록</li>',
  ].filter(Boolean);

  const keptItems = [
    ...kept.map(outcomeLine),
    kept.length ? '<li>내가 담은 장소·메모·링크·공유 문서·지출 기록은 남고, <b>작성자 이름만 지워져요</b></li>' : '',
  ].filter(Boolean);

  return `
    <div class="st-pv">
      <h3 class="st-pv-h st-pv-gone">지워지는 것</h3>
      <ul>${goneItems.join('')}</ul>
    </div>
    ${keptItems.length ? `
    <div class="st-pv">
      <h3 class="st-pv-h">남는 것</h3>
      <ul>${keptItems.join('')}</ul>
    </div>` : ''}
    ${p.unsettledCount > 0 ? `
    <div class="st-warn">
      <b>정산이 끝나지 않은 공동 지출이 ${p.unsettledCount}건 있어요.</b>
      탈퇴하면 결제자가 “탈퇴한 멤버”로 바뀌고 남은 사람들의 정산에서 빠질 수 있어요. 먼저 정산을 마무리해 두세요.
    </div>` : ''}`;
}

function openWithdrawModal(userId: string, email: string): void {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.className = 'st-overlay';
  overlay.innerHTML = `
    <div class="st-modal" role="dialog" aria-modal="true" aria-labelledby="st-m-title">
      <div id="st-m-body">
        <h2 class="st-m-title" id="st-m-title">정말 탈퇴할까요?</h2>
        <p class="st-m-lead">계정이 바로 삭제되고 <b>되돌릴 수 없어요.</b></p>
        <div id="st-preview" class="st-loading">무엇이 지워지는지 확인하는 중…</div>
        <label class="st-confirm" for="st-typed">확인을 위해 <b>탈퇴</b>를 입력해 주세요</label>
        <input id="st-typed" class="st-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" disabled />
        <div class="st-actions">
          <button type="button" class="st-btn" id="st-cancel">취소</button>
          <button type="button" class="st-btn st-btn-danger" id="st-go" disabled>탈퇴하기</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const body = overlay.querySelector<HTMLElement>('#st-m-body')!;
  const previewEl = overlay.querySelector<HTMLElement>('#st-preview')!;
  const typed = overlay.querySelector<HTMLInputElement>('#st-typed')!;
  const go = overlay.querySelector<HTMLButtonElement>('#st-go')!;
  const cancel = overlay.querySelector<HTMLButtonElement>('#st-cancel')!;

  let preview: DeletionPreview | null = null;
  let busy = false;

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 200);
    previouslyFocused?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) close(); };
  document.addEventListener('keydown', onKey);
  cancel.addEventListener('click', () => { if (!busy) close(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay && !busy) close(); });

  const refresh = () => { go.disabled = busy || !preview || typed.value.trim() !== '탈퇴'; };
  typed.addEventListener('input', refresh);

  void loadDeletionPreview(userId).then((p) => {
    preview = p;
    if (!p) {
      previewEl.className = 'st-warn';
      previewEl.innerHTML = '<b>지워지는 내용을 불러오지 못했어요.</b> 네트워크를 확인하고 잠시 뒤에 다시 시도해 주세요. 무엇이 지워지는지 확인하지 못하면 탈퇴할 수 없어요.';
      return;
    }
    previewEl.className = '';
    previewEl.innerHTML = previewHtml(p);
    typed.disabled = false;
    typed.focus();
    refresh();
  });

  const finish = (html: string, primary: { label: string; onClick: () => void }) => {
    body.innerHTML = `${html}<div class="st-actions"><button type="button" class="st-btn st-btn-primary" id="st-done">${primary.label}</button></div>`;
    body.querySelector('#st-done')!.addEventListener('click', primary.onClick);
  };

  go.addEventListener('click', async () => {
    if (!preview || go.disabled) return;
    busy = true;
    typed.disabled = true;
    cancel.disabled = true;
    refresh();
    const res = await deleteMyAccount(preview, (label) => { go.textContent = label; });
    busy = false;

    if (res.ok) {
      finish(
        `<h2 class="st-m-title">탈퇴가 끝났어요</h2>
         <p class="st-m-lead">이용해 주셔서 감사합니다.</p>
         ${res.filesFailed ? `<div class="st-warn">일부 문서 파일을 지우지 못했을 수 있어요. 마음에 걸리면 <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>로 알려 주세요.</div>` : ''}`,
        { label: '처음으로', onClick: () => { close(); navigate('login'); } }
      );
      return;
    }

    if (res.reason === 'unavailable') {
      const subject = encodeURIComponent('[몽실이] 회원 탈퇴 요청');
      const mailBody = encodeURIComponent(`가입 이메일: ${email}\n\n회원 탈퇴를 요청합니다.`);
      finish(
        `<h2 class="st-m-title">탈퇴 기능을 아직 쓸 수 없어요</h2>
         <p class="st-m-lead">서버에 탈퇴 기능이 아직 켜지지 않았어요. 계정은 그대로예요.</p>
         <div class="st-warn"><a href="mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${mailBody}">${SUPPORT_EMAIL}</a>로 요청해 주시면 확인 후 직접 지워 드려요.</div>`,
        { label: '닫기', onClick: close }
      );
      return;
    }

    finish(
      `<h2 class="st-m-title">탈퇴하지 못했어요</h2>
       <p class="st-m-lead">계정은 그대로예요. 다만 <b>문서 파일 일부는 이미 지워졌을 수 있어요.</b> 잠시 뒤에 다시 시도해 주세요.</p>
       ${res.message ? `<div class="st-warn st-mono">${esc(res.message)}</div>` : ''}`,
      { label: '닫기', onClick: close }
    );
  });
}
