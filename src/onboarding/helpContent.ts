/**
 * 도움말 센터 내용 — 온보딩 기획안 PART 1(검토 완료) 6장 "도움말 센터 구성"과 2장 "사용 방법"을 옮겼다.
 *
 * 원칙
 *   · 현재 코드에 실제로 있는 기능만 적는다. 없는 기능은 FAQ에서 "아직 지원하지 않아요"로만 밝힌다.
 *   · 문장은 앱의 다른 화면과 같은 해요체(~해요)로, 짧게 쓴다(사용자 결정 2026-11 — 평서형 ~한다는 딱딱하다는 피드백).
 *   · `gates`는 그 화면(주소의 게이트)에서 도움말을 열면 위에 먼저 보일 항목이다.
 *   · `tour`가 있으면 글 안에 "사용법 보기" 버튼이 붙어 그 가이드를 바로 실행한다.
 *   · 검색은 제목·요약·키워드·본문을 그대로 비교한다(helpSearch.ts) — 사용자가 칠 법한 말을 keywords에 넣는다.
 */

export type HelpCategory = 'start' | 'plan' | 'feature' | 'faq' | 'trouble';

export const HELP_CATEGORIES: Array<{ key: HelpCategory; label: string; desc: string }> = [
  { key: 'start', label: '몽실이 시작하기', desc: '서비스 소개, 첫 여행, 동행자 초대' },
  { key: 'plan', label: '여행 계획 단계별 사용법', desc: 'IDEAS → STAY → ROUTE → TIMELINE → Companion' },
  { key: 'feature', label: '기능별 도움말', desc: '체크리스트, 문서, 메모, 경비, 링크, 채팅, Assistant' },
  { key: 'faq', label: '자주 묻는 질문', desc: '데이터, 공유, 순서 변경, 오프라인' },
  { key: 'trouble', label: '문제 해결', desc: '안 보일 때, 반영이 안 될 때, 업로드·지도·로그인' },
];

/** 지원 상태 — FAQ에서만 쓴다 */
export type HelpStatus = 'ok' | 'part' | 'no';

export interface HelpArticle {
  id: string;
  category: HelpCategory;
  title: string;
  summary: string;
  keywords: string[];
  gates?: string[];
  tour?: string;
  status?: HelpStatus;
  /** 순서가 있는 사용 방법 */
  steps?: string[];
  /** 순서가 없는 설명 문단 */
  paragraphs?: string[];
}

export const HELP_ARTICLES: HelpArticle[] = [
  /* ── 몽실이 시작하기 ── */
  {
    id: 'what-is',
    category: 'start',
    title: '몽실이는 어떤 서비스인가요?',
    summary: '동행자와 함께 여행을 계획하고, 여행 중에는 휴대폰으로 일정을 따라가는 서비스예요.',
    keywords: ['소개', '서비스', '몽실이', '처음'],
    paragraphs: [
      '동행자와 함께 가고 싶은 곳을 모으고, 숙소와 날짜별 동선을 정하고, 서류·준비물·경비까지 한곳에서 관리해요.',
      '여행 중에는 휴대폰 화면(Companion)으로 그날 일정을 따라가면 돼요.',
    ],
  },
  {
    id: 'first-trip',
    category: 'start',
    title: '여행을 처음 만들 때',
    summary: '+ 새 여행으로 만들고, IDEAS에서 장소 체크인부터 시작해요.',
    keywords: ['새 여행', '여행 만들기', '생성', '시작', '목적지', '날짜'],
    steps: [
      '내 여행에서 + 새 여행을 눌러요.',
      '여행 이름과 출발일·복귀일을 넣어요. 목적지 도시는 쉼표로 여러 개 넣을 수 있어요.',
      '항공편이 정해졌다면 입국·출국 공항도 골라 주세요(선택).',
      '만들어진 카드를 눌러 IDEAS에서 장소 체크인부터 시작해요.',
      '여행지별 기간이나 도시를 바꾸고 싶다면 카드의 연필 버튼으로 편집해요.',
    ],
  },
  {
    id: 'invite',
    category: 'start',
    title: '동행자 초대하기',
    summary: '멤버 초대나 공유를 누르면 초대 링크가 복사돼요.',
    keywords: ['동행자', '멤버', '초대', '공유', '친구', '참여', '링크'],
    steps: [
      '워크스페이스 사이드바의 멤버 초대나 헤더의 공유를 눌러요. 초대 링크가 복사돼요.',
      '링크를 받은 사람이 열고 Google로 로그인해요.',
      '참여하기를 누르면 같은 여행의 모든 화면을 함께 보고 고칠 수 있어요.',
    ],
  },
  {
    id: 'order',
    category: 'start',
    title: '전체 계획 순서',
    summary: 'IDEAS → STAY → ROUTE → TIMELINE 순서로 진행해요. 서류·체크리스트·경비는 중간에 언제든 챙기면 돼요.',
    keywords: ['순서', '흐름', '단계', '계획', '처음'],
    steps: [
      '01 IDEAS: 장소·링크·메모를 모으고 게이트별로 나눠요.',
      '02 STAY: 숙소 후보를 비교해서 하나를 확정해요. ROUTE는 숙소를 확정해야 열려요.',
      '03 ROUTE: 날짜별로 장소를 담고 순서와 이동 수단을 정해요.',
      '04 TIMELINE: 고정 시각과 체류시간을 맞추고 장소 정보를 정리해요.',
      'Documents·Notes·Checklist·Expense는 그 사이 언제든 함께 쓰면 돼요. 여행 중에는 Companion을 써요.',
    ],
  },

  /* ── 여행 계획 단계별 사용법 ── */
  {
    id: 'plan-ideas',
    category: 'plan',
    title: 'BRAINSTORM BOARD 사용법',
    summary: '장소를 체크인하고 VISIT·FOOD·ACTIVITY·STAY 게이트로 나눠요.',
    keywords: ['IDEAS', '브레인스토밍', '보드', '장소', '수집', '아이디어'],
    gates: ['ideas'],
    tour: 'ideas',
    steps: [
      '헤더에서 여행지와 날짜를 확인해요. 여행지가 여러 곳이면 여행지 변경으로 볼 도시를 골라요.',
      '체크인 입력창에 장소 이름을 입력하고 자동완성에서 골라요. 링크나 메모도 그대로 넣을 수 있어요.',
      '대기 중 카드의 분류 제안을 적용하거나, 원하는 게이트로 끌어다 놓아요.',
      '아이디어가 부족하면 AI Monthly Picks를 펼쳐서 마음에 드는 추천을 ＋로 담아요.',
      '카드를 누르면 장소 상세가 열려요. 메모와 댓글로 동행자와 의견을 나눠 보세요.',
      '지도로 보기로 위치를 한눈에 보고, 숙소 후보가 모이면 STAY로 넘어가요.',
    ],
  },
  {
    id: 'plan-stay',
    category: 'plan',
    title: 'STAY 사용법 · 숙소 정하기',
    summary: '숙소 후보를 비교하고 여행의 중심이 될 숙소를 확정해요.',
    keywords: ['STAY', '숙소', '호텔', '후보', '확정', '비교', '숙박', 'SHORTLIST', 'CANDIDATE POOL'],
    gates: ['shortlist'],
    tour: 'stay',
    steps: [
      '숙박 기간과 예산을 확인하고, 필요하면 고쳐요.',
      '숙소 사이트에서 찾은 숙소 이름을 "직접 숙소 선택하기"에 붙여넣으면 후보로 추가돼요. IDEAS의 STAY 게이트에 넣은 카드도 자동으로 후보가 돼요.',
      '후보마다 숙박비를 넣고 지도에서 위치를 확인해요.',
      '아닌 후보는 탈락시키고, 남은 후보를 체크해서 비교하기로 나란히 봐요.',
      '마음에 드는 숙소를 골라 "이 숙소를 여행 중심으로 선택하기"를 눌러요.',
      '확정 단계에서 주변 인프라와 리뷰 요약을 확인하고, 필요하면 멤버에게 투표를 요청한 뒤 확정해요.',
    ],
  },
  {
    id: 'plan-route',
    category: 'plan',
    title: 'ROUTE 사용법',
    summary: '날짜별로 장소를 담고 방문 순서와 이동 수단을 정해요.',
    keywords: ['ROUTE', '동선', '경로', '이동', '순서', 'DAY', '일정'],
    gates: ['route'],
    tour: 'route',
    steps: [
      '위쪽 DAY 탭에서 날짜를 골라요.',
      '지도 위 장소 목록에서 ＋를 눌러 그날 갈 곳을 담아요. 1번은 확정한 숙소예요.',
      '일정 패널에서 카드를 끌어 순서를 바꾸거나, 순서 정리로 동선을 깔끔하게 정리해요.',
      '이동 구간을 눌러 도보·대중교통·택시 중에 골라요. 실제 경로 보기를 누르면 실측값을 받아 와요.',
      '예약 시간처럼 꼭 지켜야 하는 시각이 있으면 그 장소에 직접 입력해요.',
      'DAY를 다 채웠다면 타임라인으로를 눌러 TIMELINE에서 다듬어요.',
    ],
  },
  {
    id: 'plan-timeline',
    category: 'plan',
    title: 'TIMELINE 사용법',
    summary: '하루를 시간표로 보면서 시각·체류시간·장소 정보를 다듬어요.',
    keywords: ['TIMELINE', '타임라인', '시간표', '시각', '체류', '일정'],
    gates: ['timeline'],
    tour: 'timeline',
    steps: [
      'DAY 스트립에서 날짜를 고르거나, 전체를 눌러 모든 날을 나란히 비교해요.',
      '카드의 도착 시각을 확인하고, 예약처럼 고정할 시각은 직접 입력해요.',
      '체류시간이 맞지 않으면 체류 박스에서 고쳐요.',
      '카드를 눌러 장소 상세를 열고, AI 요약 생성으로 정보를 정리할 수 있어요.',
      '그 장소에 챙길 것이 있다면 상세의 준비 체크리스트에 추가해요.',
      '여행 당일에는 지금을 눌러 현재 시각이 어디쯤인지 확인해요.',
    ],
  },
  {
    id: 'plan-companion',
    category: 'plan',
    title: 'Companion (여행 중 휴대폰 화면)',
    summary: '휴대폰으로 여행을 열면 나오는 화면이에요. 오늘 일정·지도·지갑·여행 탭이 있어요.',
    keywords: ['Companion', '컴패니언', '여행 중', '휴대폰', '모바일', '오늘', '길찾기', '도착'],
    gates: ['go'],
    steps: [
      '휴대폰으로 여행을 열면 자동으로 Companion 화면이 나와요.',
      '오늘 탭에서 첫 일정과 이동 정보를 확인해요.',
      '위치 사용을 켜 두면 장소에 도착했을 때 알려 줘요. 도착·출발을 누르면 남은 일정 시각이 다시 계산돼요.',
      '카드의 길찾기를 누르면 Google 지도가 열려요.',
      '돈을 쓰면 지갑에서 바로 기록해요.',
      '출발 전에 지갑에서 예약 서류를 오프라인으로 저장해 두세요.',
    ],
  },

  /* ── 기능별 도움말 ── */
  {
    id: 'ideas-gates',
    category: 'feature',
    title: 'GATE 설명',
    summary: 'VISIT·FOOD·ACTIVITY·STAY 네 가지예요. STAY에 넣은 장소가 숙소 후보가 돼요.',
    keywords: ['게이트', 'GATE', 'VISIT', 'FOOD', 'ACTIVITY', 'STAY', '분류'],
    gates: ['ideas'],
    paragraphs: [
      'VISIT은 가 볼 곳, FOOD는 먹을 곳, ACTIVITY는 할 것, STAY는 숙소 후보예요.',
      'STAY 게이트의 장소는 STAY 화면의 숙소 후보가 되고, 나머지는 ROUTE·TIMELINE에서 동선을 짜는 재료가 돼요.',
      '대기 중에 남아 있는 카드는 다음 단계로 넘어가지 않아요. 꼭 게이트로 옮겨 주세요.',
    ],
  },
  {
    id: 'ideas-add',
    category: 'feature',
    title: '장소 추가 방법',
    summary: '체크인 입력창에 장소 이름·링크·메모를 넣으면 돼요.',
    keywords: ['장소 추가', '검색', '체크인', '자동완성', '입력', '링크', '메모'],
    gates: ['ideas'],
    steps: [
      '체크인 입력창에 장소 이름을 입력해요.',
      '자동완성 목록에서 고르면 사진·평점·주소까지 함께 저장돼요.',
      '목록에 없으면 그대로 Enter를 눌러 텍스트로 저장해요. 링크나 메모도 같은 방법으로 넣어요.',
      '새 카드는 대기 중에 들어가요. 분류 제안을 적용하거나 게이트로 끌어다 놓아요.',
    ],
  },
  {
    id: 'ideas-picks',
    category: 'feature',
    title: 'AI Monthly Picks 사용법',
    summary: '여행지와 이번 달에 맞춘 게이트별 추천을 ＋로 담아요.',
    keywords: ['AI', '추천', 'Monthly Picks', '먼슬리'],
    gates: ['ideas'],
    steps: [
      'AI Monthly Picks를 눌러 펼쳐요.',
      '게이트별 추천 목록에서 마음에 드는 곳의 ＋를 눌러요.',
      '그 장소를 찾아 대기 중 목록에 담아요. 이미 담긴 곳이면 알려 줘요.',
    ],
  },
  {
    id: 'ideas-map',
    category: 'feature',
    title: '지도로 보기',
    summary: '모은 장소를 게이트 색깔 핀으로 지도에서 볼 수 있어요.',
    keywords: ['지도', '지도로 보기', '핀', '위치'],
    gates: ['ideas'],
    paragraphs: [
      'IDEAS 위쪽의 지도로 보기를 누르면 보드가 지도로 바뀌어요. 한 번 더 누르면 보드로 돌아와요.',
      '범례를 눌러 게이트별로 핀을 숨기거나 다시 보이게 할 수 있어요.',
    ],
  },
  {
    id: 'dest-switch',
    category: 'feature',
    title: '여행지 변경',
    summary: '여행지가 두 곳 이상이면 보고 있는 여행지를 바꿀 수 있어요. 데이터는 지워지지 않아요.',
    keywords: ['여행지', '도시', '여행지 변경', '멀티', '여러 도시'],
    gates: ['ideas', 'shortlist', 'route', 'timeline'],
    paragraphs: [
      '여행지가 두 곳 이상이면 IDEAS·STAY·ROUTE·TIMELINE에 여행지 변경 버튼이 생겨요.',
      '보고 있는 여행지만 바뀌어요. 장소·숙소·동선은 여행지별로 그대로 남아 있어요.',
      '여행지를 추가하거나 기간을 고치려면 내 여행 카드의 연필 버튼(여행 편집)을 눌러요.',
    ],
  },
  {
    id: 'place-detail',
    category: 'feature',
    title: '장소 상세와 댓글',
    summary: '장소 카드를 누르면 오른쪽에 상세가 열려요. 이름·게이트·메모·댓글을 다룰 수 있어요.',
    keywords: ['장소 상세', '댓글', '메모', '수정', '예약 링크', '숙소 확정'],
    gates: ['ideas'],
    paragraphs: [
      '이름 수정, 게이트 이동, 메모, 댓글, 주소·영업시간, Google 지도·검색 링크가 모여 있어요.',
      '숙소 카드에는 예약 링크 연동과 숙소 확정·해제 기능도 있어요.',
    ],
  },
  {
    id: 'checklist',
    category: 'feature',
    title: 'Checklist 사용법',
    summary: '함께 챙길 준비 항목을 관리해요. 스마트 추천, 담당자, 기한, 연결 문서를 쓸 수 있어요.',
    keywords: ['체크리스트', '준비물', '할 일', '추천', '담당자', '기한'],
    gates: ['checklist'],
    tour: 'checklist',
    steps: [
      '오른쪽 스마트 추천에서 필요한 항목을 담아요.',
      '빠른 추가 입력창에 직접 항목을 넣을 수도 있어요.',
      '항목을 눌러 담당자와 기한을 정해요.',
      '준비를 마치면 체크해요. 누가 완료했는지도 함께 기록돼요.',
    ],
    paragraphs: ['스마트 추천은 AI가 아니라, 이 여행에 저장된 항공·숙소·일정·여행지를 바탕으로 한 규칙이에요.'],
  },
  {
    id: 'documents',
    category: 'feature',
    title: 'Documents 사용법',
    summary: '항공권·예약증 같은 원본 파일을 공용 또는 개인으로 보관해요.',
    keywords: ['문서', '예약', '예약증', '항공권', '파일', '업로드', '보험', 'PDF', '서류'],
    gates: ['docs'],
    tour: 'docs',
    steps: [
      '문서 추가를 누르고 파일을 끌어다 놓아요(PDF·JPG·PNG, 최대 20MB).',
      '분류와 DAY 범위를 지정하면 그날 TIMELINE 요약에 관련 자료로 연결돼요.',
      '나만 볼 문서는 PERSONAL에서 본인을 등록하고 PIN을 정한 뒤 저장해요.',
    ],
  },
  {
    id: 'notes',
    category: 'feature',
    title: 'Notes 사용법',
    summary: '기억해 둘 텍스트 정보를 적어 둬요. 고정과 확인 완료 표시를 쓸 수 있어요.',
    keywords: ['메모', '노트', 'NOTES', '체크인 시간', '수하물'],
    gates: ['notes', 'docs'],
    tour: 'notes',
    steps: [
      '새 메모를 눌러 체크인 시간 같은 정보를 적어요.',
      '분류·지역·DAY 범위를 지정해요.',
      '중요한 메모는 고정하고, 확인한 정보는 확인 완료로 표시해요.',
    ],
  },
  {
    id: 'expense',
    category: 'feature',
    title: 'Expense 사용법',
    summary: '예산·지출·정산을 관리해요. 현지 통화는 원화로 환산해서 저장돼요.',
    keywords: ['경비', '지출', '예산', '정산', '돈', '환율', '송금', '동행'],
    gates: ['expense'],
    tour: 'expense',
    steps: [
      '설정 탭에서 총 예산과 분류별 예산을 넣어요.',
      '예약하거나 결제할 때마다 빠른 지출 추가로 기록해요. 공동 지출이면 나눠 낼 사람을 확인해요.',
      '여행 중에는 휴대폰 Companion의 지갑에서 기록해요.',
      '여행이 끝나면 정산 탭의 송금 제안대로 주고받고, 정산 완료로 표시해요.',
    ],
  },
  {
    id: 'links',
    category: 'feature',
    title: 'Links 사용법',
    summary: '채팅에 보낸 링크가 자동으로 분류되어 모여요.',
    keywords: ['링크', 'LINKS', '블로그', '영상', '그룹'],
    gates: ['links'],
    tour: 'links',
    paragraphs: [
      '채팅(Collaborate)에 링크를 보내면 숙소·관광지·음식·액티비티·영상·블로그·기타로 자동 분류되어 여기 모여요.',
      '검색, 분류 칩, 그룹 담기, 링크로 노트 작성 기능을 쓸 수 있어요.',
    ],
  },
  {
    id: 'chat',
    category: 'feature',
    title: '채팅 (Collaborate)',
    summary: '오른쪽 아래 말풍선 버튼으로 여행 멤버끼리 대화해요.',
    keywords: ['채팅', '대화', '메시지', 'Collaborate', '동행자', '멤버'],
    tour: 'panel',
    paragraphs: [
      '오른쪽 아래 말풍선 버튼을 누르면 Collaborate 탭이 열려요.',
      '내가 보낸 메시지는 수정·삭제할 수 있어요. 채팅에 보낸 링크는 Links에 자동으로 모여요.',
    ],
  },
  {
    id: 'assistant',
    category: 'feature',
    title: 'Assistant',
    summary: 'DOCUMENTS·NOTES에 있는 내용을 바탕으로 질문에 답해요.',
    keywords: ['Assistant', 'AI', '질문', '어시스턴트', '문서'],
    tour: 'panel',
    paragraphs: [
      '말풍선 버튼 → Assistant 탭에서 써요. 올린 문서와 적어 둔 메모만 근거로 답하고, 참고한 자료 제목도 함께 보여 줘요.',
      '근거가 없으면 모른다고 답해요. 일정이나 장소를 추천해 주는 기능은 아니에요.',
      '공용 문서와, 이 브라우저에서 잠금을 푼 내 개인 문서까지 참고해요.',
    ],
  },

  /* ── 자주 묻는 질문 ── */
  {
    id: 'faq-dest-change',
    category: 'faq',
    status: 'ok',
    title: '여행지를 바꾸면 기존 데이터는 어떻게 되나요?',
    summary: '보고 있는 여행지만 바뀌고, 데이터는 여행지별로 그대로 남아요.',
    keywords: ['여행지', '변경', '데이터', '삭제'],
    paragraphs: [
      '여행지 변경은 지금 보고 있는 여행지만 바꿔요. 데이터는 여행지별로 그대로 남아 있어요.',
      '여행 편집에서 여행지를 삭제하면, 그 여행지의 장소는 남아 있는 첫 번째 여행지로 옮겨져요.',
    ],
  },
  {
    id: 'faq-together',
    category: 'faq',
    status: 'ok',
    title: '동행자와 장소를 함께 추가할 수 있나요?',
    summary: '네, 다른 멤버 화면에도 바로 반영돼요.',
    keywords: ['동행자', '함께', '공동', '실시간', '멤버'],
    paragraphs: ['같은 여행 멤버가 장소를 추가하거나 옮기거나 지우면 다른 멤버 화면에도 바로 반영돼요. 장소마다 댓글로 의견을 남길 수도 있어요.'],
  },
  {
    id: 'faq-stay-change',
    category: 'faq',
    status: 'ok',
    title: '숙소를 확정한 뒤에 바꿀 수 있나요?',
    summary: 'STAY에서 다시 확정하거나, 장소 상세에서 확정을 해제하면 돼요.',
    keywords: ['숙소', '변경', '확정', '해제', '나누기'],
    paragraphs: [
      'STAY에서 다른 숙소를 골라 다시 확정하거나, 장소 상세의 숙소 확정 섹션에서 확정을 해제할 수 있어요.',
      '한 여행지에서 숙소를 나눠 묵는다면 확정 단계의 숙소 나누기로 기간을 나눠요.',
    ],
  },
  {
    id: 'faq-reorder',
    category: 'faq',
    status: 'ok',
    title: '일정 순서를 바꿀 수 있나요?',
    summary: 'ROUTE·TIMELINE·Companion에서 끌어서 바꿀 수 있어요. 세 화면 모두 같은 동선이에요.',
    keywords: ['순서', '변경', '드래그', '끌기', '일정'],
    paragraphs: ['ROUTE 일정 패널과 TIMELINE 카드는 끌어다 놓고, Companion에서는 카드를 길게 눌러 끌어요. 세 화면 모두 같은 동선을 고치는 거예요. 실수했다면 ROUTE의 실행 취소를 쓰면 돼요.'],
  },
  {
    id: 'faq-doc-share',
    category: 'faq',
    status: 'ok',
    title: '문서를 동행자와 공유할 수 있나요?',
    summary: 'SHARED로 올린 문서는 모든 멤버가 볼 수 있어요.',
    keywords: ['문서', '공유', '동행자', '예약', '파일'],
    paragraphs: ['SHARED로 올린 문서는 모든 멤버가 보고 열 수 있어요. 파일은 비공개 저장소에 보관되고, 열 때마다 10분 동안만 쓸 수 있는 주소가 만들어져요.'],
  },
  {
    id: 'faq-personal-doc',
    category: 'faq',
    status: 'part',
    title: '개인 문서와 공유 문서는 뭐가 다른가요?',
    summary: '개인 문서는 4자리 PIN으로 잠가요. 다만 보안 인증 수준은 아니에요.',
    keywords: ['개인', 'PERSONAL', 'PIN', '잠금', '공유', 'SHARED', '여권'],
    paragraphs: [
      'PERSONAL은 본인을 등록하고 4자리 PIN으로 잠근 문서예요. 잠금을 풀기 전에는 목록에도 나오지 않아요.',
      'PIN은 멤버끼리 문서가 섞이지 않게 하는 잠금이고, 금융 수준의 보안 인증은 아니에요. 탭을 닫으면 다시 잠겨요.',
    ],
  },
  {
    id: 'faq-checklist-sync',
    category: 'faq',
    status: 'ok',
    title: '체크리스트 완료 상태가 동행자에게도 보이나요?',
    summary: '네, 보여요. 누가 완료했는지도 함께 기록돼요.',
    keywords: ['체크리스트', '완료', '동행자', '공유'],
    paragraphs: ['Checklist, Companion, TIMELINE의 장소 준비는 모두 같은 목록이에요. 완료한 사람 이름도 함께 기록돼요.'],
  },
  {
    id: 'faq-expense',
    category: 'faq',
    status: 'ok',
    title: '여행 경비는 어떻게 관리하나요?',
    summary: 'Expense에서 예산·지출·정산을 관리하고, 여행 중에는 Companion 지갑을 써요.',
    keywords: ['경비', '돈', '지출', '정산', '예산'],
    paragraphs: ['Expense에서 예산을 정하고 결제할 때마다 기록해요. 현지 통화는 원화로 환산돼요. 공동 지출은 정산 탭에서 누가 누구에게 보낼지 알려 줘요. 여행 중에는 Companion 지갑에서 기록하면 돼요.'],
  },
  {
    id: 'faq-receipt',
    category: 'faq',
    status: 'no',
    title: '영수증 사진으로 지출을 입력할 수 있나요?',
    summary: '아직 지원하지 않아요. 직접 입력을 이용해 주세요.',
    keywords: ['영수증', '사진', 'OCR', '지출'],
    paragraphs: ['아직 지원하지 않아요. 빠른 추가의 영수증·문자/이미지 탭은 자리만 있고 동작하지 않아요. 직접 입력을 이용해 주세요.'],
  },
  {
    id: 'faq-links-add',
    category: 'faq',
    status: 'no',
    title: 'Links에 링크를 직접 추가할 수 있나요?',
    summary: 'Links 화면에는 입력창이 없어요. 채팅에 보내면 자동으로 모여요.',
    keywords: ['링크', '추가', '입력'],
    paragraphs: ['Links 화면에는 입력창이 없어요. 채팅(Collaborate)에 링크를 보내면 자동으로 모여요.'],
  },
  {
    id: 'faq-ai',
    category: 'faq',
    status: 'part',
    title: 'AI 기능은 어디에 있나요?',
    summary: 'Monthly Picks, 리뷰 요약, AI 일정 짜기, 장소 AI 요약, Assistant가 있어요.',
    keywords: ['AI', '인공지능', '추천', '요약'],
    paragraphs: [
      'AI Monthly Picks(IDEAS), AI 리뷰 요약(STAY 확정 단계), AI 일정 짜기(ROUTE), 장소 AI 요약·추천 포인트(TIMELINE 상세), Assistant(문서·메모 질문)가 있어요.',
      'IDEAS의 분류 제안과 체크리스트 추천은 AI가 아니라 정해진 규칙으로 동작해요.',
    ],
  },
  {
    id: 'faq-offline',
    category: 'faq',
    status: 'ok',
    title: '인터넷이 없어도 쓸 수 있나요?',
    summary: '휴대폰 Companion은 한 번 열어 본 여행과 저장해 둔 서류를 오프라인에서도 열 수 있어요.',
    keywords: ['오프라인', '인터넷', '와이파이', '데이터', '비행기'],
    paragraphs: [
      '휴대폰 Companion은 한 번 열어 본 여행의 화면·일정·사진과 저장해 둔 서류를 오프라인에서도 보여 줘요. 도착 기록·체크·지출은 다시 연결되면 전송돼요.',
      '지도, 주변 검색, AI 기능은 인터넷이 필요해요. PC 계획 화면은 오프라인을 지원하지 않아요.',
    ],
  },
  {
    id: 'faq-delete-account',
    category: 'faq',
    status: 'ok',
    title: '탈퇴하면 데이터는 어떻게 되나요?',
    summary: '설정에서 탈퇴할 수 있어요. 혼자 쓰던 여행은 삭제되고, 함께 쓰던 여행은 방장이 넘어가요.',
    keywords: ['탈퇴', '계정', '삭제', '설정'],
    paragraphs: ['설정에서 탈퇴할 수 있어요. 혼자 쓰던 여행은 삭제되고, 함께 쓰던 여행은 가장 먼저 참여한 멤버에게 방장이 넘어가요. 채팅·댓글·개인 문서도 함께 지워져요.'],
  },

  /* ── 문제 해결 ── */
  {
    id: 'trouble-missing',
    category: 'trouble',
    title: '데이터가 보이지 않을 때',
    summary: '여행지, 게이트 분류, 숙소 확정 여부를 확인해 보세요.',
    keywords: ['안 보임', '사라짐', '표시', '없어', '빈 화면'],
    steps: [
      '헤더의 여행지가 맞는지 확인해 주세요. 데이터는 여행지별로 따로 보여요(여행지 변경).',
      'IDEAS에 넣은 장소가 STAY·ROUTE에 안 보이면 게이트로 분류했는지 확인해 주세요. 대기 중 카드는 다음 단계로 넘어가지 않아요.',
      'ROUTE가 비어 있다면 STAY에서 숙소를 먼저 확정해 주세요.',
      '그래도 안 되면 새로고침해 보세요.',
    ],
  },
  {
    id: 'trouble-sync',
    category: 'trouble',
    title: '동행자에게 변경 사항이 반영되지 않을 때',
    summary: '양쪽 모두 새로고침하고, 같은 여행의 멤버인지 확인해 보세요.',
    keywords: ['반영', '동기화', '실시간', '동행자', '안 보여'],
    steps: [
      '양쪽 모두 새로고침해 보세요. 연결이 끊겼다가 다시 이어져도 화면에 따로 알림이 뜨지 않아요.',
      '같은 여행의 멤버인지(초대 링크로 참여했는지) 확인해 주세요.',
    ],
  },
  {
    id: 'trouble-upload',
    category: 'trouble',
    title: '문서 업로드에 실패했을 때',
    summary: 'PDF·JPG·PNG 파일만, 한 파일당 20MB까지 올릴 수 있어요. 개인 문서는 잠금을 먼저 풀어 주세요.',
    keywords: ['업로드', '실패', '파일', '용량', '20MB', '문서'],
    steps: [
      'PDF·JPG·PNG 파일만, 한 파일당 20MB까지 올릴 수 있어요. 20MB가 넘는 파일은 자동으로 빠져요.',
      '개인 문서는 PERSONAL 잠금을 먼저 풀어야 저장돼요.',
      '여러 파일 중 일부만 실패하면 저장·실패 개수를 알려 줘요. 실패한 파일만 다시 올려 주세요.',
    ],
  },
  {
    id: 'trouble-map',
    category: 'trouble',
    title: '지도가 보이지 않을 때',
    summary: '지도 없이도 목록은 그대로 쓸 수 있어요. 광고 차단기와 네트워크를 확인하고 새로고침해 보세요.',
    keywords: ['지도', '안 나옴', '지도 오류', '구글맵'],
    paragraphs: [
      '지도를 못 불러오면 화면에 "지도를 불러오지 못했어요"가 뜨고, 목록은 그대로 쓸 수 있어요.',
      '광고 차단기와 네트워크를 확인하고 새로고침해 보세요. 휴대폰이 오프라인이면 지도는 열리지 않고, 길찾기는 Google 지도 앱으로 넘어가요.',
    ],
  },
  {
    id: 'trouble-login',
    category: 'trouble',
    title: '로그인이나 권한 문제가 생겼을 때',
    summary: 'Google 계정으로만 로그인할 수 있어요. 초대 링크가 안 열리면 새 링크를 받아 주세요.',
    keywords: ['로그인', '권한', '초대', '참여', '계정', 'Google'],
    steps: [
      '로그인은 Google 계정만 지원해요. 약관에 동의해야 다음으로 넘어가요.',
      '초대 링크를 찾을 수 없다고 나오면, 초대한 사람에게 새 링크를 받아 주세요.',
      '여행이 안 보이면 그 여행에 멤버로 참여했는지 확인해 주세요.',
    ],
  },
];

export function articleById(id: string): HelpArticle | null {
  return HELP_ARTICLES.find((a) => a.id === id) ?? null;
}

export function articlesInCategory(cat: HelpCategory): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.category === cat);
}

/** 그 게이트에서 먼저 보여줄 글 — 사용법(plan)이 맨 위, 그다음 기능·FAQ 순 */
export function articlesForGate(gate: string | null | undefined): HelpArticle[] {
  if (!gate) return [];
  const rank: Record<HelpCategory, number> = { plan: 0, feature: 1, start: 2, faq: 3, trouble: 4 };
  return HELP_ARTICLES
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.gates?.includes(gate))
    .sort((x, y) => rank[x.a.category] - rank[y.a.category] || x.i - y.i)
    .map(({ a }) => a);
}
