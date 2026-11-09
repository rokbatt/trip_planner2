/**
 * 환영 안내 문구 — 온보딩 기획안 PART 1 "최종 문구" 표를 그대로 옮겼다(화면 코드는 welcome.ts).
 * 내용을 크게 바꾸면 onboardingStore의 WELCOME_VERSION을 올린다 → 이미 본 사람에게도 한 번 더 뜬다.
 */

export const WELCOME_COPY = {
  label: 'WELCOME TO MONGSIL',
  title: '여행 준비를 한 곳에서, 동행자와 함께',
  intro: '장소 수집부터 숙소·동선·서류·경비까지. 여행 중에는 휴대폰으로 그날 일정을 따라간다.',
  start: '시작하기',
  skip: '건너뛰기',
  flow: [
    { step: '모으기', title: '가고 싶은 곳부터 모은다', body: '장소·링크·메모를 넣고 VISIT·FOOD·ACTIVITY·STAY로 나눈다.', gates: ['01 IDEAS'] },
    { step: '정하기', title: '숙소를 정하고 날짜별 동선을 짠다', body: '확정한 숙소가 하루의 출발점. 장소를 DAY에 담으면 이동시간이 계산된다.', gates: ['02 STAY', '03 ROUTE', '04 TIMELINE'] },
    { step: '떠나기', title: '여행 중에는 휴대폰 하나로', body: '오늘 일정, 길찾기, 예약 서류, 지출 기록. 인터넷이 끊겨도 저장한 서류는 열린다.', gates: ['Companion'] },
  ],
} as const;
