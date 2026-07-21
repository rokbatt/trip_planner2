import { supabase } from '../supabase';
import {
  loadDestinations,
  createDestination,
  updateDestination,
  deleteDestination,
  isSyntheticDestination,
} from './destinations';
import type { Trip } from '../types/database';
import './trip-create.css';
import './trip-edit.css';

const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6L18 18M6 18L18 6"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>';
const ICON_WARNING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ── 여행 삭제 (내 여행 카드에서 옮겨옴 — 편집 모달의 위험 구역에서 트리거) ── */
async function deleteTrip(tripId: string): Promise<{ success: boolean; error?: string }> {
  // trip_members 먼저 정리 (FK 제약 대비)
  const { error: memberError } = await supabase.from('trip_members').delete().eq('trip_id', tripId);
  if (memberError) return { success: false, error: memberError.message };

  const { error: tripError } = await supabase.from('trips').delete().eq('id', tripId);
  if (tripError) return { success: false, error: tripError.message };

  return { success: true };
}

export function openDeleteConfirm(trip: Trip, onDeleted: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'tdel-overlay';

  overlay.innerHTML = [
    '<div class="tdel-modal">',
    `  <div class="tdel-icon">${ICON_WARNING}</div>`,
    '  <div class="tdel-title">여행을 삭제할까요?</div>',
    `  <div class="tdel-desc"><strong>${escapeHtml(trip.name)}</strong> 여행을 삭제하시겠습니까?<br>이 작업은 되돌릴 수 없어요.</div>`,
    '  <div class="tdel-actions">',
    '    <button class="tdel-btn-cancel" id="tdel-cancel">취소</button>',
    '    <button class="tdel-btn-confirm" id="tdel-confirm">삭제하기</button>',
    '  </div>',
    '</div>',
  ].join('\n');

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 200);
  };

  overlay.querySelector('#tdel-cancel')!.addEventListener('click', close);
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

  const confirmBtn = overlay.querySelector('#tdel-confirm') as HTMLButtonElement;
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '삭제 중...';

    const result = await deleteTrip(trip.id);

    if (result.success) {
      close();
      onDeleted();
    } else {
      console.error('여행 삭제 실패:', result.error);
      confirmBtn.disabled = false;
      confirmBtn.textContent = '삭제하기';
      alert('삭제하지 못했어요. 잠시 후 다시 시도해주세요.');
    }
  });
}

interface WorkingDest {
  /** 실제 trip_destinations 행 id. null이면 아직 DB에 없음(합성 상태 또는 이번 세션에 새로 추가) */
  realId: string | null;
  name: string;
  start: string; // <input type=date> value, '' 허용
  end: string;
}

/**
 * 여행 편집 모달 — 제목, 여행지 추가/변경/삭제, 여행 삭제.
 * 다중 여행지 관리의 단일 진입점(브레인스토밍 보드는 여기서 정한 여행지 중 "전환"만 함).
 */
export function openEditTripModal(trip: Trip, onSaved: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'tc-overlay';

  overlay.innerHTML = [
    '<div class="tc-modal te-modal">',
    '  <div class="tc-header">',
    '    <div>',
    '      <p class="tc-label">EDIT TRAVEL PASS</p>',
    '      <h2 class="tc-title">여행 편집</h2>',
    '    </div>',
    '    <button class="tc-close" id="te-close">' + ICON_CLOSE + '</button>',
    '  </div>',
    '  <form id="te-form">',
    '    <div class="tc-field">',
    '      <label class="tc-field-label">여행 이름</label>',
    '      <input class="tc-input" id="te-name" type="text" value="' + escapeHtml(trip.name) + '" required />',
    '    </div>',
    '    <div class="tc-field">',
    '      <label class="tc-field-label">여행지</label>',
    '      <div class="te-dest-list" id="te-dest-list"></div>',
    '      <button type="button" class="te-dest-add" id="te-dest-add">' + ICON_PLUS + ' 여행지 추가</button>',
    '    </div>',
    '    <p class="tc-error" id="te-error"></p>',
    '    <div class="te-danger-row">',
    '      <button type="button" class="te-delete-trip" id="te-delete-trip">' + ICON_TRASH + ' 이 여행 삭제</button>',
    '    </div>',
    '    <div class="tc-actions">',
    '      <button type="button" class="tc-btn-cancel" id="te-cancel">취소</button>',
    '      <button type="submit" class="tc-btn-submit" id="te-submit">저장</button>',
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

  overlay.querySelector('#te-close')!.addEventListener('click', close);
  overlay.querySelector('#te-cancel')!.addEventListener('click', close);
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

  overlay.querySelector('#te-delete-trip')!.addEventListener('click', () => {
    close();
    openDeleteConfirm(trip, onSaved);
  });

  /* ── 여행지 목록 (로드 후 채움 — 합성/실제 모두 loadDestinations가 통일해서 줌) ── */
  let working: WorkingDest[] = [];
  const listEl = overlay.querySelector('#te-dest-list') as HTMLElement;

  function renderDestRows(): void {
    listEl.innerHTML = working
      .map((w, i) => {
        const canRemove = working.length > 1;
        return [
          '<div class="te-dest-row" data-idx="' + i + '">',
          '  <input class="te-dest-input te-dest-name" type="text" placeholder="예: 치앙마이" value="' + escapeHtml(w.name) + '" data-idx="' + i + '" />',
          '  <input class="te-dest-input te-dest-date" type="date" value="' + w.start + '" data-idx="' + i + '" data-field="start" />',
          '  <span class="te-dest-tilde">~</span>',
          '  <input class="te-dest-input te-dest-date" type="date" value="' + w.end + '" data-idx="' + i + '" data-field="end" />',
          canRemove ? '  <button type="button" class="te-dest-remove" data-idx="' + i + '" title="여행지 삭제">' + ICON_CLOSE + '</button>' : '<span class="te-dest-remove-spacer"></span>',
          '</div>',
        ].join('');
      })
      .join('');

    listEl.querySelectorAll('.te-dest-name').forEach((el) => {
      el.addEventListener('input', (e) => {
        const idx = Number((e.target as HTMLElement).dataset.idx);
        working[idx].name = (e.target as HTMLInputElement).value;
      });
    });
    listEl.querySelectorAll('.te-dest-date').forEach((el) => {
      el.addEventListener('input', (e) => {
        const t = e.target as HTMLInputElement;
        const idx = Number(t.dataset.idx);
        const field = t.dataset.field as 'start' | 'end';
        working[idx][field] = t.value;
      });
    });
    listEl.querySelectorAll('.te-dest-remove').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = Number((el as HTMLElement).dataset.idx);
        working.splice(idx, 1);
        renderDestRows();
      });
    });
  }

  overlay.querySelector('#te-dest-add')!.addEventListener('click', () => {
    working.push({ realId: null, name: '', start: '', end: '' });
    renderDestRows();
    const inputs = listEl.querySelectorAll('.te-dest-name');
    (inputs[inputs.length - 1] as HTMLInputElement)?.focus();
  });

  loadDestinations(trip).then((dests) => {
    working = dests.map((d) => ({
      realId: isSyntheticDestination(d.id) ? null : d.id,
      name: d.name,
      start: d.start_date ?? '',
      end: d.end_date ?? '',
    }));
    renderDestRows();
  });

  const form = overlay.querySelector('#te-form') as HTMLFormElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleSave(overlay, trip, working, onSaved, close);
  });
}

async function handleSave(
  overlay: HTMLElement,
  trip: Trip,
  working: WorkingDest[],
  onSaved: () => void,
  close: () => void
): Promise<void> {
  const submitBtn = overlay.querySelector('#te-submit') as HTMLButtonElement;
  const errorEl = overlay.querySelector('#te-error') as HTMLElement;
  errorEl.classList.remove('show');

  const name = (overlay.querySelector('#te-name') as HTMLInputElement).value.trim();
  if (!name) {
    errorEl.textContent = '여행 이름을 입력해주세요.';
    errorEl.classList.add('show');
    return;
  }
  const cleaned = working.map((w) => ({ ...w, name: w.name.trim() }));
  if (cleaned.length === 0 || cleaned.some((w) => !w.name)) {
    errorEl.textContent = '모든 여행지에 도시 이름을 입력해주세요.';
    errorEl.classList.add('show');
    return;
  }
  for (const w of cleaned) {
    if (w.start && w.end && new Date(w.end) < new Date(w.start)) {
      errorEl.textContent = '여행지 기간의 도착일은 출발일보다 빠를 수 없어요.';
      errorEl.classList.add('show');
      return;
    }
  }

  submitBtn.disabled = true;
  submitBtn.textContent = '저장 중...';

  try {
    await supabase.from('trips').update({ name }).eq('id', trip.id);

    const original = await loadDestinations(trip);
    const originalIsSynthetic = original.length === 1 && isSyntheticDestination(original[0].id);

    if (originalIsSynthetic && cleaned.length === 1 && cleaned[0].realId === null) {
      // 아직 여행지를 1개만 쓰는 여행 — trip_destinations 테이블을 만들 필요 없이
      // 기존 legacy 컬럼만 갱신(불필요한 스키마 전환을 피함).
      await supabase
        .from('trips')
        .update({
          destinations: [cleaned[0].name],
          start_date: cleaned[0].start || null,
          end_date: cleaned[0].end || null,
        })
        .eq('id', trip.id);
    } else {
      // 여행지가 여러 곳이 되는 순간부터는 전부 실제 trip_destinations 행으로 통일.
      // (synthetic이었던 첫 여행지도 여기서 함께 실제 행으로 만들어짐 — 안 그러면
      //  다음 로드 때 trip_destinations가 비어있지 않아 그 여행지 정보가 사라짐)
      const keepIds = new Set<string>();
      let sortOrder = 0;
      for (const w of cleaned) {
        if (w.realId) {
          await updateDestination(w.realId, { name: w.name, start_date: w.start || null, end_date: w.end || null, sort_order: sortOrder });
          keepIds.add(w.realId);
        } else {
          const created = await createDestination(trip.id, w.name, {
            startDate: w.start || null,
            endDate: w.end || null,
            sortOrder,
          });
          if (created) keepIds.add(created.id);
        }
        sortOrder++;
      }
      if (!originalIsSynthetic) {
        const reassignTo = [...keepIds][0] ?? null;
        for (const o of original) {
          if (!keepIds.has(o.id)) await deleteDestination(o.id, reassignTo);
        }
      }
    }

    close();
    onSaved();
  } catch (err) {
    console.error('여행 저장 실패:', err);
    errorEl.textContent = '저장하지 못했어요. 잠시 후 다시 시도해주세요.';
    errorEl.classList.add('show');
    submitBtn.disabled = false;
    submitBtn.textContent = '저장';
  }
}
