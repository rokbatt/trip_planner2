/**
 * 통화 — 코드·기호·소수 자리·표기, 그리고 "이 여행지의 현지 통화는 무엇인가".
 *
 * 예전에는 통화 목록이 세 곳에 따로 있었다(지출 11개, 호텔 가격 6개, ROUTE 추정 20여 개).
 * 서로 어긋나서 ROUTE는 파운드·위안으로 보여 주는데 지출에는 그 통화를 입력할 수 없었다.
 * 이제 이 파일 하나를 모두가 쓴다.
 *
 * 원칙 3-1: 국가의 공식 통화(ISO 4217)는 사실 데이터라 쓸 수 있다. 하지만 목록에 없는 여행지의
 * 통화를 특정 나라로 짚어 맞추지 않는다 — currencyForDestination은 모르면 null을 돌려준다
 * (예전엔 모르면 USD로 폴백해서 터키가 "$"로 나왔다).
 */

export interface CurrencyInfo {
  code: string;
  symbol: string;
  /** 한글 이름 — 선택 목록에서 코드만으로는 모르는 사람을 위해 */
  name: string;
  /** 소수점 아래를 쓰지 않는 통화(원·엔·동…) — 금액을 정수로 보여 준다 */
  zeroDecimal?: boolean;
}

/**
 * 지출·호텔 가격 입력에서 고를 수 있는 통화. 앞쪽일수록 한국 여행자가 자주 쓴다.
 * 환율은 /api/exchange-rate가 가져오고, 거기서 못 구하면 사용자가 직접 입력할 수 있다.
 */
export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: 'KRW', symbol: '₩', name: '원', zeroDecimal: true },
  { code: 'THB', symbol: '฿', name: '태국 바트' },
  { code: 'JPY', symbol: '¥', name: '일본 엔', zeroDecimal: true },
  { code: 'USD', symbol: '$', name: '미국 달러' },
  { code: 'EUR', symbol: '€', name: '유로' },
  { code: 'TWD', symbol: 'NT$', name: '대만 달러' },
  { code: 'VND', symbol: '₫', name: '베트남 동', zeroDecimal: true },
  { code: 'SGD', symbol: 'S$', name: '싱가포르 달러' },
  { code: 'HKD', symbol: 'HK$', name: '홍콩 달러' },
  { code: 'PHP', symbol: '₱', name: '필리핀 페소' },
  { code: 'IDR', symbol: 'Rp', name: '인도네시아 루피아', zeroDecimal: true },
  { code: 'CNY', symbol: 'CN¥', name: '중국 위안' },
  { code: 'MYR', symbol: 'RM', name: '말레이시아 링깃' },
  { code: 'GBP', symbol: '£', name: '영국 파운드' },
  { code: 'CHF', symbol: 'CHF ', name: '스위스 프랑' },
  { code: 'CZK', symbol: 'Kč', name: '체코 코루나' },
  { code: 'HUF', symbol: 'Ft', name: '헝가리 포린트', zeroDecimal: true },
  { code: 'PLN', symbol: 'zł', name: '폴란드 즐로티' },
  { code: 'SEK', symbol: 'SEK ', name: '스웨덴 크로나' },
  { code: 'NOK', symbol: 'NOK ', name: '노르웨이 크로네' },
  { code: 'DKK', symbol: 'DKK ', name: '덴마크 크로네' },
  { code: 'TRY', symbol: '₺', name: '튀르키예 리라' },
  { code: 'AED', symbol: 'AED ', name: '아랍에미리트 디르함' },
  { code: 'INR', symbol: '₹', name: '인도 루피' },
  { code: 'AUD', symbol: 'A$', name: '호주 달러' },
  { code: 'NZD', symbol: 'NZ$', name: '뉴질랜드 달러' },
  { code: 'CAD', symbol: 'C$', name: '캐나다 달러' },
  { code: 'MXN', symbol: 'MX$', name: '멕시코 페소' },
  { code: 'EGP', symbol: 'EGP ', name: '이집트 파운드' },
  { code: 'MAD', symbol: 'MAD ', name: '모로코 디르함' },
  { code: 'MNT', symbol: '₮', name: '몽골 투그릭', zeroDecimal: true },
  { code: 'KZT', symbol: '₸', name: '카자흐스탄 텡게', zeroDecimal: true },
  { code: 'ZAR', symbol: 'R', name: '남아공 랜드' },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function isSupportedCurrency(code: string): boolean {
  return BY_CODE.has(code);
}

export function symbolOf(code: string): string {
  return BY_CODE.get(code)?.symbol ?? code + ' ';
}

export function isZeroDecimal(code: string): boolean {
  return BY_CODE.get(code)?.zeroDecimal === true;
}

/**
 * 금액 표기 — 통화마다 소수 자리가 다르다. 원·엔·동은 정수로, 나머지는 필요한 만큼(최대 2자리).
 * 유로 2.5를 "3"으로 반올림해 보여 주던 문제가 없도록, 소수가 있는 통화는 소수를 살린다.
 */
export function fmtAmount(amount: number, code: string): string {
  const num = isZeroDecimal(code)
    ? Math.round(amount).toLocaleString('ko-KR')
    : amount.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  return symbolOf(code) + num;
}

/** 기호 없이 "숫자 + 코드"로 — 교통비처럼 코드를 같이 적는 자리 */
export function fmtAmountWithCode(amount: number, code: string): string {
  const num = isZeroDecimal(code)
    ? Math.round(amount).toLocaleString('ko-KR')
    : amount.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  return num + ' ' + code;
}

/* ══════════════ 여행지 → 현지 통화 ══════════════ */

/**
 * [통화, 이 통화를 쓰는 나라·도시 이름들]. 이름은 사용자가 직접 입력하는 글자라 한글·영문·흔한 표기를
 * 함께 둔다. 한 글자 한글·3글자 이하 영문 키워드는 정확히 같을 때만 맞는다(예: "빈"이 "빈탄"에 걸리지 않게).
 * 일부만 알아도 되는 도시·나라를 늘려 가는 표다 — 목록에 없으면 null이고, 그때는 통화를 짐작하지 않는다.
 */
const DESTINATION_CURRENCY: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['KRW', ['한국', '대한민국', '국내', '서울', '인천', '부산', '제주', '대구', '대전', '광주', '울산', '강릉', '속초', '여수', '경주', '전주', '춘천', '포항', '통영', '거제', '남해', 'seoul', 'busan', 'jeju']],
  ['THB', ['태국', '방콕', '파타야', '푸켓', '푸껫', '치앙마이', '치앙라이', '끄라비', '코사무이', '후아힌', '코팡안', '코타오', 'thailand', 'bangkok', 'phuket', 'pattaya', 'chiang mai']],
  ['JPY', ['일본', '도쿄', '동경', '오사카', '교토', '나고야', '삿포로', '홋카이도', '후쿠오카', '오키나와', '히로시마', '센다이', '가고시마', '구마모토', '벳푸', '다카마쓰', '나가사키', '고베', '나라', '가나자와', '하코다테', '이시가키', '미야코지마', 'japan', 'tokyo', 'osaka', 'kyoto', 'fukuoka', 'okinawa']],
  ['VND', ['베트남', '다낭', '하노이', '호치민', '나트랑', '호이안', '푸꾸옥', '달랏', '후에', '사파', '하롱베이', '무이네', 'vietnam', 'da nang', 'hanoi']],
  ['TWD', ['대만', '타이완', '타이베이', '타이페이', '가오슝', '타이중', '타이난', '화롄', '지우펀', 'taiwan', 'taipei']],
  ['SGD', ['싱가포르', 'singapore']],
  ['HKD', ['홍콩', 'hong kong', 'hongkong']],
  ['CNY', ['중국', '베이징', '북경', '상하이', '상해', '광저우', '선전', '청두', '시안', '칭다오', '장가계', '하얼빈', '항저우', '충칭', '쿤밍', '난징', '샤먼', '구이린', '연길', '하이난', '싼야', 'china', 'beijing', 'shanghai']],
  ['MYR', ['말레이시아', '쿠알라룸푸르', '코타키나발루', '페낭', '랑카위', 'malaysia', 'kuala lumpur']],
  ['IDR', ['인도네시아', '발리', '자카르타', '롬복', '족자카르타', '우붓', 'indonesia', 'bali', 'jakarta']],
  ['PHP', ['필리핀', '세부', '마닐라', '보라카이', '팔라완', '보홀', '클락', 'philippines', 'cebu', 'manila']],
  ['INR', ['인도', '델리', '뭄바이', '고아', '자이푸르', '방갈로르', '첸나이', '콜카타', '바라나시', '아그라', 'india', 'delhi', 'mumbai']],
  ['MNT', ['몽골', '울란바토르', 'mongolia']],
  ['KZT', ['카자흐스탄', '알마티', '아스타나', 'kazakhstan', 'almaty']],
  ['AED', ['아랍에미리트', 'uae', '두바이', '아부다비', 'dubai', 'abu dhabi']],
  ['TRY', ['터키', '튀르키예', '이스탄불', '카파도키아', '안탈리아', '보드룸', '앙카라', 'turkey', 'turkiye', 'istanbul']],
  ['EGP', ['이집트', '카이로', '룩소르', '샤름엘셰이크', 'egypt', 'cairo']],
  ['MAD', ['모로코', '마라케시', '카사블랑카', 'morocco', 'marrakech']],
  ['ZAR', ['남아프리카공화국', '남아공', '케이프타운', '요하네스버그', 'south africa', 'cape town']],
  ['GBP', ['영국', '런던', '맨체스터', '에든버러', '글래스고', '리버풀', '옥스퍼드', '스코틀랜드', '잉글랜드', 'uk', 'england', 'london', 'edinburgh']],
  ['CHF', ['스위스', '취리히', '제네바', '인터라켄', '루체른', '바젤', 'switzerland', 'zurich', 'geneva']],
  ['CZK', ['체코', '프라하', '브르노', '체스키크룸로프', 'czech', 'czechia', 'prague']],
  ['HUF', ['헝가리', '부다페스트', 'hungary', 'budapest']],
  ['PLN', ['폴란드', '바르샤바', '크라쿠프', '그단스크', '브로츠와프', 'poland', 'warsaw', 'krakow']],
  ['SEK', ['스웨덴', '스톡홀름', '예테보리', 'sweden', 'stockholm']],
  ['NOK', ['노르웨이', '오슬로', '베르겐', '트롬쇠', 'norway', 'oslo']],
  ['DKK', ['덴마크', '코펜하겐', 'denmark', 'copenhagen']],
  [
    'EUR',
    [
      '유럽', '독일', '프랑스', '이탈리아', '스페인', '포르투갈', '네덜란드', '벨기에', '오스트리아', '그리스', '아일랜드', '핀란드', '크로아티아', '슬로베니아', '슬로바키아', '에스토니아', '라트비아', '리투아니아', '룩셈부르크', '몰타', '키프로스', '불가리아',
      '파리', '니스', '마르세유', '리옹', '보르도', '스트라스부르', '베를린', '뮌헨', '프랑크푸르트', '함부르크', '쾰른', '뒤셀도르프', '드레스덴', '뉘른베르크', '로마', '밀라노', '베네치아', '베니스', '피렌체', '나폴리', '볼로냐', '토리노', '팔레르모', '카타니아', '베로나',
      '바르셀로나', '마드리드', '세비야', '발렌시아', '마요르카', '이비자', '테네리페', '리스본', '포르투', '마데이라', '암스테르담', '브뤼셀', '브뤼헤', '빈', '비엔나', '잘츠부르크', '인스브루크', '아테네', '산토리니', '미코노스', '크레타', '더블린', '헬싱키', '자그레브', '두브로브니크', '스플리트', '류블랴나', '탈린', '리가', '빌뉴스', '소피아', '브라티슬라바',
      'europe', 'germany', 'france', 'italy', 'spain', 'portugal', 'paris', 'rome', 'berlin', 'barcelona', 'madrid', 'amsterdam', 'vienna', 'lisbon', 'athens',
    ],
  ],
  ['USD', ['미국', '뉴욕', '로스앤젤레스', 'la', '샌프란시스코', '라스베이거스', '라스베가스', '시카고', '보스턴', '워싱턴', '시애틀', '마이애미', '올랜도', '샌디에이고', '애틀랜타', '휴스턴', '달라스', '덴버', '피닉스', '필라델피아', '뉴올리언스', '앵커리지', '하와이', '호놀룰루', '오아후', '마우이', '카우아이', '괌', '사이판', '푸에르토리코', 'usa', 'new york', 'los angeles', 'hawaii', 'guam']],
  ['CAD', ['캐나다', '밴쿠버', '토론토', '몬트리올', '퀘벡', '캘거리', 'canada', 'vancouver', 'toronto']],
  ['MXN', ['멕시코', '멕시코시티', '칸쿤', '툴룸', 'mexico', 'cancun']],
  ['AUD', ['호주', '시드니', '멜버른', '브리즈번', '골드코스트', '케언스', '퍼스', '애들레이드', 'australia', 'sydney', 'melbourne']],
  ['NZD', ['뉴질랜드', '오클랜드', '퀸스타운', '웰링턴', '크라이스트처치', 'new zealand', 'auckland']],
];

/** 키워드 → 통화. 가장 긴 키워드가 이긴다("인도네시아"가 "인도"보다 먼저). */
const KEYWORD_INDEX: Array<{ k: string; code: string }> = [];
for (const [code, names] of DESTINATION_CURRENCY) for (const k of names) KEYWORD_INDEX.push({ k: k.toLowerCase(), code });
KEYWORD_INDEX.sort((a, b) => b.k.length - a.k.length);

/**
 * 여행지 이름(사용자가 직접 입력한 글자, 예: "방콕", "파리, 프랑스", "방콕·파타야")의 현지 통화.
 * 여러 곳을 적었으면 **먼저 적은 곳 중** 알아볼 수 있는 첫 곳을 기준으로 한다. 모르면 null.
 */
export function currencyForDestination(name: string | null | undefined): string | null {
  if (!name) return null;
  const tokens = name
    .toLowerCase()
    .split(/[,·/\\|()\[\]\-–—]+|\s{2,}/)
    .map((t) => t.trim())
    .filter(Boolean);
  for (const token of tokens) {
    // "파리 프랑스"처럼 띄어 쓴 경우를 위해 단어 단위로도 본다
    const words = token.includes(' ') ? [token, ...token.split(/\s+/)] : [token];
    for (const w of words) {
      // 짧은 영문 키워드(la, uk)는 정확히 같을 때만 — "laos"가 "la"에, "ukraine"이 "uk"에 걸리면 안 된다
      const hit = KEYWORD_INDEX.find(({ k }) => w === k || (k.length >= (/[가-힣]/.test(k) ? 2 : 4) && w.startsWith(k)));
      if (hit) return hit.code;
    }
  }
  return null;
}
