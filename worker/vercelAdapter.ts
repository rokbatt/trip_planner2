/**
 * Vercel 형식 서버 함수(`handler(req, res)`)를 Cloudflare Worker의 `fetch(Request) → Response`에서
 * 그대로 돌리기 위한 변환 층 (docs/CLOUDFLARE_MIGRATION.md 1단계 PR-1).
 *
 * api/*.ts 12개는 고치지 않는다. 이 파일이 둘 사이에서 아래만 맞춰 준다.
 * - req: method, headers(소문자 키), query(주소의 ?a=b), body(JSON·폼·텍스트를 Vercel처럼 미리 읽어 둠)
 * - res: status(), json(), send(), end(), setHeader(), getHeader()
 *
 * 이 폴더는 api/ 밖에 둔다 — api/ 안의 파일은 Vercel이 서버 함수로 세어 12개 상한에 걸린다.
 */

export interface AdaptedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  query: Record<string, string | string[]>;
  body: any;
}

export interface AdaptedResponse {
  statusCode: number;
  status(code: number): AdaptedResponse;
  setHeader(name: string, value: string | number | readonly string[]): AdaptedResponse;
  getHeader(name: string): string | undefined;
  json(body: unknown): AdaptedResponse;
  send(body: unknown): AdaptedResponse;
  end(body?: string): AdaptedResponse;
}

export type VercelStyleHandler = (req: AdaptedRequest, res: AdaptedResponse) => unknown | Promise<unknown>;

/** 본문이 JSON인데 해석이 안 될 때 — Vercel도 이 경우 400을 돌려준다 */
export class InvalidBodyError extends Error {}

function readQuery(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    query[key] = all.length === 1 ? all[0] : all;
  }
  return query;
}

async function readBody(request: Request): Promise<any> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const text = await request.text();
  if (!text) return undefined;

  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  if (type.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      throw new InvalidBodyError('Invalid JSON body');
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  return text;
}

export async function toAdaptedRequest(request: Request): Promise<AdaptedRequest> {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  // Headers는 키를 이미 소문자로 돌려준다 — Node(Vercel)의 req.headers와 같은 모양
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    method: request.method.toUpperCase(),
    url: url.pathname + url.search,
    headers,
    query: readQuery(url),
    body: await readBody(request),
  };
}

/** 핸들러가 res에 쓴 내용을 모아 두었다가 Response 하나로 만든다 */
export function createAdaptedResponse() {
  const headers = new Headers();
  let body: string | null = null;
  let finished = false;

  const res: AdaptedResponse = {
    statusCode: 200,
    status(code) {
      res.statusCode = code;
      return res;
    },
    setHeader(name, value) {
      if (Array.isArray(value)) {
        headers.delete(name);
        for (const v of value) headers.append(name, String(v));
      } else {
        headers.set(name, String(value));
      }
      return res;
    },
    getHeader(name) {
      return headers.get(name) ?? undefined;
    },
    json(payload) {
      if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
      body = JSON.stringify(payload);
      finished = true;
      return res;
    },
    send(payload) {
      if (payload !== null && typeof payload === 'object') return res.json(payload);
      if (!headers.has('content-type')) headers.set('content-type', 'text/plain; charset=utf-8');
      body = payload == null ? null : String(payload);
      finished = true;
      return res;
    },
    end(payload) {
      body = payload ?? body;
      finished = true;
      return res;
    },
  };

  return {
    res,
    isFinished: () => finished,
    toResponse(): Response {
      // 204·304는 본문을 가질 수 없다(Response 생성자가 오류를 낸다)
      const noBody = res.statusCode === 204 || res.statusCode === 304;
      return new Response(noBody ? null : body, { status: res.statusCode, headers });
    },
  };
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Vercel 형식 핸들러 하나를 실행해 Response로 돌려준다 */
export async function runVercelHandler(handler: VercelStyleHandler, request: Request): Promise<Response> {
  let req: AdaptedRequest;
  try {
    req = await toAdaptedRequest(request);
  } catch (e) {
    if (e instanceof InvalidBodyError) return jsonError(400, '요청 형식이 올바르지 않아요.');
    throw e;
  }

  const out = createAdaptedResponse();
  try {
    await handler(req, out.res);
  } catch (e) {
    // 원문 오류는 로그에만 남기고 사용자에게는 일반 문구만 보낸다(Claude.md 5-11)
    console.error('[worker] handler error:', e);
    if (!out.isFinished()) return jsonError(500, '서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
  }

  if (!out.isFinished()) {
    console.error('[worker] handler finished without a response:', req.url);
    return jsonError(500, '서버에서 응답을 만들지 못했어요.');
  }
  return out.toResponse();
}
