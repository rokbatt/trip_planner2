import { describe, expect, it } from 'vitest';
import { leaveErrorMessage, planLeave, type LeaveMember } from './leaveTrip';
import types from '../types/database.ts?raw';
import sql from '../../supabase/leave_trip.sql?raw';

const m = (id: string, user: string, at: string, name: string): LeaveMember => ({
  id, trip_id: 't', user_id: user, joined_at: at, display_name: name, avatar_url: null, role: 'member',
});
const A = m('m1', 'ua', '2026-11-01T00:00:00Z', '성현');
const B = m('m2', 'ub', '2026-11-02T00:00:00Z', '지민');
const C = m('m3', 'uc', '2026-11-03T00:00:00Z', '도윤');

describe('planLeave', () => {
  it('일반 멤버는 나가면 그만 — 방장 이동 없음', () => {
    expect(planLeave('ub', 'ua', [A, B, C])).toEqual({ canLeave: true, isOwner: false, successorName: null });
  });
  it('방장이 나가면 가장 먼저 참여한 다른 멤버에게', () => {
    expect(planLeave('ua', 'ua', [C, B, A])).toEqual({ canLeave: true, isOwner: true, successorName: '지민' });
  });
  it('혼자면 나갈 수 없고, 멤버가 아니면 그것도 알려 준다', () => {
    expect(planLeave('ua', 'ua', [A])).toEqual({ canLeave: false, reason: 'only_member' });
    expect(planLeave('ux', 'ua', [A, B])).toEqual({ canLeave: false, reason: 'not_member' });
  });
});

describe('오류 문구', () => {
  it('서버 오류 코드를 사용자 문장으로', () => {
    expect(leaveErrorMessage({ message: 'only_member' })).toContain('나 혼자');
    expect(leaveErrorMessage({ message: 'not_member' })).toContain('이미');
    expect(leaveErrorMessage({ message: 'boom' })).toContain('help@mongsil2.com');
  });
});

describe('leave_trip.sql', () => {
  it('로그인 사용자만, 정의자 권한 + search_path 고정', () => {
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path\s*=/i);
    expect(sql).toMatch(/revoke all on function public\.leave_trip\(uuid\) from public/);
    expect(sql).toMatch(/revoke all on function public\.leave_trip\(uuid\) from anon/);
    expect(sql).toMatch(/grant execute on function public\.leave_trip\(uuid\) to authenticated/);
    expect(sql).toMatch(/if uid is null then[\s\S]*raise exception/);
  });
  it('멤버가 아니거나 혼자면 아무것도 지우기 전에 막는다', () => {
    const guard = sql.indexOf("raise exception 'only_member'");
    expect(guard).toBeGreaterThan(0);
    expect(sql.indexOf("raise exception 'not_member'")).toBeGreaterThan(0);
    expect(guard).toBeLessThan(sql.indexOf('delete from public.trip_doc_users'));
    expect(guard).toBeLessThan(sql.indexOf('delete from public.trip_members where id'));
  });
  it('이 여행 것만 지운다 — 다른 여행·계정은 건드리지 않는다', () => {
    expect(sql).not.toMatch(/delete from auth\.users/);
    expect(sql).not.toMatch(/delete from public\.trips\b/);
    expect(sql).toMatch(/delete from public\.trip_doc_users where trip_id = p_trip_id and user_id = uid/);
  });
  it('이름·사진 사본 컬럼은 전부 이 여행 안에서 비운다 (탈퇴 SQL과 같은 기준)', () => {
    const tables = new Map<string, string[]>();
    for (const t of types.matchAll(/^      ([a-z_]+): \{\n        Row: \{([\s\S]*?)\n        \};/gm)) {
      tables.set(t[1], [...t[2].matchAll(/^\s+([a-z_]+)\??:/gm)].map((c) => c[1]));
    }
    const copy = (c: string) => c === 'display_name' || c === 'avatar_url' || /_by_(name|avatar)$/.test(c);
    const skip = ['trip_members', 'chat_messages', 'place_comments'];
    const missing: string[] = [];
    for (const [table, cols] of tables) {
      if (skip.includes(table)) continue;
      for (const col of cols.filter(copy)) {
        if (!new RegExp(`update public\\.${table}\\s+set[^;]*\\b${col}\\b[^;]*trip_id = p_trip_id`).test(sql)) missing.push(`${table}.${col}`);
      }
    }
    expect(missing, '나가도 이름·사진이 남는 컬럼이 생겼다. supabase/leave_trip.sql 5단계에 추가하세요: ' + missing.join(', ')).toEqual([]);
  });
});
