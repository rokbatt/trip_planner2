/**
 * 통화 테스트 — 여행지 이름 → 현지 통화, 금액 표기.
 *
 * 핵심은 "모르면 짐작하지 않는다"(원칙 3-1)다. 예전에는 목록에 없는 여행지가 전부 USD로 나와서
 * 터키가 "$"로 보였다. 반대로 알아야 하는 곳(한국 사람이 많이 가는 곳)은 놓치지 않아야 한다.
 */

import { describe, expect, it } from 'vitest';
import { CURRENCIES, currencyForDestination, fmtAmount, fmtAmountWithCode, isSupportedCurrency, isZeroDecimal, symbolOf } from './currencies';

describe('currencyForDestination', () => {
  const cases: Array<[string, string]> = [
    ['방콕', 'THB'], ['푸켓', 'THB'], ['도쿄', 'JPY'], ['오사카', 'JPY'], ['다낭', 'VND'], ['타이베이', 'TWD'],
    ['프라하', 'CZK'], ['부다페스트', 'HUF'], ['바르샤바', 'PLN'], ['이스탄불', 'TRY'], ['런던', 'GBP'],
    ['파리', 'EUR'], ['로마', 'EUR'], ['빈', 'EUR'], ['비엔나', 'EUR'], ['취리히', 'CHF'],
    ['뉴욕', 'USD'], ['하와이', 'USD'], ['괌', 'USD'], ['시드니', 'AUD'], ['두바이', 'AED'], ['카이로', 'EGP'],
    ['울란바토르', 'MNT'], ['제주', 'KRW'], ['서울', 'KRW'], ['스톡홀름', 'SEK'], ['오슬로', 'NOK'], ['코펜하겐', 'DKK'],
    ['상하이', 'CNY'], ['싱가포르', 'SGD'], ['홍콩', 'HKD'], ['쿠알라룸푸르', 'MYR'], ['발리', 'IDR'], ['세부', 'PHP'], ['델리', 'INR'],
  ];
  for (const [name, code] of cases) {
    it(`${name} → ${code}`, () => expect(currencyForDestination(name)).toBe(code));
  }

  it('예전에 USD로 잘못 나오던 곳들 — 터키·헝가리·폴란드·북유럽·몽골·국내', () => {
    for (const n of ['이스탄불', '부다페스트', '바르샤바', '스톡홀름', '울란바토르', '제주도']) {
      expect(currencyForDestination(n), n).not.toBe('USD');
      expect(currencyForDestination(n), n).not.toBeNull();
    }
  });

  it('모르는 여행지는 null — USD로 짐작하지 않는다', () => {
    expect(currencyForDestination('아무도 모르는 마을')).toBeNull();
    expect(currencyForDestination('')).toBeNull();
    expect(currencyForDestination(null)).toBeNull();
    expect(currencyForDestination(undefined)).toBeNull();
  });

  it('표기가 조금 달라도 알아본다 — 시·섬·나라 붙여 쓰기', () => {
    expect(currencyForDestination('방콕시')).toBe('THB');
    expect(currencyForDestination('도쿄 여행')).toBe('JPY');
    expect(currencyForDestination('제주도')).toBe('KRW');
    expect(currencyForDestination('Bangkok')).toBe('THB');
    expect(currencyForDestination('PARIS')).toBe('EUR');
  });

  it('여러 곳을 적으면 먼저 적은 곳 기준 — 쉼표·가운뎃점·슬래시', () => {
    expect(currencyForDestination('방콕, 푸켓')).toBe('THB');
    expect(currencyForDestination('프라하,빈')).toBe('CZK');
    expect(currencyForDestination('파리·니스')).toBe('EUR');
    expect(currencyForDestination('오사카/교토')).toBe('JPY');
    expect(currencyForDestination('동유럽,이탈리아')).toBe('EUR'); // "동유럽"은 몰라도 다음 곳으로 넘어간다
  });

  it('긴 이름이 짧은 이름보다 먼저 — "인도네시아"는 "인도"(INR)가 아니다', () => {
    expect(currencyForDestination('인도네시아')).toBe('IDR');
    expect(currencyForDestination('인도')).toBe('INR');
  });

  it('짧은 키워드가 엉뚱한 단어에 걸리지 않는다 — "빈탄"은 빈(빈)이 아니고 "laos"는 la(LA)가 아니다', () => {
    expect(currencyForDestination('빈탄')).toBeNull();
    expect(currencyForDestination('laos')).toBeNull();
    expect(currencyForDestination('ukraine')).toBeNull();
    expect(currencyForDestination('la')).toBe('USD');
  });

  it('돌려주는 통화는 모두 지출에서 고를 수 있다 — 화면끼리 어긋나지 않는다', () => {
    // ROUTE는 파운드·위안을 보여 주는데 지출에는 입력할 수 없던 불일치의 재발 방지
    for (const [name] of cases) expect(isSupportedCurrency(currencyForDestination(name)!), name).toBe(true);
  });
});

describe('통화 목록', () => {
  it('코드가 중복되지 않는다', () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('한국 여행자가 자주 가는 곳의 통화가 들어 있다', () => {
    for (const c of ['KRW', 'THB', 'JPY', 'USD', 'EUR', 'TWD', 'VND', 'GBP', 'CNY', 'CZK', 'CHF', 'AUD', 'AED', 'MYR', 'TRY']) {
      expect(isSupportedCurrency(c), c).toBe(true);
    }
  });
});

describe('금액 표기', () => {
  it('원·엔·동·루피아는 정수, 나머지는 소수를 살린다', () => {
    expect(isZeroDecimal('JPY')).toBe(true);
    expect(isZeroDecimal('EUR')).toBe(false);
    expect(fmtAmount(1234.6, 'JPY')).toBe('¥1,235');
    expect(fmtAmount(2.5, 'EUR')).toBe('€2.5');
    expect(fmtAmount(2.45, 'GBP')).toBe('£2.45');
  });

  it('기호가 없는 통화는 코드로', () => {
    expect(symbolOf('BHD')).toBe('BHD ');
    expect(fmtAmount(100, 'BHD')).toBe('BHD 100');
  });

  it('코드를 붙여 쓰는 자리', () => {
    expect(fmtAmountWithCode(2.5, 'EUR')).toBe('2.5 EUR');
    expect(fmtAmountWithCode(276, 'THB')).toBe('276 THB');
    expect(fmtAmountWithCode(1500.4, 'VND')).toBe('1,500 VND');
  });
});
