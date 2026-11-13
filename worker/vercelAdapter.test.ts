import { describe, it, expect, vi } from 'vitest';
import { runVercelHandler, toAdaptedRequest, type VercelStyleHandler } from './vercelAdapter';

const BASE = 'https://www.mongsil2.com';

function post(path: string, body: string, type = 'application/json', extra: Record<string, string> = {}) {
  return new Request(BASE + path, { method: 'POST', body, headers: { 'content-type': type, ...extra } });
}

describe('toAdaptedRequest', () => {
  it('JSON 본문을 미리 읽어 req.body에 넣는다', async () => {
    const req = await toAdaptedRequest(post('/api/ai', '{"kind":"place-brief","n":1}'));
    expect(req.method).toBe('POST');
    expect(req.body).toEqual({ kind: 'place-brief', n: 1 });
  });

  it('헤더 키는 소문자로 — api 파일이 req.headers.authorization으로 읽는다', async () => {
    const req = await toAdaptedRequest(post('/api/ai', '{}', 'application/json', { Authorization: 'Bearer abc', 'X-Admin-Secret': 's' }));
    expect(req.headers.authorization).toBe('Bearer abc');
    expect(req.headers['x-admin-secret']).toBe('s');
  });

  it('쿼리는 하나면 문자열, 여러 개면 배열', async () => {
    const req = await toAdaptedRequest(new Request(`${BASE}/api/exchange-rate?from=thb&tag=a&tag=b`));
    expect(req.query.from).toBe('thb');
    expect(req.query.tag).toEqual(['a', 'b']);
    expect(req.body).toBeUndefined();
  });

  it('폼 본문은 객체로, 그 밖은 문자열로', async () => {
    expect((await toAdaptedRequest(post('/x', 'a=1&b=2', 'application/x-www-form-urlencoded'))).body).toEqual({ a: '1', b: '2' });
    expect((await toAdaptedRequest(post('/x', 'hello', 'text/plain'))).body).toBe('hello');
    expect((await toAdaptedRequest(post('/x', '', 'application/json'))).body).toBeUndefined();
  });
});

describe('runVercelHandler', () => {
  it('res.status().json()을 Response로 바꾼다', async () => {
    const handler: VercelStyleHandler = (req, res) => {
      res.status(201).json({ echo: req.body.v });
    };
    const out = await runVercelHandler(handler, post('/api/x', '{"v":"몽실"}'));
    expect(out.status).toBe(201);
    expect(out.headers.get('content-type')).toContain('application/json');
    expect(await out.json()).toEqual({ echo: '몽실' });
  });

  it('setHeader가 응답 헤더로 나간다(exchange-rate의 Cache-Control)', async () => {
    const handler: VercelStyleHandler = (_req, res) => {
      res.setHeader('Cache-Control', 's-maxage=1800');
      res.status(200).json({ ok: true });
    };
    const out = await runVercelHandler(handler, new Request(BASE + '/api/exchange-rate'));
    expect(out.headers.get('cache-control')).toBe('s-maxage=1800');
  });

  it('async 핸들러도 끝날 때까지 기다린다', async () => {
    const handler: VercelStyleHandler = async (_req, res) => {
      await new Promise((r) => setTimeout(r, 5));
      res.status(429).json({ quotaExceeded: true });
    };
    const out = await runVercelHandler(handler, post('/api/x', '{}'));
    expect(out.status).toBe(429);
    expect(await out.json()).toEqual({ quotaExceeded: true });
  });

  it('JSON이 깨졌으면 핸들러를 부르지 않고 400', async () => {
    const handler = vi.fn();
    const out = await runVercelHandler(handler, post('/api/x', '{broken'));
    expect(out.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('핸들러가 던지면 500 + 원문을 숨긴 문구', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler: VercelStyleHandler = () => {
      throw new Error('secret internal detail');
    };
    const out = await runVercelHandler(handler, post('/api/x', '{}'));
    expect(out.status).toBe(500);
    expect(await out.text()).not.toContain('secret internal detail');
    spy.mockRestore();
  });

  it('응답 없이 끝나면 500(무한 대기 대신)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await runVercelHandler(() => {}, post('/api/x', '{}'));
    expect(out.status).toBe(500);
    spy.mockRestore();
  });

  it('204는 본문 없이', async () => {
    const out = await runVercelHandler((_req, res) => { res.status(204).end(); }, post('/api/x', '{}'));
    expect(out.status).toBe(204);
    expect(await out.text()).toBe('');
  });
});
