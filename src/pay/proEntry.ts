/**
 * 요금제 화면(#pro)으로 들어온 길 — "어떤 PRO 기능을 눌러서 왔는지"를 화면 맨 위 안내 띠에 보여 주려고 잠깐 적어 둔다.
 * 요금제 화면 코드(pro.ts)는 결제 라이브러리까지 끌고 와서 무겁다 — 기능 화면들은 이 작은 파일만 불러온다.
 */
import { navigate } from '../router';

export type ProFeature = 'web' | 'photo' | 'receipt' | 'area' | 'guide';

/** 안내 띠에 쓰는 기능 이름 */
export const PRO_FEATURE_NAMES: Record<ProFeature, string> = {
  web: 'AI 어시스턴트 웹 검색',
  photo: '인생샷',
  receipt: '영수증·결제 캡처로 지출 추가',
  area: '영역 검색',
  guide: '도슨트(알고 가는 여행 가이드)',
};

const KEY = 'mongsil:pro-from';

/** 잠긴 PRO 기능에서 요금제 화면으로 — 어떤 기능인지 함께 남긴다 */
export function goPro(feature: ProFeature): void {
  try { sessionStorage.setItem(KEY, feature); } catch { /* 저장소 차단 환경 — 띠만 없을 뿐이다 */ }
  navigate('pro');
}

/** 요금제 화면이 한 번 읽고 지운다 — 새로고침·다른 경로로 다시 열었을 때 옛 안내가 남지 않게 */
export function takeProEntry(): ProFeature | null {
  try {
    const v = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return v && Object.prototype.hasOwnProperty.call(PRO_FEATURE_NAMES, v) ? (v as ProFeature) : null;
  } catch {
    return null;
  }
}
