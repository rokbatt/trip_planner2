/**
 * 탈퇴 함수 ↔ DB 스키마 드리프트 가드.
 *
 * 탈퇴가 실제로 개인정보를 지우는지는 `supabase/delete_my_account.sql`이 **어떤 테이블의 어떤
 * 컬럼을 아는가**에 달려 있다. 누가 사람 이름·사진을 사본으로 들고 있는 컬럼(예: 새 테이블의
 * `display_name`)을 타입에 추가하고 이 SQL을 안 고치면, 탈퇴한 사람의 이름이 아무도 모르게
 * 영원히 남는다. 그 실수를 PR 단계에서 막는 테스트다.
 *
 * 진짜 Postgres에서 돌리는 검증(19개 시나리오)은 이 테스트가 대신하지 못한다 — 이건 "SQL이 그 컬럼을
 * 언급은 하는가"만 본다. 그래도 가장 흔한 실수(새 컬럼을 잊는 것)는 이걸로 잡힌다.
 */

import { describe, expect, it } from 'vitest';
// ?raw 는 Vite 가 파일 내용을 문자열로 넘겨 준다 — node:fs 를 쓰면 @types/node 가 따로 필요해진다
import types from '../types/database.ts?raw';
import sql from '../../supabase/delete_my_account.sql?raw';

/** 타입 파일에서 테이블별 Row 컬럼을 읽는다 */
function readTables(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /^      ([a-z_]+): \{\n        Row: \{([\s\S]*?)\n        \};/gm;
  for (const m of types.matchAll(re)) {
    out.set(m[1], [...m[2].matchAll(/^\s+([a-z_]+)\??:/gm)].map((c) => c[1]));
  }
  return out;
}

const tables = readTables();

/** 사람을 가리키는 컬럼 */
const isUserPointer = (c: string) => c === 'user_id' || c === 'owner_id' || c === 'added_by' || c === 'author' || /_by$/.test(c);
/** 사람 이름·사진의 "사본" — 정확히 이것들만. site_name·file_name·zone_name 같은 건 사람이 아니다 */
const isPersonCopy = (c: string) => c === 'display_name' || c === 'avatar_url' || /_by_(name|avatar)$/.test(c);

/** 행 전체를 지우는 테이블 — 사본 컬럼을 따로 비울 필요가 없다 */
const DELETED_WHOLESALE = ['trip_members', 'chat_messages', 'place_comments'];

/**
 * SQL 이 이름으로 다루지는 않지만 의도적으로 안전망(no-action FK 자동 정리)에 맡기는 테이블.
 * 새 테이블이 사용자 컬럼을 가지면 여기 올리기 전에 "이게 안전망으로 충분한가"를 한 번 생각하게 하려는 목록이다.
 */
const LEFT_TO_SAFETY_NET: Record<string, string> = {
  places: 'added_by 만 있고 사람 이름 사본이 없다 — FK가 있으면 비우고, 없으면 의미 없는 id 로 남는다',
  trip_link_groups: 'created_by 만 있고 이름 사본이 없다',
  user_consents: '계정 삭제 시 on delete cascade 로 같이 지워진다',
};

describe('delete_my_account.sql 이 스키마를 따라가는가', () => {
  it('타입 파일에서 테이블을 읽었다 (파서가 깨지면 아래 검사가 전부 헛돈다)', () => {
    expect(tables.size).toBeGreaterThan(15);
    expect(tables.get('trip_expenses')).toContain('paid_by_name');
  });

  it('행 전체를 지운다고 한 테이블은 SQL 에서 실제로 delete 한다', () => {
    for (const t of DELETED_WHOLESALE) {
      expect(sql, `${t} 를 지우는 구문이 SQL 에 없다`).toMatch(new RegExp(`delete from public\\.${t}\\b`));
    }
  });

  it('사람 이름·사진 사본 컬럼은 전부 SQL 에서 비운다', () => {
    const missing: string[] = [];
    for (const [table, cols] of tables) {
      if (DELETED_WHOLESALE.includes(table)) continue;
      for (const col of cols.filter(isPersonCopy)) {
        const re = new RegExp(`update public\\.${table}\\s+set[^;]*\\b${col}\\b`);
        if (!re.test(sql)) missing.push(`${table}.${col}`);
      }
    }
    expect(
      missing,
      '탈퇴해도 이름·사진이 남는 컬럼이 생겼다. supabase/delete_my_account.sql 3단계에 update 를 추가하고 ' +
        'Postgres 에서 다시 검증한 뒤, legal.ts 의 파기 항목도 맞추세요: ' + missing.join(', ')
    ).toEqual([]);
  });

  it('사용자를 가리키는 컬럼이 있는 테이블은 SQL 이 알거나, 안전망에 맡긴다고 적혀 있다', () => {
    const unknown: string[] = [];
    for (const [table, cols] of tables) {
      if (!cols.some(isUserPointer)) continue;
      const known = sql.includes(`public.${table}`) || table in LEFT_TO_SAFETY_NET;
      if (!known) unknown.push(table);
    }
    expect(
      unknown,
      '사용자 컬럼이 있는 새 테이블이다. delete_my_account.sql 에 처리를 넣거나, 안전망으로 충분한 이유를 ' +
        'LEFT_TO_SAFETY_NET 에 적으세요: ' + unknown.join(', ')
    ).toEqual([]);
  });

  it('안전망에 맡긴다고 적은 테이블이 실제로 존재한다 (이미 사라진 테이블을 목록에 남기지 않는다)', () => {
    for (const t of Object.keys(LEFT_TO_SAFETY_NET)) expect(tables.has(t), t).toBe(true);
  });

  it('함수는 로그인 사용자만 부를 수 있게 잠겨 있다', () => {
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path\s*=/i); // definer 함수의 search_path 고정
    expect(sql).toMatch(/revoke all on function public\.delete_my_account\(\) from public/);
    expect(sql).toMatch(/revoke all on function public\.delete_my_account\(\) from anon/);
    expect(sql).toMatch(/grant execute on function public\.delete_my_account\(\) to authenticated/);
  });

  it('로그인하지 않은 호출은 함수 안에서도 한 번 더 막는다', () => {
    expect(sql).toMatch(/if uid is null then[\s\S]*raise exception/);
  });
});
