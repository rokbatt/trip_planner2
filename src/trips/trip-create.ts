import { supabase } from '../supabase';
import { store } from '../store';
import './trip-create.css';

const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6L18 18M6 18L18 6"/></svg>';

/**
 * 새 여행 생성 모달 열기
 * onCreated: 생성 성공 시 호출되는 콜백 (여행 목록 새로고침용)
 */
export function openCreateTripModal(onCreated: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'tc-overlay';

  overlay.innerHTML = [
    '<div class="tc-modal">',
    '  <div class="tc-header">',
    '    <div>',
    '      <p class="tc-label">NEW TRAVEL PASS</p>',
    '      <h2 class="tc-title">새 여행 만들기</h2>',
    '    </div>',
    '    <button class="tc-close" id="tc-close">' + ICON_CLOSE + '</button>',
    '  </div>',
    '  <form id="tc-form">',
    '    <div class="tc-field">',
    '      <label class="tc-field-label">여행 이름</label>',
    '      <input class="tc-input" id="tc-name" type="text" placeholder="예: 뉴욕 자유여행" required />',
    '    </div>',
    '    <div class="tc-field">',
    '      <label class="tc-field-label">목적지 도시</label>',
    '      <input class="tc-input" id="tc-city" type="text" placeholder="예: 방콕" />',
    '    </div>',
    '    <div class="tc-row">',
    '      <div class="tc-field">',
    '        <label class="tc-field-label">출발일</label>',
    '        <input class="tc-input" id="tc-start" type="date" required />',
    '      </div>',
    '      <div class="tc-field">',
    '        <label class="tc-field-label">도착일</label>',
    '        <input class="tc-input" id="tc-end" type="date" required />',
    '      </div>',
    '    </div>',
    '    <div class="tc-row">',
    '      <div class="tc-field">',
    '        <label class="tc-field-label">인원</label>',
    '        <input class="tc-input" id="tc-headcount" type="number" min="1" placeholder="2" />',
    '      </div>',
    '      <div class="tc-field">',
    '        <label class="tc-field-label">테마 (선택)</label>',
    '        <input class="tc-input" id="tc-theme" type="text" placeholder="맛집투어" />',
    '      </div>',
    '    </div>',
    '    <p class="tc-error" id="tc-error"></p>',
    '    <div class="tc-actions">',
    '      <button type="button" class="tc-btn-cancel" id="tc-cancel">취소</button>',
    '      <button type="submit" class="tc-btn-submit" id="tc-submit">여행 만들기</button>',
    '    </div>',
    '  </form>',
    '</div>',
  ].join('\n');

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 220);
  };

  overlay.querySelector('#tc-close')!.addEventListener('click', close);
  overlay.querySelector('#tc-cancel')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  const form = overlay.querySelector('#tc-form') as HTMLFormElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleSubmit(overlay, onCreated, close);
  });
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function handleSubmit(
  overlay: HTMLElement,
  onCreated: () => void,
  close: () => void
): Promise<void> {
  const submitBtn = overlay.querySelector('#tc-submit') as HTMLButtonElement;
  const errorEl = overlay.querySelector('#tc-error') as HTMLElement;
  errorEl.classList.remove('show');

  const user = store.get('user');
  if (!user) {
    errorEl.textContent = '로그인 정보가 없어요. 다시 로그인해주세요.';
    errorEl.classList.add('show');
    return;
  }

  const name = (overlay.querySelector('#tc-name') as HTMLInputElement).value.trim();
  const city = (overlay.querySelector('#tc-city') as HTMLInputElement).value.trim();
  const startDate = (overlay.querySelector('#tc-start') as HTMLInputElement).value;
  const endDate = (overlay.querySelector('#tc-end') as HTMLInputElement).value;
  const headcountRaw = (overlay.querySelector('#tc-headcount') as HTMLInputElement).value;
  const theme = (overlay.querySelector('#tc-theme') as HTMLInputElement).value.trim();

  if (!name || !startDate || !endDate) {
    errorEl.textContent = '여행 이름과 날짜는 필수예요.';
    errorEl.classList.add('show');
    return;
  }

  if (new Date(endDate) < new Date(startDate)) {
    errorEl.textContent = '도착일은 출발일보다 빠를 수 없어요.';
    errorEl.classList.add('show');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = '만드는 중...';

  try {
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .insert({
        name,
        start_date: startDate,
        end_date: endDate,
        headcount: headcountRaw ? Number(headcountRaw) : null,
        theme: theme || null,
        destinations: city ? [city] : null,
        dest_coords: null,
        owner_id: user.id,
        invite_code: generateInviteCode(),
      })
      .select()
      .single();

    if (tripError) throw tripError;

    const metaFullName = user.user_metadata && user.user_metadata.full_name;
    const metaName = user.user_metadata && user.user_metadata.name;
    const metaAvatar = user.user_metadata && user.user_metadata.avatar_url;
    const metaPicture = user.user_metadata && user.user_metadata.picture;

    const { error: memberError } = await supabase.from('trip_members').insert({
      trip_id: trip.id,
      user_id: user.id,
      role: 'owner',
      display_name: metaFullName || metaName || user.email || '나',
      avatar_url: metaAvatar || metaPicture || null,
      added_by: user.id,
    });

    if (memberError) throw memberError;

    close();
    onCreated();
  } catch (err) {
    console.error('여행 생성 실패:', err);
    errorEl.textContent = '여행을 만들지 못했어요. 잠시 후 다시 시도해주세요.';
    errorEl.classList.add('show');
    submitBtn.disabled = false;
    submitBtn.textContent = '여행 만들기';
  }
}
