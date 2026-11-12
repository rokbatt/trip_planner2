/**
 * HTML 문자열을 만들 때 쓰는 단일 기준 (Claude.md 5-11).
 *
 * 이 앱은 화면을 `innerHTML` 문자열로 그리는 곳이 많다. 사용자 입력(이름·메모·장소명·주소 등)을
 * 넣을 땐 반드시 여기를 거친다. 예전엔 파일마다 `textContent → innerHTML` 방식의 복사본이 있었는데,
 * 그 방식은 따옴표를 바꾸지 않아 `title="…"`·`value="…"` 같은 **속성값 안에서는 막지 못했다**
 * (이름에 `"`를 넣어 속성을 끝내고 `onmouseover=`를 붙일 수 있었다).
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** 텍스트와 속성값 어디에 넣어도 안전하게 바꾼다(& < > " ') */
export function escapeHtml(str: string): string {
  return String(str ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * 사용자·외부가 정한 주소를 링크(`href`)·이미지(`src`)·새 창에 쓸 수 있는지 — `http(s)`만 허용한다.
 * `javascript:`·`data:` 같은 주소는 누르거나 불러올 때 스크립트가 돌 수 있다. 쓸 수 없으면 null.
 * 돌려준 값도 HTML에 넣을 땐 escapeHtml을 한 번 더 거친다.
 */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}
