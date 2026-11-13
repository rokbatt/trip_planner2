import { describe, it, expect, vi } from 'vitest';
import worker from './index';

function env() {
  return { ASSETS: { fetch: vi.fn(async () => new Response('asset', { status: 200 })) }, CRON_SECRET: 'test-secret' };
}

describe('Worker fetch', () => {
  it('/api/<없는 이름>은 404 JSON, 화면 파일로 넘기지 않는다', async () => {
    const e = env();
    const res = await worker.fetch(new Request('https://x.dev/api/nope'), e, { waitUntil: () => {} });
    expect(res.status).toBe(404);
    expect(e.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('/api 밖의 주소는 정적 파일로 넘긴다', async () => {
    const e = env();
    const res = await worker.fetch(new Request('https://x.dev/terms'), e, { waitUntil: () => {} });
    expect(await res.text()).toBe('asset');
    expect(e.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it('/api/<이름>은 해당 핸들러로 간다(GET이 아니면 405를 주는 exchange-rate로 확인)', async () => {
    const res = await worker.fetch(new Request('https://x.dev/api/exchange-rate', { method: 'POST' }), env(), { waitUntil: () => {} });
    expect(res.status).toBe(405);
  });
});

describe('Worker scheduled (매일 정리 작업)', () => {
  it('정리 핸들러를 실행하고 결과를 waitUntil로 넘긴다', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const pending: Promise<unknown>[] = [];
    await worker.scheduled({}, env(), { waitUntil: (p) => pending.push(p) });
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    // 테스트 환경엔 Supabase 설정이 없어 "건너뜀"(200)으로 끝난다 — 핸들러까지 닿았다는 뜻
    expect(log).toHaveBeenCalledWith('[cron] cleanup-search-cache', 200, expect.stringContaining('skipped'));
    log.mockRestore();
  });
});
