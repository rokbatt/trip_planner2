/**
 * 사업자 신원 정보 — 한 곳에서 관리한다(약관 문의란 · 방침 · 화면 아래 표시가 모두 여기서 읽는다).
 *
 * 전자상거래법상 통신판매업자는 상호·대표자·주소·전화번호·전자우편·사업자등록번호·통신판매업 신고번호·
 * 이용약관·호스팅 사업자를 표시해야 한다(제10조·제13조 — 정확한 항목은 공정위 안내로 확인 필요).
 *
 * 값이 하나라도 비어 있으면 화면 아래 표시(businessFooterHtml)는 아무것도 그리지 않는다 —
 * 자리표시용 번호는 "비어 있는 것"이 아니라 "틀린 것"이라 없는 것보다 나쁘다(랜딩 푸터 주석과 같은 원칙).
 * 약관·방침 본문에서는 빈 칸을 [ ]로 눈에 띄게 표시한다.
 *
 * 사업자등록·통신판매업 신고가 끝나면 사용자가 정한 값으로 채운다(Claude가 추측해 넣지 않는다).
 */
import { escapeHtml as esc } from '../utils/html';

export interface BusinessInfo {
  /** 상호 */
  name: string;
  /** 대표자 */
  ceo: string;
  /** 사업자등록번호 000-00-00000 */
  regNo: string;
  /** 통신판매업 신고번호 */
  mailOrderNo: string;
  /** 사업장 주소 */
  address: string;
  /** 전화번호 */
  phone: string;
  /** 전자우편 */
  email: string;
  /** 호스팅 서비스 제공자 */
  hosting: string;
}

export const BUSINESS_INFO: BusinessInfo = {
  name: '몽실이',
  ceo: '오성현',
  regNo: '',
  mailOrderNo: '',
  address: '',
  phone: '',
  email: 'help@mongsil2.com',
  hosting: 'Cloudflare, Inc.',
};

/** 표시해야 하는 항목이 전부 채워졌는가 */
export function businessReady(info: BusinessInfo = BUSINESS_INFO): boolean {
  return (Object.keys(info) as (keyof BusinessInfo)[]).every((k) => info[k].trim() !== '');
}

/** 화면 아래 사업자 정보 한 덩어리 — 다 채워지기 전엔 빈 문자열 */
export function businessFooterHtml(info: BusinessInfo = BUSINESS_INFO): string {
  if (!businessReady(info)) return '';
  return (
    '<div class="biz-info">' +
    esc(info.name) + ' · 대표 ' + esc(info.ceo) + ' · 사업자등록번호 ' + esc(info.regNo) + ' · 통신판매업 신고 ' + esc(info.mailOrderNo) + '<br>' +
    esc(info.address) + ' · ' + esc(info.phone) + ' · ' + esc(info.email) + '<br>' +
    '호스팅 ' + esc(info.hosting) +
    '</div>'
  );
}
