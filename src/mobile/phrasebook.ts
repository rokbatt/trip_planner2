/**
 * 기초 회화 공부집 — 그날 일정(식당·쇼핑·숙소·이동)에 맞는 상황별 기본 문장.
 *
 * 원칙 3-1: 문장은 **사람이 정한 고정 목록**이다(AI가 그때그때 만든 문장이 아니다). 일정에 맞춘
 * AI 문장은 따로 붙인다. 발음은 한글 근사치라 정확한 발음은 휴대폰 음성 읽기(speechSynthesis)로 듣는다.
 * 지원 언어 밖의 여행지는 영어로 보여 주고 그렇다고 밝힌다. 국내 여행은 보여 주지 않는다.
 */
import { currencyForDestination } from '../utils/currencies';
import type { CatKey } from '../utils/travelEstimate';

export type PhraseLang = 'ja' | 'th' | 'vi' | 'zh-CN' | 'zh-TW' | 'en';
export type Situation = 'basic' | 'food' | 'move' | 'shop' | 'stay' | 'emergency';

export const LANG_LABEL: Record<PhraseLang, string> = {
  ja: '일본어', th: '태국어', vi: '베트남어', 'zh-CN': '중국어(간체)', 'zh-TW': '중국어(번체)', en: '영어',
};
/** 휴대폰 음성 읽기(speechSynthesis)에 넘길 언어 코드 */
export const SPEECH_LANG: Record<PhraseLang, string> = {
  ja: 'ja-JP', th: 'th-TH', vi: 'vi-VN', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', en: 'en-US',
};
export const SITUATION_LABEL: Record<Situation, string> = {
  basic: '기본', food: '식당·카페', move: '교통·이동', shop: '쇼핑', stay: '숙소', emergency: '급할 때',
};

export interface Phrase {
  ko: string;
  /** 언어별 [현지어, 한글 발음] */
  t: Partial<Record<PhraseLang, [string, string]>>;
}

/** 태국어는 말끝에 남성 "캅(ครับ)", 여성 "카(ค่ะ/คะ)"를 붙인다 — 문장에는 남성형을 적고 화면에서 알려 준다 */
export const PHRASES: Record<Situation, Phrase[]> = {
  basic: [
    { ko: '안녕하세요', t: { ja: ['こんにちは', '곤니치와'], th: ['สวัสดีครับ', '사왓디 캅'], vi: ['Xin chào', '씬 짜오'], 'zh-CN': ['你好', '니하오'], 'zh-TW': ['你好', '니하오'], en: ['Hello', '헬로'] } },
    { ko: '감사합니다', t: { ja: ['ありがとうございます', '아리가토 고자이마스'], th: ['ขอบคุณครับ', '콥쿤 캅'], vi: ['Cảm ơn', '깜 언'], 'zh-CN': ['谢谢', '씨에시에'], 'zh-TW': ['謝謝', '씨에시에'], en: ['Thank you', '땡큐'] } },
    { ko: '실례합니다 / 저기요', t: { ja: ['すみません', '스미마센'], th: ['ขอโทษครับ', '커톳 캅'], vi: ['Xin lỗi', '씬 로이'], 'zh-CN': ['不好意思', '뿌하오이쓰'], 'zh-TW': ['不好意思', '뿌하오이쓰'], en: ['Excuse me', '익스큐즈 미'] } },
  ],
  food: [
    { ko: '이거 주세요', t: { ja: ['これをください', '고레오 구다사이'], th: ['เอาอันนี้ครับ', '아오 안니 캅'], vi: ['Cho tôi cái này', '쪼 또이 까이 나이'], 'zh-CN': ['我要这个', '워 야오 쩌거'], 'zh-TW': ['我要這個', '워 야오 쩌거'], en: ["I'll have this, please", '아일 해브 디스, 플리즈'] } },
    { ko: '추천 메뉴가 뭐예요?', t: { ja: ['おすすめは何ですか？', '오스스메와 난데스카'], th: ['มีเมนูแนะนำไหมครับ', '미 메누 내남 마이 캅'], vi: ['Món nào ngon?', '몬 나오 응온'], 'zh-CN': ['有什么推荐的？', '여우 션머 투이찌엔 더'], 'zh-TW': ['有什麼推薦的？', '여우 션머 투이찌엔 더'], en: ['What do you recommend?', '왓 두 유 레커멘드'] } },
    { ko: '맵지 않게 해 주세요', t: { ja: ['辛くしないでください', '가라쿠 시나이데 구다사이'], th: ['ไม่เผ็ดครับ', '마이 펫 캅'], vi: ['Đừng cho cay', '등 쪼 까이'], 'zh-CN': ['不要辣', '뿌야오 라'], 'zh-TW': ['不要辣', '뿌야오 라'], en: ['Not spicy, please', '낫 스파이시, 플리즈'] } },
    { ko: '계산해 주세요', t: { ja: ['お会計お願いします', '오카이케 오네가이시마스'], th: ['เช็คบิลครับ', '첵빈 캅'], vi: ['Tính tiền', '띤 띠엔'], 'zh-CN': ['买单', '마이딴'], 'zh-TW': ['買單', '마이딴'], en: ['Check, please', '첵, 플리즈'] } },
  ],
  move: [
    { ko: '여기로 가 주세요 (화면을 보여 주며)', t: { ja: ['ここに行ってください', '고코니 잇테 구다사이'], th: ['ไปที่นี่ครับ', '빠이 티니 캅'], vi: ['Cho tôi đến đây', '쪼 또이 덴 더이'], 'zh-CN': ['请到这里', '칭 따오 쩌리'], 'zh-TW': ['請到這裡', '칭 따오 쩌리'], en: ['Please take me here', '플리즈 테이크 미 히어'] } },
    { ko: '얼마나 걸려요?', t: { ja: ['どのくらいかかりますか？', '도노쿠라이 가카리마스카'], th: ['ใช้เวลานานไหมครับ', '차이 웰라 난 마이 캅'], vi: ['Mất bao lâu?', '멋 바오 러우'], 'zh-CN': ['要多久？', '야오 뚜어지우'], 'zh-TW': ['要多久？', '야오 뚜어지우'], en: ['How long does it take?', '하우 롱 더즈 잇 테이크'] } },
    { ko: '여기서 세워 주세요', t: { ja: ['ここで止めてください', '고코데 도메테 구다사이'], th: ['จอดตรงนี้ครับ', '쩟 뜨롱니 캅'], vi: ['Dừng ở đây', '증 어 더이'], 'zh-CN': ['在这里停', '짜이 쩌리 팅'], 'zh-TW': ['在這裡停', '짜이 쩌리 팅'], en: ['Please stop here', '플리즈 스탑 히어'] } },
  ],
  shop: [
    { ko: '얼마예요?', t: { ja: ['いくらですか？', '이쿠라데스카'], th: ['เท่าไหร่ครับ', '타오라이 캅'], vi: ['Bao nhiêu tiền?', '바오 니에우 띠엔'], 'zh-CN': ['多少钱？', '뚜어샤오 치엔'], 'zh-TW': ['多少錢？', '뚜어샤오 치엔'], en: ['How much is it?', '하우 머치 이즈 잇'] } },
    { ko: '카드 돼요?', t: { ja: ['カードは使えますか？', '카도와 츠카에마스카'], th: ['จ่ายบัตรได้ไหมครับ', '짜이 밧 다이 마이 캅'], vi: ['Trả bằng thẻ được không?', '짜 방 테 드억 콩'], 'zh-CN': ['可以刷卡吗？', '커이 쏴카 마'], 'zh-TW': ['可以刷卡嗎？', '커이 쏴카 마'], en: ['Can I pay by card?', '캔 아이 페이 바이 카드'] } },
    { ko: '조금 깎아 주세요', t: { ja: ['少し安くなりませんか？', '스코시 야스쿠 나리마센카'], th: ['ลดหน่อยได้ไหมครับ', '롯 너이 다이 마이 캅'], vi: ['Bớt cho tôi được không?', '벗 쪼 또이 드억 콩'], 'zh-CN': ['便宜一点吧', '피엔이 이디엔 바'], 'zh-TW': ['便宜一點吧', '피엔이 이디엔 바'], en: ['Could you give me a discount?', '쿠쥬 기브 미 어 디스카운트'] } },
  ],
  stay: [
    { ko: '체크인할게요', t: { ja: ['チェックインお願いします', '첵쿠인 오네가이시마스'], th: ['เช็คอินครับ', '첵인 캅'], vi: ['Tôi muốn nhận phòng', '또이 무온 년 퐁'], 'zh-CN': ['我要办理入住', '워 야오 빤리 루쭈'], 'zh-TW': ['我要辦理入住', '워 야오 빤리 루쭈'], en: ["I'd like to check in", '아이드 라이크 투 첵 인'] } },
    { ko: '짐 맡길 수 있나요?', t: { ja: ['荷物を預けられますか？', '니모츠오 아즈케라레마스카'], th: ['ฝากกระเป๋าได้ไหมครับ', '팍 끄라빠오 다이 마이 캅'], vi: ['Tôi gửi hành lý được không?', '또이 그이 하인 리 드억 콩'], 'zh-CN': ['可以寄放行李吗？', '커이 찌팡 싱리 마'], 'zh-TW': ['可以寄放行李嗎？', '커이 찌팡 싱리 마'], en: ['Can I leave my luggage here?', '캔 아이 리브 마이 러기지 히어'] } },
  ],
  emergency: [
    { ko: '화장실이 어디예요?', t: { ja: ['トイレはどこですか？', '토이레와 도코데스카'], th: ['ห้องน้ำอยู่ที่ไหนครับ', '헝남 유 티나이 캅'], vi: ['Nhà vệ sinh ở đâu?', '냐 베 신 어 더우'], 'zh-CN': ['洗手间在哪里？', '시셔우찌엔 짜이 나리'], 'zh-TW': ['洗手間在哪裡？', '시셔우찌엔 짜이 나리'], en: ['Where is the restroom?', '웨어 이즈 더 레스트룸'] } },
    { ko: '약국이 어디예요?', t: { ja: ['薬局はどこですか？', '얏쿄쿠와 도코데스카'], th: ['ร้านขายยาอยู่ที่ไหนครับ', '란 카이 야 유 티나이 캅'], vi: ['Nhà thuốc ở đâu?', '냐 투옥 어 더우'], 'zh-CN': ['药店在哪里？', '야오띠엔 짜이 나리'], 'zh-TW': ['藥局在哪裡？', '야오쥐 짜이 나리'], en: ['Where is the pharmacy?', '웨어 이즈 더 파머시'] } },
    { ko: '도와주세요!', t: { ja: ['助けてください', '타스케테 구다사이'], th: ['ช่วยด้วยครับ', '추어이 두어이 캅'], vi: ['Cứu tôi với!', '끄우 또이 버이'], 'zh-CN': ['救命！', '찌우밍'], 'zh-TW': ['救命！', '찌우밍'], en: ['Help!', '헬프'] } },
  ],
};

/** 여행지 → 회화 언어. 국내면 null. 고정 목록에 없는 나라는 영어(fallback=true) */
export function languageForDestination(name: string | null | undefined): { lang: PhraseLang; fallback: boolean } | null {
  const cur = currencyForDestination(name);
  if (cur === 'KRW') return null;
  const map: Record<string, PhraseLang> = { JPY: 'ja', THB: 'th', VND: 'vi', CNY: 'zh-CN', TWD: 'zh-TW' };
  if (cur && map[cur]) return { lang: map[cur], fallback: false };
  // 영어권 통화는 fallback 표시를 하지 않는다(현지어가 영어)
  const english = new Set(['USD', 'GBP', 'AUD', 'NZD', 'CAD', 'SGD']);
  return { lang: 'en', fallback: !(cur && english.has(cur)) };
}

/** 그날 일정 종류 → 공부할 상황 순서. 기본은 늘 앞, 급할 때는 늘 뒤 */
export function situationsForDay(cats: readonly CatKey[]): Situation[] {
  const out: Situation[] = ['basic'];
  const add = (s: Situation) => { if (!out.includes(s)) out.push(s); };
  for (const c of cats) {
    if (c === 'FOOD') add('food');
    else if (c === 'SHOPPING') add('shop');
    else if (c === 'STAY') add('stay');
    else if (c === 'AIRPORT' || c === 'VISIT' || c === 'ACTIVITY') add('move');
  }
  add('emergency');
  return out;
}
