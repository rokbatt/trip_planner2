/**
 * DOCUMENTS & NOTES 공용 아이콘·유틸 — docs.ts와 notes.ts가 함께 쓴다.
 * 아이콘은 이 프로젝트의 다른 게이트와 같은 선 아이콘(stroke, currentColor)만 사용한다.
 * 이모지를 UI 아이콘으로 쓰지 않는다.
 */

import type { DocCategory, NoteCategory } from './docsStore';

const S = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

export const IC = {
  doc: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  note: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><path d="M5 4a2 2 0 0 1 2-2h7l5 5v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M14 2v5h5M9 12h6M9 16h4"/></svg>',
  plane: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><path d="M3.5 12.5 21 4l-4 9.5 1.5 6.5-3 1-3-5.5-4 1.5-1 3-1.5-.5.5-4.5z"/></svg>',
  bed: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 15h18M7 9V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2"/></svg>',
  car: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><path d="M5 17h14M4 17v-4.2l1.8-4.3A2 2 0 0 1 7.6 7h8.8a2 2 0 0 1 1.8 1.5L20 12.8V17"/><path d="M4 13h16"/><circle cx="7.5" cy="17.5" r="1.4"/><circle cx="16.5" cy="17.5" r="1.4"/></svg>',
  ticket: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.5a1.5 1.5 0 0 0 0 3V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a1.5 1.5 0 0 0 0-3z"/><path d="M13 7v10"/></svg>',
  shield: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><path d="M12 3l7 3v5.5c0 4.3-2.9 8-7 9.5-4.1-1.5-7-5.2-7-9.5V6z"/><path d="M9.5 12l1.8 1.8L15 10"/></svg>',
  stamp: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="9.5" r="2.4"/><path d="M8 15.5h8"/></svg>',
  receipt: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z"/><path d="M9 8h6M9 12h6"/></svg>',
  folder: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  bag: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><rect x="4" y="7" width="16" height="14" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M9 11v6M15 11v6"/></svg>',
  box: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><path d="M12 3l8 4v10l-8 4-8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10"/></svg>',
  cart: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><path d="M3 4h2l2.2 10.2A2 2 0 0 0 9.2 16h7.4a2 2 0 0 0 2-1.6L20 7H6"/><circle cx="10" cy="19.5" r="1.2"/><circle cx="17" cy="19.5" r="1.2"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  search: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  lock: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><rect x="4.5" y="10" width="15" height="10" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/></svg>',
  unlock: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><rect x="4.5" y="10" width="15" height="10" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 7.7-1.5"/></svg>',
  users: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3.2"/><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 5.2a3.2 3.2 0 0 1 0 5.6"/></svg>',
  user: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><path d="M19 20v-1.5a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4V20"/><circle cx="12" cy="8" r="3.4"/></svg>',
  pin: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.5"><path d="M9 3h6l-.8 5.2 3.3 3.3H6.5l3.3-3.3z"/><path d="M12 11.5V21"/></svg>',
  trash: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.7"><path d="M3.5 6h17M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6m3 0-.8 13a2 2 0 0 1-2 1.9H8.8a2 2 0 0 1-2-1.9L6 6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.7"><path d="M15.2 4.8l4 4M4 20l4.6-.9L20 7.7a1.8 1.8 0 0 0 0-2.5l-1.2-1.2a1.8 1.8 0 0 0-2.5 0L4.9 15.4z"/></svg>',
  download: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.7"><path d="M12 4v10M8 11l4 3 4-3M5 19h14"/></svg>',
  external: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.7"><path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>',
  upload: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.6"><path d="M12 16V5M8 9l4-4 4 4"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg>',
  check: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="2.2"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
  back: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>',
  info: '<svg viewBox="0 0 24 24" ' + S + ' stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
};

export const DOC_CATEGORY_ICON: Record<DocCategory, string> = {
  FLIGHT: IC.plane,
  STAY: IC.bed,
  TRANSPORT: IC.car,
  TICKET: IC.ticket,
  INSURANCE: IC.shield,
  VISA: IC.stamp,
  RECEIPT: IC.receipt,
  OTHER: IC.folder,
};

export const NOTE_CATEGORY_ICON: Record<NoteCategory, string> = {
  FLIGHT: IC.plane,
  BAGGAGE: IC.bag,
  STAY: IC.bed,
  TRANSPORT: IC.car,
  PACKING: IC.box,
  VISA: IC.stamp,
  BOOKING: IC.calendar,
  SHOPPING: IC.cart,
  OTHER: IC.note,
};

export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** "7월 31일" — 올해가 아니면 "2025. 7. 31." */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.getFullYear() !== now.getFullYear()) {
    return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '.';
  }
  return d.getMonth() + 1 + '월 ' + d.getDate() + '일';
}

/** "7월 31일 14:31" — 문서 업로드 시각처럼 분 단위가 의미 있을 때 */
export function formatDayTime(iso: string): string {
  const d = new Date(iso);
  return formatDay(iso) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** 파일 형식 배지에 쓸 짧은 라벨 — application/pdf → PDF */
export function fileKindLabel(fileName: string | null, mime: string | null): string {
  const ext = (fileName?.split('.').pop() || '').toUpperCase();
  if (ext && ext.length <= 4) return ext;
  if (!mime) return 'FILE';
  if (mime === 'application/pdf') return 'PDF';
  if (mime.startsWith('image/')) return mime.replace('image/', '').toUpperCase();
  return 'FILE';
}

export function formatFileSize(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

export function isPreviewable(mime: string | null): boolean {
  if (!mime) return false;
  return mime === 'application/pdf' || (mime.startsWith('image/') && !mime.includes('heic'));
}
