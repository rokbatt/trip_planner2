/**
 * 목적지 도시 입력 칸에 자동완성 드롭다운을 붙인다(무엇을 추천할지는 citySuggest.ts).
 *
 * 콤마로 여러 도시를 적는 칸이라, 커서가 놓인 조각 하나만 보고 추천하고 그 조각만 바꿔 넣는다.
 * 목록에 없는 도시는 지금처럼 그대로 타이핑하면 된다 — 자동완성은 강제가 아니다.
 */
import { suggestCities, tokenAtCaret, replaceToken } from './citySuggest';
import type { CitySuggestion } from './citySuggest';
import './cityAutocomplete.css';

let listSeq = 0;

export function attachCityAutocomplete(input: HTMLInputElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'cac-wrap';
  input.replaceWith(wrap);
  wrap.appendChild(input);

  const listId = 'cac-list-' + ++listSeq;
  input.setAttribute('autocomplete', 'off'); // 브라우저 자체 자동완성 목록이 겹쳐 뜨지 않게
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);

  let items: CitySuggestion[] = [];
  let active = 0;

  const caret = () => input.selectionStart ?? input.value.length;

  const close = () => {
    wrap.querySelector('.cac-list')?.remove();
    items = [];
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const pick = (city: CitySuggestion) => {
    const next = replaceToken(input.value, tokenAtCaret(input.value, caret()), city.name);
    input.value = next.value;
    input.setSelectionRange(next.caret, next.caret);
    close();
  };

  // 강조 줄만 옮긴다 — 목록을 통째로 다시 그리면 마우스 아래에 새 요소가 생기면서
  // mouseenter가 또 불려 끝없이 다시 그리게 된다.
  const setActive = (idx: number) => {
    active = idx;
    wrap.querySelectorAll('.cac-item').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      el.setAttribute('aria-selected', String(i === idx));
    });
    input.setAttribute('aria-activedescendant', listId + '-' + idx);
  };

  const render = () => {
    wrap.querySelector('.cac-list')?.remove();
    if (items.length === 0) {
      close();
      return;
    }
    const list = document.createElement('div');
    list.className = 'cac-list';
    list.id = listId;
    list.setAttribute('role', 'listbox');
    items.forEach((city, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'cac-item';
      item.id = listId + '-' + i;
      item.setAttribute('role', 'option');
      const main = document.createElement('span');
      main.className = 'cac-main';
      main.textContent = city.name;
      const sub = document.createElement('span');
      sub.className = 'cac-sub';
      sub.textContent = city.en + ' · ' + city.code;
      item.append(main, sub);
      // mousedown을 써야 input의 blur(그로 인한 목록 닫힘)보다 먼저 선택이 처리된다
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(city);
      });
      item.addEventListener('mouseenter', () => setActive(i));
      list.appendChild(item);
    });
    wrap.appendChild(list);
    input.setAttribute('aria-expanded', 'true');
    setActive(0);
  };

  input.addEventListener('input', () => {
    const token = tokenAtCaret(input.value, caret());
    items = suggestCities(token.text, token.others);
    render();
  });

  input.addEventListener('keydown', (e) => {
    if (items.length === 0) return;

    // 한글 조합 중의 키는 입력기가 먼저 가져가고, 브라우저에 따라 같은 키가 조합이 끝난 뒤
    // 한 번 더 온다. 여기서 처리하면 두 번 움직이므로 건너뛰되, Enter만은 기본 동작(폼 제출)을
    // 막아 둔다 — 안 그러면 "방ㅋ"인 채로 후보를 고르기도 전에 여행이 만들어질 수 있다.
    if (e.isComposing || e.keyCode === 229) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((active + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((active - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === 'Escape') {
      // 목록만 닫는다 — 그대로 올려보내면 모달의 Esc 처리까지 가서 창 전체가 닫힌다
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  input.addEventListener('blur', () => setTimeout(close, 120)); // mousedown 선택이 먼저 처리될 시간
}
