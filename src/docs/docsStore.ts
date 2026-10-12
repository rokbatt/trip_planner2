/**
 * DOCUMENTS & NOTES — 데이터 계층
 *
 * 화면(docs.ts / notes.ts)은 이 파일을 통해서만 Supabase를 만진다. 이렇게 분리해 두면
 * 나중에 개인 문서를 Supabase Auth 기준 소유권으로 올릴 때(supabase/trip_documents.sql의
 * "향후 강화" 참고) 화면 코드를 건드리지 않고 이 파일만 바꾸면 된다.
 *
 * 개인 문서(PERSONAL)에 대한 정직한 설명:
 * - 4자리 PIN은 "여행 멤버끼리 개인 문서를 섞이지 않게 구분하는 잠금"이다. 금융 수준의
 *   인증이 아니고, 그렇게 보이게 만들지도 않는다.
 * - PIN은 평문으로 저장하지 않는다 — 사용자별 랜덤 salt + SHA-256 해시만 저장한다.
 * - 잠금이 풀리기 전에는 PERSONAL 문서를 아예 조회하지 않고, 풀린 뒤에도 그 사람 소유
 *   (owner_id) 행만 조회한다 — 다른 사람의 개인 문서가 브라우저 메모리에 올라오지 않는다.
 * - 잠금 상태는 sessionStorage에만 둔다(탭을 닫으면 다시 잠김).
 */

import { supabase } from '../supabase';
import { store } from '../store';
import { loadDestinations, destinationDayCount } from '../trips/destinations';
import type { Database, Trip, TripDocUser, TripDocument, TripNote } from '../types/database';

type DocumentUpdate = Database['public']['Tables']['trip_documents']['Update'];
type NoteUpdate = Database['public']['Tables']['trip_notes']['Update'];

/* ══════════════ 카테고리 ══════════════ */

export type DocCategory =
  | 'FLIGHT' | 'STAY' | 'TRANSPORT' | 'TICKET' | 'INSURANCE' | 'VISA' | 'RECEIPT' | 'OTHER';

export const DOC_CATEGORIES: DocCategory[] = [
  'FLIGHT', 'STAY', 'TRANSPORT', 'TICKET', 'INSURANCE', 'VISA', 'RECEIPT', 'OTHER',
];

export const DOC_CATEGORY_LABEL: Record<DocCategory, string> = {
  FLIGHT: '항공',
  STAY: '숙소',
  TRANSPORT: '교통',
  TICKET: '투어/티켓',
  INSURANCE: '보험',
  VISA: '비자/입국',
  RECEIPT: '영수증',
  OTHER: '기타',
};

export type NoteCategory =
  | 'FLIGHT' | 'BAGGAGE' | 'STAY' | 'TRANSPORT' | 'PACKING' | 'VISA' | 'BOOKING' | 'SHOPPING' | 'OTHER';

export const NOTE_CATEGORIES: NoteCategory[] = [
  'FLIGHT', 'BAGGAGE', 'STAY', 'TRANSPORT', 'PACKING', 'VISA', 'BOOKING', 'SHOPPING', 'OTHER',
];

export const NOTE_CATEGORY_LABEL: Record<NoteCategory, string> = {
  FLIGHT: '항공',
  BAGGAGE: '수하물',
  STAY: '숙소',
  TRANSPORT: '교통',
  PACKING: '준비물',
  VISA: '입국/비자',
  BOOKING: '예약',
  SHOPPING: '쇼핑',
  OTHER: '기타',
};

export function normalizeDocCategory(raw: string | null): DocCategory {
  return (DOC_CATEGORIES as string[]).includes(raw ?? '') ? (raw as DocCategory) : 'OTHER';
}

export function normalizeNoteCategory(raw: string | null): NoteCategory {
  return (NOTE_CATEGORIES as string[]).includes(raw ?? '') ? (raw as NoteCategory) : 'OTHER';
}

/* ══════════════ 마이그레이션 전 graceful degradation ══════════════ */

/** trip_documents.sql을 아직 실행하지 않은 프로젝트인지 — 한 번 확인하면 기억해 둔다 */
let storageReady: boolean | null = null;

export function isStorageReady(): boolean {
  return storageReady !== false;
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || /relation .* does not exist/i.test(error.message ?? '');
}

/** 마이그레이션 전이면 true를 돌려주고 이후 호출을 조용히 건너뛰게 만든다 */
function markIfMissing(error: { code?: string; message?: string } | null): boolean {
  if (isMissingTable(error)) {
    storageReady = false;
    return true;
  }
  if (!error) storageReady = true;
  return false;
}

/* ══════════════ DAY ↔ 날짜, 지역 ══════════════ */

export interface DayOption {
  /** 여행 전체 기준으로 이어지는 DAY 번호 — Timeline·Route와 같은 번호 체계 */
  day: number;
  /** 선택지에 보여줄 문자열 — 날짜가 있으면 "10.26"(여행지가 여럿이면 "10.26 (방콕)"),
   *  날짜를 전혀 모르면 "DAY N"으로 폴백 */
  label: string;
}

export interface DayAndRegionOptions {
  dayOptions: DayOption[];
  /** 여행지 이름 목록(날짜순). 여행지가 하나뿐이면 지역을 구분할 의미가 없어 빈 배열 —
   *  화면은 이 배열이 비어 있으면 지역 선택/필터 UI 자체를 그리지 않는다 */
  regionOptions: string[];
}

function shortDateLabel(iso: string, plusDays: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + plusDays);
  return d.getMonth() + 1 + '.' + String(d.getDate()).padStart(2, '0');
}

/**
 * 관련 DAY 선택지 — "DAY 1/2/3" 대신 실제 날짜(여행지가 둘 이상이면 날짜 뒤에 여행지명)로
 * 보여준다. Route/Timeline과 같은 `destinationDayCount` 계산을 그대로 써서, 문서/메모에
 * 붙는 DAY 번호가 Timeline의 DAY 번호와 어긋나지 않게 한다(loadDayAttachmentCounts와 짝).
 *
 * 지역 선택지도 같은 `loadDestinations` 호출 결과에서 함께 뽑는다(중복 조회 방지).
 */
export async function loadDayAndRegionOptions(trip: Trip | null): Promise<DayAndRegionOptions> {
  if (!trip) return { dayOptions: [], regionOptions: [] };
  const destinations = await loadDestinations(trip);
  const sorted = [...destinations].sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''));
  const showDestName = sorted.length > 1;

  const dayOptions: DayOption[] = [];
  let day = 1;
  for (const dest of sorted) {
    const count = destinationDayCount(dest, trip);
    const start = dest.start_date ?? trip.start_date;
    for (let i = 0; i < count; i += 1) {
      const dateLabel = start ? shortDateLabel(start, i) : null;
      dayOptions.push({
        day,
        label: dateLabel ? (showDestName ? dateLabel + ' (' + dest.name + ')' : dateLabel) : 'DAY ' + day,
      });
      day += 1;
    }
  }

  const regionOptions = showDestName ? sorted.map((d) => d.name).filter(Boolean) : [];
  return { dayOptions, regionOptions };
}

/** DAY 번호 → 실제 날짜 문자열(10.26). 여행 날짜가 없으면 null */
export function dateLabelForDay(trip: Trip | null, day: number | null): string | null {
  if (!trip?.start_date || !day || day < 1) return null;
  const d = new Date(trip.start_date + 'T00:00:00');
  d.setDate(d.getDate() + (day - 1));
  return d.getMonth() + 1 + '.' + String(d.getDate()).padStart(2, '0');
}

/** 문서/메모의 DAY 범위를 "DAY 1 – DAY 3" 형태로 */
export function dayRangeLabel(dayStart: number | null, dayEnd: number | null): string | null {
  if (!dayStart) return null;
  if (!dayEnd || dayEnd === dayStart) return 'DAY ' + dayStart;
  return 'DAY ' + dayStart + ' – DAY ' + dayEnd;
}

/** DAY 범위를 실제 날짜 범위로(10.26 – 10.29). 여행 날짜가 없으면 null */
export function dayDateRangeLabel(trip: Trip | null, dayStart: number | null, dayEnd: number | null): string | null {
  const start = dateLabelForDay(trip, dayStart);
  if (!start) return null;
  const end = dayEnd && dayEnd !== dayStart ? dateLabelForDay(trip, dayEnd) : null;
  return end ? start + ' – ' + end : start;
}

/* ══════════════ 개인 문서 사용자 + PIN ══════════════ */

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

/** SHA-256(salt + PIN) — 평문 PIN은 어디에도 저장하지 않는다 */
async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(salt + ':' + pin);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export async function loadDocUsers(tripId: string): Promise<TripDocUser[]> {
  if (storageReady === false) return [];
  const { data, error } = await supabase
    .from('trip_doc_users')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });
  if (error) {
    if (markIfMissing(error)) return [];
    console.error('[Docs] 개인 문서 사용자 로드 실패:', error.message);
    return [];
  }
  storageReady = true;
  return data ?? [];
}

export interface DocUserResult {
  user: TripDocUser | null;
  error: string | null;
}

export async function createDocUser(tripId: string, name: string, pin: string): Promise<DocUserResult> {
  const trimmed = name.trim();
  if (!trimmed) return { user: null, error: '사용자명을 입력해주세요.' };
  if (!isValidPin(pin)) return { user: null, error: 'PIN은 숫자 4자리로 입력해주세요.' };

  const salt = randomSalt();
  const pinHash = await hashPin(pin, salt);
  const authUser = store.get('user');

  const { data, error } = await supabase
    .from('trip_doc_users')
    .insert({
      trip_id: tripId,
      name: trimmed,
      pin_salt: salt,
      pin_hash: pinHash,
      user_id: authUser?.id ?? null,
      created_by: authUser?.id ?? null,
    })
    .select()
    .single();

  if (error) {
    if (markIfMissing(error)) return { user: null, error: '문서함 준비가 아직 끝나지 않았어요.' };
    if (error.code === '23505') return { user: null, error: '이미 등록된 사용자명이에요.' };
    console.error('[Docs] 개인 문서 사용자 생성 실패:', error.message);
    return { user: null, error: '사용자를 등록하지 못했어요.' };
  }
  return { user: data, error: null };
}

/** PIN 확인 — 맞으면 true. 저장된 salt로 다시 해시해서 비교한다 */
export async function verifyPin(user: TripDocUser, pin: string): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  const hashed = await hashPin(pin, user.pin_salt);
  return hashed === user.pin_hash;
}

/* ── 잠금 상태(탭 단위) ── */

const UNLOCK_KEY = 'mongsil:docs:unlocked:';

export function getUnlockedUserId(tripId: string): string | null {
  try {
    return sessionStorage.getItem(UNLOCK_KEY + tripId);
  } catch {
    return null;
  }
}

export function setUnlockedUserId(tripId: string, docUserId: string): void {
  try {
    sessionStorage.setItem(UNLOCK_KEY + tripId, docUserId);
  } catch { /* 프라이빗 모드 등 — 잠금 유지 실패는 기능을 막지 않는다 */ }
}

export function clearUnlockedUser(tripId: string): void {
  try {
    sessionStorage.removeItem(UNLOCK_KEY + tripId);
  } catch { /* noop */ }
}

/* ── 마지막으로 보던 탭 기억(요구사항: 기본값은 마지막 사용 탭) ── */

const SCOPE_KEY = 'mongsil:docs:scope:';
const TAB_KEY = 'mongsil:docs:tab:';

export type DocScope = 'PERSONAL' | 'SHARED';
export type DocsTab = 'documents' | 'notes';

export function getLastScope(tripId: string): DocScope {
  try {
    return localStorage.getItem(SCOPE_KEY + tripId) === 'PERSONAL' ? 'PERSONAL' : 'SHARED';
  } catch {
    return 'SHARED';
  }
}

export function setLastScope(tripId: string, scope: DocScope): void {
  try {
    localStorage.setItem(SCOPE_KEY + tripId, scope);
  } catch { /* noop */ }
}

export function getLastTab(tripId: string): DocsTab {
  try {
    return localStorage.getItem(TAB_KEY + tripId) === 'notes' ? 'notes' : 'documents';
  } catch {
    return 'documents';
  }
}

export function setLastTab(tripId: string, tab: DocsTab): void {
  try {
    localStorage.setItem(TAB_KEY + tripId, tab);
  } catch { /* noop */ }
}

/* ══════════════ 문서 ══════════════ */

export async function loadSharedDocuments(tripId: string): Promise<TripDocument[]> {
  if (storageReady === false) return [];
  const { data, error } = await supabase
    .from('trip_documents')
    .select('*')
    .eq('trip_id', tripId)
    .eq('visibility', 'SHARED')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    if (markIfMissing(error)) return [];
    console.error('[Docs] 공용 문서 로드 실패:', error.message);
    return [];
  }
  storageReady = true;
  return (data ?? []) as TripDocument[];
}

/** 잠금이 풀린 사용자 소유 문서만 — 다른 사람 개인 문서는 애초에 받아오지 않는다 */
export async function loadPersonalDocuments(tripId: string, ownerId: string): Promise<TripDocument[]> {
  if (storageReady === false) return [];
  const { data, error } = await supabase
    .from('trip_documents')
    .select('*')
    .eq('trip_id', tripId)
    .eq('visibility', 'PERSONAL')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    if (markIfMissing(error)) return [];
    console.error('[Docs] 개인 문서 로드 실패:', error.message);
    return [];
  }
  storageReady = true;
  return (data ?? []) as TripDocument[];
}

export interface DocumentDraft {
  title: string;
  category: DocCategory;
  description: string | null;
  referenceCode: string | null;
  dayStart: number | null;
  dayEnd: number | null;
  /** 지역/도시(선택) — loadDayAndRegionOptions가 돌려준 여행지 이름 중 하나, 또는 null */
  region: string | null;
  visibility: DocScope;
  ownerId: string | null;
  file?: UploadedFile | null;
}

export interface UploadedFile {
  path: string;
  name: string;
  type: string;
  size: number;
}

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const ACCEPTED_FILE_TYPES = 'application/pdf,image/png,image/jpeg,image/webp,image/heic';

/** 파일 업로드 — 비공개 버킷 'trip-docs'에 {trip_id}/{scope}/{uuid}.{ext} 경로로 저장 */
export async function uploadDocFile(
  tripId: string,
  scope: DocScope,
  file: File
): Promise<{ file: UploadedFile | null; error: string | null }> {
  if (file.size > MAX_FILE_BYTES) {
    return { file: null, error: '파일은 20MB까지 올릴 수 있어요.' };
  }
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = tripId + '/' + scope.toLowerCase() + '/' + crypto.randomUUID() + '.' + ext;

  const { error } = await supabase.storage.from('trip-docs').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) {
    console.error('[Docs] 파일 업로드 실패:', error.message);
    return { file: null, error: '파일을 올리지 못했어요. 문서함 저장소 설정을 확인해주세요.' };
  }
  return {
    file: { path, name: file.name, type: file.type || 'application/octet-stream', size: file.size },
    error: null,
  };
}

/** 미리보기/다운로드용 임시 URL — 비공개 버킷이라 열 때마다 발급한다(기본 10분) */
export async function signedUrlFor(path: string, expiresInSec = 600, download?: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('trip-docs')
    .createSignedUrl(path, expiresInSec, download ? { download } : undefined);
  if (error) {
    console.error('[Docs] 파일 URL 발급 실패:', error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

export async function createDocument(tripId: string, draft: DocumentDraft): Promise<TripDocument | null> {
  const authUser = store.get('user');
  const meta = authUser?.user_metadata ?? {};
  const uploaderName: string | null = meta.full_name || meta.name || authUser?.email || null;

  const { data, error } = await supabase
    .from('trip_documents')
    .insert({
      trip_id: tripId,
      visibility: draft.visibility,
      owner_id: draft.visibility === 'PERSONAL' ? draft.ownerId : null,
      title: draft.title,
      category: draft.category,
      description: draft.description,
      reference_code: draft.referenceCode,
      day_start: draft.dayStart,
      day_end: draft.dayEnd,
      region: draft.region,
      file_path: draft.file?.path ?? null,
      file_name: draft.file?.name ?? null,
      file_type: draft.file?.type ?? null,
      file_size: draft.file?.size ?? null,
      uploaded_by: authUser?.id ?? null,
      uploaded_by_name: uploaderName,
    })
    .select()
    .single();

  if (error) {
    if (markIfMissing(error)) return null;
    console.error('[Docs] 문서 저장 실패:', error.message);
    return null;
  }
  return data as TripDocument;
}

export async function updateDocument(
  id: string,
  patch: Partial<DocumentDraft>
): Promise<TripDocument | null> {
  const row: DocumentUpdate = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.referenceCode !== undefined) row.reference_code = patch.referenceCode;
  if (patch.dayStart !== undefined) row.day_start = patch.dayStart;
  if (patch.dayEnd !== undefined) row.day_end = patch.dayEnd;
  if (patch.region !== undefined) row.region = patch.region;
  if (patch.file !== undefined) {
    row.file_path = patch.file?.path ?? null;
    row.file_name = patch.file?.name ?? null;
    row.file_type = patch.file?.type ?? null;
    row.file_size = patch.file?.size ?? null;
  }

  const { data, error } = await supabase.from('trip_documents').update(row).eq('id', id).select().single();
  if (error) {
    console.error('[Docs] 문서 수정 실패:', error.message);
    return null;
  }
  return data as TripDocument;
}

export async function deleteDocument(doc: TripDocument): Promise<boolean> {
  const { error } = await supabase.from('trip_documents').delete().eq('id', doc.id);
  if (error) {
    console.error('[Docs] 문서 삭제 실패:', error.message);
    return false;
  }
  // 행이 지워진 뒤에만 파일을 지운다 — 반대로 하면 파일만 사라진 유령 문서가 남는다
  if (doc.file_path) {
    const { error: storageError } = await supabase.storage.from('trip-docs').remove([doc.file_path]);
    if (storageError) console.error('[Docs] 파일 삭제 실패:', storageError.message);
  }
  return true;
}

/* ══════════════ 메모 ══════════════ */

export async function loadNotes(tripId: string): Promise<TripNote[]> {
  if (storageReady === false) return [];
  const { data, error } = await supabase
    .from('trip_notes')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    if (markIfMissing(error)) return [];
    console.error('[Docs] 메모 로드 실패:', error.message);
    return [];
  }
  storageReady = true;
  return (data ?? []) as TripNote[];
}

export interface NoteDraft {
  title: string;
  body: string | null;
  category: NoteCategory;
  dayStart: number | null;
  dayEnd: number | null;
  /** 지역/도시(선택) — loadDayAndRegionOptions가 돌려준 여행지 이름 중 하나, 또는 null */
  region: string | null;
}

export async function createNote(tripId: string, draft: NoteDraft): Promise<TripNote | null> {
  const authUser = store.get('user');
  const meta = authUser?.user_metadata ?? {};
  const authorName: string | null = meta.full_name || meta.name || authUser?.email || null;

  const { data, error } = await supabase
    .from('trip_notes')
    .insert({
      trip_id: tripId,
      title: draft.title,
      body: draft.body,
      category: draft.category,
      day_start: draft.dayStart,
      day_end: draft.dayEnd,
      region: draft.region,
      created_by: authUser?.id ?? null,
      created_by_name: authorName,
    })
    .select()
    .single();

  if (error) {
    if (markIfMissing(error)) return null;
    console.error('[Docs] 메모 저장 실패:', error.message);
    return null;
  }
  return data as TripNote;
}

export async function updateNote(id: string, patch: Partial<NoteDraft>): Promise<TripNote | null> {
  const row: NoteUpdate = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.body !== undefined) row.body = patch.body;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.dayStart !== undefined) row.day_start = patch.dayStart;
  if (patch.dayEnd !== undefined) row.day_end = patch.dayEnd;
  if (patch.region !== undefined) row.region = patch.region;

  const { data, error } = await supabase.from('trip_notes').update(row).eq('id', id).select().single();
  if (error) {
    console.error('[Docs] 메모 수정 실패:', error.message);
    return null;
  }
  return data as TripNote;
}

/** 확인 완료 토글 — 체크리스트의 "할 일 완료"가 아니라 "내용을 확인함" 표시 */
export async function setNoteChecked(id: string, checked: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('trip_notes')
    .update({ checked_at: checked ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) {
    console.error('[Docs] 메모 확인 상태 변경 실패:', error.message);
    return false;
  }
  return true;
}

export async function setNotePinned(id: string, pinned: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('trip_notes')
    .update({ pinned_at: pinned ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) {
    console.error('[Docs] 메모 고정 변경 실패:', error.message);
    return false;
  }
  return true;
}

export async function deleteNote(id: string): Promise<boolean> {
  const { error } = await supabase.from('trip_notes').delete().eq('id', id);
  if (error) {
    console.error('[Docs] 메모 삭제 실패:', error.message);
    return false;
  }
  return true;
}

/* ══════════════ Timeline 연결 ══════════════ */

export interface DayAttachmentCount {
  documents: number;
  notes: number;
}

/**
 * DAY 번호 → 그 날짜에 걸린 공용 문서/메모 개수. Timeline이 "이 DAY에 관련 문서가 있다"를
 * 표시할 때 쓴다(개인 문서는 잠금 대상이라 여기 포함하지 않는다).
 * DAY 범위(day_start~day_end)로 저장된 문서는 그 사이 모든 DAY에 걸린 것으로 센다.
 */
export async function loadDayAttachmentCounts(tripId: string): Promise<Map<number, DayAttachmentCount>> {
  const counts = new Map<number, DayAttachmentCount>();
  if (storageReady === false) return counts;

  const [docRes, noteRes] = await Promise.all([
    supabase
      .from('trip_documents')
      .select('day_start, day_end')
      .eq('trip_id', tripId)
      .eq('visibility', 'SHARED')
      .not('day_start', 'is', null),
    supabase.from('trip_notes').select('day_start, day_end').eq('trip_id', tripId).not('day_start', 'is', null),
  ]);

  if (markIfMissing(docRes.error) || markIfMissing(noteRes.error)) return counts;

  const bump = (day: number, key: keyof DayAttachmentCount) => {
    const entry = counts.get(day) ?? { documents: 0, notes: 0 };
    entry[key] += 1;
    counts.set(day, entry);
  };

  const spread = (rows: Array<{ day_start: number | null; day_end: number | null }>, key: keyof DayAttachmentCount) => {
    for (const row of rows) {
      const start = row.day_start;
      if (!start) continue;
      const end = Math.max(start, row.day_end ?? start);
      for (let d = start; d <= end; d += 1) bump(d, key);
    }
  };

  spread((docRes.data ?? []) as Array<{ day_start: number | null; day_end: number | null }>, 'documents');
  spread((noteRes.data ?? []) as Array<{ day_start: number | null; day_end: number | null }>, 'notes');

  return counts;
}

/** 게이트를 떠날 때 모듈 캐시 초기화 — 다른 트립으로 이동해도 이전 판단이 남지 않도록 */
export function resetDocsStore(): void {
  storageReady = null;
}
