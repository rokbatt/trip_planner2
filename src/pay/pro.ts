/**
 * 요금제 · PRO 이용권 화면(#pro) — docs/PAYMENT_DESIGN.md 6장.
 *
 * 들어오는 곳(조사 근거는 PR 설명): 계정 메뉴(PC 랜딩·내 여행) · 설정 화면 · 휴대폰 메뉴(☰) · 잠긴 PRO 기능(인생샷·영수증·웹 검색)
 * 한 화면에서: 지금 내 요금제 → 무료·PRO 비교 → 구매(결제 전 고지·동의) → 결제 내역·환불 요청
 *
 * 결제 설정(VITE_PORTONE_*)이 없으면 구매 영역을 "준비 중"으로만 보여 준다 — 고지 문구·결제 버튼을 열지 않는다.
 * 문구: 결제·환불 고지는 담백한 합니다체(Claude.md 3-6). 가격은 src/pay/products.ts 한 곳에서 온다.
 */
import './pro.css';
import '../account/settings.css';
import { navigate } from '../router';
import { escapeHtml as esc } from '../utils/html';
import { PRODUCTS } from './products';
import { PRO_FEATURE_NAMES, takeProEntry } from './proEntry';
import { businessFooterHtml } from '../legal/business';
import { fetchMyPlanInfo, type PlanInfo } from '../assistant/assistantClient';
import {
  PAY_METHODS,
  payConfig,
  startCheckout,
  completePayment,
  takePayReturn,
  fetchPaymentHistory,
  payMethodName,
  adminRefund,
  adminRecheck,
  type RefundReview,
  type PayMethodKey,
  type PaymentHistoryRow,
} from './payClient';

const SUPPORT_EMAIL = 'help@mongsil2.com';
const PRODUCT = PRODUCTS.pro_30d;

/** 무료 · PRO 비교 — docs/COMMERCIAL_READINESS.md 3단계 표와 같은 사실(바꾸면 둘 다) */
const COMPARE: { label: string; free: string; pro: string }[] = [
  { label: '여행 계획 · 협업 · 여행 중 화면', free: '✓', pro: '✓' },
  { label: 'AI 일정 · 장소 · 서류 요약', free: '✓', pro: '✓' },
  { label: 'AI 어시스턴트(내 서류·메모)', free: '✓', pro: '✓' },
  { label: 'AI 어시스턴트 웹 검색', free: '—', pro: '✓' },
  { label: '인생샷', free: '—', pro: '✓' },
  { label: '영수증·결제 캡처로 지출 추가', free: '—', pro: '✓' },
  { label: '지도 영역 검색(PC)', free: '하루 3번', pro: '하루 20번' },
  { label: '하루 AI 사용 횟수', free: '60번', pro: '150번' },
];

/** PRO에서 쓸 수 있는 기능 카드 — 숫자는 products.ts·api/ai.ts의 값과 같다 */
const FEATURES: { icon: string; bg: string; title: string; tag?: string; desc: string }[] = [
  { icon: '🔎', bg: '#EAF6FD', title: 'AI 어시스턴트 웹 검색', tag: '하루 20번 · 이용권당 100번', desc: '내 서류·메모에 없는 운영 시간, 입장료, 교통까지 웹에서 찾아 출처와 함께 답해요.' },
  { icon: '📸', bg: '#F4F0FE', title: '인생샷 장소 찾기', desc: '지금 있는 곳 근처의 사진 명소를 찾아 구글 지도에서 확인해 보여 줘요.' },
  { icon: '🧾', bg: '#EDFBF4', title: '영수증·결제 캡처로 지출 추가', desc: '사진만 올리면 가게·금액·통화를 읽어 지출 초안을 만들어 줘요.' },
  { icon: '🗺️', bg: '#FDF1F7', title: '지도 영역 검색', tag: 'PC · 하루 20번(무료 3번)', desc: '지도에서 영역을 그리면 그 안의 맛집·카페·관광지를 평점순으로 모아 보여 줘요.' },
  { icon: '⚡', bg: '#FFF6E7', title: 'AI 하루 사용 횟수 확대', desc: '일정 짜기, 장소 요약 등 AI를 하루 60번에서 150번까지 쓸 수 있어요.' },
];

/** 결제 전 고지 — 사용자 확정(2026-11-24). 바꾸면 약관 유료 조항(C-7)과 맞춘다 */
export const PURCHASE_NOTICE: string[] = [
  `${PRODUCT.name}은 ${PRODUCT.amount.toLocaleString('ko-KR')}원(부가세 포함)이며, 결제 즉시 ${PRODUCT.days}일 동안 이용할 수 있습니다.`,
  '자동으로 갱신되거나 다시 결제되지 않습니다.',
  `이용 중에 다시 구매하면 남은 기간에 ${PRODUCT.days}일, 웹 검색에 ${PRODUCT.web}번이 더해집니다.`,
  '결제 후 7일 이내이고 PRO 전용 기능(웹 검색, 인생샷, 영수증 AI 입력, 지도 영역 검색의 하루 4번째 이후 사용)을 사용하지 않았다면 전액 환불받을 수 있습니다.',
  'PRO 전용 기능을 사용한 뒤에는 디지털 콘텐츠의 특성상 청약철회가 제한됩니다.',
  '미성년자가 법정대리인의 동의 없이 결제한 경우 본인 또는 법정대리인이 취소할 수 있습니다.',
  `환불·문의: ${SUPPORT_EMAIL}`,
];

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function planStatusText(p: PlanInfo | null): { title: string; sub: string } {
  if (!p) return { title: '확인 중이에요', sub: '' };
  if (p.plan !== 'pro') return { title: '무료 이용 중', sub: 'PRO 이용권으로 웹 검색·인생샷·영수증 AI를 쓰고, 지도 영역 검색을 하루 20번까지 쓸 수 있어요.' };
  const parts: string[] = [];
  parts.push(p.expiresAt ? fmtDate(p.expiresAt) + '까지' : '기간 제한 없음');
  if (p.webLeft !== null) parts.push('웹 검색 남은 ' + p.webLeft + '번');
  return { title: 'PRO 이용 중', sub: parts.join(' · ') };
}

function refundMailto(paymentId: string): string {
  const body = '결제 번호: ' + paymentId + '\n환불 사유: \n\n(결제 후 7일 이내이고 PRO 전용 기능을 사용하지 않은 경우 전액 환불됩니다.)';
  return 'mailto:' + SUPPORT_EMAIL + '?subject=' + encodeURIComponent('[몽실이] 환불 요청') + '&body=' + encodeURIComponent(body);
}

function historyHtml(rows: PaymentHistoryRow[] | null): string {
  if (rows === null) return '<p class="st-note">결제 내역을 불러오지 못했어요.</p>';
  if (!rows.length) return '<p class="st-note">아직 결제 내역이 없어요.</p>';
  return (
    '<ul class="pro-hist">' +
    rows
      .map((r) => {
        const method = payMethodName(r.pay_method);
        const state = r.status === 'cancelled' ? '환불됨' : '결제 완료';
        return (
          '<li class="pro-hist-row">' +
          '<div class="pro-hist-main"><span class="pro-hist-date">' + esc(fmtDate(r.granted_at ?? r.created_at)) + '</span>' +
          '<span class="pro-hist-amt">' + r.amount.toLocaleString('ko-KR') + '원' + (method ? ' · ' + esc(method) : '') + '</span></div>' +
          '<div class="pro-hist-side"><span class="pro-hist-state' + (r.status === 'cancelled' ? ' is-off' : '') + '">' + state + '</span>' +
          (r.status === 'paid' ? '<a class="pro-hist-refund" href="' + esc(refundMailto(r.payment_id)) + '">환불 요청</a>' : '') + '</div>' +
          '<div class="pro-hist-id st-mono">' + esc(r.payment_id) + '</div>' +
          '</li>'
        );
      })
      .join('') +
    '</ul>'
  );
}

const METHOD_ICONS: Record<string, string> = { card: '💳', tosspay: '🅣', kakaopay: '💬' };

/** 결제 카드 안쪽 — 가격 · 혜택 · 결제 수단 · 결제 버튼 · 고지. 결제 설정이 없으면 가격만 보여 주고 고지·버튼은 열지 않는다 */
function buyHtml(configured: boolean, isPro: boolean): string {
  const amount = PRODUCT.amount.toLocaleString('ko-KR');
  const head = [
    '<p class="pro-pname">' + esc(PRODUCT.name) + '</p>',
    '<div class="pro-price"><b class="pro-price-num">' + amount + '</b><span class="pro-price-unit">원</span></div>',
    '<p class="pro-vat">부가세 포함 · ' + PRODUCT.days + '일 이용 · 자동 갱신 없음</p>',
    '<div class="pro-chips">' + ['웹 검색 ' + PRODUCT.web + '번', '인생샷', '영수증 AI', '영역 검색 하루 20번', 'AI 하루 150번'].map((c) => '<span class="pro-chip">' + esc(c) + '</span>').join('') + '</div>',
  ].join('');
  if (!configured) {
    return head + '<button type="button" class="pro-cta" disabled>결제 준비 중이에요</button><p class="pro-fine">열리면 이 화면에서 바로 구매할 수 있어요.</p>';
  }
  const perks = [
    '결제 즉시 ' + PRODUCT.days + '일 동안 모든 PRO 기능 이용',
    '이용 중 다시 구매하면 남은 기간에 ' + PRODUCT.days + '일, 웹 검색에 ' + PRODUCT.web + '번이 더해져요',
    '결제 후 7일 이내 PRO 기능을 쓰지 않았다면 전액 환불',
  ];
  return [
    head,
    '<ul class="pro-perks">' + perks.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>',
    isPro ? '<p class="pro-owned">이미 PRO를 쓰고 있어요. 지금 구매하면 이어서 더해져요.</p>' : '',
    '<div class="pro-methods" role="radiogroup" aria-label="결제 수단">' +
      PAY_METHODS.map((m, i) =>
        '<button type="button" class="pro-method' + (i === 0 ? ' on' : '') + '" role="radio" aria-checked="' + (i === 0 ? 'true' : 'false') + '" data-method="' + m.key + '">' +
        '<i>' + (METHOD_ICONS[m.key] ?? '') + '</i>' + esc(m.key === 'card' ? '카드' : m.label) + '</button>').join('') +
    '</div>',
    '<button type="button" class="pro-cta" id="pro-pay" disabled>' + amount + '원 결제하기</button>',
    '<label class="pro-agree"><input type="checkbox" id="pro-agree" /><span>결제 내용과 환불 기준을 확인했으며, <a href="#terms" target="_blank" rel="noopener">이용약관</a>에 동의해요.</span></label>',
    '<p class="pro-msg" id="pro-msg" role="status"></p>',
    // 결제 전 고지 전문 — 사용자 확정 문구라 줄이지 않고 그대로 보여 준다
    '<ul class="pro-notice">' + PURCHASE_NOTICE.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>',
  ].join('');
}

/** 환불 판단 자료 한 덩어리 — 기준: 결제 후 7일 이내 + PRO 전용 기능 미사용 */
export function reviewHtml(r: RefundReview): string {
  if (r.error) return '<p class="pro-msg">' + esc(r.error) + '</p>';
  if (r.status === 'cancelled') return '<p class="st-note">' + (r.already ? '이미 환불된 결제예요.' : '환불했어요. 이용권도 회수했어요.') + '</p>';
  const use = r.proUseSincePaid === null || r.proUseSincePaid === undefined ? '확인 불가' : r.proUseSincePaid + '번';
  return [
    '<dl class="pro-admin-dl">',
    '<dt>결제자</dt><dd>' + esc(r.buyerEmail ?? '(알 수 없음)') + '</dd>',
    '<dt>금액</dt><dd>' + (r.amount ?? 0).toLocaleString('ko-KR') + '원</dd>',
    '<dt>결제일</dt><dd>' + esc(fmtDate(r.paidAt ?? null)) + ' (' + (r.daysSincePaid ?? '?') + '일 지남)</dd>',
    '<dt>결제 후 PRO 기능 사용</dt><dd>' + esc(use) + '</dd>',
    '<dt>환불 기준</dt><dd><b>' + (r.withinPolicy ? '기준 안 — 전액 환불 대상' : '기준 밖 — 운영 절차 문서의 예외 판단') + '</b></dd>',
    '</dl>',
    '<button type="button" class="st-btn st-btn-danger" id="pro-admin-go">이 결제 환불하기</button>',
  ].join('');
}

function adminCardHtml(): string {
  return `
    <section class="st-card pro-admin">
      <h2 class="st-h2">관리자 · 결제 처리</h2>
      <p class="st-note">관리자에게만 보여요. 처리 기준과 순서는 운영 절차 문서(docs/PAYMENT_OPERATIONS.md)를 따라 주세요.</p>
      <input class="st-input" id="pro-admin-id" placeholder="결제 번호 (mongsil-…)" autocomplete="off" />
      <input class="st-input" id="pro-admin-reason" placeholder="환불 사유 (예: 단순 변심, 7일 이내 미사용)" autocomplete="off" />
      <div class="pro-admin-acts">
        <button type="button" class="st-btn" id="pro-admin-review">환불 검토</button>
        <button type="button" class="st-btn" id="pro-admin-recheck">반영 다시 확인</button>
      </div>
      <div id="pro-admin-out"></div>
    </section>`;
}

function bindAdmin(root: HTMLElement): void {
  const out = root.querySelector('#pro-admin-out') as HTMLElement;
  const idOf = () => ((root.querySelector('#pro-admin-id') as HTMLInputElement).value || '').trim();
  const reasonOf = () => ((root.querySelector('#pro-admin-reason') as HTMLInputElement).value || '').trim();
  root.querySelector('#pro-admin-review')?.addEventListener('click', async () => {
    const id = idOf();
    if (!id) return;
    out.innerHTML = '<p class="st-note">확인 중…</p>';
    const r = await adminRefund(id, reasonOf(), false);
    out.innerHTML = reviewHtml(r);
    out.querySelector('#pro-admin-go')?.addEventListener('click', async () => {
      if (!reasonOf()) {
        out.insertAdjacentHTML('beforeend', '<p class="pro-msg">환불 사유를 적어 주세요.</p>');
        return;
      }
      if (!window.confirm(id + ' 결제를 환불할까요? 포트원에서 결제가 취소되고 이용권이 회수돼요. 되돌릴 수 없어요.')) return;
      out.innerHTML = '<p class="st-note">환불하는 중…</p>';
      out.innerHTML = reviewHtml(await adminRefund(id, reasonOf(), true));
    });
  });
  root.querySelector('#pro-admin-recheck')?.addEventListener('click', async () => {
    const id = idOf();
    if (!id) return;
    out.innerHTML = '<p class="st-note">포트원에 다시 확인하는 중…</p>';
    const r = await adminRecheck(id);
    const label: Record<string, string> = {
      paid: '결제 완료 — 이용권이 반영돼 있어요.',
      pending: '아직 결제 승인 전이에요.',
      failed: '결제가 완료되지 않은 주문이에요(실패·취소).',
      mismatch: '금액·상점·채널이 맞지 않아 반영하지 않았어요(' + (r.reason ?? '') + '). 포트원 콘솔에서 확인해 주세요.',
      cancelled: '환불된 결제예요.',
      error: '포트원 또는 DB 확인에 실패했어요. 잠시 뒤 다시 시도해 주세요.',
    };
    out.innerHTML = '<p class="st-note">' + esc(r.error ?? label[r.status] ?? r.status) + (r.buyerEmail ? ' · ' + esc(r.buyerEmail) : '') + '</p>';
  });
}

export function renderProPage(): HTMLElement {
  window.scrollTo(0, 0);
  const cfg = payConfig();
  const el = document.createElement('div');
  el.className = 'st-page pro-page';
  el.innerHTML = `
    <div class="pro-wrap">
      <button type="button" class="pro-back" id="pro-back">← 돌아가기</button>
      <div class="pro-banner" id="pro-banner" hidden></div>
      <header class="pro-hero">
        <span class="pro-eyebrow">MONGSIL PRO</span>
        <h1 class="pro-title">여행 중 궁금한 걸,<br>더 빠르게 찾아요</h1>
        <p class="pro-sub">PRO ${PRODUCT.days}일 이용권 하나로 웹 검색 어시스턴트, 인생샷, 영수증 AI를 쓰고 영역 검색도 하루 20번까지 써요.<br>자동으로 갱신되지 않아서, 필요한 여행 동안만 쓰면 돼요.</p>
        <div class="pro-status" id="pro-status"><b>확인 중이에요</b></div>
      </header>

      <div class="pro-grid">
        <section class="pro-card pro-features">
          <h2 class="pro-h2">PRO에서 쓸 수 있는 기능</h2>
          ${FEATURES.map((f) => `
          <div class="pro-feat">
            <div class="pro-feat-ic" style="background:${f.bg}" aria-hidden="true">${f.icon}</div>
            <div><h3>${esc(f.title)}${f.tag ? `<span class="pro-tag">${esc(f.tag)}</span>` : ''}</h3><p>${esc(f.desc)}</p></div>
          </div>`).join('')}
          <h2 class="pro-h2 pro-cmp-h">무료 · PRO 한눈에 비교</h2>
          <table class="pro-compare">
            <thead><tr><th></th><th>무료</th><th>PRO</th></tr></thead>
            <tbody>${COMPARE.map((r) => `<tr><td>${esc(r.label)}</td><td${r.free === '—' ? ' class="is-no"' : ''}>${esc(r.free)}</td><td class="is-pro">${esc(r.pro)}</td></tr>`).join('')}</tbody>
          </table>
        </section>

        <aside class="pro-card pro-buy" id="pro-buy">
          <div id="pro-buy-body">${buyHtml(!!cfg, false)}</div>
          <p class="pro-contact"><a href="#terms" target="_blank" rel="noopener">이용약관</a> · <a href="#privacy" target="_blank" rel="noopener">개인정보처리방침</a></p>
        </aside>
      </div>

      <section class="pro-card pro-history-card">
        <h2 class="pro-h2">결제 내역</h2>
        <div id="pro-history"><p class="st-note">불러오는 중…</p></div>
        <p class="st-note">카드 영수증은 결제한 카드사·간편결제 앱에서 확인할 수 있어요. 탈퇴하면 남은 이용권은 사라지고 환불되지 않으니, 환불 기준에 해당하면 탈퇴 전에 요청해 주세요.</p>
      </section>
      ${businessFooterHtml()}
    </div>`;

  el.querySelector('#pro-back')!.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else navigate('trips');
  });

  const banner = el.querySelector('#pro-banner') as HTMLElement;
  const showBanner = (kind: 'ok' | 'wait' | 'err', text: string) => {
    banner.hidden = false;
    banner.className = 'pro-banner is-' + kind;
    banner.textContent = text;
  };
  // 잠긴 PRO 기능을 눌러서 왔으면 어떤 기능인지 알려 주는 안내 띠(결제 결과 안내가 생기면 그것으로 바뀐다)
  const from = takeProEntry();
  if (from) {
    banner.hidden = false;
    banner.className = 'pro-banner is-info';
    banner.innerHTML = '<span class="pro-dot" aria-hidden="true"></span><span><b>' + esc(PRO_FEATURE_NAMES[from]) + '</b>은 PRO 기능이에요. 이용권을 구매하면 바로 쓸 수 있어요.</span>';
  }

  const refresh = async () => {
    const [p, rows] = await Promise.all([fetchMyPlanInfo(), fetchPaymentHistory()]);
    const s = planStatusText(p);
    const statusEl = el.querySelector('#pro-status');
    if (statusEl) statusEl.innerHTML = '<b>' + esc(s.title) + '</b>' + (s.sub ? '<span>' + esc(s.sub) + '</span>' : '');
    const hist = el.querySelector('#pro-history');
    if (hist) hist.innerHTML = historyHtml(rows);
    if (p.admin && !el.querySelector('.pro-admin')) {
      el.querySelector('.pro-wrap')?.insertAdjacentHTML('beforeend', adminCardHtml());
      bindAdmin(el);
    }
    const body = el.querySelector('#pro-buy-body');
    if (body && cfg) {
      body.innerHTML = buyHtml(true, p.plan === 'pro');
      bindBuy();
    }
  };

  let method: PayMethodKey = PAY_METHODS[0].key;
  const setBusy = (busy: boolean) => {
    const cta = el.querySelector<HTMLButtonElement>('#pro-pay');
    const agreed = (el.querySelector('#pro-agree') as HTMLInputElement | null)?.checked ?? false;
    if (cta) cta.disabled = busy || !agreed;
  };

  const bindBuy = () => {
    method = PAY_METHODS[0].key;
    el.querySelector('#pro-agree')?.addEventListener('change', () => setBusy(false));
    el.querySelectorAll<HTMLButtonElement>('.pro-method').forEach((tile) => {
      tile.addEventListener('click', () => {
        method = tile.dataset.method as PayMethodKey;
        el.querySelectorAll<HTMLButtonElement>('.pro-method').forEach((t) => {
          const on = t === tile;
          t.classList.toggle('on', on);
          t.setAttribute('aria-checked', String(on));
        });
      });
    });
    el.querySelector('#pro-pay')?.addEventListener('click', async () => {
      const msg = el.querySelector('#pro-msg') as HTMLElement | null;
      setBusy(true);
      if (msg) msg.textContent = '결제창을 여는 중이에요…';
      try {
        const r = await startCheckout(PRODUCT.id, method);
        if (r.kind === 'paid') {
          showBanner('ok', '결제가 완료됐어요. PRO를 바로 쓸 수 있어요.');
          if (msg) msg.textContent = '';
          await refresh();
        } else if (r.kind === 'pending') {
          showBanner('wait', r.message);
          if (msg) msg.textContent = '';
        } else if (msg) {
          msg.textContent = r.message;
        }
      } catch {
        if (msg) msg.textContent = '결제창을 열지 못했어요. 잠시 후 다시 시도해 주세요.';
      } finally {
        setBusy(false);
      }
    });
  };
  if (cfg) bindBuy();

  // 휴대폰 결제창에서 돌아온 경우(/pay/done → main.ts → #pro)
  const ret = takePayReturn();
  void (async () => {
    if (ret) {
      if (ret.code) {
        showBanner('err', ret.message || '결제가 완료되지 않았어요.');
      } else {
        showBanner('wait', '결제를 확인하고 있어요…');
        const r = await completePayment(ret.paymentId);
        if (r.kind === 'paid') showBanner('ok', '결제가 완료됐어요. PRO를 바로 쓸 수 있어요.');
        else if (r.kind === 'pending') showBanner('wait', r.message);
        else showBanner('err', r.message + ' (결제 번호 ' + ret.paymentId + ')');
      }
    }
    await refresh();
  })();
  return el;
}
