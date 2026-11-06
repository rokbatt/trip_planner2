/**
 * 랜딩의 "제품 화면" — 실제 방콕 여행(ICN → BKK, 10.26 – 10.30, 3명)에서 쓴 화면을 HTML로 다시 그린 것.
 *
 * 스크린샷 이미지를 넣지 않고 다시 그리는 이유
 *  - 개인정보: 원본 화면에는 동행자 이름·프로필 사진이 있다. 다시 그리면서 사람은 전부 "멤버"나
 *    이니셜 없는 회색 원으로 바꿨다. 블러 처리한 스크린샷은 흔적이 남고, 나중에 원본이 섞여 들어오기 쉽다.
 *  - 선명도: 어떤 화면 폭에서도 글자가 깨지지 않고, 모바일에서는 열을 쌓아 다시 배치할 수 있다.
 *
 * 숫자·장소·시간·요금은 실제 기록 그대로다(원칙 3-1 — 지어낸 값을 넣지 않는다). 사진은 넣지 않고
 * 장소 종류 아이콘으로 대신한다. 지도는 실제 지도가 아니라 같은 배치를 단순화해 그린 그림이다.
 * 이 파일의 값을 바꾸려면 "실제로 그렇게 기록된 값인가"를 먼저 확인할 것.
 */

/* ── 작은 아이콘 (선 아이콘, currentColor) ── */
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const IC = {
  bus: svg('<rect x="5" y="3" width="14" height="14" rx="2"/><path d="M5 11h14M8 21v-4M16 21v-4"/><circle cx="8.5" cy="14" r=".6"/><circle cx="15.5" cy="14" r=".6"/>'),
  store: svg('<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v11H4z"/><path d="M10 20v-5h4v5"/>'),
  cup: svg('<path d="M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10h2a2 2 0 0 1 0 4h-2M8 3v2M11 3v2"/>'),
  cross: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>'),
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  card: svg('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h3"/>'),
  car: svg('<path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v3H3z"/><circle cx="7.5" cy="13" r=".7"/><circle cx="16.5" cy="13" r=".7"/>'),
  cart: svg('<path d="M3 4h2l2.5 11h10L20 8H7"/><circle cx="9" cy="19" r="1.2"/><circle cx="17" cy="19" r="1.2"/>'),
  clock: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'),
  walk: svg('<circle cx="13" cy="4.5" r="1.6"/><path d="M10 21l2-6-2-3 1-4 3 3 3 1M8 12l2-4"/>'),
  home: svg('<path d="M4 11l8-6 8 6v9H4z"/><path d="M10 20v-5h4v5"/>'),
  pin: svg('<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>'),
  hotel: svg('<path d="M5 21V4h14v17"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M10 21v-4h4v4"/>'),
  temple: svg('<path d="M12 2l1.5 4h-3z"/><path d="M6 10l6-4 6 4"/><path d="M4 14l8-4 8 4"/><path d="M6 14v6h12v-6M10 20v-3h4v3"/>'),
  spa: svg('<path d="M12 20c-4 0-7-2.5-7-6 3 0 5 1 7 3 2-2 4-3 7-3 0 3.5-3 6-7 6z"/><path d="M12 17c-1.5-2.5-1.5-5.5 0-9 1.5 3.5 1.5 6.5 0 9z"/>'),
  food: svg('<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10"/><path d="M16 21V3c-2 1.5-3 4-3 7h3"/>'),
  taxi: svg('<path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v3H3z"/><path d="M10 6V4h4v2"/>'),
  train: svg('<rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 11h12M9 21l1.5-4M15 21l-1.5-4"/>'),
  bag: svg('<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  plane: svg('<path d="M3 13l18-7-5 15-3.5-6.5z"/><path d="M12.5 14.5L21 6"/>'),
  ticket: svg('<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/>'),
  sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>'),
  receipt: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  image: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M20 16l-5-5-8 8"/>'),
  check: svg('<path d="M5 12l5 5 9-10"/>'),
  ext: svg('<path d="M9 5h10v10M19 5L8 16"/>'),
  doc: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h4"/>'),
  vote: svg('<path d="M4 12l4 4 4-4M8 16V4"/><path d="M20 12l-4-4-4 4M16 8v12"/>'),
};

/** 브라우저 창 모양 틀 — 실제 화면 상단의 "게이트 이름 · ICN → BKK" 헤더를 그대로 옮긴다 */
function frame(gate: string, body: string, extraClass = ''): string {
  return `
    <div class="ls-frame ${extraClass}">
      <div class="ls-frame-bar">
        <span class="ls-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="ls-frame-gate">${gate}</span>
        <span class="ls-frame-trip"><b>ICN → BKK</b> 방콕 · 10.26 – 10.30</span>
        <span class="ls-avatars" aria-label="멤버 3명"><i></i><i></i><i></i></span>
      </div>
      <div class="ls-frame-body">${body}</div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════
 * 지도 그림 — 방콕 동선(DAY 2)을 단순화해 그린다.
 * 실제 좌표가 아니라 배치만 비슷하게: 짜오프라야강 동쪽의 왕궁·왓 프라깨우·왓 포 묶음,
 * 강 건너 왓 아룬, 동쪽 수쿰윗의 숙소, 오른쪽 끝 공항 숙소.
 * ══════════════════════════════════════════════════════════ */

const ROUTE_BLUE = '#2F5FD0';
const NAVY = '#0B2A5C';
const STOP_PURPLE = '#7F77DD';

/** route.ts pinTearPath와 같은 식의 핀치드 벌룬 (auth.ts와 같은 모양) */
function pinPath(cx: number, cy: number, r: number, tipY: number): string {
  const d = tipY - cy;
  const k = (v: number) => Math.round(v * 100) / 100;
  return (
    `M${k(cx)} ${k(tipY)}` +
    ` C${k(cx - 0.087 * d)} ${k(tipY - 0.55 * d)} ${k(cx - r)} ${k(cy + 0.545 * r)} ${k(cx - r)} ${k(cy)}` +
    ` A${r} ${r} 0 1 1 ${k(cx + r)} ${k(cy)}` +
    ` C${k(cx + r)} ${k(cy + 0.545 * r)} ${k(cx + 0.087 * d)} ${k(tipY - 0.55 * d)} ${k(cx)} ${k(tipY)} Z`
  );
}

function pin(x: number, y: number, color: string, label: string, r = 10): string {
  const cy = y - r * 2.2;
  return `
    <g>
      <ellipse cx="${x}" cy="${y + 1}" rx="${r * 0.45}" ry="${r * 0.16}" fill="rgba(11,42,92,.2)"/>
      <path d="${pinPath(x, cy, r, y)}" fill="${color}"/>
      <circle cx="${x}" cy="${cy}" r="${r * 0.76}" fill="#fff"/>
      <text x="${x}" y="${cy + 3.6}" text-anchor="middle" class="ls-map-num" fill="${color}">${label}</text>
    </g>`;
}

/** DAY 2 동선. 번호는 동선 화면의 번호와 같다(R = 잠깐 들르기) */
const ROUTE_STOPS: Array<[number, number, string, string]> = [
  [556, 214, '1', NAVY],
  [392, 232, 'R', STOP_PURPLE],
  [178, 196, '2', ROUTE_BLUE],
  [206, 170, '3', ROUTE_BLUE],
  [190, 236, '4', ROUTE_BLUE],
  [248, 146, '5', ROUTE_BLUE],
  [240, 272, '6', ROUTE_BLUE],
  [112, 240, '7', ROUTE_BLUE],
];

/** viewBox·정렬을 받아 놓는 이유: 동선 화면은 왼쪽을 장소 목록 패널이 덮고(오른쪽 정렬),
 *  시각표 화면은 세로로 길어서 보여 줄 범위가 다르다 */
export function bangkokMapSvg(label = 'DAY 2 · 11곳', viewBox = '0 0 600 400', align = 'xMidYMid'): string {
  const line = ROUTE_STOPS.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  const [ox, oy] = viewBox.split(' ').map(Number);
  return `
  <svg class="ls-map-svg" viewBox="${viewBox}" preserveAspectRatio="${align} slice" role="img"
       aria-label="방콕 DAY 2 동선 지도. 공항 근처 숙소에서 출발해 짐을 맡기고, 왕궁·왓 프라깨우·왓 포를 지나 왓 아룬까지 잇는 경로입니다.">
    <rect x="-400" y="-200" width="1400" height="800" fill="#F3F7F2"/>
    <!-- 공원 -->
    <path d="M300,40 C340,30 380,50 372,86 C364,118 318,120 300,100 C286,84 282,52 300,40Z" fill="#DCEFD9"/>
    <path d="M430,300 C470,290 520,300 516,334 C512,364 450,368 432,346 C418,330 414,306 430,300Z" fill="#DCEFD9"/>
    <path d="M60,330 C90,316 130,330 122,356 C114,380 70,382 58,364 C48,350 46,338 60,330Z" fill="#DCEFD9"/>
    <!-- 도로 -->
    <g stroke="#E2E8EE" stroke-width="6" fill="none" stroke-linecap="round">
      <path d="M-300,268 C160,250 300,258 700,230"/>
      <path d="M206,-100 C222,120 240,260 236,600"/>
      <path d="M358,-100 C364,140 372,280 404,600"/>
      <path d="M-300,126 C180,110 420,128 700,100"/>
    </g>
    <!-- 고속도로 (공항 방면) -->
    <path d="M300,280 C400,262 500,236 610,220" stroke="#F4C99A" stroke-width="4" fill="none" stroke-linecap="round"/>
    <!-- 짜오프라야강 -->
    <path d="M110,-120 C146,70 102,124 128,184 C150,236 118,282 178,330 C224,368 300,372 380,560"
          stroke="#BFE1F5" stroke-width="22" fill="none" stroke-linecap="round"/>
    <!-- 지역 이름 -->
    <g class="ls-map-area">
      <text x="236" y="296">라따나꼬신</text>
      <text x="420" y="196">수쿰윗</text>
      <text x="470" y="180">공항 방면 →</text>
      <text x="42" y="168">톤부리</text>
    </g>
    <!-- 동선 -->
    <path d="${line}" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${line}" stroke="${ROUTE_BLUE}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    ${ROUTE_STOPS.map(([x, y, n, c]) => pin(x, y, c, n)).join('')}
    ${label ? `<g class="ls-map-chip">
      <rect x="${ox + 14}" y="${oy + 14}" width="${label.length * 9 + 26}" height="26" rx="7" fill="#fff"/>
      <text x="${ox + 27}" y="${oy + 31}">${label}</text>
    </g>` : ''}
  </svg>`;
}

/* ══════════════════════════════════════════════════════════
 * 1) 채팅 — 링크가 칩으로 쌓이는 모습 (REAL-TIME)
 * 실제 채팅 순서·시각 그대로. 보낸 사람은 "멤버 A/B"로 바꿨다.
 * ══════════════════════════════════════════════════════════ */
export function chatShotHtml(): string {
  type Msg = { who: 'me' | 'A' | 'B'; host: string; kind: 'agoda' | 'naver'; time: string };
  const msgs: Msg[] = [
    { who: 'me', host: 'agoda.com', kind: 'agoda', time: '오후 12:36' },
    { who: 'A', host: 'agoda.com', kind: 'agoda', time: '오후 12:39' },
    { who: 'me', host: 'm.blog.naver.com', kind: 'naver', time: '오후 12:42' },
    { who: 'me', host: 'm.blog.naver.com', kind: 'naver', time: '오후 12:44' },
    { who: 'A', host: 'agoda.com', kind: 'agoda', time: '오전 9:14' },
    { who: 'me', host: 'agoda.com', kind: 'agoda', time: '오전 9:24' },
    { who: 'B', host: 'agoda.com', kind: 'agoda', time: '오전 9:29' },
    { who: 'B', host: 'blog.naver.com', kind: 'naver', time: '오전 9:30' },
  ];
  const fav = (k: Msg['kind']) => `<span class="ls-fav is-${k}">${k === 'agoda' ? 'a' : 'b'}</span>`;
  const rows = msgs.map((m, i) => {
    const prev = msgs[i - 1];
    const showWho = m.who !== 'me' && prev?.who !== m.who;
    const chip = `<span class="ls-chip">${fav(m.kind)}${m.host}${IC.ext}</span>`;
    if (m.who === 'me') {
      return `<div class="ls-chat-row is-me"><span class="ls-chat-time">${m.time}</span><span class="ls-bubble is-me">${chip}</span></div>`;
    }
    return `
      <div class="ls-chat-row${showWho ? '' : ' is-cont'}">
        <span class="ls-chat-av is-${m.who}" aria-hidden="true"></span>
        <div>
          ${showWho ? `<span class="ls-chat-who">멤버 ${m.who}</span>` : ''}
          <span class="ls-bubble">${chip}</span>
        </div>
        <span class="ls-chat-time">${m.time}</span>
      </div>`;
  }).join('');
  return `
    <div class="ls-chat" aria-label="여행 채팅. 숙소 예약 사이트와 블로그 링크가 이어서 올라온 모습">
      <div class="ls-chat-head"><span>CHAT</span>방콕 · 멤버 3</div>
      <div class="ls-chat-list">${rows}</div>
      <div class="ls-chat-foot">
        <span class="ls-chat-input">메시지 또는 링크 붙여넣기</span>
        <span class="ls-chat-send">${IC.plane}</span>
      </div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════
 * 2) CANDIDATE POOL — 숙소 확정 화면 (STAY)
 * ══════════════════════════════════════════════════════════ */
export function stayShotHtml(): string {
  const infra: Array<[string, string, string, string]> = [
    ['대중교통 (역/정류장)', '1분 · 100m', IC.bus, '#2F80ED'],
    ['편의점', '1분 · 62m', IC.store, '#16A34A'],
    ['카페', '1분 · 50m', IC.cup, '#D97706'],
    ['약국', '1분 · 57m', IC.cross, '#E5484D'],
    ['병원/클리닉', '4분 · 325m', IC.heart, '#D6409F'],
    ['ATM', '1분 · 11m', IC.card, '#CA8A04'],
    ['택시 승차장', '24분 · 1.9km', IC.car, '#EA580C'],
    ['슈퍼마켓', '8분 · 624m', IC.cart, '#7C3AED'],
  ];
  const tiles: Array<[string, string, string, string, string]> = [
    ['평균 이동시간', '20분', '전체 장소 기준', IC.clock, '#2F80ED'],
    ['도보권 장소', '4곳', '도보 15분 이내', IC.walk, '#12A594'],
    ['대중교통 접근성', '아주 좋음', '도보 1분', IC.bus, '#7C3AED'],
    ['편의시설 접근성', '아주 좋음', '평균 도보 2분 (5/5)', IC.home, '#D97706'],
    ['관광지 접근성', '좋음', '담은 관광지 14곳 평균', IC.temple, '#E5484D'],
    ['편의점 접근성', '아주 좋음', '도보 1분', IC.cart, '#16A34A'],
  ];
  const stars = (n: number) => '★'.repeat(n) + `<i>${'★'.repeat(5 - n)}</i>`;
  const scores: Array<[string, number]> = [
    ['이동 편의성', 4], ['관광 접근성', 3], ['편의시설', 4], ['위치 만족도', 4], ['가성비', 3],
  ];

  const body = `
    <p class="ls-ask">이 숙소를 여행의 중심으로 확정할까요?</p>
    <div class="ls-stay">
      <div class="ls-col">
        <section class="ls-card">
          <h4 class="ls-card-title">여행 중심 요약</h4>
          <div class="ls-hotel">
            <div class="ls-thumb is-hotel">${IC.hotel}</div>
            <div class="ls-hotel-info">
              <p class="ls-hotel-name">이스틴 그랜드 호텔 사톤 <span class="ls-stars">★★★★★</span><b>4.7</b></p>
              <span class="ls-tag">숙소</span>
              <p class="ls-muted">33/1 S Sathon Rd, Yannawa, Sathon, Bangkok</p>
              <dl class="ls-fields">
                <div><dt>선택 지역</dt><dd>사톤</dd></div>
                <div><dt>숙박 기간</dt><dd>10.29 – 10.30</dd></div>
              </dl>
            </div>
          </div>
        </section>
        <section class="ls-card">
          <h4 class="ls-card-title">주변 편의 인프라</h4>
          <div class="ls-infra">
            <div class="ls-infra-map" aria-hidden="true">
              <svg viewBox="0 0 240 180" preserveAspectRatio="xMidYMid slice">
                <rect width="240" height="180" fill="#F4F8F3"/>
                <path d="M-10,40 C40,60 30,120 70,190" stroke="#BFE1F5" stroke-width="16" fill="none"/>
                <g stroke="#E2E8EE" stroke-width="5" fill="none"><path d="M0,104 H240"/><path d="M150,0 V180"/><path d="M60,0 L240,150"/></g>
                <path d="M170,120 C200,112 226,128 222,156 C218,178 180,180 168,162 C160,148 158,126 170,120Z" fill="#DCEFD9"/>
                <g fill="none" stroke="#9AA9BA" stroke-dasharray="3 4"><circle cx="138" cy="96" r="30"/><circle cx="138" cy="96" r="58"/><circle cx="138" cy="96" r="86"/></g>
                <g>
                  <circle cx="122" cy="84" r="5" fill="#2F80ED"/><circle cx="152" cy="80" r="5" fill="#16A34A"/>
                  <circle cx="146" cy="112" r="5" fill="#D97706"/><circle cx="124" cy="108" r="5" fill="#E5484D"/>
                  <circle cx="176" cy="66" r="5" fill="#D6409F"/><circle cx="96" cy="128" r="5" fill="#7C3AED"/>
                </g>
                <path d="${pinPath(138, 74, 9, 96)}" fill="${NAVY}"/><circle cx="138" cy="74" r="4" fill="#fff"/>
              </svg>
              <span class="ls-infra-legend">도보 5분 · 10분 · 15분</span>
            </div>
            <ul class="ls-infra-list">
              ${infra.map(([n, d, ic, c]) => `<li><span class="ls-ic" style="--c:${c}">${ic}</span><span>${n}</span><b>${d}</b></li>`).join('')}
            </ul>
          </div>
        </section>
        <section class="ls-card ls-score">
          <div class="ls-score-big"><b>80</b><span>/100</span><em>Good</em><small>여행 거점으로 적합한 숙소예요</small></div>
          <ul class="ls-score-list">
            ${scores.map(([n, s]) => `<li><span>${n}</span><span class="ls-stars">${stars(s)}</span></li>`).join('')}
          </ul>
        </section>
      </div>
      <div class="ls-col">
        <section class="ls-card">
          <h4 class="ls-card-title">이 숙소를 선택하면</h4>
          <div class="ls-tiles">
            ${tiles.map(([t, v, s, ic, c]) => `
              <div class="ls-tile">
                <span class="ls-ic" style="--c:${c}">${ic}</span>
                <span class="ls-tile-t">${t}</span>
                <b class="ls-tile-v">${v}</b>
                <span class="ls-tile-s">${s}</span>
              </div>`).join('')}
          </div>
        </section>
        <section class="ls-card">
          <h4 class="ls-card-title">AI 리뷰 요약</h4>
          <p class="ls-muted">실제 이용자 후기를 AI가 찾아 정리해 드려요.</p>
          <span class="ls-btn is-dark">${IC.sparkle}AI 리뷰 요약 보기</span>
        </section>
        <section class="ls-card">
          <h4 class="ls-card-title">멤버 투표</h4>
          <p class="ls-muted">이 숙소가 어떤지 다른 멤버에게 물어보세요.</p>
          <span class="ls-btn">${IC.vote}멤버에게 투표 요청</span>
        </section>
      </div>
    </div>`;
  return frame('CANDIDATE POOL', body, 'is-stay');
}

/* ══════════════════════════════════════════════════════════
 * 3) ROUTE PLANNER — 지도 + DAY 2 동선 목록 (ROUTE)
 * ══════════════════════════════════════════════════════════ */
type Leg = { mode: 'taxi' | 'walk' | 'transit'; text: string; est?: boolean };
type Stop = { n: string; name: string; cat: string; time: string; note?: string; leg?: Leg };

const LEG_ICON = { taxi: IC.taxi, walk: IC.walk, transit: IC.train } as const;
const LEG_NAME = { taxi: '택시', walk: '도보', transit: '대중교통' } as const;

export function routeShotHtml(): string {
  const stops: Stop[] = [
    { n: '1', name: '골든 포이어 스완나품 에어포트 호텔', cat: '숙소', time: '09:00', leg: { mode: 'taxi', text: '1시간 18분 · 230 THB', est: true } },
    { n: 'R', name: 'Rembrandt Residences Bangkok', cat: '잠깐 들르기 · 짐 보관', time: '10:18', leg: { mode: 'taxi', text: '25분 · 100 THB', est: true } },
    { n: '2', name: '방콕 왕궁', cat: '공원', time: '11:43', leg: { mode: 'walk', text: '4분 · 291m', est: true } },
    { n: '3', name: '왓 프라깨우', cat: '사원', time: '12:47', leg: { mode: 'walk', text: '9분 · 726m', est: true } },
    { n: '4', name: '왓 포', cat: '종교시설', time: '13:56', leg: { mode: 'transit', text: '12분 · 32 THB', est: true } },
    { n: '5', name: '크루아압쏜', cat: '음식점', time: '15:08', leg: { mode: 'walk', text: '2분 · 22m', est: true } },
    { n: '6', name: 'Pimaan Thai Massage', cat: '명소', time: '16:25', leg: { mode: 'transit', text: '14분 · 32 THB', est: true } },
    { n: '7', name: '아룬 사원 (왓 아룬)', cat: '사원', time: '17:39' },
  ];
  const pool: Array<[string, string, boolean]> = [
    ['왓 포', '종교시설', true], ['방콕 왕궁', '공원', true], ['티추까 루프탑바', '바', false],
    ['아룬 사원', '사원', true], ['쩟페어 랏차다', '야시장', false], ['아시아티크', '시장', true],
    ['엠포리움 백화점', '쇼핑', false],
  ];
  const days = ['DAY 1|10.26 (월)', 'DAY 2|10.27 (화)', 'DAY 3|10.28 (수)', 'DAY 4|10.29 (목)', 'DAY 5|10.30 (금)'];

  const list = stops.map((s) => `
    <li class="ls-stop${s.n === 'R' ? ' is-visit' : ''}">
      <span class="ls-stop-n">${s.n === 'R' ? IC.hotel : s.n}</span>
      <span class="ls-stop-body"><b>${s.name}</b><small>${s.cat}</small></span>
      <span class="ls-stop-time">${s.time}</span>
    </li>
    ${s.leg ? `<li class="ls-leg is-${s.leg.mode}">${LEG_ICON[s.leg.mode]}<span>${LEG_NAME[s.leg.mode]} ${s.leg.text}</span>${s.leg.est ? '<em>추정</em>' : ''}</li>` : ''}
  `).join('');

  const body = `
    <div class="ls-route-top">
      <div class="ls-daytabs">
        ${days.map((d, i) => { const [a, b] = d.split('|'); return `<span class="${i === 1 ? 'is-on' : ''}"><b>${a}</b>${b}</span>`; }).join('')}
      </div>
      <span class="ls-btn is-ghost">→ 타임라인으로</span>
    </div>
    <div class="ls-route">
      <div class="ls-route-map">
        ${bangkokMapSvg('', '-250 -120 870 640', 'xMaxYMid')}
        <div class="ls-pool">
          <span class="ls-pool-search">장소 검색</span>
          <div class="ls-pool-cats"><i style="--c:#E5484D">관광</i><i style="--c:#16A34A">맛집</i><i style="--c:#7C3AED">액티비티</i><i style="--c:#D97706">쇼핑</i></div>
          <ul>
            ${pool.map(([n, c, on]) => `<li><span class="ls-pool-th"></span><span><b>${n}</b><small>${c}</small></span><span class="ls-pool-add${on ? ' is-on' : ''}">${on ? IC.check : '+'}</span></li>`).join('')}
          </ul>
        </div>
      </div>
      <aside class="ls-route-side">
        <div class="ls-route-head"><b>DAY 2</b> 10.27 (화)</div>
        <span class="ls-btn is-dark is-block">${IC.sparkle}AI 일정 짜기</span>
        <ul class="ls-stops">${list}</ul>
      </aside>
    </div>`;
  return frame('ROUTE PLANNER', body, 'is-route');
}

/* ══════════════════════════════════════════════════════════
 * 4) TIMELINE — DAY 2 시각표 (TIMELINE)
 * ══════════════════════════════════════════════════════════ */
export function timelineShotHtml(): string {
  const days: Array<[string, string, string]> = [
    ['DAY 1', '10.26 (월)', '3곳 · 3시간 24분'],
    ['DAY 2', '10.27 (화)', '11곳 · 12시간 13분'],
    ['DAY 3', '10.28 (수)', '8곳 · 9시간 0분'],
    ['DAY 4', '10.29 (목)', '8곳 · 8시간 36분'],
    ['DAY 5', '10.30 (금)', '2곳 · 4시간 30분'],
  ];
  const place = (time: string, n: string, name: string, cat: string, icon: string, tone: string, extra = '', stay = '') => `
    <div class="ls-tl-row">
      <span class="ls-tl-time"><b>${time}</b>${stay ? `<small>${stay}</small>` : ''}</span>
      <div class="ls-tl-card">
        <div class="ls-thumb is-${tone}">${icon}</div>
        <div class="ls-tl-info">
          <p><span class="ls-num">${n}</span><b>${name}</b></p>
          <small>${cat}</small>
          ${extra}
          <span class="ls-memo">메모 추가</span>
        </div>
        ${stay ? `<div class="ls-tl-stay"><small>예상 체류</small><b>${stay}</b></div>` : ''}
      </div>
    </div>`;
  const leg = (mode: 'taxi' | 'walk', mins: string, text: string, arrive: string, est = false) => `
    <div class="ls-tl-row is-leg">
      <span class="ls-tl-time"><small>${mins}</small></span>
      <div class="ls-tl-leg is-${mode}">
        <span class="ls-tl-leg-ic">${mode === 'taxi' ? IC.taxi : IC.walk}</span>
        <b>${mode === 'taxi' ? '택시' : '도보'}</b>
        <span class="ls-tl-leg-r"><b>${mins}</b>${text}${est ? '<em>추정</em>' : ''}<small>${arrive} 도착 예정</small></span>
      </div>
    </div>`;

  const body = `
    <div class="ls-tl-days">
      ${days.map(([d, dt, s], i) => `<span class="${i === 1 ? 'is-on' : ''}"><b>${d}</b> ${dt}<small>${s}</small></span>`).join('')}
    </div>
    <div class="ls-tl">
      <div class="ls-tl-main">
        <div class="ls-tl-head">
          <p><b>DAY 2</b> 10.27 (화) <span class="ls-pill">09:00 – 21:13</span></p>
          <p class="ls-muted ls-ellipsis">골든 포이어 스완나품 에어포트 호텔 → Rembrandt Residences Bangkok → 방콕 왕궁 → 왓 프라깨우 → 왓 포 → 크루아압쏜 …</p>
          <div class="ls-tl-stats">
            <span>일정 <b>11곳</b></span><span>이동 <b>2시간 43분</b></span><span>예상 교통비 <b>590 THB</b></span><span>관련 자료 <b>문서 2</b></span>
          </div>
          <p class="ls-insight">이동에만 2시간 43분이 걸리는 동선이에요. 가장 긴 구간은 골든 포이어 스완나품 에어포트 호텔 → Rembrandt Residences Bangkok(43분)이에요.</p>
        </div>
        ${place('09:00', '1', '골든 포이어 스완나품 에어포트 호텔', '숙소', IC.hotel, 'hotel', '<span class="ls-rate">★ 4.1</span>')}
        ${leg('taxi', '43분', '약 276 THB', '09:43')}
        <div class="ls-tl-row">
          <span class="ls-tl-time"><b>09:43</b><small>1시간</small></span>
          <div class="ls-tl-visit">${IC.hotel}<b>숙소 들르기</b><span>짐 보관</span></div>
        </div>
        ${leg('taxi', '25분', '약 100 THB', '11:08', true)}
        ${place('11:08', '3', '방콕 왕궁', '관광 · 공원', IC.temple, 'temple', '<span class="ls-rate">★ 4.6</span><span class="ls-hours">오전 8:30 ~ 오후 3:30</span>', '1시간')}
        ${leg('walk', '4분', '', '12:12', true)}
        ${place('12:12', '4', '왓 프라깨우', '관광 · 사원', IC.temple, 'gold', '', '1시간')}
      </div>
      <div class="ls-tl-map">${bangkokMapSvg('DAY 2 · 11곳', '70 -60 540 575')}</div>
    </div>`;
  return frame('TIMELINE', body, 'is-timeline');
}

/* ══════════════════════════════════════════════════════════
 * 5) EXPENSE — 예산 요약 (EXPENSE)
 * 금액은 실제 기록 그대로. "나의 부담액"처럼 한 사람의 몫이 드러나는 값은 넣지 않았다.
 * ══════════════════════════════════════════════════════════ */
export function expenseShotHtml(): string {
  const cats: Array<[string, string, string, string, number]> = [
    ['항공', '₩1,764,900', IC.plane, '#2F80ED', 71],
    ['숙소', '₩479,508', IC.hotel, '#E5484D', 19],
    ['관광·액티비티', '₩245,452', IC.ticket, '#D6409F', 10],
  ];
  const recent: Array<[string, string, string, string, string]> = [
    ['골든 포이어 스완나품 에어포트 호텔', '공동 지출', '₩43,000', IC.hotel, '#E5484D'],
    ['피피섬 투어', '공동 지출', '₩245,452', IC.ticket, '#D6409F'],
    ['항공권', '개인 지출 · 3명', '₩588,300', IC.plane, '#2F80ED'],
    ['렘브란트 레지던스 방콕', '공동 지출', '₩222,614', IC.hotel, '#E5484D'],
    ['이스틴 그랜드 호텔 사톤', '공동 지출', '₩213,894', IC.hotel, '#E5484D'],
  ];
  const body = `
    <div class="ls-tabs"><span class="is-on">예산 요약</span><span>지출 내역</span><span>정산</span><span>동행</span><span>설정</span></div>
    <div class="ls-exp">
      <div class="ls-col">
        <section class="ls-card ls-spent">
          <span class="ls-card-title">현재 사용</span>
          <b class="ls-big">₩2,489,860</b>
          <div class="ls-split-bar"><i style="width:29%"></i><i style="width:71%"></i></div>
          <p class="ls-legend"><span><i class="is-shared"></i>공동 지출 ₩724,960 (29%)</span><span><i class="is-own"></i>개인 지출 ₩1,764,900 (71%)</span></p>
        </section>
        <section class="ls-card">
          <h4 class="ls-card-title">카테고리별 사용</h4>
          <div class="ls-cats">
            ${cats.map(([n, v, ic, c, p]) => `
              <div class="ls-cat">
                <span class="ls-ic" style="--c:${c}">${ic}</span>
                <span class="ls-cat-n">${n}</span>
                <b>${v}</b>
                <span class="ls-cat-bar"><i style="width:${p}%;background:${c}"></i></span>
              </div>`).join('')}
          </div>
        </section>
        <section class="ls-card">
          <h4 class="ls-card-title">최근 지출</h4>
          <ul class="ls-recent">
            ${recent.map(([n, t, v, ic, c], i) => `
              <li>
                <span class="ls-ic" style="--c:${c}">${ic}</span>
                <span class="ls-recent-n"><b>${n}</b><small>${i === 2 ? '<em class="is-paid">PAID</em>' : '<em>정산완료</em>'}${t}</small></span>
                <span class="ls-recent-v">${v}${i === 2 ? '<small>1인당 · 총 ₩1,764,900</small>' : ''}</span>
              </li>`).join('')}
          </ul>
        </section>
      </div>
      <div class="ls-col">
        <section class="ls-card ls-settled">
          <h4 class="ls-card-title">정산 현황</h4>
          <p class="ls-done">${IC.check}공동 지출 정산을 모두 마쳤어요</p>
          <p class="ls-muted">정산 대기 0건 · 정산 완료 4건</p>
        </section>
        <section class="ls-card">
          <h4 class="ls-card-title">빠른 지출 추가</h4>
          <div class="ls-form">
            <span class="ls-input">카테고리 선택</span>
            <div class="ls-form-row"><span class="ls-input">금액</span><span class="ls-input is-s">THB</span></div>
            <div class="ls-seg is-sm"><span class="is-on">공동 지출</span><span>개인 지출</span></div>
            <span class="ls-btn is-blue is-block">저장</span>
          </div>
        </section>
      </div>
    </div>`;
  return frame('EXPENSE', body, 'is-expense');
}

/* ══════════════════════════════════════════════════════════
 * 6) 보드 — 링크로 모은 후보지 (IDEAS)
 * 동선·지출에 실제로 등장하는 장소들로 채웠다.
 * ══════════════════════════════════════════════════════════ */
export function boardShotHtml(): string {
  const cols: Array<[string, string, string[]]> = [
    ['가고싶어', '#E24B4A', ['방콕 왕궁', '왓 아룬', '아시아티크']],
    ['먹고싶어', '#1D9E75', ['크루아압쏜', '쩟페어 랏차다']],
    ['하고싶어', '#7F77DD', ['피피섬 투어', 'Pimaan Thai Massage', '티추까 루프탑바']],
  ];
  return `
    <div class="lp-board">
      <div class="lp-board-side">
        <div class="lp-board-dest is-active">방콕<span>4박</span></div>
        <div class="lp-board-dest lp-board-dest-add">+ 도시 추가</div>
      </div>
      <div class="lp-board-main">
        ${cols.map(([mood, color, items], ci) => `
          <div class="lp-board-col">
            <div class="lp-board-colhead"><span class="lp-board-dot" style="background:${color}"></span>${mood}<em>${items.length}</em></div>
            ${items.map((t, i) => `
              <div class="lp-board-card${ci === 0 && i === 0 ? ' is-picked' : ''}">
                <span class="lp-board-bar" style="background:${color}"></span>
                <span class="lp-board-name">${t}</span>
              </div>`).join('')}
          </div>`).join('')}
      </div>
    </div>`;
}
