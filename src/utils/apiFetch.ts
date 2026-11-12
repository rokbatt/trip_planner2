/**
 * 우리 서버 함수(`/api/*`)를 부르는 단일 창구 — 로그인 토큰을 `Authorization: Bearer`로 붙인다.
 *
 * 서버가 "누가 부르는지"를 확인할 수 있어야 남의 여행 접근·비용 폭탄을 막을 수 있다(Claude.md 5-11).
 * 서버 쪽 확인은 이 변경이 기기들에 퍼진 뒤 따로 켠다 — 설치된 앱(PWA)은 예전 화면을 저장해 두므로,
 * 서버를 먼저 막으면 아직 토큰을 안 보내는 기기의 기능이 멈춘다.
 *
 * 새 `/api` 호출을 만들 땐 `fetch` 대신 반드시 이걸 쓴다.
 */
import { supabase } from '../supabase';

type TokenGetter = () => Promise<string | null>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** 테스트에서 토큰·fetch를 바꿔 끼울 수 있게 만든 공장 함수 */
export function createApiFetch(getToken: TokenGetter, fetchImpl: FetchLike): FetchLike {
  return async (input, init = {}) => {
    let token: string | null = null;
    try {
      token = await getToken();
    } catch {
      // 세션을 못 읽어도 요청은 보낸다 — 서버가 아직 확인하지 않는 동안 기능이 멈추면 안 된다
    }
    const headers = new Headers(init.headers);
    if (token && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
    return fetchImpl(input, { ...init, headers });
  };
}

export const apiFetch: FetchLike = createApiFetch(
  async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
  (input, init) => fetch(input, init)
);
