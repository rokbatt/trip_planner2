/**
 * 회원 탈퇴 계산·실행 테스트.
 *
 * 되돌릴 수 없는 작업이라 "무엇을 지우는가"보다 **"무엇을 지우지 않는가"**를 더 꼼꼼히 본다.
 *  - 남는 여행의 파일은 절대 건드리지 않는다
 *  - 서버 함수가 실패하면 계정·기기 데이터를 건드리지 않는다
 *  - 파일은 반드시 서버 함수보다 먼저 지운다(멤버십이 사라지면 지울 권한도 사라진다)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const order: string[] = [];
const rpc = vi.fn();
const signOut = vi.fn();
vi.mock('../supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), auth: { signOut: (...a: unknown[]) => signOut(...a) } },
}));

import {
  deleteMyAccount,
  isFunctionMissing,
  pickSuccessor,
  planDeletion,
  type DeletionPreview,
  type MemberRow,
  type TripRow,
} from './accountStore';
import type { StorageBucketLike } from './tripFiles';

const ME = 'me';
const m = (id: string, user_id: string, joined_at: string, trip_id = 't', display_name: string | null = null): MemberRow =>
  ({ id, trip_id, user_id, joined_at, display_name });

describe('pickSuccessor — 서버 함수(order by joined_at, id)와 같은 규칙', () => {
  it('나를 뺀 멤버 중 가장 먼저 참여한 사람', () => {
    const ms = [m('1', ME, '2026-01-01T00:00:00Z'), m('2', 'b', '2026-02-05T00:00:00Z'), m('3', 'c', '2026-02-01T00:00:00Z')];
    expect(pickSuccessor(ME, ms)?.user_id).toBe('c');
  });

  it('참여 시각이 같으면 id 순으로 정한다 (서버와 같은 결과를 내야 화면이 거짓말을 하지 않는다)', () => {
    const ms = [m('9', 'z', '2026-02-01T00:00:00Z'), m('2', 'y', '2026-02-01T00:00:00Z'), m('1', ME, '2026-01-01T00:00:00Z')];
    expect(pickSuccessor(ME, ms)?.user_id).toBe('y');
  });

  it('시각 표기가 달라도(+00:00 / Z) 시각으로 비교한다', () => {
    const ms = [m('1', 'a', '2026-02-01T09:00:00+09:00'), m('2', 'b', '2026-02-01T00:30:00Z')];
    // a = 00:00Z, b = 00:30Z → a 가 먼저
    expect(pickSuccessor(ME, ms)?.user_id).toBe('a');
  });

  it('다른 멤버가 없으면 null', () => {
    expect(pickSuccessor(ME, [m('1', ME, '2026-01-01T00:00:00Z')])).toBeNull();
    expect(pickSuccessor(ME, [])).toBeNull();
  });
});

describe('planDeletion', () => {
  const trips: TripRow[] = [
    { id: 'solo', name: '혼자', owner_id: ME },
    { id: 'shared', name: '같이(방장 나)', owner_id: ME },
    { id: 'guest', name: '같이(방장 남)', owner_id: 'other' },
  ];
  const members: MemberRow[] = [
    m('1', ME, '2026-01-01T00:00:00Z', 'solo'),
    m('2', ME, '2026-01-01T00:00:00Z', 'shared'),
    m('3', 'b', '2026-02-05T00:00:00Z', 'shared', '지현'),
    m('4', 'c', '2026-02-01T00:00:00Z', 'shared', '태호'),
    m('5', 'other', '2026-01-01T00:00:00Z', 'guest'),
    m('6', ME, '2026-01-02T00:00:00Z', 'guest'),
  ];

  it('혼자 방장이면 삭제, 멤버가 있으면 이관, 방장이 아니면 나만 빠진다', () => {
    const plan = planDeletion(ME, trips, members);
    expect(plan.find((o) => o.tripId === 'solo')?.kind).toBe('delete');
    expect(plan.find((o) => o.tripId === 'shared')).toMatchObject({ kind: 'transfer', successorName: '태호' });
    expect(plan.find((o) => o.tripId === 'guest')?.kind).toBe('leave');
  });

  it('방장이 아닌 여행은 멤버가 나 혼자처럼 보여도 삭제로 계산하지 않는다', () => {
    // 목록 조회가 일부만 돌아와도 남의 여행을 "삭제"로 안내하면 안 된다
    const plan = planDeletion(ME, [{ id: 'guest', name: 'g', owner_id: 'other' }], [m('6', ME, '2026-01-02T00:00:00Z', 'guest')]);
    expect(plan[0].kind).toBe('leave');
  });

  it('여행이 없으면 빈 계획', () => {
    expect(planDeletion(ME, [], [])).toEqual([]);
  });
});

describe('isFunctionMissing', () => {
  it('SQL 을 아직 안 돌려 함수가 없는 경우를 일반 오류와 구분한다', () => {
    expect(isFunctionMissing({ code: 'PGRST202', message: 'x' })).toBe(true);
    expect(isFunctionMissing({ code: '42883', message: 'x' })).toBe(true);
    expect(isFunctionMissing({ message: 'Could not find the function public.delete_my_account' })).toBe(true);
    expect(isFunctionMissing({ code: '23503', message: 'foreign key violation' })).toBe(false);
    expect(isFunctionMissing(null)).toBe(false);
  });
});

/** 호출 순서를 기록하는 가짜 버킷 */
function bucketWithFiles(files: Record<string, string[]>): StorageBucketLike {
  return {
    async list(path) {
      order.push('list:' + path);
      const top = files[path];
      if (top) return { data: top.map((n) => ({ name: n, id: 'f' })), error: null };
      return { data: [], error: null };
    },
    async remove(paths) {
      order.push('remove:' + paths.join(','));
      return { error: null };
    },
  };
}

const preview = (over: Partial<DeletionPreview> = {}): DeletionPreview => ({
  outcomes: [],
  personalDocPaths: [],
  unsettledCount: 0,
  ...over,
});

describe('deleteMyAccount', () => {
  beforeEach(() => {
    order.length = 0;
    rpc.mockReset();
    signOut.mockReset();
    rpc.mockImplementation(async () => { order.push('rpc'); return { error: null }; });
    signOut.mockImplementation(async () => { order.push('signOut'); return { error: null }; });
    const store = new Map<string, string>([['mongsil:consent', '{}']]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: () => {}, removeItem: (k: string) => { store.delete(k); order.push('clearConsent'); } });
    vi.stubGlobal('sessionStorage', { clear: () => order.push('clearSession') });
  });

  it('파일 → 서버 함수 → 기기 정리 순서로 실행한다', async () => {
    const b = bucketWithFiles({ solo: ['x.pdf'] });
    const res = await deleteMyAccount(
      preview({ outcomes: [{ tripId: 'solo', name: 's', kind: 'delete' }], personalDocPaths: ['shared/p.jpg'] }),
      () => {},
      b
    );
    expect(res).toEqual({ ok: true, filesFailed: false });
    const iRpc = order.indexOf('rpc');
    expect(order.findIndex((o) => o.startsWith('remove:'))).toBeLessThan(iRpc);
    expect(iRpc).toBeLessThan(order.indexOf('signOut'));
    expect(order).toContain('clearConsent');
  });

  it('남는 여행(이관·나가기)의 파일은 절대 건드리지 않는다', async () => {
    const b = bucketWithFiles({ shared: ['keep.pdf'], guest: ['keep2.pdf'] });
    await deleteMyAccount(
      preview({
        outcomes: [
          { tripId: 'shared', name: 'a', kind: 'transfer', successorName: 'b' },
          { tripId: 'guest', name: 'g', kind: 'leave' },
        ],
      }),
      () => {},
      b
    );
    expect(order.filter((o) => o.startsWith('list:') || o.startsWith('remove:'))).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('내 개인 문서 파일은 남는 여행 안에 있어도 지운다', async () => {
    const b = bucketWithFiles({});
    await deleteMyAccount(preview({ personalDocPaths: ['guest/personal/mine.jpg'] }), () => {}, b);
    expect(order).toContain('remove:guest/personal/mine.jpg');
  });

  it('서버 함수가 없으면 unavailable — 로그아웃·기기 정리를 하지 않는다 (계정은 그대로다)', async () => {
    rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'Could not find the function' } });
    const res = await deleteMyAccount(preview(), () => {}, bucketWithFiles({}));
    expect(res).toEqual({ ok: false, reason: 'unavailable' });
    expect(signOut).not.toHaveBeenCalled();
    expect(order).not.toContain('clearConsent');
  });

  it('서버 함수가 실패하면 error 와 메시지 — 역시 기기를 건드리지 않는다', async () => {
    rpc.mockResolvedValue({ error: { code: '23503', message: 'violates foreign key' } });
    const res = await deleteMyAccount(preview(), () => {}, bucketWithFiles({}));
    expect(res).toEqual({ ok: false, reason: 'error', message: 'violates foreign key' });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('파일 삭제가 일부 실패해도 계정 삭제는 진행하고 filesFailed 로 알린다', async () => {
    const b: StorageBucketLike = {
      list: async () => ({ data: null, error: { message: 'denied' } }),
      remove: async () => ({ error: null }),
    };
    const res = await deleteMyAccount(preview({ outcomes: [{ tripId: 'solo', name: 's', kind: 'delete' }] }), () => {}, b);
    expect(res).toEqual({ ok: true, filesFailed: true });
  });

  it('진행 단계를 화면에 알린다', async () => {
    const steps: string[] = [];
    await deleteMyAccount(preview(), (s) => steps.push(s), bucketWithFiles({}));
    expect(steps).toEqual(['문서 파일을 지우는 중…', '계정을 지우는 중…', '이 기기를 정리하는 중…']);
  });

  it('로컬 로그아웃만 한다 — 서버 세션은 이미 사라졌다', async () => {
    await deleteMyAccount(preview(), () => {}, bucketWithFiles({}));
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
