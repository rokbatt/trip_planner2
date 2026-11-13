/**
 * 페이지별 가이드 내용 — 문구·순서·강조 대상만 담는다(화면 코드는 tour.ts).
 *
 * 문구는 온보딩 기획안 PART 1(검토 완료)의 "페이지별 Guided Tour" 표를 옮겨, 앱의 다른 화면과 같은 해요체로 다듬었다.
 * 강조 대상은 실제 화면 요소에 붙인 `data-tour="…"` 이름이다 — 클래스·id는 디자인 작업 중에
 * 자주 바뀌므로 가이드는 이 이름에만 기대고, 화면 쪽은 이 이름을 지우지 않는다.
 *
 * 규칙
 *   · 대상이 화면에 없거나 숨겨져 있으면 그 단계는 건너뛴다(`fallback`이 있으면 그걸 대신 보여준다).
 *     예: TIMELINE의 "지금" 버튼은 여행 기간에만 보인다 → 그 밖엔 "동선 수정"으로 대신.
 *   · `prepare`는 대상이 열려 있어야 보이는 경우(오른쪽 패널 안 탭 등) 먼저 실행할 동작 이름이다.
 *     실제 동작은 tour.ts의 PREPARE 표에 있다.
 *   · 내용을 크게 바꾸면 그 가이드의 `version`을 올린다 → 이미 본 사람에게도 한 번 더 뜬다.
 *   · `prepare`가 화면을 바꿨다면(예: 채팅 탭 → Assistant 탭) 가이드가 끝날 때 원래대로 돌려놓는다.
 *   · 폰(Companion) 가이드는 이번 범위가 아니다(PC 전용 구현).
 */

export interface TourStepContent {
  /** data-tour 값 */
  target: string;
  title: string;
  body: string;
  /** 대상이 없을 때 대신 보여줄 단계 */
  fallback?: { target: string; title: string; body: string };
  /** 대상을 보이게 하려면 먼저 해야 하는 동작(tour.ts PREPARE) */
  prepare?: 'openPanelAssistant';
}

export interface TourDef {
  id: string;
  /** 도움말·자동 실행에 쓰는 화면 이름 */
  label: string;
  /** 이 가이드가 붙는 워크스페이스 게이트(주소의 마지막 칸). 없으면 자동 실행하지 않는다 */
  gate?: string;
  version: number;
  steps: TourStepContent[];
}

export const TOURS: TourDef[] = [
  {
    id: 'ideas',
    label: 'IDEAS · BRAINSTORM BOARD',
    gate: 'ideas',
    version: 1,
    steps: [
      { target: 'brainstorm-search', title: '장소 체크인', body: '장소 이름을 입력하면 Google에서 찾아 사진·평점과 함께 저장해요. 링크나 메모도 그대로 넣을 수 있어요.' },
      {
        target: 'brainstorm-suggest',
        title: '게이트로 분류',
        body: '새 카드는 대기 중에 들어가요. 제안된 게이트를 적용하거나, 원하는 게이트로 끌어다 놓으세요.',
        fallback: { target: 'brainstorm-inbox', title: '게이트로 분류', body: '새 카드는 대기 중에 들어가요. 원하는 게이트로 끌어다 놓아 분류하세요.' },
      },
      { target: 'brainstorm-gates', title: 'VISIT · FOOD · ACTIVITY · STAY', body: 'STAY 게이트에 넣은 장소는 숙소 후보가 되고, 나머지는 동선을 짜는 재료가 돼요.' },
      { target: 'brainstorm-monthly-picks', title: '이번 달 추천', body: '여행지와 이번 달에 맞춘 추천이에요. ＋를 누르면 대기 목록에 담겨요.' },
      { target: 'brainstorm-map', title: '위치 한눈에', body: '모은 장소를 게이트 색깔별로 지도에서 볼 수 있어요. 숙소 후보가 모이면 STAY로 넘어가요.' },
    ],
  },
  {
    id: 'stay',
    label: 'STAY',
    gate: 'shortlist',
    version: 1,
    steps: [
      { target: 'stay-summary', title: '기간과 예산', body: '여기 값이 숙소 검색 사이트로 그대로 전달돼요. 예산은 1박 1인 기준이에요.' },
      { target: 'stay-import', title: '후보 추가', body: '예약 사이트에서 본 숙소 이름을 붙여넣으면 후보에 추가돼요. IDEAS의 STAY 카드도 자동으로 후보가 돼요.' },
      { target: 'stay-candidates', title: '후보 비교', body: '숙박비를 넣으면 1박 평균이 계산돼요. 이동시간은 담아 둔 장소를 기준으로 한 추정치예요. 아닌 후보는 ✕로 빼 주세요.' },
      { target: 'stay-compare', title: '나란히 보기', body: '후보를 2개 이상 체크하면 항목별로 나란히 비교할 수 있어요.' },
      { target: 'stay-confirm', title: '여행 중심 숙소', body: '고른 숙소를 기준으로 동선이 계산돼요. 확정 단계에서 멤버에게 투표를 요청할 수도 있어요.' },
    ],
  },
  {
    id: 'route',
    label: 'ROUTE',
    gate: 'route',
    version: 1,
    steps: [
      // 숙소를 아직 확정하지 않은 빈 화면에서만 보이는 단계 — 나머지 단계는 대상이 없어 자동으로 빠진다
      { target: 'route-need-stay', title: '숙소 먼저', body: 'STAY에서 숙소를 먼저 확정해 주세요. 확정한 숙소가 하루의 출발점이 돼요.' },
      { target: 'route-days', title: '날짜 고르기', body: '날짜마다 동선을 따로 만들어요. 필요하면 DAY를 추가할 수 있어요.' },
      { target: 'route-library', title: '장소 담기', body: 'IDEAS에서 모은 장소가 여기 있어요. ＋를 누르면 선택한 날에 담겨요.' },
      { target: 'route-plan', title: '순서와 시각', body: '1번은 확정한 숙소예요. 카드를 끌어 순서를 바꾸고, 꼭 지킬 시각은 직접 입력하세요.' },
      { target: 'route-refine', title: '동선 다듬기', body: '순서 정리를 누르면 이동이 짧은 순서로 바꿔 줘요. 이동시간은 추정치라, 실제 경로 보기로 실측값을 받아 볼 수 있어요.' },
      { target: 'route-to-timeline', title: '시간표로', body: '동선이 정리되면 TIMELINE에서 시간 단위로 다듬어요.' },
    ],
  },
  {
    id: 'timeline',
    label: 'TIMELINE',
    gate: 'timeline',
    version: 1,
    steps: [
      { target: 'timeline-empty', title: '동선 먼저', body: 'ROUTE에서 하루 동선을 만들면 여기서 시간 단위로 다듬을 수 있어요.' },
      { target: 'timeline-days', title: '날짜별 밀도', body: '막대 길이로 어느 날이 빡빡한지 한눈에 볼 수 있어요. 전체를 누르면 모든 날을 나란히 비교해요.' },
      { target: 'timeline-time', title: '시각 고정', body: '시각을 입력하면 고정되고, 뒤 일정이 다시 계산돼요. 비우면 자동 계산으로 돌아가요.' },
      { target: 'timeline-card', title: '장소 상세', body: '카드를 누르면 장소 정보와 준비 체크리스트가 열려요. AI 요약은 버튼을 눌러야 만들어져요.' },
      {
        target: 'timeline-now',
        title: '여행 중',
        body: '여행 기간에는 이 버튼으로 오늘 일정과 지금 시각 위치로 바로 이동해요.',
        fallback: { target: 'timeline-route', title: '동선 수정', body: '장소를 넣고 빼는 큰 수정은 ROUTE에서 해요. 여기서 고친 순서와 시각도 ROUTE에 반영돼요.' },
      },
    ],
  },
  {
    id: 'checklist',
    label: 'Checklist',
    gate: 'checklist',
    version: 1,
    steps: [
      { target: 'checklist-suggest', title: '이 여행 기준 추천', body: '저장된 항공·숙소·일정·여행지를 바탕으로 추천한 항목이에요. 담으면 목록에 추가돼요.' },
      { target: 'checklist-quick', title: '직접 추가', body: '항목을 입력하고 Enter를 누르세요. 항목을 누르면 담당자·기한·연결 문서를 정할 수 있어요.' },
      { target: 'checklist-list', title: '함께 체크', body: '체크하면 모든 멤버에게 똑같이 보이고, 누가 완료했는지도 기록돼요.' },
    ],
  },
  {
    id: 'docs',
    label: 'Documents',
    gate: 'docs',
    version: 1,
    steps: [
      { target: 'docs-add', title: '원본 보관', body: 'PDF·JPG·PNG 파일을 20MB까지 올릴 수 있어요. DAY를 지정하면 그날 타임라인에 연결돼요.' },
      { target: 'docs-scope', title: '공용과 개인', body: '공용 문서는 모든 멤버가 볼 수 있어요. 개인 문서는 4자리 PIN으로 잠가요(멤버끼리 구분하기 위한 잠금이에요).' },
      { target: 'docs-notes-tab', title: '텍스트 정보', body: '수하물 규정처럼 적어 둘 정보는 메모로 남겨요. 고정하거나 확인 완료로 표시할 수 있어요.' },
    ],
  },
  {
    id: 'notes',
    label: 'Notes',
    gate: 'notes',
    version: 1,
    steps: [
      { target: 'docs-add', title: '새 메모', body: '수하물 규정이나 체크인 시간처럼 적어 둘 정보는 메모로 남겨요.' },
      { target: 'notes-cats', title: '분류와 표시', body: '분류를 눌러 원하는 메모만 볼 수 있어요. 메모마다 고정과 확인 완료 표시도 쓸 수 있어요.' },
    ],
  },
  {
    id: 'expense',
    label: 'Expense',
    gate: 'expense',
    version: 1,
    steps: [
      { target: 'expense-tabs', title: '예산부터 정산까지', body: '예산 요약 · 지출 내역 · 정산 · 동행 · 설정 탭이 있어요. 예산은 설정 탭에서 정해요.' },
      { target: 'expense-quickadd', title: '지출 기록', body: '현지 통화로 입력하면 원화로 환산해서 저장해요. 공동 지출이면 각자 낼 금액이 계산돼요.' },
      { target: 'expense-settle', title: '누가 누구에게', body: '결제를 마친 공동 지출을 바탕으로 누가 누구에게 얼마를 보내면 되는지 알려 줘요.' },
    ],
  },
  {
    id: 'links',
    label: 'Links',
    gate: 'links',
    version: 1,
    steps: [
      { target: 'links-list', title: '채팅 링크 모음', body: '채팅에 보낸 링크가 자동으로 분류되어 여기 모여요. 링크를 추가하려면 채팅에 보내 주세요.' },
      { target: 'links-groups', title: '나만의 묶음', body: '링크를 주제별 그룹에 담아 두면 나중에 다시 찾기 쉬워요.' },
    ],
  },
  {
    // 채팅 옆 Assistant — 게이트와 상관없이 **오른쪽 채팅 패널을 처음 열 때** 한 번 자동 실행한다
    // (onboarding.ts onPanelOpened). 도움말 센터에서도 다시 볼 수 있다.
    // 두 단계 모두 prepare가 있어 패널이 닫혀 있어도(도움말에서 실행) Assistant 탭을 열고 시작한다.
    id: 'assistant',
    label: 'Assistant',
    version: 1,
    steps: [
      {
        target: 'panel-assistant-tab',
        title: '채팅 옆 Assistant',
        body: '멤버끼리 대화는 Collaborate에서, 여행 서류와 메모에 대한 질문은 옆의 Assistant 탭에서 해요.',
        prepare: 'openPanelAssistant',
      },
      {
        target: 'panel-assistant',
        title: '내 자료로 답해 줘요',
        body: 'DOCUMENTS에 올린 예약증·항공권과 NOTES 메모만 근거로 답하고, 참고한 자료도 함께 보여 줘요. "체크인 몇 시야?"처럼 물어보세요.',
        prepare: 'openPanelAssistant',
      },
    ],
  },
];

export function tourById(id: string): TourDef | null {
  return TOURS.find((t) => t.id === id) ?? null;
}

export function tourForGate(gate: string | null | undefined): TourDef | null {
  if (!gate) return null;
  return TOURS.find((t) => t.gate === gate) ?? null;
}
