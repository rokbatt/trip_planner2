/**
 * 여행 화면(#trip/:id/:gate)의 메뉴 이름 목록 — 주소에 들어올 수 있는 값의 기준.
 * 목록에 없는 이름(오타, 손으로 고친 주소, 예전 메뉴 이름)은 기본 화면으로 보낸다.
 * 메뉴를 추가하면 여기와 workspace.ts의 화면 분기를 같이 고친다.
 */
export const GATE_TITLES: Record<string, string> = {
  ideas: 'BRAINSTORM BOARD',
  shortlist: 'CANDIDATE POOL',
  route: 'ROUTE PLANNER',
  timeline: 'TIMELINE',
  go: 'TRAVEL COMPANION',
  checklist: 'CHECKLIST',
  expense: 'EXPENSE',
  links: 'LINKS',
  docs: 'DOCUMENTS',
  notes: 'NOTES',
};

export function isKnownGate(gate: string | undefined): gate is string {
  return !!gate && Object.prototype.hasOwnProperty.call(GATE_TITLES, gate);
}
