# 몽실이 (Mongsil) — 프로젝트 컨텍스트

이 문서는 Claude Code가 이 프로젝트에서 작업할 때 최종 목표와 방향성을 잃지 않기 위한 참고 문서입니다.
코드를 수정하기 전에 이 문서를 먼저 읽고, 여기 명시된 원칙과 어긋나는 변경은 하지 마세요.

---

## 1. 이 프로젝트는 무엇인가

**몽실이**는 친구 간 협업 여행 계획 플랫폼입니다.

### 핵심 차별점
여행지가 결정된 직후, 여행 멤버들이 "여기 가고 싶다", "이거 먹고 싶다" 하고
**자유롭게 아이디어를 쏟아내는 브레인스토밍 에너지**를 그대로 담아내는 게 목표입니다.
기존 여행 플래너들처럼 처음부터 날짜별 일정표에 장소를 끼워 넣는 경직된 방식이 아니라,

```
브레인스토밍(자유 수집) → 지역/숙소 결정 → 동선 최적화 → 날짜별 일정
```

순서로 자연스럽게 좁혀나가는 흐름입니다.

### 타겟 사용자
유연하고 즉흥적인 여행을 선호하는 "P형" 여행자. 계획을 미리 촘촘히 짜는 걸 싫어하지만,
그렇다고 완전히 무계획으로 다니고 싶지도 않은 사람들.

### 브랜드 컨셉 — "인천공항 프리미엄 라운지"
전체 여정을 공항 메타포로 표현합니다. **이 컨셉은 절대 임의로 바꾸지 마세요.**

| 단계(Gate) | 공항 메타포 | 상태 |
|---|---|---|
| Brainstorm (IDEAS) | 자유 수집 | ✅ 완성 |
| Shortlist | Departure Hall → Immigration Counter → Boarding Pass | ✅ 완성 (Step1 지역선택 / Step2 숙소선택 / Step3 확정) |
| Route | 동선 최적화 | 🚧 플레이스홀더 |
| Timeline | 날짜별 일정 | 🚧 미구현 |

Shortlist 3단계 세부 컨셉:
- **Step1 (지역 선택)** = Departure Hall — "우리 여행의 중심 지역이 어디냐"만 결정
- **Step2 (숙소 선택)** = Immigration Counter — "숙소를 선택하면 여행의 중심이 결정된다"
- **Step3 (확정)** = Boarding Pass — 숙소 기준 이동효율 좋은 장소들을 확정, 다음 단계(Route)로 전달

---

## 2. 디자인 시스템 — "Airport Lounge Premium Light"

이 톤앤매너는 프로젝트 전체에서 반드시 일관되게 유지되어야 합니다.

- **컬러**: 딥네이비 `#0B2A5C` (포인트), 스카이블루 `#8FD8F8`, 배경 `#F8FBFE`
- **레퍼런스**: Linear / Notion / Stripe / Apple / Airbnb 수준의 미니멀 SaaS 느낌
- **타이포**: 제목은 `Instrument Serif`(세리프, 우아한 느낌), 본문은 Pretendard/시스템 폰트
- **원칙**:
  - 과한 그림자·과한 색상·과한 아이콘 금지
  - 여백을 충분히 확보 (Padding, Margin, Line-height 넉넉하게)
  - 카드는 Rounded, 테두리는 얇게
  - "관리자 페이지처럼 보이면 안 됨" — 실제 SaaS 서비스 수준의 완성도를 목표로 함
  - 보딩패스 감성의 점선 구분선(`border-bottom: 1px dashed rgba(130,150,170,0.18)`) 자주 사용
  - 카드 서페이스는 `rgba(255,255,255,0.82)` + `backdrop-filter: blur()`로 프리미엄 유리질감

---

## 3. 절대 원칙 (Non-negotiable)

이 프로젝트를 진행하며 반복적으로 강조된 원칙들입니다.

### 3-1. 데이터는 절대 지어내지 않는다
- 화면에 보여주는 숫자(평점, 이동시간, 가격 등)는 반드시 **실제 데이터 기반**이어야 함
- 실제 데이터가 없으면: (a) 명시적으로 "추정치/참고용"이라고 표시하거나 (b) 아예 UI에서 뺀다
- 예: 예약 사이트별 평점은 "Claude가 숙소 예약 목적으로 평가한 종합 점수"이지 그 사이트의 실제 이용자 평점이 아님 — 반드시 이렇게 명확히 구분해서 라벨링
- 예: 이동시간은 실제 Google API 데이터가 오기 전까진 직선거리 기반 추정치임을 표시

### 3-2. API 비용을 항상 의식한다
- 새 기능에서 외부 API(특히 Google Maps/Places, Gemini)를 쓸 땐 **호출 빈도를 최소화하는 캐싱 전략**을 먼저 설계
- **DB-first 원칙**: 캐싱 가능한 건 반드시 DB에 먼저 저장하고, 캐시 미스일 때만 API 호출
- 예: 여행지별 "숙박 생활권" 데이터는 `stay_zones` 테이블에 조사·검수된 고정 데이터로 관리 (AI 실시간 생성 아님). 아직 큐레이션 안 된 도시만 AI 폴백 사용
- 예: AI Monthly Picks는 `ai_monthly_picks` 테이블에 목적지+월 단위로 캐싱, "+" 클릭 시에만 Google Places 호출
- 새 API 활성화가 필요하면 반드시 무료 한도를 먼저 확인하고 사용자에게 안내

### 3-3. 인터랙션은 명시적이어야 한다
- **hover로 지도가 확대/강조되는 방식은 전부 제거됨** — 반드시 **클릭**해야 반응하도록
- 사용자가 "빈 공간 클릭하면 강조 해제" 같은 명시적 해제 수단을 항상 요구함 → 새 선택 UI를 만들 땐 항상 "이걸 어떻게 취소/해제하는가"를 먼저 설계

### 3-4. 기능보다 디자인 요청이 많을 땐 기능을 건드리지 않는다
- "디자인만 바꿔줘" 요청 시 로직/라우팅/상태관리는 절대 손대지 않음
- CSS와 마크업 구조 조정만으로 해결

---

## 4. 기술 스택

- **프론트엔드**: Vite + TypeScript (바닐라, 프레임워크 없음), 각 게이트가 `src/{module}/module.ts` + `module.css`로 독립 모듈화
- **백엔드/DB**: Supabase (Postgres + RLS + Storage + Realtime)
- **배포**: Vercel (서버리스 함수는 `api/*.ts`)
- **지도**: Google Maps JavaScript API (`libraries=places`, `language=ko&region=KR` 필수)
- **AI**: Gemini `gemini-2.5-flash-lite` (여행 추천/지역 생성 등에 제한적으로 사용)

### Vercel 서버리스 함수 작성 규칙 (중요, 반복 발생한 버그)
- **각 `api/*.ts` 파일은 완전히 자립형(self-contained)이어야 함** — 로컬 `lib/`를 import하면 Vercel 배포 시 `ERR_MODULE_NOT_FOUND` 발생
- 공통 로직(사진 재호스팅 등)은 각 파일에 인라인으로 중복 작성
- 클라이언트 키(referrer 제한)와 서버 키(`GOOGLE_MAPS_SERVER_KEY`, 무제한)는 반드시 분리해서 사용

### 알려진 반복 버그 패턴 (다시 만들지 말 것)
- **`typeof NaN === 'number'`**: 좌표 검증 시 `typeof x === 'number'`만 쓰면 NaN도 통과함 → 반드시 `Number.isFinite()` 사용
- **CSS Grid의 row 높이는 콘텐츠 기준 자동 계산됨**: `height: 100%`를 자식에 줘도 부모 grid row 자체가 콘텐츠에 맞춰 늘어나 있으면 의미 없음. 화면 높이 독립적으로 제한하려면 `max-height: calc(100vh - Npx)` 같은 뷰포트 기준 값을 써야 함
- **중첩 스크롤 컨테이너 문제**: `position: sticky`는 실제로 스크롤이 일어나는 가장 가까운 조상 기준으로 붙음. 여러 레벨에 `overflow-y: auto`가 중복되면 sticky가 엉뚱한 컨테이너 기준으로 붙어 안 먹힘 — 스크롤 컨테이너는 명확히 하나로 통일할 것
- **FK 제약조건이 정상적인 삭제를 막는 경우**: 참조되는 레코드가 삭제되어야 하는 상황이면 `ON DELETE SET NULL` / `ON DELETE CASCADE`를 명시적으로 고려할 것 (기본값 RESTRICT는 조용히 삭제를 막아버림)
- **5초 실행취소(undo) 타이머 패턴**: 화면 이탈 시 대기 중인 삭제 타이머를 그냥 취소하면 "DB엔 남아있는데 화면에서만 사라진" 상태가 됨 → 이탈 시엔 커밋해야 함

---

## 5. Shortlist 아키텍처 (완성된 기능, 참고용)

향후 Route/Timeline 게이트를 만들 때 이 패턴을 참고하세요.

### 데이터 흐름
```
stay_zones(큐레이션 DB, 도시당 8~15개 권역, 실좌표)
  ↓ (없으면 AI 폴백 — 프롬프트로 "숙박 생활권만, 관광지 이름 금지"를 엄격히 제한)
Brainstorm에서 모은 장소들을 가장 가까운 권역에 자동 배정 (거리 계산만, API 호출 없음)
  ↓
권역별 장소 개수/평점/이동효율 집계 → AI 추천 순위 계산 (평점+밀집도-이동시간 조합 점수)
  ↓
사용자가 권역 선택 (Step1) → 그 권역 내 숙소 후보(STAY) 중 선택 (Step2) → 확정(Step3)
```

### Step1 — 지역 선택
- 지도: 완전 추상화된 스타일(`MAP_STYLE_LIGHT`), 권역은 얇은 blob 폴리곤(시드 기반 사인파 합성, 매번 같은 모양)
- 마커: 작고 얇은 컴팩트 핀 (`buildCategoryIcon(g, mood, 'compact')`)
- 카드: 순위 배지, 별점, 특징 태그, 4개 통계(장소 수/평균 이동시간/추천 숙박일/이동 효율), 대표 사진+썸네일
- 지역명은 반드시 **AI가 지어낸 이름이 아니라 큐레이션 DB 우선, 여행자가 실제 부르는 한글 표기**로

### Step2 — 숙소 선택
- 지도: Step1과 달리 실제 구글맵 디테일 유지(도로/건물), 단 업체 POI 아이콘은 `MAP_STYLE_STEP2`로 옅게 처리
- 마커: 크고 흰 테두리 있는 핀 (`'detailed'` variant), 클릭 시 InfoWindow로 저장된 정보 표시(추가 API 호출 없음)
- 숙소 검색 사이트 카드(Booking/Agoda/Airbnb/Google Hotels): 가로 1줄, 실제 파비콘, Claude가 매긴 편집 평점(실제 평점 아님을 명시), 실제 트립 날짜+예산 필터를 URL 파라미터로 전달(사이트별 지원 여부가 다르므로 `filterSupport: 'confirmed' | 'best_effort' | 'unsupported'`로 투명하게 구분)
- 예산 필터는 "1인 1박 기준"으로 입력받지만 실제 사이트 전송 시엔 **인원수(headcount)를 곱해서** 전달 (숙소는 인당이 아니라 객실 전체 가격 기준)
- 링크가 아니라 **숙소 이름을 텍스트로 입력**받아 Google Places Text Search로 실제 장소를 찾는 방식(URL 스크래핑은 불안정해서 폐기함)

### Step3 — 확정
- 숙소 기준 각 장소까지의 이동시간을 Distance Matrix API로 실제 조회(2km 이내는 도보, 이상은 차량 배치 조회), 화면은 먼저 직선거리 추정치로 즉시 채우고 백그라운드로 갱신

---

## 6. 파일 구조

```
src/
  board/board.ts, board.css          ← Brainstorm 게이트
  shortlist/shortlist.ts, shortlist.css  ← Shortlist 게이트 (Step1/2/3 전부 이 안에)
  workspace/workspace.ts             ← 게이트 라우팅, 사이드바
  utils/googleMaps.ts                ← Google Maps 로더, GooglePlaceResult 추출/카테고리 매핑 (공유 유틸)
  types/database.ts                  ← Supabase 테이블 타입

api/                                  ← Vercel 서버리스 함수 (각각 완전 자립형)
  monthly-picks.ts                   ← AI 월별 추천 (Gemini + DB 캐싱)
  cache-photo.ts                     ← Google 사진 재호스팅 (Supabase Storage)
  destination-zones.ts               ← 큐레이션 우선 → AI 폴백, 숙박 생활권 목록
  import-hotel.ts                    ← 숙소 이름 → Google Places 매칭 + 사진 재호스팅
  exchange-rate.ts                   ← Frankfurter 환율 프록시 (CORS 회피)
```

---

## 7. 다음에 할 일 (미완성/개선 대상)

1. **Route 게이트** — 아직 플레이스홀더. Shortlist가 `mongsil:navigateGate` 이벤트로 넘기지만 갈 곳이 없음. 확정된 권역+숙소+장소를 기준으로 동선 최적화(Google Routes API)를 만들어야 함
2. **Timeline 게이트** — 미구현. 날짜별 일정 배치
3. **Checklist / Expense / Links 탭** — 미구현
4. **`google.maps.Marker` → `AdvancedMarkerElement` 마이그레이션** — 지금은 폐기 예정 경고만 뜨는 상태, 급하진 않음 (최소 12개월 유예)
5. **방콕 외 도시의 `stay_zones` 큐레이션** — 현재 방콕만 실제 조사된 데이터, 나머지 도시는 AI 폴백 상태

---

## 8. 작업 시 체크리스트

새 기능을 만들거나 수정하기 전에:

- [ ] 이 요청이 **디자인만 바꾸는 요청**인지 **기능을 바꾸는 요청**인지 먼저 구분했는가
- [ ] 새로 보여줄 데이터가 **진짜 데이터 기반**인가, 아니면 지어내고 있는가
- [ ] 외부 API를 새로 쓴다면 **캐싱 전략**이 있는가, 무료 한도를 확인했는가
- [ ] 클릭/hover 인터랙션이 이 프로젝트의 "명시적 클릭 원칙"과 맞는가
- [ ] 공항 메타포·디자인 시스템 톤을 깨지 않는가
- [ ] 수정 후 `npx tsc --noEmit && npx vite build`로 검증했는가

<!-- push 테스트: 2026-07-18 -->

