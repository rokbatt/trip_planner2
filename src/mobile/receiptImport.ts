/**
 * 지갑 "사진으로 추가" — 영수증·결제 알림·이용내역 캡처를 읽어 지출 초안으로 만든다.
 *
 * 흐름: 사진 고르기(앨범 전체 권한 없이 고른 사진만) → 휴대폰에서 줄이기(최대 1280px JPEG)
 *       → 서버 `/api/ai` kind 'receipt-read'(Gemini) → **초안**으로 화면에 보여 주고 사용자가 고친 뒤 저장.
 * AI가 읽은 값은 바로 저장하지 않는다(원칙 3-1). 사진은 서버에도 우리 저장소에도 남기지 않는다.
 */
import { apiFetch } from '../utils/apiFetch';
import { EXPENSE_CATEGORIES, type ExpenseCategory, type SplitMode } from '../expense/expenseModel';

export const MAX_PHOTOS_PER_IMPORT = 5;

export interface ReadEntry {
  title: string;
  amount: number;
  currency: string | null;
  date: string | null;
  category: string;
  krwCharged: number | null;
}

export interface PhotoDraft {
  include: boolean;
  title: string;
  amount: number;
  currency: string;
  date: string;
  category: ExpenseCategory;
  splitMode: SplitMode;
  /** 화면에 원화 청구액이 보였으면 그 값 — 저장할 때 실제 청구 환율로 쓴다 */
  krwCharged: number | null;
}

/** 읽은 값 → 화면 초안. 통화·날짜를 모르면 지금 지갑 통화·오늘로 채운다(사용자가 고칠 수 있게 보임) */
export function toDraft(e: ReadEntry, fallbackCurrency: string, today: string): PhotoDraft {
  const cat = (EXPENSE_CATEGORIES as readonly string[]).includes(e.category) ? (e.category as ExpenseCategory) : 'ETC';
  return {
    include: true,
    title: e.title,
    amount: e.amount,
    currency: e.currency ?? fallbackCurrency,
    date: e.date ?? today,
    category: cat,
    splitMode: 'SHARED',
    krwCharged: e.krwCharged,
  };
}

/**
 * 원화 청구액이 보였으면 "1 외화 = ? 원"을 그 값으로 계산한다 — 카드사가 실제로 적용한 환율이라
 * 오늘 시세보다 정확하다. 원화 결제이거나 값이 이상하면 null(평소처럼 시세로 환산).
 */
export function chargedRate(d: Pick<PhotoDraft, 'currency' | 'amount' | 'krwCharged'>): number | null {
  if (d.currency === 'KRW' || d.krwCharged == null || !(d.amount > 0)) return null;
  const r = d.krwCharged / d.amount;
  return Number.isFinite(r) && r > 0 ? r : null;
}

/** 사진을 줄여 JPEG base64로 — 전송량과 서버 처리 시간(Worker CPU 한도)을 줄인다 */
export async function downscaleToJpegBase64(file: File, maxSide = 1280, quality = 0.75): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('이미지를 처리하지 못했어요.');
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

export type ReadResult = { ok: true; entries: ReadEntry[] } | { ok: false; error: string; disabled?: boolean };

export async function readReceiptPhoto(file: File, currencyHint: string | null): Promise<ReadResult> {
  let image: string;
  try {
    image = await downscaleToJpegBase64(file);
  } catch {
    return { ok: false, error: '사진을 읽지 못했어요. 다른 사진으로 해 주세요.' };
  }
  try {
    const res = await apiFetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'receipt-read', mimeType: 'image/jpeg', image, currency: currencyHint }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error || '사진을 읽지 못했어요.', disabled: !!json?.disabled };
    return { ok: true, entries: Array.isArray(json?.entries) ? json.entries : [] };
  } catch {
    return { ok: false, error: '인터넷 연결을 확인해 주세요.' };
  }
}
