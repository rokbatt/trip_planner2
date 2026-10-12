/**
 * 여행지(한글 도시명) → IATA 공항코드 + 영문 도시명 매핑.
 *
 * 원래 trip-list.ts와 workspace.ts에 같은 표가 각각 복사돼 있어서, 한쪽에만 도시를
 * 추가하면 다른 화면에서는 여전히 폴백(앞 3글자 자르기)이 걸리는 문제가 있었다
 * (예: "프라하" → PRG가 아니라 "프라하"로 표시). 그래서 한 곳으로 합쳤다.
 *
 * 매핑에 없는 도시는 지금까지처럼 앞 3글자를 대문자로 잘라 쓴다 — 표에 없다고 화면이
 * 깨지지는 않되, 자주 쓰는 여행지는 여기에 추가하면 바로 제대로 표시된다.
 */

interface AirportInfo {
  /** IATA 3-letter 코드 */
  code: string;
  /** 보딩패스 스텁에 함께 찍는 영문 도시명 */
  en: string;
}

/* 한 도시에 공항이 여러 개면 여행자가 가장 많이 쓰는 관문 공항 하나로 통일한다
   (예: 도쿄는 NRT/HND 둘 다지만 NRT, 서울은 ICN). */
const CITY_TO_AIRPORT: Record<string, AirportInfo> = {
  /* ── 한국 ── */
  '서울': { code: 'ICN', en: 'SEOUL' },
  '인천': { code: 'ICN', en: 'INCHEON' },
  '김포': { code: 'GMP', en: 'SEOUL' },
  '부산': { code: 'PUS', en: 'BUSAN' },
  '제주': { code: 'CJU', en: 'JEJU' },
  '대구': { code: 'TAE', en: 'DAEGU' },

  /* ── 일본 ── */
  '도쿄': { code: 'NRT', en: 'TOKYO' },
  '동경': { code: 'NRT', en: 'TOKYO' },
  '오사카': { code: 'KIX', en: 'OSAKA' },
  '교토': { code: 'KIX', en: 'KYOTO' },
  '나고야': { code: 'NGO', en: 'NAGOYA' },
  '삿포로': { code: 'CTS', en: 'SAPPORO' },
  '홋카이도': { code: 'CTS', en: 'HOKKAIDO' },
  '후쿠오카': { code: 'FUK', en: 'FUKUOKA' },
  '오키나와': { code: 'OKA', en: 'OKINAWA' },
  '히로시마': { code: 'HIJ', en: 'HIROSHIMA' },
  '센다이': { code: 'SDJ', en: 'SENDAI' },
  '가고시마': { code: 'KOJ', en: 'KAGOSHIMA' },
  '구마모토': { code: 'KMJ', en: 'KUMAMOTO' },
  '벳푸': { code: 'OIT', en: 'OITA' },
  '다카마쓰': { code: 'TAK', en: 'TAKAMATSU' },

  /* ── 중화권 ── */
  '베이징': { code: 'PEK', en: 'BEIJING' },
  '북경': { code: 'PEK', en: 'BEIJING' },
  '상하이': { code: 'PVG', en: 'SHANGHAI' },
  '상해': { code: 'PVG', en: 'SHANGHAI' },
  '광저우': { code: 'CAN', en: 'GUANGZHOU' },
  '선전': { code: 'SZX', en: 'SHENZHEN' },
  '청두': { code: 'CTU', en: 'CHENGDU' },
  '시안': { code: 'XIY', en: 'XIAN' },
  '칭다오': { code: 'TAO', en: 'QINGDAO' },
  '장가계': { code: 'DYG', en: 'ZHANGJIAJIE' },
  '홍콩': { code: 'HKG', en: 'HONG KONG' },
  '마카오': { code: 'MFM', en: 'MACAU' },
  '타이베이': { code: 'TPE', en: 'TAIPEI' },
  '대만': { code: 'TPE', en: 'TAIWAN' },
  '가오슝': { code: 'KHH', en: 'KAOHSIUNG' },

  /* ── 동남아 ── */
  '방콕': { code: 'BKK', en: 'BANGKOK' },
  '푸켓': { code: 'HKT', en: 'PHUKET' },
  '치앙마이': { code: 'CNX', en: 'CHIANG MAI' },
  '끄라비': { code: 'KBV', en: 'KRABI' },
  '코사무이': { code: 'USM', en: 'KOH SAMUI' },
  '파타야': { code: 'UTP', en: 'PATTAYA' },
  '싱가포르': { code: 'SIN', en: 'SINGAPORE' },
  '쿠알라룸푸르': { code: 'KUL', en: 'KUALA LUMPUR' },
  '코타키나발루': { code: 'BKI', en: 'KOTA KINABALU' },
  '페낭': { code: 'PEN', en: 'PENANG' },
  '하노이': { code: 'HAN', en: 'HANOI' },
  '호치민': { code: 'SGN', en: 'HO CHI MINH' },
  '다낭': { code: 'DAD', en: 'DA NANG' },
  '나트랑': { code: 'CXR', en: 'NHA TRANG' },
  '푸꾸옥': { code: 'PQC', en: 'PHU QUOC' },
  '달랏': { code: 'DLI', en: 'DA LAT' },
  '발리': { code: 'DPS', en: 'BALI' },
  '자카르타': { code: 'CGK', en: 'JAKARTA' },
  '마닐라': { code: 'MNL', en: 'MANILA' },
  '세부': { code: 'CEB', en: 'CEBU' },
  '보라카이': { code: 'MPH', en: 'BORACAY' },
  '팔라완': { code: 'PPS', en: 'PALAWAN' },
  '프놈펜': { code: 'PNH', en: 'PHNOM PENH' },
  '씨엠립': { code: 'REP', en: 'SIEM REAP' },
  '비엔티안': { code: 'VTE', en: 'VIENTIANE' },
  '루앙프라방': { code: 'LPQ', en: 'LUANG PRABANG' },
  '양곤': { code: 'RGN', en: 'YANGON' },

  /* ── 남아시아 · 중동 ── */
  '델리': { code: 'DEL', en: 'DELHI' },
  '뭄바이': { code: 'BOM', en: 'MUMBAI' },
  '콜롬보': { code: 'CMB', en: 'COLOMBO' },
  '몰디브': { code: 'MLE', en: 'MALE' },
  '카트만두': { code: 'KTM', en: 'KATHMANDU' },
  '두바이': { code: 'DXB', en: 'DUBAI' },
  '아부다비': { code: 'AUH', en: 'ABU DHABI' },
  '도하': { code: 'DOH', en: 'DOHA' },
  '이스탄불': { code: 'IST', en: 'ISTANBUL' },
  '카파도키아': { code: 'NAV', en: 'CAPPADOCIA' },
  '텔아비브': { code: 'TLV', en: 'TEL AVIV' },

  /* ── 유럽 ── */
  '파리': { code: 'CDG', en: 'PARIS' },
  '니스': { code: 'NCE', en: 'NICE' },
  '런던': { code: 'LHR', en: 'LONDON' },
  '맨체스터': { code: 'MAN', en: 'MANCHESTER' },
  '에든버러': { code: 'EDI', en: 'EDINBURGH' },
  '더블린': { code: 'DUB', en: 'DUBLIN' },
  '암스테르담': { code: 'AMS', en: 'AMSTERDAM' },
  '브뤼셀': { code: 'BRU', en: 'BRUSSELS' },
  '프랑크푸르트': { code: 'FRA', en: 'FRANKFURT' },
  '뮌헨': { code: 'MUC', en: 'MUNICH' },
  '베를린': { code: 'BER', en: 'BERLIN' },
  '함부르크': { code: 'HAM', en: 'HAMBURG' },
  '취리히': { code: 'ZRH', en: 'ZURICH' },
  '제네바': { code: 'GVA', en: 'GENEVA' },
  '인터라켄': { code: 'ZRH', en: 'INTERLAKEN' },
  '빈': { code: 'VIE', en: 'VIENNA' },
  '비엔나': { code: 'VIE', en: 'VIENNA' },
  '잘츠부르크': { code: 'SZG', en: 'SALZBURG' },
  '프라하': { code: 'PRG', en: 'PRAGUE' },
  '부다페스트': { code: 'BUD', en: 'BUDAPEST' },
  '바르샤바': { code: 'WAW', en: 'WARSAW' },
  '크라쿠프': { code: 'KRK', en: 'KRAKOW' },
  '로마': { code: 'FCO', en: 'ROME' },
  '밀라노': { code: 'MXP', en: 'MILAN' },
  '베네치아': { code: 'VCE', en: 'VENICE' },
  '베니스': { code: 'VCE', en: 'VENICE' },
  '피렌체': { code: 'FLR', en: 'FLORENCE' },
  '나폴리': { code: 'NAP', en: 'NAPLES' },
  '바르셀로나': { code: 'BCN', en: 'BARCELONA' },
  '마드리드': { code: 'MAD', en: 'MADRID' },
  '세비야': { code: 'SVQ', en: 'SEVILLE' },
  '리스본': { code: 'LIS', en: 'LISBON' },
  '포르투': { code: 'OPO', en: 'PORTO' },
  '아테네': { code: 'ATH', en: 'ATHENS' },
  '산토리니': { code: 'JTR', en: 'SANTORINI' },
  '미코노스': { code: 'JMK', en: 'MYKONOS' },
  '코펜하겐': { code: 'CPH', en: 'COPENHAGEN' },
  '스톡홀름': { code: 'ARN', en: 'STOCKHOLM' },
  '오슬로': { code: 'OSL', en: 'OSLO' },
  '헬싱키': { code: 'HEL', en: 'HELSINKI' },
  '레이캬비크': { code: 'KEF', en: 'REYKJAVIK' },
  '아이슬란드': { code: 'KEF', en: 'ICELAND' },
  '모스크바': { code: 'SVO', en: 'MOSCOW' },
  '자그레브': { code: 'ZAG', en: 'ZAGREB' },
  '두브로브니크': { code: 'DBV', en: 'DUBROVNIK' },
  '류블랴나': { code: 'LJU', en: 'LJUBLJANA' },

  /* ── 미주 ── */
  '뉴욕': { code: 'JFK', en: 'NEW YORK' },
  '로스앤젤레스': { code: 'LAX', en: 'LOS ANGELES' },
  'LA': { code: 'LAX', en: 'LOS ANGELES' },
  '샌프란시스코': { code: 'SFO', en: 'SAN FRANCISCO' },
  '라스베이거스': { code: 'LAS', en: 'LAS VEGAS' },
  '시카고': { code: 'ORD', en: 'CHICAGO' },
  '보스턴': { code: 'BOS', en: 'BOSTON' },
  '워싱턴': { code: 'IAD', en: 'WASHINGTON' },
  '시애틀': { code: 'SEA', en: 'SEATTLE' },
  '마이애미': { code: 'MIA', en: 'MIAMI' },
  '올랜도': { code: 'MCO', en: 'ORLANDO' },
  '하와이': { code: 'HNL', en: 'HAWAII' },
  '호놀룰루': { code: 'HNL', en: 'HONOLULU' },
  '괌': { code: 'GUM', en: 'GUAM' },
  '사이판': { code: 'SPN', en: 'SAIPAN' },
  '밴쿠버': { code: 'YVR', en: 'VANCOUVER' },
  '토론토': { code: 'YYZ', en: 'TORONTO' },
  '몬트리올': { code: 'YUL', en: 'MONTREAL' },
  '멕시코시티': { code: 'MEX', en: 'MEXICO CITY' },
  '칸쿤': { code: 'CUN', en: 'CANCUN' },
  '리마': { code: 'LIM', en: 'LIMA' },
  '상파울루': { code: 'GRU', en: 'SAO PAULO' },
  '리우데자네이루': { code: 'GIG', en: 'RIO DE JANEIRO' },
  '부에노스아이레스': { code: 'EZE', en: 'BUENOS AIRES' },
  '산티아고': { code: 'SCL', en: 'SANTIAGO' },

  /* ── 오세아니아 ── */
  '시드니': { code: 'SYD', en: 'SYDNEY' },
  '멜버른': { code: 'MEL', en: 'MELBOURNE' },
  '브리즈번': { code: 'BNE', en: 'BRISBANE' },
  '골드코스트': { code: 'OOL', en: 'GOLD COAST' },
  '케언스': { code: 'CNS', en: 'CAIRNS' },
  '퍼스': { code: 'PER', en: 'PERTH' },
  '오클랜드': { code: 'AKL', en: 'AUCKLAND' },
  '퀸스타운': { code: 'ZQN', en: 'QUEENSTOWN' },

  /* ── 아프리카 ── */
  '카이로': { code: 'CAI', en: 'CAIRO' },
  '케이프타운': { code: 'CPT', en: 'CAPE TOWN' },
  '마라케시': { code: 'RAK', en: 'MARRAKECH' },
  '나이로비': { code: 'NBO', en: 'NAIROBI' },

  /* ── 나라 이름만 적은 경우의 대표 관문 공항 ── */
  '일본': { code: 'NRT', en: 'JAPAN' },
  '중국': { code: 'PEK', en: 'CHINA' },
  '태국': { code: 'BKK', en: 'THAILAND' },
  '베트남': { code: 'HAN', en: 'VIETNAM' },
  '필리핀': { code: 'MNL', en: 'PHILIPPINES' },
  '인도네시아': { code: 'CGK', en: 'INDONESIA' },
  '말레이시아': { code: 'KUL', en: 'MALAYSIA' },
  '캄보디아': { code: 'REP', en: 'CAMBODIA' },
  '라오스': { code: 'VTE', en: 'LAOS' },
  '인도': { code: 'DEL', en: 'INDIA' },
  '미국': { code: 'JFK', en: 'USA' },
  '캐나다': { code: 'YVR', en: 'CANADA' },
  '멕시코': { code: 'MEX', en: 'MEXICO' },
  '유럽': { code: 'CDG', en: 'EUROPE' },
  '영국': { code: 'LHR', en: 'UNITED KINGDOM' },
  '프랑스': { code: 'CDG', en: 'FRANCE' },
  '독일': { code: 'FRA', en: 'GERMANY' },
  '이탈리아': { code: 'FCO', en: 'ITALY' },
  '스페인': { code: 'BCN', en: 'SPAIN' },
  '포르투갈': { code: 'LIS', en: 'PORTUGAL' },
  '스위스': { code: 'ZRH', en: 'SWITZERLAND' },
  '오스트리아': { code: 'VIE', en: 'AUSTRIA' },
  '체코': { code: 'PRG', en: 'CZECHIA' },
  '헝가리': { code: 'BUD', en: 'HUNGARY' },
  '폴란드': { code: 'WAW', en: 'POLAND' },
  '네덜란드': { code: 'AMS', en: 'NETHERLANDS' },
  '그리스': { code: 'ATH', en: 'GREECE' },
  '터키': { code: 'IST', en: 'TURKIYE' },
  '크로아티아': { code: 'ZAG', en: 'CROATIA' },
  '호주': { code: 'SYD', en: 'AUSTRALIA' },
  '뉴질랜드': { code: 'AKL', en: 'NEW ZEALAND' },
  '이집트': { code: 'CAI', en: 'EGYPT' },
  '남아프리카공화국': { code: 'CPT', en: 'SOUTH AFRICA' },
  '모로코': { code: 'RAK', en: 'MOROCCO' },
};

/** 코드 → 영문 도시명. 위 표에서 자동으로 만들어 두 곳에 같은 이름을 두 번 적지 않는다.
 *  같은 코드를 여러 도시가 공유하면(예: KIX ← 오사카/교토) 먼저 등록된 쪽이 대표가 된다. */
const CODE_TO_EN: Record<string, string> = {};
for (const info of Object.values(CITY_TO_AIRPORT)) {
  if (!CODE_TO_EN[info.code]) CODE_TO_EN[info.code] = info.en;
}

function lookup(city: string): AirportInfo | null {
  const cleaned = city.trim();
  if (CITY_TO_AIRPORT[cleaned]) return CITY_TO_AIRPORT[cleaned];
  // "방콕 " / "방콕시"처럼 살짝 다르게 적은 경우를 위해 공백 제거 후 한 번 더
  const compact = cleaned.replace(/\s+/g, '');
  return CITY_TO_AIRPORT[compact] ?? null;
}

/** 여행지 이름 → IATA 코드. 표에 없으면 기존 동작대로 앞 3글자를 대문자로 자른다. */
export function toAirportCode(city: string): string {
  const info = lookup(city);
  if (info) return info.code;
  return city.trim().slice(0, 3).toUpperCase();
}

/** 여행지 이름 → 영문 도시명(보딩패스 스텁용). 표에 없으면 null. */
export function toAirportCityEn(city: string): string | null {
  return lookup(city)?.en ?? null;
}

/** IATA 코드 → 영문 도시명. 출발지(ICN)처럼 코드만 아는 경우에 쓴다. */
export function airportCityEnByCode(code: string): string | null {
  return CODE_TO_EN[code] ?? null;
}
