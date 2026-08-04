/**
 * 공항 이름 자동완성(스카이스캐너 스타일) + 시각 입력 칸 — 여러 화면(여행 생성/편집,
 * 예전엔 ROUTE에도)에서 똑같이 필요해서 뽑아낸 공용 컴포넌트.
 *
 * 좌표는 자동완성 드롭다운에서 실제로 골랐을 때만 채워진다(원칙 3-1 — 실측 없이
 * 좌표를 지어내지 않기 위해). 이름만 직접 타이핑하고 끝내면 이름만 저장된다.
 */
import { loadGoogleMapsScript, getAirportPredictions, getPlaceDetails, extractPlaceResult } from '../utils/googleMaps';
import type { PlacePrediction } from '../utils/googleMaps';
import { rehostPhoto } from './addGooglePlace';
import { parseTimeInput } from '../utils/travelEstimate';
import './airportPicker.css';

export interface AirportValue {
  airport: string | null;
  time: string | null;
  lat: number | null;
  lng: number | null;
  photoUrl: string | null;
  rating: number | null;
}

export const EMPTY_AIRPORT_VALUE: AirportValue = {
  airport: null, time: null, lat: null, lng: null, photoUrl: null, rating: null,
};

export interface AirportPickerHandle {
  getValue(): AirportValue;
  /** 자동완성에서 방금 고른 곳의 좌표 조회(getPlaceDetails)가 아직 안 끝났으면 끝날 때까지
   *  기다린다 — 고르자마자 바로 저장 버튼을 눌러도 좌표가 빠진 채로 getValue()가 불리지
   *  않도록, 저장 직전에 반드시 이걸 먼저 await해야 한다. */
  waitForPending(): Promise<void>;
  destroy(): void;
}

export interface AirportPickerOptions {
  /** aria-label과 기본 placeholder에 쓰이는 라벨(예: "입국", "출국") */
  label: string;
  placeholder?: string;
  initial?: AirportValue;
  /** 값이 확정될 때마다(이름만 입력/시각 변경/자동완성 선택) 호출 */
  onChange?: (value: AirportValue) => void;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** container 안에 공항 입력 행 하나를 mount. route.ts에 있던 airportInfoHtml/bindAirportInfo를
 *  일반화해서 trip-create/trip-edit 등에서 재사용한다. */
export function mountAirportPicker(container: HTMLElement, opts: AirportPickerOptions): AirportPickerHandle {
  let value: AirportValue = { ...EMPTY_AIRPORT_VALUE, ...opts.initial };

  const wrap = document.createElement('div');
  wrap.className = 'apk-row';
  wrap.innerHTML = [
    '<span class="apk-icon" aria-hidden="true">✈️</span>',
    '<input type="text" class="apk-airport" placeholder="' + escapeHtml(opts.placeholder ?? opts.label + ' 공항 (예: 인천 ICN)') + '"' +
      ' value="' + escapeHtml(value.airport ?? '') + '" aria-label="' + escapeHtml(opts.label) + ' 공항" />',
    '<input type="text" class="apk-time" placeholder="HH:MM" value="' + escapeHtml(value.time ?? '') + '"' +
      ' inputmode="numeric" maxlength="5" spellcheck="false" aria-label="' + escapeHtml(opts.label) + ' 시각 (24시간 HH:MM)" />',
  ].join('');
  container.appendChild(wrap);

  const airportInput = wrap.querySelector('.apk-airport') as HTMLInputElement;
  const timeInput = wrap.querySelector('.apk-time') as HTMLInputElement;

  // 자동완성 준비 — 실패해도(키 없음 등) 이름 직접 입력/시각 입력은 그대로 동작
  void loadGoogleMapsScript().catch(() => {});

  const emit = () => opts.onChange?.(value);

  const commitNameOnly = () => {
    const v = airportInput.value.trim();
    if (v === (value.airport ?? '')) return;
    value = { ...value, airport: v || null };
    emit();
  };
  const commitTime = () => {
    const parsed = parseTimeInput(timeInput.value);
    if (parsed === (value.time ?? null) && timeInput.value.trim() !== '') return;
    const next = timeInput.value.trim() ? parsed : null;
    value = { ...value, time: next };
    emit();
  };

  let acTimer: ReturnType<typeof setTimeout> | null = null;
  let acPredictions: PlacePrediction[] = [];
  const closeAc = () => {
    wrap.querySelector('.apk-ac')?.remove();
    acPredictions = [];
  };
  // 드롭다운에서 골랐을 때 좌표 조회(getPlaceDetails)가 끝나기 전에 저장 버튼을 눌러버리는
  // 경우를 막기 위해 진행 중인 조회를 추적 — waitForPending()이 이걸 기다린다.
  let pendingLookup: Promise<void> | null = null;

  // 드롭다운에서 실제로 골랐을 때만 좌표를 받아와 채운다
  const selectAirport = (p: PlacePrediction): Promise<void> => {
    airportInput.value = p.mainText;
    closeAc();
    value = { ...value, airport: p.mainText };

    const lookup = (async () => {
      let lat: number | null = null;
      let lng: number | null = null;
      let photo: string | null = null;
      let rating: number | null = null;
      try {
        const details = await getPlaceDetails(p.placeId);
        const extracted = extractPlaceResult(details);
        lat = extracted?.lat ?? null;
        lng = extracted?.lng ?? null;
        photo = extracted?.photoUrl ?? null;
        rating = extracted?.rating ?? null;
        // Google 원본 URL을 그대로 저장하면 볼 때마다 Google에 요청이 나가고(비용) 언젠가
        // 만료된다 — 우리 Storage로 재호스팅해서 저장.
        if (photo) photo = await rehostPhoto(photo, p.placeId);
      } catch (e) {
        console.error('[airportPicker] 공항 정보 조회 실패(이름만 저장):', (e as Error).message);
      }
      value = { ...value, lat, lng, photoUrl: photo, rating };
      emit();
    })();
    pendingLookup = lookup;
    return lookup;
  };
  const renderAc = () => {
    wrap.querySelector('.apk-ac')?.remove();
    if (acPredictions.length === 0) return;
    const dd = document.createElement('div');
    dd.className = 'apk-ac';
    dd.innerHTML = acPredictions
      .map(
        (p, i) =>
          '<button type="button" class="apk-ac-item" data-idx="' + i + '">' +
          '<span class="apk-ac-main">' + escapeHtml(p.mainText) + '</span>' +
          (p.secondaryText ? '<span class="apk-ac-sub">' + escapeHtml(p.secondaryText) + '</span>' : '') +
          '</button>'
      )
      .join('');
    dd.querySelectorAll('.apk-ac-item').forEach((btn) => {
      // mousedown을 써야 input의 blur(그로 인한 드롭다운 닫힘)보다 먼저 선택이 처리된다
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const idx = Number((btn as HTMLElement).dataset.idx);
        void selectAirport(acPredictions[idx]);
      });
    });
    wrap.appendChild(dd);
  };

  const onInput = () => {
    const q = airportInput.value.trim();
    if (acTimer) clearTimeout(acTimer);
    if (q.length < 2) { closeAc(); return; }
    acTimer = setTimeout(async () => {
      acPredictions = await getAirportPredictions(q);
      renderAc();
    }, 300);
  };
  const onBlur = () => {
    commitNameOnly();
    setTimeout(closeAc, 120); // mousedown 선택이 먼저 처리될 시간을 준 뒤 닫음
  };
  const onKeydown = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAc(); };
  const onClickStop = (e: MouseEvent) => e.stopPropagation();
  const onTimeKeydown = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); timeInput.blur(); } };

  airportInput.addEventListener('input', onInput);
  airportInput.addEventListener('blur', onBlur);
  airportInput.addEventListener('keydown', onKeydown);
  airportInput.addEventListener('click', onClickStop);
  timeInput.addEventListener('change', commitTime);
  timeInput.addEventListener('keydown', onTimeKeydown);
  timeInput.addEventListener('click', onClickStop);

  return {
    getValue: () => value,
    waitForPending: async () => { if (pendingLookup) await pendingLookup; },
    destroy: () => wrap.remove(),
  };
}
