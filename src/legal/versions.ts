/**
 * 약관·방침의 "버전" — 동의 기록이 어느 문서에 대한 동의인지 가리키는 값.
 *
 * 문서 내용이 바뀌어 사용자가 다시 동의해야 하는 수준이면 **여기 값을 올린다.** 올리는 순간
 * 이미 가입한 사용자도 다음 접속 때 동의 창을 다시 보게 된다(account/consent.ts의 게이트).
 * 오타 수정처럼 의미가 안 바뀌는 고침에는 올리지 않는다.
 *
 * ⚠️ 지금 두 문서는 아직 법률 검토 전 초안이다(legal.ts 상단 참고). 정식 문서로 확정하면
 *    이 값을 반드시 올려서, "초안에 동의한 기록"이 "정식 문서에 동의한 기록"으로 오해되지 않게 한다.
 *
 * legal.ts(문서 본문)는 지연 로드되는 큰 청크라, 로그인 화면이 이 값만 쓰려고 그걸 끌어오지
 * 않도록 상수를 따로 둔다.
 */

export const TERMS_VERSION = '2026-11-draft2';
export const PRIVACY_VERSION = '2026-11-draft2';

/** 동의 창에 나오는 항목 — 법이 "각각 따로" 받으라고 하는 것들을 한 줄씩 나눠 둔다. */
export interface ConsentItem {
  key: 'age' | 'terms' | 'privacy';
  required: true;
  label: string;
  /** 문서 링크가 있는 항목만 */
  href?: string;
}

export const CONSENT_ITEMS: readonly ConsentItem[] = [
  { key: 'age', required: true, label: '만 14세 이상입니다.' },
  { key: 'terms', required: true, label: '이용약관에 동의합니다.', href: '/terms' },
  { key: 'privacy', required: true, label: '개인정보 수집 및 이용에 동의합니다.', href: '/privacy' },
];
