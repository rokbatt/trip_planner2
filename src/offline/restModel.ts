/**
 * 오프라인 REST 규칙 — DB 없이 돌려볼 수 있는 순수 함수만 모았다(테스트: restModel.test.ts).
 *
 * 오프라인 동안 누른 "도착"·체크·지출은 대기열에 들어간다. 그런데 앱을 다시 열면 화면은
 * **저장해 둔 옛 응답**을 읽는다 — 대기열 내용을 거기에 겹쳐 보여주지 않으면 방금 누른 도착이
 * 사라진 것처럼 보인다. 그래서 PostgREST의 아주 작은 부분(eq/in/is 필터, upsert 충돌 키,
 * id 기준 수정·삭제)만 흉내 내서 저장된 응답에 대기열을 겹친다. 흉내 낼 수 없는 필터가
 * 섞인 요청은 **겹치지 않고 그대로 둔다**(틀리게 겹치는 것보다 낫다).
 */

/** 오프라인에서 쓰기를 대기열에 넣어도 되는 테이블 — 여행 중 폰에서 누르는 것만.
 *  ROUTE 저장처럼 "지우고 다시 넣기" 묶음은 순서·충돌 위험이 커서 넣지 않는다. */
export const QUEUE_TABLES = new Set(['trip_stop_progress', 'trip_checklist', 'trip_expenses']);

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

export type FilterOp = 'eq' | 'in' | 'is.null' | 'not.is.null';
export interface RestFilter { col: string; op: FilterOp; values: string[] }

export interface ParsedRestUrl {
  table: string;
  filters: RestFilter[];
  /** 흉내 낼 수 없는 필터(gt, like, or …)가 하나라도 있으면 false */
  supported: boolean;
  onConflict: string[];
}

export interface QueuedWrite {
  method: 'POST' | 'PATCH' | 'DELETE';
  url: string;
  table: string;
  headers: Record<string, string>;
  body: string | null;
  at: number;
}

type Row = Record<string, unknown>;

/** `/rest/v1/<table>?...` 이면 테이블과 필터를, 아니면 null */
export function parseRestUrl(url: string): ParsedRestUrl | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const m = u.pathname.match(/\/rest\/v1\/([^/]+)$/);
  if (!m) return null;
  const filters: RestFilter[] = [];
  let supported = true;
  u.searchParams.forEach((raw, col) => {
    if (RESERVED.has(col)) return;
    if (raw.startsWith('eq.')) filters.push({ col, op: 'eq', values: [raw.slice(3)] });
    else if (raw === 'is.null') filters.push({ col, op: 'is.null', values: [] });
    else if (raw === 'not.is.null') filters.push({ col, op: 'not.is.null', values: [] });
    else if (raw.startsWith('in.(') && raw.endsWith(')')) {
      filters.push({ col, op: 'in', values: splitList(raw.slice(4, -1)) });
    } else supported = false;
  });
  const oc = u.searchParams.get('on_conflict');
  return { table: decodeURIComponent(m[1]), filters, supported, onConflict: oc ? oc.split(',').map((s) => s.trim()) : [] };
}

/** `a,"b c",d` → ['a', 'b c', 'd'] */
function splitList(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function cell(v: unknown): string | null {
  return v == null ? null : String(v);
}

export function rowMatches(row: Row, filters: RestFilter[]): boolean {
  return filters.every((f) => {
    const v = cell(row[f.col]);
    if (f.op === 'eq') return v === f.values[0];
    if (f.op === 'in') return v != null && f.values.includes(v);
    if (f.op === 'is.null') return v == null;
    return v != null; // not.is.null
  });
}

export function isQueueable(method: string, url: string): boolean {
  if (method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') return false;
  const p = parseRestUrl(url);
  return !!p && QUEUE_TABLES.has(p.table);
}

/** 요청 본문(객체 또는 배열)을 행 배열로 */
export function bodyRows(body: string | null): Row[] {
  if (!body) return [];
  try {
    const v = JSON.parse(body) as unknown;
    if (Array.isArray(v)) return v.filter((r): r is Row => !!r && typeof r === 'object');
    return v && typeof v === 'object' ? [v as Row] : [];
  } catch {
    return [];
  }
}

/**
 * 일반 insert(upsert가 아닌)면 행마다 id를 미리 정해 넣는다. 그래야 대기열에서 보낼 때와
 * 화면에 겹쳐 보여줄 때 같은 행이 된다(나중에 수정·삭제가 그 id로 걸린다).
 * upsert에는 넣지 않는다 — 충돌한 기존 행의 id를 바꿔 버린다.
 */
export function withClientIds(write: QueuedWrite, makeId: () => string): QueuedWrite {
  if (write.method !== 'POST') return write;
  const p = parseRestUrl(write.url);
  const prefer = (write.headers['prefer'] ?? write.headers['Prefer'] ?? '').toLowerCase();
  if (!p || p.onConflict.length || prefer.includes('resolution=')) return write;
  const rows = bodyRows(write.body);
  if (!rows.length) return write;
  const filled = rows.map((r) => (r.id ? r : { ...r, id: makeId() }));
  const wasArray = write.body?.trim().startsWith('[');
  return { ...write, body: JSON.stringify(wasArray ? filled : filled[0]) };
}

/**
 * 저장된 읽기 응답(rows)에 같은 테이블의 대기열 쓰기를 순서대로 겹친다.
 * `read`는 그 읽기 요청의 URL 해석 결과 — 겹친 뒤 그 필터에 맞는 행만 남긴다.
 */
export function applyQueued(rows: Row[], read: ParsedRestUrl, writes: QueuedWrite[]): Row[] {
  if (!read.supported) return rows;
  let out = rows.map((r) => ({ ...r }));
  for (const w of writes) {
    const p = parseRestUrl(w.url);
    if (!p || p.table !== read.table) continue;
    if (w.method === 'POST') {
      const prefer = (w.headers['prefer'] ?? w.headers['Prefer'] ?? '').toLowerCase();
      const ignore = prefer.includes('ignore-duplicates');
      for (const r of bodyRows(w.body)) {
        const keys = p.onConflict.length ? p.onConflict : r.id != null ? ['id'] : [];
        const i = keys.length ? out.findIndex((x) => keys.every((k) => cell(x[k]) === cell(r[k]))) : -1;
        if (i >= 0) { if (!ignore) out[i] = { ...out[i], ...r }; }
        else out.push({ ...r });
      }
    } else if (w.method === 'PATCH') {
      if (!p.supported) continue;
      const patch = bodyRows(w.body)[0] ?? {};
      out = out.map((x) => (rowMatches(x, p.filters) ? { ...x, ...patch } : x));
    } else if (w.method === 'DELETE') {
      if (!p.supported) continue;
      out = out.filter((x) => !rowMatches(x, p.filters));
    }
  }
  return out.filter((r) => rowMatches(r, read.filters));
}

/** 오프라인 응답 키 — 같은 URL이라도 "한 행"(object)과 "목록"(array) 요청은 다른 응답이다 */
export function cacheKey(method: string, url: string, accept: string | null): string {
  return method + ' ' + url + (accept && accept.includes('vnd.pgrst.object') ? ' #object' : '');
}
