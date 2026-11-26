/**
 * 유료 조항 스위치(VITE_PAID_TERMS)와 사업자 정보 표시.
 * 결제를 여는 날 켜는 스위치 하나로 약관 본문·방침·버전(재동의)이 함께 바뀌는지 지킨다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { businessReady, businessFooterHtml, BUSINESS_INFO } from './business';
import { PURCHASE_NOTICE } from '../pay/pro';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('유료 조항 스위치', () => {
  it('꺼져 있으면: 버전은 그대로(draft2), 유료 조항은 "시행 예정"으로 묶여 보인다', async () => {
    vi.stubEnv('VITE_PAID_TERMS', '');
    vi.resetModules();
    const v = await import('./versions');
    const l = await import('./legal');
    expect(v.PAID_TERMS_LIVE).toBe(false);
    expect(v.TERMS_VERSION).toBe('2026-11-draft2');
    const terms = l.termsHtml();
    expect(terms).toContain('유료 서비스(PRO 이용권 결제)를 시작할 때 적용됩니다.');
    expect(terms).toContain('제12조 (유료 서비스 — PRO 이용권)');
    expect(terms).toContain('제16조 (분쟁의 해결)');
    expect(l.privacyHtml()).toContain('lg-pending');
  });

  it('켜면: 버전이 올라가(재동의) 유료 조항이 본문이 되고, 방침에 결제 기록 5년 보관이 들어간다', async () => {
    vi.stubEnv('VITE_PAID_TERMS', 'on');
    vi.resetModules();
    const v = await import('./versions');
    const l = await import('./legal');
    expect(v.PAID_TERMS_LIVE).toBe(true);
    expect(v.TERMS_VERSION).not.toBe('2026-11-draft2');
    expect(v.PRIVACY_VERSION).not.toBe('2026-11-draft2');
    expect(l.termsHtml()).not.toContain('lg-pending');
    const privacy = l.privacyHtml();
    expect(privacy).not.toContain('lg-pending');
    expect(privacy).toContain('5년 — 회원 탈퇴 후에도 보관');
    expect(privacy).toContain('계정과의 연결은 끊고 결제자 이메일만 남깁니다');
  });

  it('약관 유료 조항이 결제 전 고지(확정 문구)와 같은 사실을 말한다', async () => {
    const l = await import('./legal');
    const terms = l.termsHtml();
    expect(PURCHASE_NOTICE.join(' ')).toContain('자동으로 갱신되거나 다시 결제되지 않습니다');
    expect(terms).toContain('자동으로 갱신되거나 다시 결제되지 않습니다');
    expect(terms).toContain('7일 이내');
    expect(terms).toContain('웹 검색, 인생샷, 영수증 AI 입력, 지도 영역 검색의 하루 4번째 이후 사용');
    expect(terms).toContain('4,900원');
  });
});

describe('사업자 정보', () => {
  it('지금은 비어 있어 화면 아래 표시를 그리지 않는다(빈 자리표시는 틀린 정보보다 낫다)', () => {
    expect(businessReady()).toBe(false);
    expect(businessFooterHtml()).toBe('');
    expect(BUSINESS_INFO.email).toBe('help@mongsil2.com');
  });
  it('다 채우면 표시하고, 값은 이스케이프한다', () => {
    const info = { name: '몽실<b>', ceo: '홍길동', regNo: '123-45-67890', mailOrderNo: '제2026-서울-0000호', address: '서울', phone: '02-000-0000', email: 'help@mongsil2.com', hosting: 'Cloudflare, Inc.' };
    expect(businessReady(info)).toBe(true);
    const html = businessFooterHtml(info);
    expect(html).toContain('사업자등록번호 123-45-67890');
    expect(html).toContain('몽실&lt;b&gt;');
  });
});
