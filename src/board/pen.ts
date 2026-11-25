/**
 * IDEAS 지도 펜(PC 전용) — 지도 위에 동선을 손으로 그어 일행과 실시간으로 나눠 본다.
 *
 *  · [펜]을 켜면 지도 끌기가 멈추고, 왼쪽 버튼을 누른 채 움직이면 선이 그려진다(휠 확대·축소는 그대로).
 *    끄거나 Esc를 누르면 다시 지도를 움직일 수 있다.
 *  · 색은 사람마다 자동 배정된 고유색(penModel.memberColors), 두께는 고정.
 *  · 선 끝에 시작점↔끝점 **직선거리**를 붙인다.
 *  · 저장·공유는 supabase/board_drawings.sql. 표가 없으면 그 화면에서만 보이고, 도구 줄에 한 번 알린다.
 *  · 남의 선은 지울 수 없다(서버 정책도 본인 선만 삭제).
 */

import { supabase } from '../supabase';
import { store } from '../store';
import { escapeHtml } from '../utils/html';
import { createProjector, isOverlayUi } from './mapPixel';
import {
  PEN_WIDTH, formatDistance, isValidPath, memberColors, simplifyPath, straightDistance, type LatLng,
} from './penModel';

interface DrawingRow {
  id: string;
  trip_id: string;
  destination_id: string | null;
  user_id: string;
  color: string;
  path: LatLng[];
  distance_m: number | null;
  created_at: string;
}

interface Drawn {
  row: DrawingRow;
  line: any;
  label: any;
}

interface Member {
  user_id: string;
  name: string;
}

export interface PenController {
  destroy(): void;
  /** 펜이 켜져 있는가 — 영역 검색이 꾹 누르기를 양보할 때 본다 */
  isActive(): boolean;
}

const ICON_PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l4-1 10-10-3-3L5 16l-1 4z"/><path d="M13.5 6.5l3 3"/></svg>';
const ICON_UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

/** 표가 아직 없다는 오류인가(SQL 실행 전) */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === '42P01' || err.code === 'PGRST205' || /relation .* does not exist|schema cache/i.test(err.message ?? '');
}

/**
 * 지도와 도구 칸을 받아 펜을 붙인다. 지도를 다시 그릴 때마다 destroy() 후 새로 붙인다.
 * destinationId: 실제 여행지 id(마이그레이션 전 합성 여행지면 null).
 */
export function mountPen(opts: {
  g: any;
  map: any;
  toolsEl: HTMLElement;
  tripId: string;
  destinationId: string | null;
}): PenController {
  const { g, map, toolsEl, tripId, destinationId } = opts;
  const myId: string | null = store.get('user')?.id ?? null;

  let active = false;
  let destroyed = false;
  let shared = true; // board_drawings 표를 쓸 수 있는가
  let notice = '';
  let colors = new Map<string, string>();
  let members: Member[] = [];
  const hidden = new Set<string>();
  const drawn = new Map<string, Drawn>();
  let channel: any = null;

  // 그리는 중 상태
  let stroke: LatLng[] | null = null;
  let liveLine: any = null;

  const myColor = () => (myId && colors.get(myId)) || '#F97316';

  /* ── 지도 위에 선 하나 그리기 ── */
  function draw(row: DrawingRow): void {
    if (drawn.has(row.id) || !isValidPath(row.path)) return;
    const color = colors.get(row.user_id) ?? row.color;
    const path = row.path.map(([lat, lng]) => ({ lat, lng }));
    const visible = !hidden.has(row.user_id);
    const line = new g.maps.Polyline({
      path, strokeColor: color, strokeOpacity: 0.92, strokeWeight: PEN_WIDTH, clickable: false, map: visible ? map : null, zIndex: 50,
    });
    const end = path[path.length - 1];
    const dist = row.distance_m ?? Math.round(straightDistance(row.path));
    const label = new g.maps.Marker({
      position: end,
      map: visible ? map : null,
      clickable: false,
      zIndex: 1100,
      icon: { path: g.maps.SymbolPath.CIRCLE, scale: 4, fillColor: color, fillOpacity: 1, strokeColor: '#FFFFFF', strokeWeight: 2 },
      label: { text: formatDistance(dist), className: 'bd-pen-dist', color: '#FFFFFF', fontSize: '11px', fontWeight: '700' },
    });
    drawn.set(row.id, { row, line, label });
  }

  function erase(id: string): void {
    const d = drawn.get(id);
    if (!d) return;
    d.line.setMap(null);
    d.label.setMap(null);
    drawn.delete(id);
  }

  function applyVisibility(): void {
    drawn.forEach((d) => {
      const on = !hidden.has(d.row.user_id);
      d.line.setMap(on ? map : null);
      d.label.setMap(on ? map : null);
    });
  }

  /* ── 도구 ──
   * 범례 줄(아래): [펜 ●] 하나만 — 줄이 넘치거나 오른쪽 아래 채팅 버튼에 가리지 않게.
   * 지도 왼쪽 위 떠 있는 작은 바: 펜을 켰을 때 되돌리기·내 선 지우기, 선이 있으면 사람별 보기/숨기기. */
  const floatEl = document.createElement('div');
  floatEl.className = 'bd-pen-float';
  map.getDiv()?.appendChild(floatEl);

  function renderTools(): void {
    if (destroyed) return;
    const mine = myId ? [...drawn.values()].filter((d) => d.row.user_id === myId).length : 0;
    const authors = members.filter((m) => [...drawn.values()].some((d) => d.row.user_id === m.user_id));
    toolsEl.innerHTML =
      '<button type="button" class="bd-tool-btn' + (active ? ' on' : '') + '" data-tool="pen" aria-pressed="' + active + '" title="펜 — 지도에 동선을 그어요 (Esc로 끄기)">' +
      ICON_PEN + '<span>펜</span><i class="bd-tool-dot" style="--dot:' + myColor() + '"></i></button>' +
      (notice ? '<span class="bd-tool-note">' + escapeHtml(notice) + '</span>' : '');

    floatEl.innerHTML =
      (active
        ? '<span class="bd-pen-float-hint">누른 채 그어요 · Esc로 끄기</span>' +
          '<button type="button" class="bd-tool-btn sub" data-tool="undo"' + (mine ? '' : ' disabled') + ' title="내 마지막 선 지우기">' + ICON_UNDO + '<span>되돌리기</span></button>' +
          '<button type="button" class="bd-tool-btn sub" data-tool="clear"' + (mine ? '' : ' disabled') + ' title="내 선 모두 지우기">' + ICON_TRASH + '<span>내 선 지우기</span></button>'
        : '') +
      authors.map((m) =>
        '<button type="button" class="bd-tool-person' + (hidden.has(m.user_id) ? ' off' : '') + '" data-person="' + escapeHtml(m.user_id) + '" aria-pressed="' + !hidden.has(m.user_id) + '" title="' + escapeHtml(m.name) + '의 선 보기/숨기기">' +
        '<i class="bd-tool-dot" style="--dot:' + (colors.get(m.user_id) ?? '#94A3B8') + '"></i>' + escapeHtml(m.user_id === myId ? '나' : m.name) + '</button>',
      ).join('');
    floatEl.hidden = !floatEl.innerHTML;

    toolsEl.querySelector('[data-tool="pen"]')?.addEventListener('click', () => setActive(!active));
    floatEl.querySelector('[data-tool="undo"]')?.addEventListener('click', () => void undo());
    floatEl.querySelector('[data-tool="clear"]')?.addEventListener('click', () => void clearMine());
    floatEl.querySelectorAll<HTMLElement>('[data-person]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.person!;
        if (hidden.has(id)) hidden.delete(id);
        else hidden.add(id);
        applyVisibility();
        renderTools();
      });
    });
  }

  /* ── 켜고 끄기 ──
   * 지도 끌기 설정(draggable)은 건드리지 않는다 — 끄면 휠 확대·축소까지 막힌다(사용자 피드백).
   * 대신 펜이 켜져 있는 동안 지도 위 누르기를 우리가 먼저 받아 지도·핀으로 보내지 않는다(아래 onDown). */
  const mapDiv: HTMLElement = map.getDiv();
  const projector = createProjector(g, map);

  function setActive(on: boolean): void {
    if (!myId) return;
    active = on;
    mapDiv.classList.toggle('bd-pen-on', on);
    if (!on) cancelStroke();
    renderTools();
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && active) setActive(false);
  };
  document.addEventListener('keydown', onKey);

  /* ── 긋기 — 브라우저 포인터 이벤트(캡처 단계) ──
   * 핀 위에서 시작해도 핀이 눌리지 않고 선이 시작된다. 휠은 손대지 않으니 그리는 중에도 확대·축소가 된다. */
  function cancelStroke(): void {
    stroke = null;
    liveLine?.setMap(null);
    liveLine = null;
  }

  const swallow = (e: Event) => {
    if (!active || isOverlayUi(e.target)) return;
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  };
  const onDown = (e: PointerEvent | MouseEvent) => {
    if (!active || (e as MouseEvent).button !== 0 || isOverlayUi(e.target)) return;
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    if (stroke) return; // pointerdown 뒤 따라오는 mousedown
    const ll = projector.toLatLng(e.clientX, e.clientY);
    if (!ll) return;
    stroke = [[ll.lat(), ll.lng()]];
    liveLine = new g.maps.Polyline({
      path: [ll], strokeColor: myColor(), strokeOpacity: 0.92, strokeWeight: PEN_WIDTH, clickable: false, map, zIndex: 60,
    });
  };
  const onMove = (e: PointerEvent) => {
    if (!active || !stroke) return;
    const ll = projector.toLatLng(e.clientX, e.clientY);
    if (!ll) return;
    stroke.push([ll.lat(), ll.lng()]);
    liveLine?.getPath().push(ll);
  };
  // 지도 밖(화면 밖)에서 버튼을 놓아도 끝낸다
  const onUp = () => { if (stroke) void finishStroke(); };
  mapDiv.addEventListener('pointerdown', onDown, true);
  mapDiv.addEventListener('mousedown', onDown, true);
  // 펜이 켜져 있는 동안 핀 클릭·더블클릭 확대는 지도로 보내지 않는다
  mapDiv.addEventListener('click', swallow, true);
  mapDiv.addEventListener('dblclick', swallow, true);
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('mouseup', onUp, true);

  async function finishStroke(): Promise<void> {
    const raw = stroke;
    cancelStroke();
    if (!raw || raw.length < 2 || !myId) return;
    // 화면 1.5px 정도의 흔들림은 버린다 — 확대 수준에 맞춘 도(°) 단위 허용치
    const zoom = map.getZoom() ?? 14;
    const degPerPx = 360 / (256 * Math.pow(2, zoom));
    const path = simplifyPath(raw, degPerPx * 1.5);
    if (path.length < 2) return;
    const row: DrawingRow = {
      id: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      trip_id: tripId,
      destination_id: destinationId,
      user_id: myId,
      color: myColor(),
      path,
      distance_m: Math.round(straightDistance(path)),
      created_at: new Date().toISOString(),
    };
    draw(row);
    renderTools();
    if (!shared) return;
    const { data, error } = await supabase
      .from('board_drawings')
      .insert({ trip_id: row.trip_id, destination_id: row.destination_id, user_id: row.user_id, color: row.color, path: row.path, distance_m: row.distance_m })
      .select()
      .single();
    if (destroyed) return;
    if (error || !data) {
      if (isMissingTable(error)) markLocalOnly();
      else console.warn('[pen] 선 저장 실패(화면에는 남아 있음):', error?.message);
      return;
    }
    // 임시 id → 서버 id로 바꿔 단다(실시간으로 같은 줄이 다시 와도 중복으로 그리지 않게)
    const d = drawn.get(row.id);
    if (d) {
      drawn.delete(row.id);
      d.row = data as DrawingRow;
      drawn.set(data.id, d);
    }
  }

  function markLocalOnly(): void {
    shared = false;
    notice = '선 공유는 아직 준비 중이에요 · 이 화면에서만 보여요';
    renderTools();
  }

  /* ── 지우기 ── */
  async function undo(): Promise<void> {
    if (!myId) return;
    const last = [...drawn.values()].filter((d) => d.row.user_id === myId).sort((a, b) => a.row.created_at.localeCompare(b.row.created_at)).pop();
    if (!last) return;
    erase(last.row.id);
    renderTools();
    if (shared && !last.row.id.startsWith('local-')) {
      const { error } = await supabase.from('board_drawings').delete().eq('id', last.row.id);
      if (error) console.warn('[pen] 지우기 실패:', error.message);
    }
  }

  async function clearMine(): Promise<void> {
    if (!myId) return;
    const mine = [...drawn.values()].filter((d) => d.row.user_id === myId);
    if (!mine.length || !confirm('내가 그은 선 ' + mine.length + '개를 모두 지울까요?')) return;
    mine.forEach((d) => erase(d.row.id));
    renderTools();
    const ids = mine.map((d) => d.row.id).filter((id) => !id.startsWith('local-'));
    if (shared && ids.length) {
      const { error } = await supabase.from('board_drawings').delete().in('id', ids);
      if (error) console.warn('[pen] 지우기 실패:', error.message);
    }
  }

  /* ── 불러오기 · 실시간 ── */
  async function load(): Promise<void> {
    const mem = await supabase.from('trip_members').select('user_id, display_name, joined_at').eq('trip_id', tripId);
    if (destroyed) return;
    const rows = (mem.data ?? []) as Array<{ user_id: string | null; display_name: string | null; joined_at: string | null }>;
    colors = memberColors(rows);
    members = rows.filter((r) => !!r.user_id).map((r) => ({ user_id: r.user_id!, name: r.display_name || '멤버' }));

    let q = supabase.from('board_drawings').select('*').eq('trip_id', tripId);
    q = destinationId ? q.eq('destination_id', destinationId) : q.is('destination_id', null);
    const { data, error } = await q.order('created_at', { ascending: true });
    if (destroyed) return;
    if (error) {
      if (isMissingTable(error)) markLocalOnly();
      else console.warn('[pen] 선 불러오기 실패:', error.message);
      renderTools();
      return;
    }
    (data as DrawingRow[] | null)?.forEach(draw);
    renderTools();

    channel = supabase
      .channel('board_drawings:' + tripId + ':' + (destinationId ?? 'all'))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'board_drawings', filter: 'trip_id=eq.' + tripId }, (payload: any) => {
        const row = payload.new as DrawingRow;
        if ((row.destination_id ?? null) !== destinationId) return;
        if (row.user_id === myId && [...drawn.values()].some((d) => d.row.id === row.id)) return;
        // 내가 방금 그린 선은 저장 응답이 오기 전에 실시간이 먼저 올 수 있다 — 같은 모양의 임시 선이 있으면 건너뛴다
        if (row.user_id === myId && [...drawn.values()].some((d) => d.row.id.startsWith('local-') && JSON.stringify(d.row.path) === JSON.stringify(row.path))) return;
        draw(row);
        renderTools();
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'board_drawings', filter: 'trip_id=eq.' + tripId }, (payload: any) => {
        const id = payload.old?.id;
        if (id) { erase(id); renderTools(); }
      })
      .subscribe();
  }

  renderTools();
  void load();

  return {
    isActive: () => active,
    destroy() {
      destroyed = true;
      mapDiv.classList.remove('bd-pen-on');
      cancelStroke();
      document.removeEventListener('keydown', onKey);
      mapDiv.removeEventListener('pointerdown', onDown, true);
      mapDiv.removeEventListener('mousedown', onDown, true);
      mapDiv.removeEventListener('click', swallow, true);
      mapDiv.removeEventListener('dblclick', swallow, true);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('mouseup', onUp, true);
      projector.destroy();
      drawn.forEach((d) => { d.line.setMap(null); d.label.setMap(null); });
      drawn.clear();
      if (channel) void supabase.removeChannel(channel);
      toolsEl.innerHTML = '';
      floatEl.remove();
    },
  };
}
