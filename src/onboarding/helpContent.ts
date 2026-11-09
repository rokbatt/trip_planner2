/**
 * 도움말 센터 내용 — 온보딩 기획안 PART 1(검토 완료) 6장 "도움말 센터 구성"과 2장 "사용 방법"을 옮겼다.
 *
 * 원칙
 *   · 현재 코드에 실제로 있는 기능만 적는다. 없는 기능은 FAQ에서 "현재 지원하지 않는다"로만 밝힌다.
 *   · 문장은 짧은 평서형(~한다). 화면에 넣을 카피라 설명을 늘리지 않는다.
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
    title: '몽실이는 어떤 서비스인가',
    summary: '동행자와 함께 여행을 계획하고, 여행 중에는 휴대폰으로 일정을 따라가는 서비스.',
    keywords: ['소개', '서비스', '몽실이', '처음'],
    paragraphs: [
      '동행자와 함께 여행 장소를 모으고, 숙소와 날짜별 동선을 정하고, 서류·준비물·경비를 관리한다.',
      '여행 중에는 휴대폰 화면(Companion)으로 그날 일정을 따라간다.',
    ],
  },
  {
    id: 'first-trip',
    category: 'start',
    title: '여행을 처음 만들 때',
    summary: '+ 새 여행으로 만들고, IDEAS에서 장소 체크인부터 시작한다.',
    keywords: ['새 여행', '여행 만들기', '생성', '시작', '목적지', '날짜'],
    steps: [
      '내 여행에서 + 새 여행을 누른다.',
      '여행 이름·출발일·복귀일을 넣는다. 목적지 도시는 쉼표로 여러 개 넣을 수 있다.',
      '항공편을 알면 입국·출국 공항을 고른다(선택).',
      '만들어진 카드를 눌러 IDEAS에서 장소 체크인부터 시작한다.',
      '여행지별 기간이나 도시를 바꿀 때는 카드의 연필 버튼으로 편집한다.',
    ],
  },
  {
    id: 'invite',
    category: 'start',
    title: '동행자 초대',
    summary: '멤버 초대 또는 공유를 누르면 초대 링크가 복사된다.',
    keywords: ['동행자', '멤버', '초대', '공유', '친구', '참여', '링크'],
    steps: [
      '워크스페이스 사이드바의 멤버 초대 또는 헤더의 공유를 누른다. 초대 링크가 복사된다.',
      '받은 사람이 링크를 열고 Google로 로그인한다.',
      '참여하기를 누르면 같은 여행의 모든 화면을 함께 보고 고친다.',
    ],
  },
  {
    id: 'order',
    category: 'start',
    title: '전체 계획 순서',
    summary: 'IDEAS → STAY → ROUTE → TIMELINE. 서류·체크리스트·경비는 그 사이 언제든.',
    keywords: ['순서', '흐름', '단계', '계획', '처음'],
    steps: [
      '01 IDEAS: 장소·링크·메모를 모으고 게이트로 나눈다.',
      '02 STAY: 숙소 후보를 비교하고 하나를 확정한다. ROUTE는 숙소가 확정되어야 열린다.',
      '03 ROUTE: 날짜별로 장소를 담고 순서·이동 수단을 정한다.',
      '04 TIMELINE: 고정 시각·체류시간을 맞추고 장소 정보를 정리한다.',
      'Documents·Notes·Checklist·Expense는 그 사이 언제든 병행한다. 여행 중에는 Companion.',
    ],
  },

  /* ── 여행 계획 단계별 사용법 ── */
  {
    id: 'plan-ideas',
    category: 'plan',
    title: 'BRAINSTORM BOARD 사용법',
    summary: '장소를 체크인하고 VISIT·FOOD·ACTIVITY·STAY 게이트로 나눈다.',
    keywords: ['IDEAS', '브레인스토밍', '보드', '장소', '수집', '아이디어'],
    gates: ['ideas'],
    tour: 'ideas',
    steps: [
      '헤더에서 여행지와 날짜를 확인한다. 여행지가 여럿이면 여행지 변경으로 볼 도시를 고른다.',
      '체크인 입력창에 장소 이름을 입력하고 자동완성에서 고른다. 링크나 메모도 그대로 넣는다.',
      '대기 중 카드의 분류 제안을 적용하거나, 원하는 게이트로 끌어 놓는다.',
      '아이디어가 부족하면 AI Monthly Picks를 펼쳐 추천을 ＋로 담는다.',
      '카드를 눌러 장소 상세에서 메모·댓글로 동행자와 의견을 나눈다.',
      '지도로 보기로 위치 분포를 확인하고, 숙소 후보가 모이면 STAY로 넘어간다.',
    ],
  },
  {
    id: 'plan-stay',
    category: 'plan',
    title: 'STAY 사용법 · 숙소 정하기',
    summary: '숙소 후보를 비교하고 여행의 중심 숙소를 확정한다.',
    keywords: ['STAY', '숙소', '호텔', '후보', '확정', '비교', '숙박', 'SHORTLIST', 'CANDIDATE POOL'],
    gates: ['shortlist'],
    tour: 'stay',
    steps: [
      '숙박 기간과 예산을 확인하고 필요하면 수정한다.',
      '숙소 검색 사이트에서 찾은 숙소 이름을 직접 숙소 선택하기에 붙여넣어 후보로 추가한다. IDEAS의 STAY 게이트 카드도 자동으로 후보가 된다.',
      '후보마다 숙박비를 넣고 지도에서 위치를 본다.',
      '아닌 후보는 탈락시키고, 남은 후보를 체크해 비교하기로 본다.',
      '하나를 고르고 이 숙소를 여행 중심으로 선택하기를 누른다.',
      '확정 단계에서 주변 인프라·리뷰 요약을 보고, 필요하면 멤버에게 투표 요청을 보낸 뒤 확정한다.',
    ],
  },
  {
    id: 'plan-route',
    category: 'plan',
    title: 'ROUTE 사용법',
    summary: '날짜별로 장소를 담고 방문 순서와 이동 수단을 정한다.',
    keywords: ['ROUTE', '동선', '경로', '이동', '순서', 'DAY', '일정'],
    gates: ['route'],
    tour: 'route',
    steps: [
      '위의 DAY 탭에서 날짜를 고른다.',
      '지도 위 장소 목록에서 ＋를 눌러 그날 갈 곳을 담는다. 1번은 확정한 숙소다.',
      '일정 패널에서 순서를 끌어 바꾸거나 순서 정리로 동선을 정리한다.',
      '이동 구간을 눌러 도보·대중교통·택시를 고른다. 필요하면 실제 경로 보기로 실측값을 받는다.',
      '고정해야 하는 시각(예약 시간)이 있으면 그 장소의 시각을 직접 입력한다.',
      '모든 DAY를 채운 뒤 타임라인으로를 눌러 TIMELINE에서 다듬는다.',
    ],
  },
  {
    id: 'plan-timeline',
    category: 'plan',
    title: 'TIMELINE 사용법',
    summary: '하루를 시간표로 확인하고 시각·체류시간·장소 정보를 다듬는다.',
    keywords: ['TIMELINE', '타임라인', '시간표', '시각', '체류', '일정'],
    gates: ['timeline'],
    tour: 'timeline',
    steps: [
      'DAY 스트립에서 날짜를 고르거나 전체로 모든 날을 비교한다.',
      '카드의 도착 시각을 확인하고, 예약처럼 고정할 시각은 직접 입력한다.',
      '체류시간이 맞지 않으면 체류 박스에서 고친다.',
      '카드를 눌러 장소 상세를 열고 AI 요약 생성으로 정보를 정리한다.',
      '장소에 필요한 준비물은 상세의 준비 체크리스트에 추가한다.',
      '여행 당일에는 지금을 눌러 현재 시각 위치를 확인한다.',
    ],
  },
  {
    id: 'plan-companion',
    category: 'plan',
    title: 'Companion (여행 중 휴대폰 화면)',
    summary: '휴대폰으로 여행을 열면 뜨는 화면. 오늘 일정·지도·지갑·여행 탭.',
    keywords: ['Companion', '컴패니언', '여행 중', '휴대폰', '모바일', '오늘', '길찾기', '도착'],
    gates: ['go'],
    steps: [
      '휴대폰으로 여행을 연다(자동으로 Companion).',
      '오늘 탭에서 첫 일정과 이동 정보를 확인한다.',
      '위치 사용을 켜 두면 장소에 도착했을 때 알려 준다. 도착·출발을 누르면 남은 시각이 다시 계산된다.',
      '카드의 길찾기로 Google 지도를 연다.',
      '돈을 쓰면 지갑에서 바로 기록한다.',
      '출발 전 지갑에서 예약 서류를 오프라인 저장해 둔다.',
    ],
  },

  /* ── 기능별 도움말 ── */
  {
    id: 'ideas-gates',
    category: 'feature',
    title: 'GATE 설명',
    summary: 'VISIT·FOOD·ACTIVITY·STAY. STAY에 넣은 장소가 숙소 후보가 된다.',
    keywords: ['게이트', 'GATE', 'VISIT', 'FOOD', 'ACTIVITY', 'STAY', '분류'],
    gates: ['ideas'],
    paragraphs: [
      'VISIT은 가 볼 곳, FOOD는 먹을 곳, ACTIVITY는 할 것, STAY는 숙소 후보다.',
      'STAY 게이트의 장소는 STAY 화면의 숙소 후보가 되고, 나머지는 ROUTE·TIMELINE에서 동선의 재료가 된다.',
      '대기 중에 남아 있는 카드는 다음 단계로 넘어가지 않는다. 게이트로 옮겨야 한다.',
    ],
  },
  {
    id: 'ideas-add',
    category: 'feature',
    title: '장소 추가 방법',
    summary: '체크인 입력창에 장소 이름·링크·메모를 넣는다.',
    keywords: ['장소 추가', '검색', '체크인', '자동완성', '입력', '링크', '메모'],
    gates: ['ideas'],
    steps: [
      '체크인 입력창에 장소 이름을 입력한다.',
      '자동완성 목록에서 고르면 사진·평점·주소까지 저장된다.',
      '목록에 없으면 그대로 Enter를 눌러 텍스트로 저장한다. 링크·메모도 같은 방법이다.',
      '새 카드는 대기 중에 들어간다. 분류 제안을 적용하거나 게이트로 끌어 놓는다.',
    ],
  },
  {
    id: 'ideas-picks',
    category: 'feature',
    title: 'AI Monthly Picks 사용법',
    summary: '여행지와 이번 달 기준 게이트별 추천을 ＋로 담는다.',
    keywords: ['AI', '추천', 'Monthly Picks', '먼슬리'],
    gates: ['ideas'],
    steps: [
      'AI Monthly Picks를 눌러 펼친다.',
      '게이트별 추천 목록에서 마음에 드는 곳의 ＋를 누른다.',
      '장소를 찾아 대기 중 목록에 담는다. 이미 담긴 곳이면 알려 준다.',
    ],
  },
  {
    id: 'ideas-map',
    category: 'feature',
    title: '지도로 보기',
    summary: '모은 장소를 게이트 색 핀으로 지도에서 본다.',
    keywords: ['지도', '지도로 보기', '핀', '위치'],
    gates: ['ideas'],
    paragraphs: [
      'IDEAS 위쪽의 지도로 보기를 누르면 보드가 지도로 바뀐다. 다시 누르면 보드로 돌아온다.',
      '범례를 눌러 게이트별로 핀을 숨기거나 보인다.',
    ],
  },
  {
    id: 'dest-switch',
    category: 'feature',
    title: '여행지 변경',
    summary: '여행지가 2곳 이상이면 보고 있는 여행지를 바꾼다. 데이터는 지우지 않는다.',
    keywords: ['여행지', '도시', '여행지 변경', '멀티', '여러 도시'],
    gates: ['ideas', 'shortlist', 'route', 'timeline'],
    paragraphs: [
      'IDEAS·STAY·ROUTE·TIMELINE에 여행지 변경 버튼이 있다(여행지가 2곳 이상일 때).',
      '보고 있는 여행지만 바뀐다. 장소·숙소·동선은 여행지별로 그대로 남는다.',
      '여행지 추가·기간 수정은 내 여행 카드의 연필 버튼(여행 편집)에서 한다.',
    ],
  },
  {
    id: 'place-detail',
    category: 'feature',
    title: '장소 상세와 댓글',
    summary: '장소 카드를 누르면 오른쪽에 상세가 열린다. 이름·게이트·메모·댓글.',
    keywords: ['장소 상세', '댓글', '메모', '수정', '예약 링크', '숙소 확정'],
    gates: ['ideas'],
    paragraphs: [
      '이름 수정, 게이트 이동, 메모, 댓글, 주소·영업시간, Google 지도·검색 링크가 있다.',
      '숙소 카드에는 예약 링크 연동과 숙소 확정·해제가 함께 있다.',
    ],
  },
  {
    id: 'checklist',
    category: 'feature',
    title: 'Checklist 사용법',
    summary: '함께 챙길 준비 항목. 스마트 추천, 담당자, 기한, 연결 문서.',
    keywords: ['체크리스트', '준비물', '할 일', '추천', '담당자', '기한'],
    gates: ['checklist'],
    tour: 'checklist',
    steps: [
      '오른쪽 스마트 추천에서 필요한 항목을 담는다.',
      '빠른 추가 입력으로 직접 항목을 넣는다.',
      '항목을 눌러 담당자와 기한을 정한다.',
      '준비를 마치면 체크한다. 완료한 사람이 함께 기록된다.',
    ],
    paragraphs: ['스마트 추천은 AI가 아니라 이 여행에 저장된 항공·숙소·일정·여행지를 근거로 한 규칙이다.'],
  },
  {
    id: 'documents',
    category: 'feature',
    title: 'Documents 사용법',
    summary: '항공권·예약증 같은 원본 파일을 공용 또는 개인으로 보관한다.',
    keywords: ['문서', '예약', '예약증', '항공권', '파일', '업로드', '보험', 'PDF', '서류'],
    gates: ['docs'],
    tour: 'docs',
    steps: [
      '문서 추가를 눌러 파일을 끌어다 놓는다(PDF·JPG·PNG, 최대 20MB).',
      '분류와 DAY 범위를 지정한다. 그날 TIMELINE 요약에 관련 자료로 연결된다.',
      '나만 볼 문서는 PERSONAL에서 본인을 등록하고 PIN을 정한 뒤 저장한다.',
    ],
  },
  {
    id: 'notes',
    category: 'feature',
    title: 'Notes 사용법',
    summary: '기억해 둘 텍스트 정보. 고정과 확인 완료 표시.',
    keywords: ['메모', '노트', 'NOTES', '체크인 시간', '수하물'],
    gates: ['notes', 'docs'],
    tour: 'notes',
    steps: [
      '새 메모를 눌러 체크인 시간 같은 정보를 적는다.',
      '분류·지역·DAY 범위를 지정한다.',
      '중요한 메모는 고정하고, 확인한 정보는 확인 완료로 표시한다.',
    ],
  },
  {
    id: 'expense',
    category: 'feature',
    title: 'Expense 사용법',
    summary: '예산·지출·정산. 현지 통화는 원화로 환산해 저장한다.',
    keywords: ['경비', '지출', '예산', '정산', '돈', '환율', '송금', '동행'],
    gates: ['expense'],
    tour: 'expense',
    steps: [
      '설정 탭에서 총 예산과 분류별 예산을 넣는다.',
      '예약·결제할 때마다 빠른 지출 추가로 기록한다. 공동 지출이면 분담 인원을 확인한다.',
      '여행 중에는 휴대폰 Companion 지갑에서 기록한다.',
      '여행이 끝나면 정산 탭의 송금 제안대로 주고받고 정산 완료로 표시한다.',
    ],
  },
  {
    id: 'links',
    category: 'feature',
    title: 'Links 사용법',
    summary: '채팅에 보낸 링크가 자동으로 분류되어 모인다.',
    keywords: ['링크', 'LINKS', '블로그', '영상', '그룹'],
    gates: ['links'],
    tour: 'links',
    paragraphs: [
      '채팅(Collaborate)에 링크를 보내면 숙소·관광지·음식·액티비티·영상·블로그·기타로 자동 분류되어 여기 모인다.',
      '검색, 분류 칩, 그룹 담기, 링크로 노트 작성을 쓸 수 있다.',
    ],
  },
  {
    id: 'chat',
    category: 'feature',
    title: '채팅 (Collaborate)',
    summary: '오른쪽 아래 말풍선 버튼. 여행 멤버끼리 대화한다.',
    keywords: ['채팅', '대화', '메시지', 'Collaborate', '동행자', '멤버'],
    tour: 'panel',
    paragraphs: [
      '오른쪽 아래 말풍선 버튼을 누르면 Collaborate 탭이 열린다.',
      '내 메시지는 수정·삭제할 수 있다. 보낸 링크는 Links에 자동으로 모인다.',
    ],
  },
  {
    id: 'assistant',
    category: 'feature',
    title: 'Assistant',
    summary: 'DOCUMENTS·NOTES 내용을 근거로 질문에 답한다.',
    keywords: ['Assistant', 'AI', '질문', '어시스턴트', '문서'],
    tour: 'panel',
    paragraphs: [
      '말풍선 버튼 → Assistant 탭. 올린 문서와 적은 메모만 근거로 답하고, 참고한 자료 제목을 보여준다.',
      '근거가 없으면 모른다고 답한다. 일정·장소 추천용이 아니다.',
      '범위는 공용 문서와, 이 브라우저에서 잠금을 푼 내 개인 문서다.',
    ],
  },

  /* ── 자주 묻는 질문 ── */
  {
    id: 'faq-dest-change',
    category: 'faq',
    status: 'ok',
    title: '여행지를 변경하면 기존 데이터는 어떻게 되나',
    summary: '보고 있는 여행지만 바뀌고 데이터는 여행지별로 남는다.',
    keywords: ['여행지', '변경', '데이터', '삭제'],
    paragraphs: [
      '여행지 변경은 보고 있는 여행지만 바꾼다. 데이터는 여행지별로 그대로 남는다.',
      '여행 편집에서 여행지를 삭제하면 그 여행지의 장소는 남은 첫 여행지로 옮겨진다.',
    ],
  },
  {
    id: 'faq-together',
    category: 'faq',
    status: 'ok',
    title: '동행자와 장소를 함께 추가할 수 있나',
    summary: '가능하다. 다른 멤버 화면에 바로 반영된다.',
    keywords: ['동행자', '함께', '공동', '실시간', '멤버'],
    paragraphs: ['같은 여행의 멤버가 추가·이동·삭제한 장소는 다른 멤버 화면에 바로 반영된다. 장소마다 댓글로 의견을 남길 수 있다.'],
  },
  {
    id: 'faq-stay-change',
    category: 'faq',
    status: 'ok',
    title: '숙소를 확정한 뒤 바꿀 수 있나',
    summary: 'STAY에서 다시 확정하거나 장소 상세에서 확정 해제한다.',
    keywords: ['숙소', '변경', '확정', '해제', '나누기'],
    paragraphs: [
      'STAY에서 다른 숙소를 다시 선택해 확정하거나, 장소 상세의 숙소 확정 섹션에서 확정 해제한다.',
      '한 여행지에서 숙소를 나눠 묵으면 확정 단계의 숙소 나누기로 구간을 나눈다.',
    ],
  },
  {
    id: 'faq-reorder',
    category: 'faq',
    status: 'ok',
    title: '일정 순서를 바꿀 수 있나',
    summary: 'ROUTE·TIMELINE·Companion에서 끌어서 바꾼다. 같은 동선이다.',
    keywords: ['순서', '변경', '드래그', '끌기', '일정'],
    paragraphs: ['ROUTE 일정 패널과 TIMELINE 카드는 끌어 놓기, Companion은 카드를 길게 눌러 끈다. 세 화면이 같은 동선을 고친다. 실수하면 ROUTE의 실행 취소를 쓴다.'],
  },
  {
    id: 'faq-doc-share',
    category: 'faq',
    status: 'ok',
    title: '문서를 동행자와 공유할 수 있나',
    summary: 'SHARED로 올린 문서는 모든 멤버가 본다.',
    keywords: ['문서', '공유', '동행자', '예약', '파일'],
    paragraphs: ['SHARED로 올린 문서는 모든 멤버가 보고 연다. 파일은 비공개 저장소에 있고, 열 때마다 10분짜리 주소를 받는다.'],
  },
  {
    id: 'faq-personal-doc',
    category: 'faq',
    status: 'part',
    title: '개인 문서와 공유 문서는 무엇이 다른가',
    summary: '개인 문서는 4자리 PIN으로 잠근다. 보안 인증은 아니다.',
    keywords: ['개인', 'PERSONAL', 'PIN', '잠금', '공유', 'SHARED', '여권'],
    paragraphs: [
      'PERSONAL은 본인을 등록하고 4자리 PIN으로 잠근 문서다. 잠금을 풀기 전에는 목록에도 뜨지 않는다.',
      'PIN은 멤버끼리 섞이지 않게 하는 잠금이고 금융 수준의 보안 인증은 아니다. 탭을 닫으면 다시 잠긴다.',
    ],
  },
  {
    id: 'faq-checklist-sync',
    category: 'faq',
    status: 'ok',
    title: '체크리스트 완료 상태는 동행자에게도 보이나',
    summary: '보인다. 완료한 사람 이름도 함께 기록된다.',
    keywords: ['체크리스트', '완료', '동행자', '공유'],
    paragraphs: ['Checklist·Companion·TIMELINE 장소 준비가 같은 목록이고, 완료한 사람 이름이 함께 기록된다.'],
  },
  {
    id: 'faq-expense',
    category: 'faq',
    status: 'ok',
    title: '여행 경비는 어떻게 관리하나',
    summary: 'Expense에서 예산·지출·정산. 여행 중엔 Companion 지갑.',
    keywords: ['경비', '돈', '지출', '정산', '예산'],
    paragraphs: ['Expense에서 예산을 정하고 결제마다 기록한다. 현지 통화는 원화로 환산된다. 공동 지출은 정산 탭에서 송금 제안을 받는다. 여행 중에는 Companion 지갑에서 기록한다.'],
  },
  {
    id: 'faq-receipt',
    category: 'faq',
    status: 'no',
    title: '영수증 사진으로 지출을 입력할 수 있나',
    summary: '현재 지원하지 않는다. 직접 입력을 쓴다.',
    keywords: ['영수증', '사진', 'OCR', '지출'],
    paragraphs: ['현재 지원하지 않는다. 빠른 추가의 영수증·문자/이미지 탭은 자리만 있다. 직접 입력을 쓴다.'],
  },
  {
    id: 'faq-links-add',
    category: 'faq',
    status: 'no',
    title: 'Links에 링크를 직접 추가할 수 있나',
    summary: 'Links 화면엔 입력창이 없다. 채팅에 보내면 모인다.',
    keywords: ['링크', '추가', '입력'],
    paragraphs: ['Links 화면에는 입력창이 없다. 채팅(Collaborate)에 링크를 보내면 자동으로 모인다.'],
  },
  {
    id: 'faq-ai',
    category: 'faq',
    status: 'part',
    title: 'AI 기능은 어디에 있나',
    summary: 'Monthly Picks, 리뷰 요약, AI 일정 짜기, 장소 AI 요약, Assistant.',
    keywords: ['AI', '인공지능', '추천', '요약'],
    paragraphs: [
      'AI Monthly Picks(IDEAS), AI 리뷰 요약(STAY 확정 단계), AI 일정 짜기(ROUTE), 장소 AI 요약·추천 포인트(TIMELINE 상세), Assistant(문서·메모 질문).',
      'IDEAS 분류 제안과 체크리스트 추천은 AI가 아니라 규칙이다.',
    ],
  },
  {
    id: 'faq-offline',
    category: 'faq',
    status: 'ok',
    title: '인터넷이 없어도 쓸 수 있나',
    summary: '휴대폰 Companion은 한 번 연 여행과 저장한 서류를 오프라인으로 연다.',
    keywords: ['오프라인', '인터넷', '와이파이', '데이터', '비행기'],
    paragraphs: [
      '휴대폰 Companion은 한 번 연 여행의 화면·일정·사진과 저장해 둔 서류를 오프라인으로 연다. 도착 기록·체크·지출은 연결되면 전송된다.',
      '지도·주변 검색·AI는 인터넷이 필요하다. PC 계획 화면은 오프라인 대상이 아니다.',
    ],
  },
  {
    id: 'faq-delete-account',
    category: 'faq',
    status: 'ok',
    title: '탈퇴하면 데이터는 어떻게 되나',
    summary: '설정에서 탈퇴한다. 혼자 쓰던 여행은 삭제, 함께 쓰는 여행은 방장이 넘어간다.',
    keywords: ['탈퇴', '계정', '삭제', '설정'],
    paragraphs: ['설정에서 탈퇴한다. 혼자 쓰던 여행은 삭제되고, 함께 쓰는 여행은 가장 먼저 참여한 멤버에게 방장이 넘어간다. 채팅·댓글·개인 문서도 지워진다.'],
  },

  /* ── 문제 해결 ── */
  {
    id: 'trouble-missing',
    category: 'trouble',
    title: '데이터가 표시되지 않을 때',
    summary: '여행지, 게이트 분류, 숙소 확정 여부를 확인한다.',
    keywords: ['안 보임', '사라짐', '표시', '없어', '빈 화면'],
    steps: [
      '헤더의 여행지가 맞는지 확인한다. 데이터는 여행지별로 보인다(여행지 변경).',
      'IDEAS 장소가 STAY·ROUTE에 안 보이면 게이트로 분류했는지 확인한다. 대기 중 카드는 다음 단계로 넘어가지 않는다.',
      'ROUTE가 빈 화면이면 STAY에서 숙소를 먼저 확정한다.',
      '그래도 안 되면 새로고침한다.',
    ],
  },
  {
    id: 'trouble-sync',
    category: 'trouble',
    title: '동행자에게 변경 사항이 반영되지 않을 때',
    summary: '양쪽 모두 새로고침하고, 같은 여행 멤버인지 확인한다.',
    keywords: ['반영', '동기화', '실시간', '동행자', '안 보여'],
    steps: [
      '양쪽 모두 새로고침한다. 연결이 끊겼다 다시 이어져도 화면에 따로 알림이 뜨지 않는다.',
      '같은 여행의 멤버인지(초대 링크로 참여했는지) 확인한다.',
    ],
  },
  {
    id: 'trouble-upload',
    category: 'trouble',
    title: '문서 업로드에 실패했을 때',
    summary: 'PDF·JPG·PNG, 파일당 20MB까지. 개인 문서는 잠금을 먼저 푼다.',
    keywords: ['업로드', '실패', '파일', '용량', '20MB', '문서'],
    steps: [
      'PDF·JPG·PNG만, 파일당 20MB까지 올라간다. 20MB가 넘는 파일은 자동으로 빠진다.',
      '개인 문서는 PERSONAL 잠금을 먼저 풀어야 저장된다.',
      '여러 개 중 일부만 실패하면 저장·실패 개수를 알려 준다. 실패한 파일만 다시 올린다.',
    ],
  },
  {
    id: 'trouble-map',
    category: 'trouble',
    title: '지도가 표시되지 않을 때',
    summary: '목록은 그대로 쓸 수 있다. 차단기·네트워크를 확인하고 새로고침.',
    keywords: ['지도', '안 나옴', '지도 오류', '구글맵'],
    paragraphs: [
      '각 화면이 "지도를 불러오지 못했어요"를 띄우고 목록은 그대로 쓸 수 있다.',
      '광고 차단기·네트워크를 확인하고 새로고침한다. 휴대폰이 오프라인이면 지도는 열리지 않고 길찾기는 Google 지도 앱으로 넘어간다.',
    ],
  },
  {
    id: 'trouble-login',
    category: 'trouble',
    title: '로그인 또는 권한 문제가 생겼을 때',
    summary: 'Google 계정만 지원. 초대 링크가 안 되면 새 링크를 받는다.',
    keywords: ['로그인', '권한', '초대', '참여', '계정', 'Google'],
    steps: [
      '로그인은 Google 계정만 지원한다. 약관에 동의해야 진행된다.',
      '초대 링크를 찾을 수 없다고 나오면 초대한 사람에게 새 링크를 받는다.',
      '여행이 안 보이면 그 여행의 멤버로 참여했는지 확인한다.',
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
