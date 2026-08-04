import { supabase } from '../supabase';
import { store } from '../store';
import { createDestination } from './destinations';
import { mountAirportPicker } from './airportPicker';
import type { AirportValue } from './airportPicker';
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
    '      <input class="tc-input" id="tc-city" type="text" placeholder="예: 방콕, 파타야 (여러 도시는 콤마로 구분)" />',
    '    </div>',
    '    <div class="tc-row">',
    '      <div class="tc-field">',
    '        <label class="tc-field-label">출발일</label>',
    '        <input class="tc-input" id="tc-start" type="date" required />',
    '      </div>',
    '      <div class="tc-field">',
    '        <label class="tc-field-label">복귀일</label>',
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
    '    <div class="tc-field">',
    '      <label class="tc-field-label">항공편 (선택)</label>',
    '      <div class="tc-airport-group">',
    '        <div class="tc-airport-slot" id="tc-arrival-mount"></div>',
    '        <div class="tc-airport-slot" id="tc-departure-mount"></div>',
    '      </div>',
    '      <p class="tc-airport-hint">여러 도시를 여행하면 입국은 첫 도시, 출국은 마지막 도시 기준으로 저장돼요. 나머지 이동 항공편은 여행 편집에서 추가할 수 있어요.</p>',
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

  const arrivalPicker = mountAirportPicker(overlay.querySelector('#tc-arrival-mount') as HTMLElement, {
    label: '입국',
    placeholder: '입국 공항 (예: 수완나품 BKK)',
  });
  const departurePicker = mountAirportPicker(overlay.querySelector('#tc-departure-mount') as HTMLElement, {
    label: '출국',
    placeholder: '출국 공항 (예: 인천 ICN)',
  });

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
    // 자동완성에서 방금 고른 공항의 좌표 조회가 아직 진행 중일 수 있으니(비동기) 다 끝날
    // 때까지 기다린 뒤에 값을 읽는다 — 안 그러면 고르자마자 바로 제출했을 때 좌표가 빠진다.
    await Promise.all([arrivalPicker.waitForPending(), departurePicker.waitForPending()]);
    await handleSubmit(overlay, arrivalPicker.getValue(), departurePicker.getValue(), onCreated, close);
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
  arrival: AirportValue,
  departure: AirportValue,
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
    errorEl.textContent = '복귀일은 출발일보다 빠를 수 없어요.';
    errorEl.classList.add('show');
    return;
  }

  const destinations = city
    ? city.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

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
        destinations: destinations.length ? destinations : null,
        owner_id: user.id,
      })
      .select()
      .single();

    if (tripError) throw tripError;

    const metaFullName = user.user_metadata && user.user_metadata.full_name;
    const metaName = user.user_metadata && user.user_metadata.name;
    const metaAvatar = user.user_metadata && user.user_metadata.avatar_url;
    const metaPicture = user.user_metadata && user.user_metadata.picture;

    // 트리거가 owner를 trip_members에 이미 추가했을 수 있으므로 upsert로 충돌(409) 없이
    // 넘어가되, ignoreDuplicates는 쓰지 않는다 — 이미 있는 행이면 트리거가 만든 이름/아바타
    // 없는 placeholder일 수 있으므로, 여기서 실제 프로필 정보(display_name/avatar_url)로
    // 덮어써야 한다. (ignoreDuplicates:true였을 때는 이미 있는 행을 그대로 두고 조용히
    // 넘어가서, 트리거가 만든 이름/아바타 없는 행이 계속 남아 프로필 사진이 "?"로 보였음)
    //
    // ⚠️ trip_destinations를 만들기 **전에** 반드시 먼저 실행해야 한다 — trip_destinations의
    // RLS 정책이 "이 트립의 trip_members에 내가 있어야" insert를 허용하는데, 트리거가 아직
    // 안 돌았거나 지연되면 순서가 바뀌었을 때 항공편 정보를 담은 여행지 행이 RLS에 막혀
    // 조용히(에러 알림 없이) 사라져버린다.
    const { error: memberError } = await supabase.from('trip_members').upsert(
      {
        trip_id: trip.id,
        user_id: user.id,
        role: 'owner',
        display_name: metaFullName || metaName || user.email || '나',
        avatar_url: metaAvatar || metaPicture || null,
      },
      { onConflict: 'trip_id,user_id' }
    );

    if (memberError) throw memberError;

    // 입국/출국 항공편을 입력했으면(또는 도시를 여러 곳 적었으면) 실제 trip_destinations 행을
    // 바로 만든다 — arrival_*/departure_* 컬럼은 실제 여행지 행에만 있어서, 만들어두지 않으면
    // 지금 입력한 항공편 정보를 저장할 곳이 없다. 도시를 안 적었어도 항공편만 입력했으면
    // 여행 이름으로 여행지 1개를 만든다(여행 편집에서 이름은 나중에 바꿀 수 있음).
    const destNames = destinations.length ? destinations : (arrival.airport || departure.airport ? [name] : []);
    for (let i = 0; i < destNames.length; i++) {
      const isFirst = i === 0;
      const isLast = i === destNames.length - 1;
      const created = await createDestination(trip.id, destNames[i], {
        sortOrder: i,
        ...(isFirst
          ? {
              arrivalAirport: arrival.airport, arrivalTime: arrival.time,
              arrivalLat: arrival.lat, arrivalLng: arrival.lng,
              arrivalPhotoUrl: arrival.photoUrl, arrivalRating: arrival.rating,
            }
          : {}),
        ...(isLast
          ? {
              departureAirport: departure.airport, departureTime: departure.time,
              departureLat: departure.lat, departureLng: departure.lng,
              departurePhotoUrl: departure.photoUrl, departureRating: departure.rating,
            }
          : {}),
      });
      if (!created) console.error('[trip-create] 여행지 "' + destNames[i] + '" 생성 실패 — 항공편 정보가 저장되지 않았을 수 있어요.');
    }

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
