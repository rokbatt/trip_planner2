/**
 * 이용약관 · 개인정보처리방침
 *
 * ⚠️ 이 문서는 **코드가 실제로 하는 일을 근거로 쓴 초안**이지 법률 자문이 아니다.
 *    공개 전에 반드시 변호사 검토를 받아야 한다. 특히:
 *      - 개인정보보호법 제30조의 필수 기재사항 충족 여부
 *      - 제28조의8 국외이전 고지·동의 요건 (Google/Supabase/Vercel이 해외 사업자)
 *      - 유료화·제휴 수수료를 붙이는 순간 전자상거래법상 표시 의무와 청약철회 규정
 *
 * 내용은 실제 구현을 감사해서 쓴 것이다(수집 항목 = 실제 테이블/버킷, 국외이전 =
 * 실제 호출하는 외부 API). **기능을 추가·변경하면 이 문서도 같이 고쳐야 한다** —
 * 여기 적힌 내용과 코드가 어긋나면 그 자체가 법 위반이다.
 *
 * 사업자 정보처럼 실제 값이 없는 자리는 BLANK로 표시해 두었다. 비워 두는 게
 * 틀린 값을 적는 것보다 낫고, 채우기 전엔 공개하면 안 된다(랜딩 푸터와 같은 원칙).
 */

import { navigate } from '../router';
import './legal.css';

export type LegalDoc = 'terms' | 'privacy';

/** 실제 값을 채워야 하는 자리 — 화면에서 눈에 띄게 표시해 빠뜨릴 수 없게 한다 */
function blank(label: string): string {
  return `<span class="lg-blank">[${label}]</span>`;
}

/** 이 서비스가 외부로 데이터를 보내는 곳 — api/*.ts와 src/supabase.ts 기준 */
const SUBPROCESSORS: Array<[string, string, string]> = [
  ['Supabase', '데이터베이스 · 파일 보관 · 로그인 처리', '싱가포르 등 프로젝트 생성 시 선택한 리전'],
  ['Vercel', '웹사이트 호스팅 및 서버리스 함수 실행', '미국 등'],
  ['Google (OAuth)', '구글 계정 로그인 확인', '미국 등'],
  ['Google (Maps · Places · Routes)', '장소 검색, 지도 표시, 이동 시간 계산', '미국 등'],
  ['Google (Gemini)', '숙소 리뷰 요약, 일정 초안, 장소 설명 생성', '미국 등'],
];

function shell(title: string, updated: string, body: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'lg-page';
  el.innerHTML = `
    <nav class="lg-nav">
      <button type="button" class="lg-home" id="lg-home">몽실이</button>
      <div class="lg-nav-links">
        <button type="button" class="lg-navlink" data-go="terms">이용약관</button>
        <button type="button" class="lg-navlink" data-go="privacy">개인정보처리방침</button>
      </div>
    </nav>

    <main class="lg-main">
      <header class="lg-head">
        <p class="lg-eyebrow">몽실이 (Mongsil)</p>
        <h1 class="lg-title">${title}</h1>
        <p class="lg-updated">시행일 ${updated}</p>
      </header>

      <div class="lg-draft">
        <strong>준비 중인 초안입니다.</strong>
        서비스가 실제로 처리하는 데이터를 기준으로 작성했지만, 아직 법률 검토를 받지 않았고
        사업자 정보 등 확정되지 않은 항목이 남아 있습니다. 정식 공개 전까지는 참고용으로만
        봐주세요.
      </div>

      ${body}

      <footer class="lg-foot">
        <button type="button" class="lg-backhome" id="lg-back">← 홈으로</button>
      </footer>
    </main>
  `;

  el.querySelector('#lg-home')?.addEventListener('click', () => navigate('login'));
  el.querySelector('#lg-back')?.addEventListener('click', () => navigate('login'));
  el.querySelectorAll<HTMLElement>('.lg-navlink').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.go ?? 'login'));
  });
  return el;
}

/* ══════════════════════ 이용약관 ══════════════════════ */

function termsBody(): string {
  return `
    <section class="lg-sec">
      <h2>제1조 (목적)</h2>
      <p>이 약관은 ${blank('회사명')}(이하 “회사”)이 제공하는 여행 계획 서비스 몽실이(이하 “서비스”)를
      이용하는 데 필요한 회사와 이용자의 권리·의무 및 책임사항을 정하는 것을 목적으로 합니다.</p>
    </section>

    <section class="lg-sec">
      <h2>제2조 (정의)</h2>
      <ol class="lg-ol">
        <li>“이용자”란 이 약관에 동의하고 서비스를 이용하는 사람을 말합니다.</li>
        <li>“여행”이란 이용자가 서비스 안에 만든 하나의 여행 계획 단위를 말하며, 초대를 통해 여러 이용자가 함께 사용할 수 있습니다.</li>
        <li>“멤버”란 초대 링크를 통해 특정 여행에 참여한 이용자를 말합니다.</li>
        <li>“콘텐츠”란 이용자가 서비스에 입력하거나 올린 장소, 메모, 대화, 지출 내역, 파일 등 일체의 자료를 말합니다.</li>
      </ol>
    </section>

    <section class="lg-sec">
      <h2>제3조 (약관의 효력 및 변경)</h2>
      <ol class="lg-ol">
        <li>이 약관은 서비스 화면에 게시함으로써 효력이 발생합니다.</li>
        <li>회사는 관련 법령을 위반하지 않는 범위에서 약관을 변경할 수 있습니다.</li>
        <li>약관을 변경할 때는 시행일 7일 전(이용자에게 불리한 변경은 30일 전)부터 서비스 화면에 공지합니다.</li>
        <li>공지된 시행일까지 이용자가 명시적으로 거부 의사를 밝히지 않으면 변경에 동의한 것으로 봅니다. 동의하지 않는 경우 이용을 중단하고 탈퇴할 수 있습니다.</li>
      </ol>
    </section>

    <section class="lg-sec">
      <h2>제4조 (이용계약의 성립)</h2>
      <ol class="lg-ol">
        <li>이용계약은 이용자가 이 약관에 동의하고 구글 계정으로 로그인함으로써 성립합니다.</li>
        <li>서비스는 현재 구글 계정 로그인만 지원합니다. 별도의 아이디·비밀번호를 만들지 않습니다.</li>
        <li>만 14세 미만은 서비스를 이용할 수 없습니다.</li>
      </ol>
    </section>

    <section class="lg-sec">
      <h2>제5조 (서비스의 내용)</h2>
      <p>회사는 다음 기능을 제공합니다.</p>
      <ol class="lg-ol">
        <li>가고 싶은 장소를 모으고 분류하는 기능</li>
        <li>숙박 지역과 숙소를 비교·선택하는 기능</li>
        <li>선택한 장소를 동선과 날짜별 일정으로 정리하는 기능</li>
        <li>여행 중 일정 확인 및 실제 도착 시각 기록</li>
        <li>예산 설정, 지출 기록, 멤버 간 정산 계산</li>
        <li>여행 관련 문서·메모 보관, 멤버 간 대화</li>
      </ol>
      <p>서비스는 <strong>여행 계획을 돕는 도구</strong>이며, 항공권·숙박·투어 등의 예약이나 결제를
      직접 중개하거나 대행하지 않습니다.</p>
    </section>

    <section class="lg-sec">
      <h2>제6조 (여행과 멤버)</h2>
      <ol class="lg-ol">
        <li>여행을 만든 이용자는 초대 링크를 통해 다른 이용자를 멤버로 초대할 수 있습니다.</li>
        <li><strong>초대 링크를 가진 사람은 누구나 해당 여행에 참여할 수 있습니다.</strong> 링크를 공유할 때 주의해 주세요.</li>
        <li>여행 안의 콘텐츠는 그 여행의 멤버 전원이 보고 수정할 수 있습니다. 멤버 개개인에 대한 세부 권한 구분은 제공하지 않습니다.</li>
        <li>여행을 만든 이용자가 여행을 삭제하면 그 여행에 속한 콘텐츠가 함께 삭제되며 <strong>되돌릴 수 없습니다.</strong></li>
      </ol>
    </section>

    <section class="lg-sec">
      <h2>제7조 (이용자의 의무)</h2>
      <p>이용자는 다음 행위를 해서는 안 됩니다.</p>
      <ol class="lg-ol">
        <li>타인의 계정을 무단으로 사용하는 행위</li>
        <li>타인의 개인정보나 저작물을 권한 없이 올리는 행위</li>
        <li>서비스의 정상적인 운영을 방해하거나 비정상적인 방법으로 접근하는 행위</li>
        <li>법령이나 공서양속에 반하는 콘텐츠를 올리는 행위</li>
      </ol>
    </section>

    <section class="lg-sec">
      <h2>제8조 (콘텐츠의 권리)</h2>
      <ol class="lg-ol">
        <li>이용자가 올린 콘텐츠의 권리는 이용자에게 있습니다.</li>
        <li>회사는 서비스 제공에 필요한 범위(저장, 같은 여행 멤버에게 표시, 백업)에서만 콘텐츠를 이용합니다.</li>
        <li><strong>회사는 이용자의 콘텐츠를 광고에 사용하거나 인공지능 모델 학습에 제공하지 않습니다.</strong></li>
        <li>제7조를 위반한 콘텐츠는 사전 통지 없이 삭제될 수 있습니다.</li>
      </ol>
    </section>

    <section class="lg-sec">
      <h2>제9조 (인공지능이 생성한 정보)</h2>
      <ol class="lg-ol">
        <li>서비스는 숙소 요약, 일정 초안, 장소 설명 등 일부 정보를 인공지능으로 생성합니다.</li>
        <li>이 정보는 <strong>참고용 추정치이며 사실과 다를 수 있습니다.</strong> 화면에는 인공지능이 생성한 값임을 표시합니다.</li>
        <li>숙소 점수는 회사가 인공지능으로 평가한 값이며, 예약 사이트의 실제 이용자 평점이 아닙니다.</li>
        <li>이동 시간·거리·비용은 실측 데이터가 없는 경우 추정치로 표시되며, 실제와 다를 수 있습니다.</li>
        <li>이용자는 예약·출국 등 중요한 결정을 하기 전에 해당 정보를 직접 확인해야 하며, 회사는 이를 확인하지 않아 발생한 손해에 책임지지 않습니다.</li>
      </ol>
    </section>

    <section class="lg-sec">
      <h2>제10조 (외부 링크)</h2>
      <p>서비스는 이용자가 입력하거나 검색 결과로 제공되는 외부 사이트 링크를 표시할 수 있습니다.
      회사는 외부 사이트의 내용, 거래 조건, 이용 결과에 대해 책임지지 않습니다.
      ${blank('제휴 수수료를 받게 되면 여기에 그 사실과 표시 방법을 명시할 것')}</p>
    </section>

    <section class="lg-sec">
      <h2>제11조 (서비스의 변경·중단)</h2>
      <ol class="lg-ol">
        <li>회사는 서비스의 내용을 변경하거나 일부·전부를 중단할 수 있습니다.</li>
        <li>서비스를 종료하는 경우 최소 30일 전에 공지하고, 이용자가 자신의 콘텐츠를 내려받을 수 있는 방법을 함께 안내합니다.</li>
        <li>설비 점검, 통신 장애, 천재지변 등으로 서비스가 일시 중단될 수 있습니다.</li>
      </ol>
    </section>

    <section class="lg-sec">
      <h2>제12조 (책임의 제한)</h2>
      <ol class="lg-ol">
        <li>회사는 천재지변, 이용자의 귀책사유, 외부 서비스(지도·인공지능·환율 등)의 장애로 발생한 손해에 대해 책임지지 않습니다.</li>
        <li>회사는 이용자가 서비스를 통해 얻은 정보를 신뢰하여 내린 결정의 결과에 대해 책임지지 않습니다.</li>
        <li>같은 여행의 멤버 사이에서 발생한 분쟁(정산 등)에 대해 회사는 당사자가 아니며 책임지지 않습니다.</li>
        <li>다만 회사의 고의 또는 중대한 과실로 인한 손해에는 이 조항이 적용되지 않습니다.</li>
      </ol>
    </section>

    <section class="lg-sec">
      <h2>제13조 (분쟁의 해결)</h2>
      <p>이 약관은 대한민국 법률에 따르며, 서비스 이용과 관련한 분쟁은 민사소송법에 따른 관할 법원에 제기합니다.</p>
    </section>

    <section class="lg-sec lg-contact">
      <h2>문의</h2>
      <p>${blank('회사명')} · ${blank('대표자')}<br>
      사업자등록번호 ${blank('000-00-00000')}<br>
      주소 ${blank('주소')}<br>
      이메일 <a href="mailto:help@mongsil.app">help@mongsil.app</a></p>
    </section>
  `;
}

/* ══════════════════ 개인정보처리방침 ══════════════════ */

function privacyBody(): string {
  const sub = SUBPROCESSORS.map(
    ([name, purpose, where]) => `<tr><td>${name}</td><td>${purpose}</td><td>${where}</td></tr>`
  ).join('');

  return `
    <section class="lg-sec">
      <p class="lg-lede">${blank('회사명')}(이하 “회사”)은 몽실이 서비스를 제공하면서 아래와 같이
      개인정보를 처리합니다. 이 방침은 <strong>서비스가 실제로 하는 일을 그대로 적은 것</strong>이며,
      기능이 바뀌면 함께 고쳐 공지합니다.</p>
    </section>

    <section class="lg-sec">
      <h2>1. 수집하는 개인정보 항목</h2>

      <h3>가. 로그인할 때</h3>
      <p>구글 계정으로 로그인하면 구글로부터 다음을 전달받습니다.</p>
      <ul class="lg-ul">
        <li>이메일 주소</li>
        <li>이름(구글 계정에 설정된 표시 이름)</li>
        <li>프로필 사진 주소</li>
        <li>구글이 발급한 계정 식별자</li>
      </ul>
      <p class="lg-note">비밀번호는 수집하지 않습니다. 로그인 처리는 구글과 Supabase가 담당합니다.</p>

      <h3>나. 서비스를 이용하면서 저장되는 것</h3>
      <ul class="lg-ul">
        <li><strong>여행 정보</strong> — 여행 이름, 날짜, 목적지, 인원, 예산</li>
        <li><strong>장소</strong> — 담은 장소의 이름·주소·좌표·분류, 확정한 숙소</li>
        <li><strong>일정</strong> — 날짜별 동선, 방문 순서, 시각</li>
        <li><strong>대화와 메모</strong> — 멤버 간 채팅, 장소 댓글, 노트</li>
        <li><strong>링크</strong> — 대화에 붙여 넣은 주소와 그 미리보기</li>
        <li><strong>지출</strong> — 항목명, 금액, 통화, 결제자, 분담 대상, 메모</li>
        <li><strong>문서</strong> — 이용자가 올린 파일(항공권, 예약 확인서 등)</li>
        <li><strong>체크리스트</strong> — 준비물 목록과 완료 여부</li>
        <li><strong>여행 중 기록</strong> — 각 장소에 도착·출발했다고 <em>직접 누른</em> 시각</li>
      </ul>

      <h3>다. 자동으로 생성되는 것</h3>
      <ul class="lg-ul">
        <li>접속 기록, 브라우저 종류, IP 주소 (호스팅·데이터베이스 서비스의 운영 로그)</li>
        <li>로그인 상태 유지를 위한 브라우저 저장소 값</li>
      </ul>

      <div class="lg-callout">
        <strong>수집하지 않는 것</strong>
        <ul class="lg-ul">
          <li><strong>기기의 위치(GPS)를 수집하지 않습니다.</strong> “도착”을 누른 시각만 기록하며, 그 순간의 좌표를 받아오지 않습니다.</li>
          <li>주민등록번호 등 고유식별정보를 별도로 수집하지 않습니다.</li>
          <li>결제 수단 정보(카드번호 등)를 수집하지 않습니다. 지출 기능은 금액을 적어 두는 가계부이며 실제 결제나 송금을 하지 않습니다.</li>
          <li>광고·분석 목적의 추적 도구를 사용하지 않습니다.</li>
        </ul>
      </div>

      <div class="lg-warn">
        <strong>문서를 올리실 때 주의해 주세요.</strong>
        여권 사본처럼 여권번호가 보이는 파일을 올리면 고유식별정보가 저장될 수 있습니다.
        회사는 이런 정보를 요구하지 않으며, 꼭 필요한 경우가 아니라면 번호 부분을 가린 뒤 올리시기를 권합니다.
      </div>
    </section>

    <section class="lg-sec">
      <h2>2. 개인정보의 처리 목적</h2>
      <ol class="lg-ol">
        <li>회원 식별 및 로그인 상태 유지</li>
        <li>여행 계획 작성·공유 기능 제공</li>
        <li>같은 여행의 멤버에게 누가 무엇을 추가·수정했는지 표시</li>
        <li>이동 시간 계산, 장소 검색, 숙소 요약 등 서비스 기능 제공</li>
        <li>지출 집계 및 정산 계산</li>
        <li>문의 응대, 부정 이용 확인, 서비스 오류 파악</li>
      </ol>
    </section>

    <section class="lg-sec">
      <h2>3. 보유 및 이용 기간</h2>
      <table class="lg-table">
        <thead><tr><th>구분</th><th>보유 기간</th></tr></thead>
        <tbody>
          <tr><td>계정 정보</td><td>탈퇴 시까지</td></tr>
          <tr><td>여행 콘텐츠(장소·일정·대화·지출·메모)</td><td>해당 여행이 삭제될 때까지</td></tr>
          <tr><td>업로드한 문서 파일</td><td>이용자가 삭제하거나 여행이 삭제될 때까지</td></tr>
          <tr><td>접속 기록 등 운영 로그</td><td>${blank('보관 기간 — 위탁사 설정 확인 후 기재')}</td></tr>
        </tbody>
      </table>
      <p class="lg-note">법령에서 별도의 보존 기간을 정한 경우에는 그 기간을 따릅니다.</p>
    </section>

    <section class="lg-sec">
      <h2>4. 개인정보의 파기</h2>
      <ol class="lg-ol">
        <li>여행을 삭제하면 그 여행에 속한 콘텐츠가 데이터베이스에서 삭제됩니다.</li>
        <li>탈퇴를 요청하면 계정 정보와 이용자가 만든 여행을 삭제합니다.</li>
        <li>다른 멤버가 함께 만든 여행의 경우, 탈퇴한 이용자의 계정 정보는 삭제하되 <strong>여행 자체는 남은 멤버를 위해 유지될 수 있습니다.</strong> 이 경우 작성자 표시는 식별할 수 없는 형태로 바뀝니다.</li>
        <li>파기는 복구할 수 없는 방법으로 처리합니다.</li>
      </ol>
      <div class="lg-warn">
        <strong>탈퇴 방법 안내</strong>
        현재 화면에서 바로 탈퇴하는 기능은 준비 중입니다. 그전까지는
        <a href="mailto:help@mongsil.app">help@mongsil.app</a>으로 요청해 주시면 확인 후 처리해 드립니다.
      </div>
    </section>

    <section class="lg-sec">
      <h2>5. 제3자 제공</h2>
      <p>회사는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 법령에 따라 수사기관이
      적법한 절차로 요구하는 경우에는 그에 따릅니다.</p>
      <p class="lg-note">같은 여행에 속한 멤버끼리 콘텐츠와 표시 이름·프로필 사진이 공유되는 것은
      이용자가 직접 초대해 만든 관계이며, 제3자 제공에 해당하지 않습니다.</p>
    </section>

    <section class="lg-sec">
      <h2>6. 처리위탁 및 국외 이전</h2>
      <p>회사는 서비스 제공을 위해 아래 사업자에게 개인정보 처리를 위탁하고 있으며,
      이들 사업자의 서버가 국외에 있어 개인정보가 국외로 이전됩니다.</p>
      <table class="lg-table">
        <thead><tr><th>위탁받는 자</th><th>위탁 업무</th><th>이전되는 국가</th></tr></thead>
        <tbody>${sub}</tbody>
      </table>
      <ul class="lg-ul">
        <li><strong>이전 시기 및 방법</strong> — 서비스 이용 시점에 암호화된 통신으로 전송</li>
        <li><strong>이전 항목</strong> — 위 1항의 수집 항목 중 해당 기능에 필요한 범위</li>
        <li><strong>보유 기간</strong> — 위탁 계약 종료 또는 처리 목적 달성 시까지</li>
      </ul>
      <p class="lg-note">인공지능 기능(숙소 요약·일정 초안·장소 설명)에는 여행지, 날짜, 장소 이름,
      이용자가 적은 메모 등 <strong>해당 요청에 필요한 여행 정보만</strong> 전달되며,
      이름·이메일·계정 식별자는 함께 보내지 않습니다.</p>
      <p>${blank('각 위탁사의 실제 리전과 계약 조건을 확인해 국가명을 확정할 것')}</p>
    </section>

    <section class="lg-sec">
      <h2>7. 정보주체의 권리와 행사 방법</h2>
      <ol class="lg-ol">
        <li>이용자는 자신의 개인정보에 대해 열람, 정정, 삭제, 처리정지를 요구할 수 있습니다.</li>
        <li>여행 이름·일정·지출 등 대부분의 정보는 서비스 화면에서 직접 수정하거나 삭제할 수 있습니다.</li>
        <li>그 밖의 요청은 <a href="mailto:help@mongsil.app">help@mongsil.app</a>으로 보내 주시면 지체 없이 처리합니다.</li>
        <li>법정대리인이나 위임받은 자를 통해서도 권리를 행사할 수 있습니다.</li>
      </ol>
    </section>

    <section class="lg-sec">
      <h2>8. 안전성 확보 조치</h2>
      <ul class="lg-ul">
        <li>모든 통신은 HTTPS로 암호화합니다.</li>
        <li>데이터베이스에 접근 제어 규칙을 적용해, <strong>해당 여행의 멤버만</strong> 그 여행의 데이터를 읽고 쓸 수 있도록 제한합니다.</li>
        <li>업로드한 문서는 공개되지 않는 저장소에 보관하고, 열람할 때마다 짧은 시간만 유효한 일회성 주소를 발급합니다.</li>
        <li>개인 문서 보호용 PIN은 평문으로 저장하지 않고, 이용자별 임의값을 더해 해시로만 보관합니다.</li>
      </ul>
      <div class="lg-warn">
        <strong>개인 문서 PIN에 대한 정확한 안내</strong>
        개인 문서의 4자리 PIN은 <strong>같은 여행 멤버끼리 각자의 문서가 섞이지 않게 하는 칸막이</strong>이지,
        제3자의 접근을 막는 인증 수단이 아닙니다. 데이터베이스 접근 권한은 “그 여행의 멤버인가”까지만
        확인합니다. 멤버에게 알려지면 곤란한 자료는 올리지 않기를 권합니다.
      </div>
    </section>

    <section class="lg-sec">
      <h2>9. 쿠키 등 자동 수집 장치</h2>
      <p>서비스는 로그인 상태를 유지하기 위해 브라우저의 저장소(localStorage 등)를 사용합니다.
      광고나 이용 행태 분석을 위한 쿠키는 사용하지 않습니다.</p>
      <p>브라우저 설정에서 저장소 사용을 차단할 수 있으나, 이 경우 로그인 상태가 유지되지 않습니다.</p>
    </section>

    <section class="lg-sec">
      <h2>10. 개인정보 보호책임자</h2>
      <p>${blank('성명')} · ${blank('직책')}<br>
      이메일 <a href="mailto:help@mongsil.app">help@mongsil.app</a></p>
      <p class="lg-note">개인정보 처리와 관련한 문의, 불만, 피해 구제는 위 연락처로 접수해 주시면
      지체 없이 답변해 드립니다.</p>
    </section>

    <section class="lg-sec">
      <h2>11. 권익침해 구제 방법</h2>
      <p>개인정보 침해로 인한 상담이나 분쟁 조정이 필요한 경우 아래 기관에 문의하실 수 있습니다.</p>
      <ul class="lg-ul">
        <li>개인정보분쟁조정위원회 — 1833-6972 (www.kopico.go.kr)</li>
        <li>개인정보침해신고센터 — 118 (privacy.kisa.or.kr)</li>
        <li>대검찰청 사이버수사과 — 1301 (www.spo.go.kr)</li>
        <li>경찰청 사이버수사국 — 182 (ecrm.police.go.kr)</li>
      </ul>
    </section>

    <section class="lg-sec">
      <h2>12. 방침의 변경</h2>
      <p>이 방침을 변경할 때는 시행일 7일 전부터 서비스 화면에 공지합니다.
      이용자에게 중대한 영향을 주는 변경은 30일 전에 공지합니다.</p>
    </section>
  `;
}

/* ══════════════════════ 렌더 ══════════════════════ */

const EFFECTIVE_DATE = '(미정 — 법률 검토 후 확정)';

export function renderLegal(doc: LegalDoc): HTMLElement {
  window.scrollTo(0, 0);
  return doc === 'terms'
    ? shell('이용약관', EFFECTIVE_DATE, termsBody())
    : shell('개인정보처리방침', EFFECTIVE_DATE, privacyBody());
}
