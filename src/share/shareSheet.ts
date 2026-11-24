/**
 * 공유 창 — 앱 아이콘 줄 + 링크 칸 + 복사 버튼(유튜브 공유 창과 같은 모양).
 * PC는 가운데 창, 휴대폰은 아래에서 올라오는 시트. 여행 초대(PC 멤버 초대·공유, Companion 일행 탭)가 같이 쓴다.
 *
 * - 카카오톡: 환경 변수 VITE_KAKAO_JS_KEY가 있을 때만 버튼이 나온다(카카오 개발자 앱 등록 필요). 없으면 숨긴다
 * - "더보기": 기기의 기본 공유(navigator.share)가 있으면 나온다 — 휴대폰에선 카카오톡 등 설치된 앱이 다 뜬다
 * - 공유 미리보기(제목·사진)는 index.html의 og 태그를 쓴다. 초대 코드는 # 뒤라 미리보기 카드에는 서비스 소개가 보인다
 */
import './shareSheet.css';
import { shareTargets } from './shareTargets';
import { escapeHtml } from '../utils/html';

export interface ShareInput {
  url: string;
  /** 창 제목(예: "일행 초대하기") */
  title: string;
  /** 메시지에 같이 붙는 문구 */
  text: string;
}

const ICONS: Record<string, { bg: string; svg: string }> = {
  kakao: { bg: '#FEE500', svg: '<svg viewBox="0 0 24 24"><path fill="#191919" d="M12 4C7 4 3 7.1 3 11c0 2.5 1.7 4.7 4.2 5.9l-.9 3.3c-.1.3.3.6.6.4l3.9-2.6c.4 0 .8.1 1.2.1 5 0 9-3.1 9-7s-4-7.1-9-7.1z"/></svg>' },
  sms: { bg: '#34C759', svg: '<svg viewBox="0 0 24 24"><path fill="#fff" d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/></svg>' },
  line: { bg: '#06C755', svg: '<svg viewBox="0 0 24 24"><path fill="#fff" d="M12 4c-4.7 0-8.5 3-8.5 6.8 0 3.4 3 6.2 7.1 6.7.3.1.6.2.7.5v1.6c0 .4.4.7.8.4 1.3-.8 6.9-4.1 8-6.4.3-.9.4-1.8.4-2.8C20.5 7 16.7 4 12 4z"/></svg>' },
  whatsapp: { bg: '#25D366', svg: '<svg viewBox="0 0 24 24"><path fill="#fff" d="M12 3.5a8.4 8.4 0 0 0-7.3 12.6L3.5 20.5l4.5-1.2A8.4 8.4 0 1 0 12 3.5zm4.6 11.7c-.2.6-1.1 1.1-1.6 1.1-.4.1-1 .1-3.1-.8-2.6-1.1-4.3-3.8-4.4-4-.1-.2-1-1.4-1-2.6s.6-1.8.9-2.1c.2-.2.5-.3.6-.3h.5c.1 0 .4 0 .6.5l.8 1.9c.1.1.1.3 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.7 1.2 1.6 1.9 1.1.9 2 1.2 2.3 1.4.3.1.5.1.6-.1l.8-1c.2-.2.4-.2.6-.1l1.8.9c.3.1.4.2.5.3 0 .2 0 .7-.3 1.2z"/></svg>' },
  telegram: { bg: '#2AABEE', svg: '<svg viewBox="0 0 24 24"><path fill="#fff" d="M20.6 4.4 3.9 10.8c-1.1.4-1.1 1.1-.2 1.4l4.3 1.3 1.6 5c.2.6.4.8.8.8.3 0 .5-.1.8-.4l2.1-2 4.3 3.2c.8.4 1.4.2 1.6-.7l2.8-13.3c.3-1.2-.4-1.7-1.4-1.3zM9.4 13.6l8.3-5.2c.4-.2.7-.1.4.2l-6.9 6.2-.3 3.1-1.5-4.3z"/></svg>' },
  x: { bg: '#000000', svg: '<svg viewBox="0 0 24 24"><path fill="#fff" d="M17.5 3.5h3l-6.6 7.5 7.7 9.5h-6l-4.7-5.8-5.4 5.8h-3l7.1-8L2.4 3.5h6.2l4.2 5.3 4.7-5.3zm-1 15.3h1.7L7.6 5.1H5.8z"/></svg>' },
  facebook: { bg: '#1877F2', svg: '<svg viewBox="0 0 24 24"><path fill="#fff" d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21h3.1z"/></svg>' },
  email: { bg: '#EA4335', svg: '<svg viewBox="0 0 24 24"><path fill="#fff" d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm8 6.5L4.5 7.8v.9L12 13.5l7.5-4.8v-.9z"/></svg>' },
  more: { bg: '#E2E8F0', svg: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.8" fill="#334155"/><circle cx="12" cy="12" r="1.8" fill="#334155"/><circle cx="18" cy="12" r="1.8" fill="#334155"/></svg>' },
};

function isPhone(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

/* ── 카카오톡(선택) ── */
const KAKAO_KEY = (import.meta.env.VITE_KAKAO_JS_KEY as string | undefined) || '';
let kakaoReady: Promise<any> | null = null;
function loadKakao(): Promise<any> {
  if (kakaoReady) return kakaoReady;
  kakaoReady = new Promise((resolve, reject) => {
    const w = window as any;
    if (w.Kakao) return resolve(w.Kakao);
    const s = document.createElement('script');
    s.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js';
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(w.Kakao);
    s.onerror = () => { kakaoReady = null; reject(new Error('kakao sdk')); };
    document.head.appendChild(s);
  });
  return kakaoReady;
}
async function shareKakao(input: ShareInput): Promise<boolean> {
  try {
    const Kakao = await loadKakao();
    if (!Kakao.isInitialized()) Kakao.init(KAKAO_KEY);
    Kakao.Share.sendDefault({
      objectType: 'feed',
      content: {
        title: input.text,
        description: '몽실이 — 친구와 함께 짜는 여행 계획',
        imageUrl: location.origin + '/hero.jpg',
        link: { mobileWebUrl: input.url, webUrl: input.url },
      },
      buttons: [{ title: '여행 참여하기', link: { mobileWebUrl: input.url, webUrl: input.url } }],
    });
    return true;
  } catch {
    return false;
  }
}

export function openShareSheet(input: ShareInput): void {
  document.querySelector('.ss-overlay')?.remove();
  const phone = isPhone();
  const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
  const targets = shareTargets(input.url, input.text).filter((t) => phone || !t.mobileOnly);

  const btn = (key: string, label: string, attrs: string) =>
    '<' + (attrs.startsWith('href') ? 'a ' + attrs + ' target="_blank" rel="noopener"' : 'button type="button" ' + attrs) + ' class="ss-app">' +
    '<span class="ss-app-ic" style="background:' + ICONS[key].bg + '">' + ICONS[key].svg + '</span>' +
    '<span class="ss-app-label">' + escapeHtml(label) + '</span>' +
    (attrs.startsWith('href') ? '</a>' : '</button>');

  const apps = [
    KAKAO_KEY ? btn('kakao', '카카오톡', 'data-ss="kakao"') : '',
    ...targets.map((t) => btn(t.key, t.label, 'href="' + escapeHtml(t.href) + '"')),
    'share' in navigator ? btn('more', '더보기', 'data-ss="more"') : '',
  ].join('');

  const overlay = document.createElement('div');
  overlay.className = 'ss-overlay' + (phone ? ' is-sheet' : '');
  overlay.innerHTML = [
    '<div class="ss-box" role="dialog" aria-modal="true" aria-label="' + escapeHtml(input.title) + '">',
    '  <div class="ss-head"><h2 class="ss-title">' + escapeHtml(input.title) + '</h2>',
    '    <button type="button" class="ss-close" aria-label="닫기"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>',
    '  <div class="ss-apps">' + apps + '</div>',
    '  <div class="ss-link"><input class="ss-url" type="text" readonly value="' + escapeHtml(input.url) + '" aria-label="공유 링크" />',
    '    <button type="button" class="ss-copy">복사</button></div>',
    '  <p class="ss-note">링크를 받은 사람이 로그인하면 이 여행에 함께하게 돼요.</p>',
    '</div>',
  ].join('');
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 180);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.ss-close')!.addEventListener('click', close);

  const urlEl = overlay.querySelector('.ss-url') as HTMLInputElement;
  urlEl.addEventListener('focus', () => urlEl.select());
  const copyBtn = overlay.querySelector('.ss-copy') as HTMLButtonElement;
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(input.url);
    } catch {
      urlEl.select();
      document.execCommand?.('copy');
    }
    copyBtn.textContent = '복사됨';
    copyBtn.classList.add('is-done');
    setTimeout(() => { copyBtn.textContent = '복사'; copyBtn.classList.remove('is-done'); }, 1600);
  });

  overlay.querySelector('[data-ss="kakao"]')?.addEventListener('click', async () => {
    if (!(await shareKakao(input))) copyBtn.click();
  });
  overlay.querySelector('[data-ss="more"]')?.addEventListener('click', async () => {
    try {
      await nav.share!({ title: '몽실이 여행 초대', text: input.text, url: input.url });
    } catch {
      /* 닫음 */
    }
  });
}
