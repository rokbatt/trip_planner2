/**
 * 페이지별 가이드 내용 — 문구·순서·강조 대상만 담는다(화면 코드는 tour.ts).
 *
 * 문구는 온보딩 기획안 PART 1(검토 완료)의 "페이지별 Guided Tour" 표를 그대로 옮겼다.
 * 강조 대상은 실제 화면 요소에 붙인 `data-tour="…"` 이름이다 — 클래스·id는 디자인 작업 중에
 * 자주 바뀌므로 가이드는 이 이름에만 기대고, 화면 쪽은 이 이름을 지우지 않는다.
 *
 * 규칙
 *   · 대상이 화면에 없거나 숨겨져 있으면 그 단계는 건너뛴다(`fallback`이 있으면 그걸 대신 보여준다).
 *     예: TIMELINE의 "지금" 버튼은 여행 기간에만 보인다 → 그 밖엔 "동선 수정"으로 대신.
 *   · `prepare`는 대상이 열려 있어야 보이는 경우(오른쪽 패널 안 탭 등) 먼저 실행할 동작 이름이다.
 *     실제 동작은 tour.ts의 PREPARE 표에 있다.
 *   · 내용을 크게 바꾸면 그 가이드의 `version`을 올린다 → 이미 본 사람에게도 한 번 더 뜬다.
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
      { target: 'brainstorm-search', title: '장소 체크인', body: '장소 이름을 입력하면 Google에서 찾아 사진·평점과 함께 저장한다. 링크나 메모도 그대로 넣을 수 있다.' },
      {
        target: 'brainstorm-suggest',
        title: '게이트로 분류',
        body: '새 카드는 대기 중에 들어간다. 제안된 게이트를 적용하거나 원하는 게이트로 끌어 놓는다.',
        fallback: { target: 'brainstorm-inbox', title: '게이트로 분류', body: '새 카드는 대기 중에 들어간다. 원하는 게이트로 끌어 놓아 분류한다.' },
      },
      { target: 'brainstorm-gates', title: 'VISIT · FOOD · ACTIVITY · STAY', body: 'STAY 게이트에 넣은 장소가 숙소 후보가 된다. 나머지는 동선의 재료.' },
      { target: 'brainstorm-monthly-picks', title: '이번 달 추천', body: '여행지와 이번 달 기준 추천. ＋로 대기 목록에 담는다.' },
      { target: 'brainstorm-map', title: '위치 한눈에', body: '모은 장소를 지도에서 게이트 색으로 본다. 숙소 후보가 모이면 STAY로 이동.' },
    ],
  },
  {
    id: 'stay',
    label: 'STAY',
    gate: 'shortlist',
    version: 1,
    steps: [
      { target: 'stay-summary', title: '기간과 예산', body: '여기 값이 숙소 검색 사이트로 전달된다. 예산은 1박 1인 기준.' },
      { target: 'stay-import', title: '후보 추가', body: '예약 사이트에서 본 숙소 이름을 붙여넣으면 후보에 추가된다. IDEAS의 STAY 카드도 자동으로 후보.' },
      { target: 'stay-candidates', title: '후보 비교', body: '숙박비를 넣으면 1박 평균이 계산된다. 이동시간은 담아 둔 장소 기준 추정. 아닌 후보는 ✕로 탈락.' },
      { target: 'stay-compare', title: '나란히 보기', body: '체크한 후보 2개 이상을 항목별로 비교한다.' },
      { target: 'stay-confirm', title: '여행 중심 숙소', body: '고른 숙소를 기준으로 동선이 계산된다. 확정 단계에서 멤버 투표도 요청할 수 있다.' },
    ],
  },
  {
    id: 'route',
    label: 'ROUTE',
    gate: 'route',
    version: 1,
    steps: [
      // 숙소를 아직 확정하지 않은 빈 화면에서만 보이는 단계 — 나머지 단계는 대상이 없어 자동으로 빠진다
      { target: 'route-need-stay', title: '숙소 먼저', body: 'STAY에서 숙소를 먼저 확정한다. 확정한 숙소가 하루의 출발점이 된다.' },
      { target: 'route-days', title: '날짜 고르기', body: '날짜마다 동선을 따로 만든다. 필요하면 DAY를 추가한다.' },
      { target: 'route-library', title: '장소 담기', body: 'IDEAS에서 모은 장소가 여기 있다. ＋로 선택한 날에 담는다.' },
      { target: 'route-plan', title: '순서와 시각', body: '1번은 확정한 숙소. 카드를 끌어 순서를 바꾸고 고정할 시각은 직접 입력한다.' },
      { target: 'route-refine', title: '동선 다듬기', body: '순서 정리는 이동이 짧은 순서로 바꾼다. 이동시간은 추정이고, 실제 경로 보기로 실측값을 받는다.' },
      { target: 'route-to-timeline', title: '시간표로', body: '동선이 정리되면 TIMELINE에서 시간 단위로 다듬는다.' },
    ],
  },
  {
    id: 'timeline',
    label: 'TIMELINE',
    gate: 'timeline',
    version: 1,
    steps: [
      { target: 'timeline-empty', title: '동선 먼저', body: 'ROUTE에서 하루 동선을 만들면 여기서 시간 단위로 다듬는다.' },
      { target: 'timeline-days', title: '날짜별 밀도', body: '막대 길이로 어느 날이 빡빡한지 본다. 전체는 모든 날을 나란히 비교.' },
      { target: 'timeline-time', title: '시각 고정', body: '시각을 입력하면 고정되고 뒤 일정이 다시 계산된다. 비우면 자동 계산으로 돌아간다.' },
      { target: 'timeline-card', title: '장소 상세', body: '카드를 누르면 장소 정보와 준비 체크리스트가 열린다. AI 요약은 버튼을 눌러야 생성된다.' },
      {
        target: 'timeline-now',
        title: '여행 중',
        body: '여행 기간이면 오늘 일정과 현재 시각선으로 이동한다.',
        fallback: { target: 'timeline-route', title: '동선 수정', body: '장소를 넣고 빼는 큰 수정은 ROUTE에서 한다. 여기서 고친 순서·시각도 ROUTE에 반영된다.' },
      },
    ],
  },
  {
    id: 'checklist',
    label: 'Checklist',
    gate: 'checklist',
    version: 1,
    steps: [
      { target: 'checklist-suggest', title: '이 여행 기준 추천', body: '저장된 항공·숙소·일정·여행지를 근거로 만든 항목. 담으면 목록에 추가된다.' },
      { target: 'checklist-quick', title: '직접 추가', body: '항목을 입력하고 Enter. 눌러서 담당자·기한·연결 문서를 정한다.' },
      { target: 'checklist-list', title: '함께 체크', body: '체크하면 모든 멤버에게 같은 상태로 보이고, 완료한 사람이 기록된다.' },
    ],
  },
  {
    id: 'docs',
    label: 'Documents',
    gate: 'docs',
    version: 1,
    steps: [
      { target: 'docs-add', title: '원본 보관', body: 'PDF·JPG·PNG, 최대 20MB. DAY를 지정하면 그날 타임라인에 연결된다.' },
      { target: 'docs-scope', title: '공용과 개인', body: '공용은 모든 멤버가 본다. 개인은 4자리 PIN으로 잠근다(멤버끼리 구분용 잠금).' },
      { target: 'docs-notes-tab', title: '텍스트 정보', body: '수하물 규정처럼 적어 둘 정보는 메모로. 고정과 확인 완료 표시가 있다.' },
    ],
  },
  {
    id: 'notes',
    label: 'Notes',
    gate: 'notes',
    version: 1,
    steps: [
      { target: 'docs-add', title: '새 메모', body: '수하물 규정·체크인 시간처럼 적어 둘 정보는 메모로 남긴다.' },
      { target: 'notes-cats', title: '분류와 표시', body: '분류로 좁혀 본다. 메모마다 고정과 확인 완료 표시를 쓸 수 있다.' },
    ],
  },
  {
    id: 'expense',
    label: 'Expense',
    gate: 'expense',
    version: 1,
    steps: [
      { target: 'expense-tabs', title: '예산부터 정산까지', body: '예산 요약 · 지출 내역 · 정산 · 동행 · 설정. 예산은 설정 탭에서 정한다.' },
      { target: 'expense-quickadd', title: '지출 기록', body: '현지 통화로 입력하면 원화로 환산해 저장한다. 공동 지출이면 분담이 계산된다.' },
      { target: 'expense-settle', title: '누가 누구에게', body: '결제 완료된 공동 지출로 차액과 송금 제안을 만든다.' },
    ],
  },
  {
    id: 'links',
    label: 'Links',
    gate: 'links',
    version: 1,
    steps: [
      { target: 'links-list', title: '채팅 링크 모음', body: '채팅에 보낸 링크가 자동으로 분류되어 모인다. 직접 추가는 채팅에서.' },
      { target: 'links-groups', title: '나만의 묶음', body: '링크를 주제별 그룹에 담아 다시 찾는다.' },
    ],
  },
  {
    // 오른쪽 패널 — 어느 게이트에서나 쓰는 거라 자동 실행하지 않고 도움말에서만 연다
    id: 'panel',
    label: '채팅 · Assistant',
    version: 1,
    steps: [
      { target: 'panel-fab', title: '채팅과 Assistant', body: '멤버 채팅은 Collaborate, 문서·메모 질문은 Assistant.' },
      { target: 'panel-assistant', title: '자료 기반 답변', body: 'DOCUMENTS와 NOTES 내용만 근거로 답하고, 참고한 자료를 함께 보여준다.', prepare: 'openPanelAssistant' },
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
