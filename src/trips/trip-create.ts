import { supabase } from '../supabase';
import { store } from '../store';
import './trip-create.css';

const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6L18 18M6 18L18 6"/></svg>`;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 새 여행 생성 모달 열기
 * onCreated: 생성 성공 시 호출되는 콜백 (여행 목록 새로고침용)
 */
export function openCreateTripModal(onCreated: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'tc-overlay';

  overlay.innerHTML = `
    <div class="tc-modal">
      <div class="tc-header">
        <div>
          <p class="tc-label">NEW TRAVEL PASS</p>
          <h2 class="tc-title">새 여행 만들기</h2>
        </div>
        <button class="tc-close" id="tc-close">${ICON_CLOSE}</button>
      </div>

      <form id="tc-form">
        <div class="tc-field">
          <label class="tc-field-label">여행 이름</label>
          <input class="tc-input" id="tc-name" type="text" placeholder="예: 뉴욕 자유여행" required />
        </div>

        <div class="tc-field">
          <label class="tc-field-label">목적지 도시</label>
          <input class="tc-input" id="tc-city" type="text" placeholder="예: 방콕" />
          <div class="tc-preview" id="tc-preview">
            <div class="tc-preview-img" id="tc-preview-img"></div>
            <span class="tc-preview-text" id="tc-preview-text"></span>
          </div>
        </div>

        <div class="tc-row">
          <div class="tc-field">
            <label class="tc-field-label">출발일</label>
            <input class="tc-input" id="tc-start" type="date" required />
          </div>
          <div class="tc-field">
            <label class="tc-field-label">도착일</label>
            <input class="tc-input" id="tc-end" type="date" required />
          </div>
        </div>

        <div class="tc-row">
          <div class="tc-field">
            <label class="tc-field-label">인원</label>
            <input class="tc-input" id="tc-headcount" type="number" min="1" placeholder="2" />
          </div>
          <div class="tc-field">
            <label class="tc-field-label">테마 (선택)</label>
            <input class="tc-input" id="tc-theme" type="text" placeholder="맛집투어" />
          </div>
        </div>

        <p class="tc-error" id="tc-error"></p>

        <div class="tc-actions">
          <button type="button" class="tc-btn-cancel" id="tc-cancel">취소</button>
          <button type="submit" class="tc-btn-submit" id="tc-submit">여행 만들기</button>
        </div>
      </form>
