/* =========================================================
   LAST_LOGIN — 게임 로직
   ---------------------------------------------------------
   구성
   1. 기본 도구 (선택자, 시간 표시)
   2. 게임 상태 (State)
   3. 게임 데이터 (단서, 메일, 메신저, 파일, 접속 기록)
   4. 아이콘과 그림 (SVG)
   5. 창 관리 (열기, 닫기, 포커스, 작업표시줄)
   6. 알림과 단서 기록
   7. 화면 그리기 (각 앱의 HTML)
   8. 앱 열기
   9. 공포 연출 (원격 커서, 강제 종료, 입력 가로채기)
   10. 이벤트 1, 2, 김도윤 메시지
   11. 명령 프롬프트
   12. 엔딩
   13. 버튼 동작 (Actions)
   14. 입력 처리 (클릭, 제출, 선택, 드래그, 탭 이탈)
   ========================================================= */
{
  /* ---------------------------------------------------------
     1. 기본 도구
     --------------------------------------------------------- */

  // CSS 선택자로 요소 하나 찾기
  const $ = (selector) => document.querySelector(selector);

  // 게임 속 시각 (분 단위). 23:12에서 시작
  let gameMinutes = 23 * 60 + 12;

  // 분 → "HH:MM" 문자열
  function formatTime(minutes) {
    const hh = String(Math.floor(minutes / 60) % 24).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  // 플레이어가 입력한 글자를 HTML에 안전하게 넣기
  const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  /* ---------------------------------------------------------
     1-1. 사운드 (파일 없이 Web Audio로 직접 만든 소리)
     --------------------------------------------------------- */

  const sound = {
    ctx: null,
    master: null,
    hum: null,
    enabled: true,

    // 브라우저 정책상 첫 클릭 이후에만 소리를 켤 수 있음
    start() {
      if (this.ctx) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
    },

    ready() {
      return this.ctx && this.enabled;
    },

    // 낮게 웅웅거리는 잡음 (브라운 노이즈)
    noiseBuffer(seconds) {
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        data[i] = last * 3.5;
      }
      return buffer;
    },

    // 짧은 잡음 한 번 (타자 소리, 하드디스크 긁는 소리 재료)
    burst(duration, filterType, frequency, volume, when = 0) {
      if (!this.ready()) return;
      const t = this.ctx.currentTime + when;
      const source = this.ctx.createBufferSource();
      source.buffer = this.noiseBuffer(Math.max(duration, 0.05));
      const filter = this.ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = frequency;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      source.connect(filter).connect(gain).connect(this.master);
      source.start(t);
      source.stop(t + duration + 0.02);
    },

    // 단순한 음 하나
    tone(frequency, duration, type = "sine", volume = 0.15, when = 0) {
      if (!this.ready()) return;
      const t = this.ctx.currentTime + when;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + duration + 0.05);
    },

    // PC 팬 소음 (로그인 후 계속)
    startHum() {
      if (!this.ctx || this.hum) return;
      const source = this.ctx.createBufferSource();
      source.buffer = this.noiseBuffer(4);
      source.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 380;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.master);
      source.start();
      gain.gain.linearRampToValueAtTime(this.enabled ? 0.12 : 0, this.ctx.currentTime + 2);
      this.hum = gain;
    },

    notify() { this.tone(880, 0.18); this.tone(1320, 0.25, "sine", 0.12, 0.09); },         // 메시지 알림
    alert() { this.tone(220, 0.3, "triangle", 0.2); this.tone(196, 0.45, "triangle", 0.18, 0.2); }, // 경고 알림
    error() { this.tone(150, 0.2, "square", 0.07); },                                          // 암호 틀림
    key() { this.burst(0.03, "highpass", 2500, 0.08); },                                       // 타자 소리
    buzz() { this.tone(60, 0.25, "sawtooth", 0.1); this.burst(0.08, "bandpass", 3000, 0.1, 0.05); }, // 화면 깨짐

    // 원격 접속 순간: 하드디스크 긁는 소리 + 낮은 울림
    scratch() {
      for (let i = 0; i < 16; i++) {
        this.burst(0.04 + Math.random() * 0.05, "bandpass", 1200 + Math.random() * 2400, 0.25, i * 0.09 + Math.random() * 0.05);
      }
      this.tone(55, 2.2, "sine", 0.25);
    },

    // 문 열리는 소리 (낮은 쿵 + 잡음)
    door() {
      this.tone(70, 0.6, "sine", 0.45);
      this.burst(0.5, "lowpass", 600, 0.4, 0.05);
      this.burst(0.25, "bandpass", 900, 0.2, 0.5);
    },

    setEnabled(on) {
      this.enabled = on;
      if (this.hum) this.hum.gain.value = on ? 0.12 : 0;
    },
  };

  /* ---------------------------------------------------------
     2. 게임 상태
     --------------------------------------------------------- */

  // 원격 사용자가 처음 열 때 강제로 닫아 버리는 파일
  // (공포 연출은 드물수록 효과적이라 한 개만: 한서진의 생존이 담긴 파일)
  const FORCE_CLOSE_FILES = ["음성메모_1101.txt"];

  const state = {
    selectedMail: 0,          // 메일 목록에서 선택된 메일
    selectedChat: "doyun",    // 메신저에서 선택된 대화방
    insuranceUnlocked: false, // '보험' 폴더 잠금 해제 여부
    restored: {},             // 휴지통에서 복원한 파일
    event1Done: false,        // 이벤트 1: 원격 접속 시작
    event2Done: false,        // 이벤트 2: 뒷모습 사진, 협박 메시지
    remoteStart: 0,           // 원격 세션이 시작된 게임 시각
    photoTime: 0,             // 뒷모습 사진이 찍힌 게임 시각
    clues: [],                // 찾은 단서 키 목록
    folderTries: 0,           // 보험 폴더 암호 실패 횟수
    loginTries: 0,            // 로그인 암호 실패 횟수
    triedAdmin: false,        // 관리자 로그인을 시도했는지
    forceClosed: {},          // 이미 강제 종료를 당한 창
    chatHijacked: false,      // 메신저 입력 가로채기 발생 여부
    reportAnswers: ["", "", ""],  // 입력한 답
    reportResult: "",             // "" | "incomplete" | "rejected" | "solved"
    submitsLeft: 3,               // 남은 제출 기회
    topZ: 10,                 // 맨 앞 창의 z-index
    keepSending: null,        // 엔딩 B의 '전송 유지' 버튼 동작
    gameOver: false,          // 엔딩이 시작되면 다른 이벤트를 멈춤
    agentKilled: false,       // 명령 프롬프트로 원격 프로그램을 껐는지
    tabWarnings: 0,           // 탭 이탈 경고를 받은 횟수
    runNumber: 0,             // 이번이 몇 번째 플레이인지
    cmdLines: [               // 명령 프롬프트 화면에 쌓인 줄
      "Hangyeol OS [버전 10.0.19045]",
      "(c) Hangyeol Logistics. All rights reserved.",
      "",
      "명령어 목록을 보려면 help를 입력하세요.",
      "",
    ],
  };

  /* ---------------------------------------------------------
     2-1. 회차 기억과 엔딩 도감 (이 브라우저에만 저장됨)
     --------------------------------------------------------- */

  const SAVE_KEY = "last_login_save_v1";

  function loadSave() {
    const empty = { runs: 0, endings: [], history: [] };
    try {
      return Object.assign(empty, JSON.parse(localStorage.getItem(SAVE_KEY)) || {});
    } catch {
      return empty;
    }
  }

  function writeSave() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch {
      // 저장이 막힌 브라우저(시크릿 모드 등)에서는 그냥 기억하지 않음
    }
  }

  const save = loadSave();
  const previousRuns = save.runs; // 이번 판을 시작하기 전까지의 플레이 횟수

  // 엔딩 도감 [엔딩 키, 이름] (도감에 보이는 순서)
  const ENDING_DEX = [
    ["C", "마지막 접속자"],
    ["B", "보험금 지급"],
    ["A", "정리된 사람"],
    ["D", "혼자 오세요"],
    ["B_FAIL", "늦었다"],
    ["H", "연결 끊김"],
  ];
  const ENDING_NAMES = Object.fromEntries(ENDING_DEX);

  /* ---------------------------------------------------------
     3. 게임 데이터
     --------------------------------------------------------- */

  // 단서 수첩에 기록될 문장들
  // 원칙: 수첩에는 '무엇이 어디에 있는지(관찰)'만 적고, 보고서의 정답(이름, 계정)은 적지 않음
  //      → 정답은 플레이어가 직접 파일을 다시 열어 확인해야 함
  const CLUES = {
    c_admin: "관리자 원격 로그인 권한이 11/05 03:12에 누군가에 의해 해제됨",
    c_order: '보안팀장: "보험" 폴더를 발견하면 열지 말고 즉시 연락하라고 지시함',
    c_notice: '전사공지: 10/14 02:10 박정호 단독 작업 중 추락. "다른 인원 없었음"',
    c_hr: "한서진 11/03부 무기한 휴직. 문의처가 인사팀이 아니라 보안팀",
    c_mail4: '한서진 → 김도윤: "무슨 일 생기면 보험 폴더. 비번은 그때 그거"',
    c_pwhint: "보험 폴더 비밀번호 = 팀 첫 회식 가게 이름 (사진 폴더에 사진이 있음)",
    c_login: "한서진 계정이 어제 23:47에 다른 기기에서 접속됨. 실종자인데?",
    c_sign: "팀 첫 회식 장소의 간판 사진을 찾음",
    c_diary: "업무일지: CCTV 서버 삭제 전에 원본을 복사해 둠. 누군가 휴지통을 비우려 함",
    c_memo: "공지(02:10, 단독)와 영상(01:52, 두 명) 사이 18분의 공백",
    c_cctv: "01:52 CCTV: 박정호 옆에 보안팀 조끼를 입은 사람이 한 명 더 있음",
    c_report: "사고보고서 원본: 수정본에서 '현장 동행자' 항목이 통째로 삭제됨",
    c_voice: "한서진 음성메모: 누군가 원격으로 PC에 들어온다고 함. 접속 기록을 보라고 남김",
    c_log: "접속 기록: 실종 이후에도 원격 계정이 파일을 지웠고, 외부 계정이 메신저에 로그인함",
    c_photo: "5분 전에 찍힌 내 뒷모습 사진. 누군가 지금 나를 보고 있다",
    c_doyun: "김도윤: 최 팀장에게 '보험'의 존재를 말한 건 자신이었다고 고백함",
    c_agent: "명령 프롬프트: 다른 계정의 원격 프로그램이 이 PC에서 실행 중",
  };

  // 메일함
  const MAILS = [
    {
      from: "최문혁 (보안팀장)",
      to: "이준",
      date: "11/24 18:02",
      subject: "[보안] 한서진 사원 PC 정리 요청",
      clue: "c_order",
      body: `이준 씨,

휴직 처리된 한서진 사원 PC를 오늘 밤 안에 정리 부탁합니다.
개인 파일은 열람 후 전부 삭제하고, 업무 자료만 남겨 주세요.

특히 '보험'이라는 이름의 파일이나 폴더가 보이면
열지 말고 바로 저에게 연락 주세요.

외부 반출은 절대 금지입니다.

— 보안팀 최문혁`,
    },
    {
      from: "경영지원팀",
      to: "전 직원",
      date: "10/15 09:00",
      subject: "[전사공지] 물류동 안전사고 관련 안내",
      clue: "c_notice",
      body: `10월 14일(화) 02:10경, 물류동 3층에서 야간 근무자 박정호 님이
단독 작업 중 추락하는 사고가 있었습니다.

현장 CCTV 확인 결과 당시 다른 인원은 없었으며,
단순 안전사고로 종결되었습니다.

관련 문의 및 외부 언급은 삼가 주시기 바랍니다.
고인의 명복을 빕니다.`,
    },
    {
      from: "인사팀",
      to: "한서진",
      date: "11/04 10:12",
      subject: "[인사] 휴직 처리 안내",
      clue: "c_hr",
      body: `한서진 님은 개인 사유로 11/03부 무기한 휴직 처리되었습니다.

관련 문의는 보안팀으로 해 주시기 바랍니다.`,
    },
    {
      from: "한서진 (보낸 메일)",
      to: "김도윤",
      date: "10/31 23:58",
      subject: "(제목 없음)",
      clue: "c_mail4",
      body: `도윤씨,

혹시 나한테 무슨 일 생기면
내 PC 보험 폴더 열어 봐요.

비번은 그때 그거. 알죠?`,
    },
  ];

  // 메신저 대화
  // 메시지 종류: "day" = 날짜 구분선, "me" = 내가 보냄,
  //            "other" = 상대가 보냄, "threat" = 위협 메시지(빨간색)
  const CHATS = {
    doyun: {
      name: "김도윤",
      status: "오프라인",
      messages: [
        ["day", "2023.03.20"],
        ["other", "서진씨 이번에도 비번 까먹으면 저 안 도와줘요 ㅋㅋ"],
        ["me", "이번엔 절대 안 까먹지. 우리 팀 첫 회식한 가게 이름으로 했거든"],
        ["other", "아 거기 ㅋㅋ 사장님 고양이 있던 데"],
        ["me", "사진도 찍어 놨음. 사진 폴더에 있어"],
        ["day", "2026.10.30"],
        ["me", "도윤씨 14일 밤 CCTV 원본 봤어요?"],
        ["me", "공지엔 혼자였다는데 01:52 영상엔 둘이에요"],
        ["other", "서진씨 그 얘기 메신저로 하지 마요"],
        ["other", "여기 다 로그 남아요. 보안팀이 봐요"],
        ["me", "알아요. 그래서 '보험' 만들어 둔 거예요"],
        ["day", "2026.11.03"],
        ["other", "서진씨 오늘 왜 안 나왔어요?"],
        ["other", "전화 좀 받아요"],
        ["other", "서진씨"],
      ],
    },
    choi: {
      name: "최문혁 팀장",
      status: "접속 중",
      messages: [
        ["day", "2026.11.01"],
        ["other", "서진 씨, CCTV 원본은 어디서 났어요?"],
        ["other", "그런 건 개인 PC에 두면 곤란해요."],
        ["other", "내일 아침 일찍 보안팀으로 오세요. 혼자."],
        ["me", "네."],
      ],
    },
  };

  // 폴더 구조 (폴더 이름 → 파일 이름 목록)
  const FOLDERS = {
    사진: ["첫회식_2023.jpg"],
    문서: ["업무일지.txt"],
    보험: ["사고보고서_원본.txt", "음성메모_1101.txt"],
  };

  // 휴지통에 들어 있는 파일
  const TRASH = ["CCTV_물류3F_1014_0152.jpg", "지울것.txt"];

  // 파일 내용
  // type: "img" = 그림 파일, "txt" = 글 파일
  // onOpen: 처음 열었을 때 실행할 동작
  const FILES = {
    "첫회식_2023.jpg": {
      type: "img",
      image: "sign",
      clue: "c_sign",
      caption: "2023.03.17 팀 첫 회식. 사장님네 고양이가 계속 서진 씨 옆에 앉아 있었다.",
    },
    "업무일지.txt": {
      type: "txt",
      clue: "c_diary",
      body: `10/14  물류동 사고. 다들 쉬쉬함.
10/22  CCTV 서버 정리 요청이 내려옴. IT가 아니라 보안팀에서?
10/23  서버 지우기 전에 원본 영상 복사해 둠.
10/29  누가 내 PC 휴지통을 비우려고 했다. 권한이 없어서 실패한 듯.
        난 그런 적 없는데.
11/01  최 팀장 호출. 내일 혼자 오래.`,
    },
    "CCTV_물류3F_1014_0152.jpg": {
      type: "img",
      image: "cctv",
      clue: "c_cctv",
      caption: "물류동 3층 CAM 07 · 2026-10-14 01:52:07",
    },
    "지울것.txt": {
      type: "txt",
      clue: "c_memo",
      body: `공지: 02:10, 단독 작업.
영상: 01:52, 두 명.

18분 동안 무슨 일이 있었지?

→ 원본은 '보험'에.`,
    },
    "사고보고서_원본.txt": {
      type: "txt",
      clue: "c_report",
      body: `[물류동 안전사고 보고서 — 초안 v1]
작성: 시설안전팀 / 2026.10.14 06:30

발생 시각 : 02:10
장소      : 물류동 3층 적재구역 난간
피해자    : 박정호 (야간 물류)

현장 동행자 : 보안팀 최문혁 팀장
              (출입기록 01:40 ~ 02:05)
특이사항   : 사고 직전 두 사람이 언쟁하는 소리를
              들었다는 진술 있음

※ 본 문서는 10/16 '수정본 v2'로 대체됨
※ v2에서 '현장 동행자', '특이사항' 항목 삭제`,
    },
    "음성메모_1101.txt": {
      type: "txt",
      clue: "c_voice",
      // 이 메모를 읽고 9초 뒤 이벤트 2가 일어남
      onOpen: () => setTimeout(startEvent2, 9000),
      body: `[음성메모 받아쓰기 — 11/01 23:41]

…이거 녹음되고 있죠.

요즘 내 PC가 이상해요.
내가 안 켰는데 켜져 있고, 파일이 지워져 있어요.
누가 원격으로 들어오고 있어요.

내일 최 팀장이 혼자 오래요. 안 갈 거예요.
오늘 밤 그냥 사라질 거예요.

혹시 이걸 누가 보고 있다면,
접속 기록을 봐요. 'hsj_backup'은 나예요.

난 살아 있어요.
그리고 아직, 이 PC를 보고 있어요.`,
    },
  };

  // 접속 기록 [일시, 계정, 위치, 동작]
  const ACCESS_LOG = [
    ["11/02 00:14", "hsj", "본 PC", "로그아웃 (마지막 정상 로그인)"],
    ["11/05 03:14", "sec_choi", "원격 · 사내 10.2.0.7", "파일 삭제: CCTV_물류3F_1014_0152.jpg"],
    ["11/05 03:16", "sec_choi", "원격 · 사내 10.2.0.7", "휴지통 비우기 실패 (권한 없음)"],
    ["11/12 02:40", "sec_choi", "원격 · 사내 10.2.0.7", "폴더 열기 실패: 보험 (암호 불일치)"],
    ["11/23 23:47", "hsj_backup", "외부 · 알 수 없음", "메신저 로그인"],
    ["11/23 23:52", "hsj_backup", "외부 · 알 수 없음", "보험 폴더 열람 (읽기 전용)"],
  ];

  // 정답 비밀번호
  const LOGIN_PASSWORDS = ["콩이0412", "0412콩이"];
  const FOLDER_PASSWORD = "달빛포차";

  // 보고서 문항 (단답형 직접 입력)
  // accepted: 정답으로 인정하는 표기들 (띄어쓰기, 밑줄, 대소문자, 호칭은 무시하고 비교)
  // requires: 이 단서를 모두 찾아야 입력칸이 열림 (조사 없이 찍는 것 방지)
  const QUESTIONS = [
    {
      question: "10/14 01:52, 박정호 곁에 있던 사람은?",
      placeholder: "이름을 입력",
      accepted: ["최문혁", "최팀장", "보안팀장", "최문혁보안팀장", "보안팀장최문혁", "보안팀최문혁", "secchoi"],
      requires: ["c_cctv", "c_report"],
    },
    {
      question: "한서진 실종 후 이 PC의 파일을 지운 계정은?",
      placeholder: "계정 이름을 입력",
      accepted: ["secchoi", "최문혁"],
      requires: ["c_log", "c_voice"],
    },
    {
      question: "어제 23:47, 한서진 계정으로 접속한 사람은?",
      placeholder: "이름 또는 계정을 입력",
      accepted: ["한서진", "서진", "hsjbackup", "hsj"],
      requires: ["c_voice", "c_log"],
    },
  ];

  // 입력한 답을 비교하기 좋게 다듬기
  // "최문혁 팀장님" → "최문혁", "HSJ_backup" → "hsjbackup"
  // 결과는 두 가지: 호칭만 뗀 것, 끝의 '팀장'까지 뗀 것
  function normalizeAnswer(text) {
    let s = text.toLowerCase().replace(/[\s_\-.()]/g, "");
    s = s.replace(/(님|씨|본인)$/, "");
    const withoutTitle = s.endsWith("팀장") ? s.slice(0, -2) : s;
    return [s, withoutTitle];
  }

  const isCorrectAnswer = (index, text) =>
    normalizeAnswer(text || "").some((form) => QUESTIONS[index].accepted.includes(form));

  // 보고서 제출 기회
  const MAX_SUBMITS = 3;

  // 엔딩 [본문 줄들, 엔딩 제목]
  const ENDINGS = {
    A: [
      [
        "보험 폴더를 삭제했다. 휴지통도 비웠다.",
        '<span class="redt">[원격 사용자] 수고했어요, 이준 씨.</span>',
        "3주 뒤, 메일 한 통이 도착한다.",
        "[인사] 이준 사원 휴직 처리 안내\n관련 문의는 보안팀으로 해 주시기 바랍니다.",
      ],
      "ENDING A · 정리된 사람",
    ],
    B: [
      [
        "전송 완료.",
        '다음 날 아침, 기사 하나가 올라왔다.\n"물류동 추락사, 현장엔 한 사람이 더 있었다"',
        "최문혁 팀장은 그날 출근하지 않았다.",
        "그리고 당신의 메신저에 한 줄이 남았다.\n[hsj_backup] 고마워요.",
      ],
      "ENDING B · 보험금 지급",
    ],
    B_FAIL: [
      [
        "전송이 취소되었습니다.",
        "원격 세션이 보험 폴더를 삭제합니다… 완료.",
        "모니터가 꺼진다.",
        "꺼진 화면에 비친 당신의 어깨 너머로, 누군가 서 있다.",
      ],
      "ENDING B′ · 늦었다",
    ],
    C: [
      [
        "나: hsj_backup… 서진 씨 맞죠?",
        "[hsj_backup] 드디어 찾았네요.",
        "[hsj_backup] 지금 그 화면, 최 팀장도 같이 보고 있어요.",
        "[hsj_backup] 보험 복사본은 나한테 있어요. 필요했던 건 증인 한 명이에요.",
        "[hsj_backup] 엘리베이터 말고 계단. 1층 비상구로 나와요. 지금.",
        "3층, 2층, 1층.\n비상구 문 너머에서 누군가 손을 흔든다.",
      ],
      "ENDING C · 마지막 접속자",
    ],
    D: [
      [
        "메일 창을 닫으려다 손이 미끄러졌다.",
        "그 문장은 한 달 전, 한서진이 받았던 메시지와 똑같았다.",
        "다음 날 아침, 당신은 보안팀으로 향했다.",
        "그날 밤, 이 PC의 접속 기록에 한 줄이 더 남았다.",
        '<span class="redt">lee_jun · 본 PC · 로그아웃 (마지막 정상 로그인)</span>',
      ],
      "ENDING D · 혼자 오세요",
    ],
    // 숨겨진 엔딩: 명령 프롬프트로 원격 프로그램을 끔
    H: [
      [
        "원격 세션이 끊겼다. 처음으로 화면이 조용해졌다.",
        "팬 소리만 남은 사무실에서, 당신은 잠깐 숨을 골랐다.",
        "그리고 등 뒤에서 출입문이 열리는 소리가 났다.",
        "화면으로 볼 수 없게 되자, 그는 직접 왔다.",
        '<span class="redt">"이준 씨. 거기까지 하죠."</span>',
      ],
      "ENDING H · 연결 끊김",
    ],
  };

  /* ---------------------------------------------------------
     4. 아이콘과 그림 (SVG)
     --------------------------------------------------------- */

  const ICONS = {
    mail: `<svg viewBox="0 0 40 40">
      <rect x="4" y="9" width="32" height="22" rx="2" fill="#c9d3cf"/>
      <path d="M4 11l16 12 16-12" fill="none" stroke="#3b4a4f" stroke-width="2.4"/>
    </svg>`,
    msg: `<svg viewBox="0 0 40 40">
      <path d="M6 8h28v18H17l-8 7v-7H6z" fill="#8fb9ae"/>
      <circle cx="14" cy="17" r="2" fill="#1b2528"/>
      <circle cx="20" cy="17" r="2" fill="#1b2528"/>
      <circle cx="26" cy="17" r="2" fill="#1b2528"/>
    </svg>`,
    pc: `<svg viewBox="0 0 40 40">
      <rect x="4" y="6" width="32" height="21" rx="2" fill="#3a4b52" stroke="#c9d3cf" stroke-width="2"/>
      <rect x="15" y="28" width="10" height="4" fill="#c9d3cf"/>
      <rect x="10" y="32" width="20" height="3" fill="#c9d3cf"/>
    </svg>`,
    trash: `<svg viewBox="0 0 40 40">
      <rect x="9" y="11" width="22" height="25" rx="2" fill="#7d8a86"/>
      <rect x="6" y="7" width="28" height="4" fill="#c9d3cf"/>
      <path d="M15 15v17M20 15v17M25 15v17" stroke="#3b4a4f" stroke-width="2"/>
    </svg>`,
    log: `<svg viewBox="0 0 40 40">
      <rect x="7" y="4" width="26" height="32" rx="2" fill="#c9d3cf"/>
      <path d="M12 12h16M12 18h16M12 24h10" stroke="#3b4a4f" stroke-width="2.4"/>
      <circle cx="28" cy="29" r="5" fill="#d0392f"/>
    </svg>`,
    notes: `<svg viewBox="0 0 40 40">
      <rect x="8" y="5" width="24" height="31" rx="2" fill="#e7d9a4"/>
      <path d="M13 13h14M13 19h14M13 25h9" stroke="#6b5a2a" stroke-width="2"/>
    </svg>`,
    report: `<svg viewBox="0 0 40 40">
      <rect x="7" y="4" width="26" height="32" rx="2" fill="#c9d3cf"/>
      <path d="M12 11h16M12 17h12" stroke="#3b4a4f" stroke-width="2.4"/>
      <circle cx="24" cy="27" r="6" fill="none" stroke="#d0392f" stroke-width="2.4"/>
    </svg>`,
    folder: `<svg viewBox="0 0 40 40">
      <path d="M4 10h12l3 4h17v20H4z" fill="#b59a57"/>
    </svg>`,
    lockedFolder: `<svg viewBox="0 0 40 40">
      <path d="M4 10h12l3 4h17v20H4z" fill="#7a3b33"/>
      <rect x="15" y="20" width="10" height="9" rx="1" fill="#f1d2cc"/>
      <path d="M17 20v-3a3 3 0 016 0v3" fill="none" stroke="#f1d2cc" stroke-width="2"/>
    </svg>`,
    img: `<svg viewBox="0 0 40 40">
      <rect x="6" y="7" width="28" height="26" rx="2" fill="#c9d3cf"/>
      <circle cx="14" cy="15" r="3" fill="#8fb9ae"/>
      <path d="M8 30l9-10 6 6 4-4 5 8z" fill="#3b4a4f"/>
    </svg>`,
    cmd: `<svg viewBox="0 0 40 40">
      <rect x="4" y="7" width="32" height="26" rx="2" fill="#0b0e10" stroke="#c9d3cf" stroke-width="2"/>
      <path d="M10 15l5 4-5 4" fill="none" stroke="#c9d3cf" stroke-width="2.2"/>
      <path d="M18 25h9" stroke="#c9d3cf" stroke-width="2.2"/>
    </svg>`,
    txt: `<svg viewBox="0 0 40 40">
      <path d="M9 4h16l7 7v25H9z" fill="#c9d3cf"/>
      <path d="M13 16h14M13 21h14M13 26h10" stroke="#3b4a4f" stroke-width="2"/>
    </svg>`,
  };

  // 게임 속 사진들 (코드로 그린 그림)
  const PICTURES = {
    // 회식 사진: 달빛포차 간판 + 사람들 + 고양이
    sign() {
      const people = [86, 126, 170, 214]
        .map((x) => `<circle cx="${x}" cy="132" r="12"/>
                     <rect x="${x - 15}" y="146" width="30" height="40" rx="8"/>`)
        .join("");

      return `<svg viewBox="0 0 320 200" role="img" aria-label="달빛포차 간판 아래 회식 사진">
        <rect width="320" height="200" fill="#1a1420"/>
        <circle cx="276" cy="32" r="15" fill="#f3e3b0"/>
        <circle cx="282" cy="28" r="13" fill="#1a1420"/>
        <rect x="36" y="38" width="248" height="162" fill="#2a2230"/>
        <rect x="66" y="50" width="188" height="42" rx="4" fill="#f1c96b"/>
        <text x="160" y="80" text-anchor="middle" font-size="24" font-weight="700"
              fill="#3a2110" font-family="IBM Plex Sans KR">달빛포차</text>
        <rect x="56" y="102" width="208" height="98" fill="#ffb86b" opacity=".2"/>
        <g fill="#0f0c12">
          ${people}
          <rect x="244" y="182" width="34" height="5"/>
          <ellipse cx="262" cy="174" rx="14" ry="8"/>
          <circle cx="273" cy="164" r="7"/>
          <path d="M268 159l2-7 3 6zM274 158l4-6 1 7z"/>
        </g>
        <text x="10" y="192" font-size="11" fill="#f3e3b0" font-family="monospace">2023.03.17 23:04</text>
      </svg>`;
    },

    // CCTV 캡처: 난간 근처의 두 사람 (한 명은 보안팀 조끼)
    cctv() {
      let noise = "";
      for (let i = 0; i < 180; i++) {
        const x = Math.floor(Math.random() * 320);
        const y = Math.floor(Math.random() * 200);
        const opacity = (Math.random() * 0.45).toFixed(2);
        noise += `<rect x="${x}" y="${y}" width="2" height="1" fill="#fff" opacity="${opacity}"/>`;
      }

      const railPosts = [190, 220, 250, 280, 310]
        .map((x) => `<path d="M${x} 70V112" stroke="#8a8f8c" stroke-width="2"/>`)
        .join("");

      return `<svg viewBox="0 0 320 200" role="img" aria-label="CCTV 캡처: 난간 근처에 두 사람">
        <rect width="320" height="200" fill="#2a2d2c"/>
        <path d="M0 130L320 110V200H0z" fill="#3a3e3c"/>
        <path d="M180 70H320M180 92H320" stroke="#8a8f8c" stroke-width="2"/>
        ${railPosts}
        <rect x="20" y="90" width="50" height="45" fill="#4a4f4c"/>
        <rect x="74" y="104" width="40" height="32" fill="#444946"/>

        <!-- 박정호 -->
        <g fill="#141615">
          <circle cx="232" cy="80" r="8"/>
          <rect x="223" y="88" width="18" height="34" rx="5"/>
        </g>

        <!-- 보안팀 조끼를 입은 사람 -->
        <g>
          <circle cx="196" cy="84" r="8" fill="#141615"/>
          <rect x="186" y="92" width="20" height="36" rx="5" fill="#7c817e"/>
          <rect x="186" y="104" width="20" height="4" fill="#d7dbd8"/>
          <text x="196" y="118" text-anchor="middle" font-size="4.5" fill="#141615"
                font-family="monospace">SECURITY</text>
        </g>

        ${noise}
        <text x="8" y="16" font-size="11" fill="#e6e6e6" font-family="monospace">CAM 07  물류동 3F</text>
        <text x="312" y="16" text-anchor="end" font-size="11" fill="#e6e6e6"
              font-family="monospace">2026-10-14 01:52:07</text>
        <circle cx="12" cy="190" r="4" fill="#d0392f"/>
        <text x="20" y="194" font-size="10" fill="#e6e6e6" font-family="monospace">REC</text>
      </svg>`;
    },

    // 뒷모습 사진: 지금 모니터 앞에 앉은 '나'를 뒤에서 찍은 것
    back() {
      return `<svg viewBox="0 0 320 200" role="img" aria-label="책상에 앉은 사람의 뒷모습을 뒤에서 찍은 사진">
        <defs>
          <radialGradient id="glow" cx=".55" cy=".45" r=".5">
            <stop offset="0" stop-color="#7fb0c4" stop-opacity=".55"/>
            <stop offset="1" stop-color="#7fb0c4" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="320" height="200" fill="#080b0d"/>
        <rect width="320" height="200" fill="url(#glow)"/>
        <rect x="120" y="50" width="120" height="74" rx="3" fill="#9cc4d4"/>
        <rect x="126" y="56" width="108" height="56" fill="#cfe3ea"/>
        <rect x="0" y="140" width="320" height="60" fill="#151a1d"/>
        <rect x="128" y="96" width="72" height="104" rx="20" fill="#0d1113"/>
        <circle cx="164" cy="98" r="22" fill="#0b0e10"/>
        <path d="M144 92q20-26 40 0" fill="#050708"/>
        <text x="8" y="16" font-size="11" fill="#e6e6e6" font-family="monospace">CAM ?? · IT지원실</text>
        <text x="312" y="16" text-anchor="end" font-size="11" fill="#e6e6e6"
              font-family="monospace">2026-11-24 ${formatTime(state.photoTime)}:14</text>
        <circle cx="12" cy="190" r="4" fill="#d0392f"/>
        <text x="20" y="194" font-size="10" fill="#e6e6e6" font-family="monospace">REC</text>
      </svg>`;
    },

    // 잠금 화면 배경: 고양이 액자 + 4월 달력 (12일에 동그라미)
    lockWallpaper() {
      // 2026년 4월 1일은 수요일 → 앞에 빈칸 3개
      const days = ["", "", ""];
      for (let d = 1; d <= 30; d++) days.push(d);

      const calendar = days
        .map((day, i) => {
          if (!day) return "";
          const x = 240 + (i % 7) * 19;
          const y = 68 + Math.floor(i / 7) * 16;
          let cell = `<text x="${x}" y="${y}" text-anchor="middle" font-size="9"
                            fill="#333" font-family="monospace">${day}</text>`;
          if (day === 12) {
            cell += `<circle cx="${x}" cy="${y - 3}" r="7.5" fill="none" stroke="#d0392f" stroke-width="1.6"/>
                     <path d="M${x + 9} ${y - 12}c2-3 6-1 4 2l-4 4-4-4c-2-3 2-5 4-2z" fill="#d0392f"/>`;
          }
          return cell;
        })
        .join("");

      return `<svg viewBox="0 0 400 220" role="img" aria-label="한서진의 책상 사진: 고양이 액자와 달력">
        <rect width="400" height="220" fill="#1f282b"/>
        <rect y="150" width="400" height="70" fill="#2b2420"/>

        <!-- 고양이 액자 -->
        <rect x="40" y="62" width="110" height="92" rx="3" fill="#c8b48a"/>
        <rect x="48" y="70" width="94" height="66" fill="#33302c"/>
        <g fill="#e9e2d4">
          <ellipse cx="95" cy="118" rx="24" ry="14"/>
          <circle cx="112" cy="100" r="12"/>
          <path d="M104 92l3-11 5 9zM114 90l6-9 2 11z"/>
        </g>
        <circle cx="108" cy="99" r="1.6" fill="#33302c"/>
        <circle cx="116" cy="99" r="1.6" fill="#33302c"/>
        <text x="95" y="148" text-anchor="middle" font-size="11" fill="#3a2a14"
              font-family="IBM Plex Sans KR">우리 집 막내 콩이</text>

        <!-- 달력 -->
        <rect x="228" y="28" width="140" height="126" rx="3" fill="#ece8df"/>
        <rect x="228" y="28" width="140" height="22" fill="#a63b32"/>
        <text x="298" y="44" text-anchor="middle" font-size="12" fill="#fff" font-weight="700"
              font-family="IBM Plex Sans KR">2026 · 4월</text>
        ${calendar}
        <text x="298" y="150" text-anchor="middle" font-size="9" fill="#7a2a24"
              font-family="IBM Plex Sans KR">우리 집에 온 날</text>

        <rect x="170" y="140" width="40" height="12" rx="2" fill="#3c4a4f"/>
        <text x="8" y="212" font-size="10" fill="#8d9792" font-family="monospace">hsj-pc-0412 · 잠김</text>
      </svg>`;
    },
  };

  /* ---------------------------------------------------------
     5. 화면 크기 맞추기와 창 관리
     --------------------------------------------------------- */

  // 넓은 화면에서 게임 화면의 기준 높이. 가로는 화면 비율에 맞춰 정함
  const STAGE_HEIGHT = 720;
  const STAGE_MIN_WIDTH = 960;
  const STAGE_MAX_WIDTH = 1600;
  const NARROW_BREAKPOINT = 700; // 이보다 좁으면 모바일 배치

  // 현재 게임 화면의 크기, 위치, 확대 비율
  const view = { width: innerWidth, height: innerHeight, scale: 1, left: 0, top: 0, narrow: false };

  // 브라우저 크기에 맞춰 게임 화면 크기와 확대 비율 다시 계산
  function updateStage() {
    const stage = $("#stage");
    const wasNarrow = view.narrow;
    view.narrow = innerWidth <= NARROW_BREAKPOINT;
    document.body.classList.toggle("narrow", view.narrow);

    if (view.narrow) {
      // 모바일: 확대 없이 화면을 꽉 채움
      Object.assign(view, { width: innerWidth, height: innerHeight, scale: 1, left: 0, top: 0 });
      stage.style.width = "";
      stage.style.height = "";
      stage.style.transform = "";
    } else {
      // 넓은 화면: 기준 높이로 만든 화면을 통째로 확대·축소해서 가운데 배치
      const aspect = innerWidth / innerHeight;
      view.height = STAGE_HEIGHT;
      view.width = Math.round(Math.min(STAGE_MAX_WIDTH, Math.max(STAGE_MIN_WIDTH, STAGE_HEIGHT * aspect)));
      view.scale = Math.min(innerWidth / view.width, innerHeight / view.height);
      view.left = (innerWidth - view.width * view.scale) / 2;
      view.top = (innerHeight - view.height * view.scale) / 2;

      stage.style.width = view.width + "px";
      stage.style.height = view.height + "px";
      stage.style.transform = `translate(${view.left}px, ${view.top}px) scale(${view.scale})`;
    }

    // 모바일 ↔ 넓은 화면이 바뀌면 창을 새로 배치, 아니면 화면 밖으로 나간 창만 끌어옴
    if (wasNarrow !== view.narrow) {
      Object.values(windows).forEach(placeWindow);
    } else {
      Object.values(windows).forEach(keepWindowOnScreen);
    }
  }

  // 브라우저 화면 좌표 → 게임 화면 좌표
  const toStage = (x, y) => ({
    x: (x - view.left) / view.scale,
    y: (y - view.top) / view.scale,
  });

  const windows = {};   // 창 id → 창 요소
  const renderers = {}; // 창 id → 창 내용을 그리는 함수

  // 창의 크기와 위치 정하기 (원하는 크기는 창 요소에 저장해 둠)
  function placeWindow(win) {
    const wantWidth = Number(win.dataset.w);
    const wantHeight = Number(win.dataset.h);
    const slot = Number(win.dataset.slot); // 몇 번째로 열린 창인지 (겹치지 않게 조금씩 밀기)
    const deskHeight = view.height - 44;   // 작업표시줄 제외
    let width, height, left, top;

    if (view.narrow) {
      // 모바일: 가로를 꽉 채우고, 위쪽 아이콘 줄 아래에 배치
      width = view.width - 16;
      height = Math.min(wantHeight, deskHeight - 104);
      left = 8;
      top = Math.min(92 + slot * 10, deskHeight - height - 4);
    } else {
      // 넓은 화면: 왼쪽 아이콘 줄(약 110px)을 피해서 배치
      const iconColumn = 116;
      width = Math.min(wantWidth, view.width - iconColumn - 20);
      height = Math.min(wantHeight, deskHeight - 40);
      left = Math.max(iconColumn, Math.min(iconColumn + 24 + slot * 30, view.width - width - 10));
      top = Math.max(8, Math.min(24 + slot * 28, deskHeight - height - 8));
    }

    Object.assign(win.style, {
      width: width + "px",
      height: height + "px",
      left: left + "px",
      top: top + "px",
    });
  }

  // 화면 크기가 줄었을 때 창이 화면 밖으로 사라지지 않게
  function keepWindowOnScreen(win) {
    const maxLeft = view.width - 80;
    const maxTop = view.height - 90;
    if (win.offsetLeft > maxLeft) win.style.left = maxLeft + "px";
    if (win.offsetTop > maxTop) win.style.top = maxTop + "px";
  }

  // 창을 맨 앞으로 가져오기
  function focusWindow(id) {
    const win = windows[id];
    if (!win) return;
    win.style.zIndex = ++state.topZ;
    document.querySelectorAll(".win.on").forEach((w) => w.classList.remove("on"));
    win.classList.add("on");
  }

  // 창 열기 (이미 열려 있으면 내용만 새로 그리고 맨 앞으로)
  function openWindow(id, title, render, width = 520, height = 400) {
    renderers[id] = render;

    if (windows[id]) {
      windows[id].querySelector(".body").innerHTML = render();
      focusWindow(id);
      return windows[id];
    }

    const win = document.createElement("section");
    win.className = "win";
    win.dataset.id = id;
    win.dataset.w = width;
    win.dataset.h = height;
    win.dataset.slot = Object.keys(windows).length % 6;
    placeWindow(win);

    win.innerHTML = `
      <div class="tb">
        <b></b>
        <button class="x" data-act="close" aria-label="닫기">×</button>
      </div>
      <div class="body"></div>`;
    win.querySelector("b").textContent = title;
    win.querySelector(".x").dataset.arg = id;
    win.querySelector(".body").innerHTML = render();

    $("#desk").appendChild(win);
    windows[id] = win;
    updateTaskbar();
    focusWindow(id);
    return win;
  }

  // 열려 있는 창의 내용 새로 그리기
  function rerender(id) {
    if (id === "msg" && state.messengerLocked) {
      return; // 타이핑이 끝나면 한 번에 다시 그림
    }
    if (windows[id]) {
      windows[id].querySelector(".body").innerHTML = renderers[id]();
    }
  }

  // 창 닫기
  function closeWindow(id) {
    if (!windows[id]) return;
    windows[id].remove();
    delete windows[id];
    delete renderers[id];
    updateTaskbar();
  }

  // 작업표시줄 버튼 다시 만들기
  function updateTaskbar() {
    const bar = $("#tasks");
    bar.innerHTML = "";
    for (const id of Object.keys(windows)) {
      const button = document.createElement("button");
      button.className = "tbtn";
      button.dataset.act = "focus";
      button.dataset.arg = id;
      button.textContent = windows[id].querySelector("b").textContent;
      bar.appendChild(button);
    }
  }

  /* ---------------------------------------------------------
     6. 알림과 단서 기록
     --------------------------------------------------------- */

  // 오른쪽 아래 알림 (클릭하면 onClick 실행, 8초 뒤 사라짐)
  // style: "" = 조용한 알림, "msg" = 메시지(알림음), "red" = 경고(경고음)
  // options.key: 같은 key의 알림이 떠 있으면 새로 쌓지 않고 그 칸의 글자만 바꿈
  // options.duration: 떠 있는 시간 (기본 8초, 반복되는 알림은 짧게)
  const toastTimers = new Map(); // 알림 → 사라지게 할 타이머

  function showToast(text, style = "", onClick, options = {}) {
    const { key, duration = 8000 } = options;
    if (style === "red") sound.alert();
    if (style === "msg") sound.notify();

    let toast = key && $(`#toasts [data-key="${key}"]`);
    if (!toast) {
      toast = document.createElement("button");
      toast.className = "toast " + style + (key ? " mini" : "");
      if (key) toast.dataset.key = key;
      $("#toasts").appendChild(toast);
    }
    toast.textContent = text;
    toast.onclick = () => {
      toast.remove();
      if (onClick) onClick();
    };

    // 같은 알림이 다시 오면 사라지는 시간을 처음부터 다시 셈
    clearTimeout(toastTimers.get(toast));
    toastTimers.set(toast, setTimeout(() => {
      toast.remove();
      toastTimers.delete(toast);
    }, duration));
  }

  // 단서 수첩에 기록 (이미 있으면 무시)
  function addClue(key) {
    if (!key || state.clues.includes(key)) return;
    state.clues.push(key);
    const total = Object.keys(CLUES).length;
    showToast(`단서 수첩에 기록됨 (${state.clues.length}/${total})`, "", () => APPS.notes(), { key: "clue", duration: 2500 });
    rerender("notes");
    rerender("report"); // 새 단서로 보고서 문항이 열릴 수 있음
  }

  // 화면이 순간 깨지는 효과
  function glitch() {
    sound.buzz();
    document.body.classList.add("glitch");
    setTimeout(() => document.body.classList.remove("glitch"), 520);
  }

  /* ---------------------------------------------------------
     7. 화면 그리기 (각 앱의 HTML)
     --------------------------------------------------------- */

  function renderMail() {
    const mail = MAILS[state.selectedMail];
    const list = MAILS.map((m, i) => `
      <button class="li ${i === state.selectedMail ? "sel" : ""}" data-act="mail" data-arg="${i}">
        <b>${m.subject}</b>
        <span>${m.from} · ${m.date}</span>
      </button>`).join("");

    return `
      <div class="split">
        <div class="list">${list}</div>
        <div class="read">
          <h3>${mail.subject}</h3>
          <p class="meta">보낸 사람: ${mail.from} · 받는 사람: ${mail.to} · ${mail.date}</p>
          <pre class="doc">${mail.body}</pre>
        </div>
      </div>`;
  }

  function renderMessenger() {
    const chat = CHATS[state.selectedChat];

    const contacts = Object.keys(CHATS).map((key) => `
      <button class="li ${key === state.selectedChat ? "sel" : ""}" data-act="chat" data-arg="${key}">
        <b>${CHATS[key].name}</b>
        <span>${CHATS[key].status}</span>
      </button>`).join("");

    const bubbleClass = { me: "me", other: "", threat: "thr" };
    const messages = chat.messages.map(([kind, text]) =>
      kind === "day"
        ? `<div class="day">${text}</div>`
        : `<div class="bub ${bubbleClass[kind]}">${text}</div>`
    ).join("");

    // 최문혁의 협박 메시지 이후에만 입력창이 나타남 (입력 가로채기용)
    const inputBar = state.selectedChat === "choi" && state.event2Done
      ? `<div class="inbar"><input id="mi" readonly placeholder="메시지를 입력하세요" aria-label="메시지 입력"></div>`
      : "";

    return `
      <div class="split">
        <div class="list">
          <div class="warn">내 계정: 한서진<br>다른 기기에서 접속됨 · 어제 23:47</div>
          ${contacts}
        </div>
        <div class="read" style="padding:0">
          <div class="chat">${messages}</div>
          ${inputBar}
        </div>
      </div>`;
  }

  function renderFileGrid(fileNames, action) {
    const items = fileNames.map((name) => `
      <button class="file" data-act="${action}" data-arg="${name}">
        ${ICONS[FILES[name].type]}${name}
      </button>`).join("");
    return `<div class="files">${items}</div>`;
  }

  function renderMyPC() {
    const folders = Object.keys(FOLDERS).map((name) => {
      const locked = name === "보험" && !state.insuranceUnlocked;
      return `
        <button class="file" data-act="folder" data-arg="${name}">
          ${locked ? ICONS.lockedFolder : ICONS.folder}${name}
        </button>`;
    }).join("");

    return `
      <p class="dim" style="margin-top:0">hsj-pc-0412 · 로컬 디스크 (C:)</p>
      <div class="files">${folders}</div>`;
  }

  function renderTrash() {
    const items = TRASH.map((name) => {
      const icon = ICONS[FILES[name].type];
      if (state.restored[name]) {
        return `<button class="file" data-act="file" data-arg="${name}">${icon}${name}</button>`;
      }
      return `
        <button class="file" data-act="restore" data-arg="${name}" style="opacity:.55">
          ${icon}${name}<span class="dim">눌러서 복원</span>
        </button>`;
    }).join("");

    return `
      <p class="dim" style="margin-top:0">휴지통 · 항목 ${TRASH.length}개</p>
      <div class="files">${items}</div>`;
  }

  function renderAccessLog() {
    const rows = ACCESS_LOG.slice();

    // 회차 기억: 지난 판에서 '내'가 남긴 마지막 로그아웃 기록 (날짜는 알 수 없음)
    save.history
      .filter((h) => h.run < state.runNumber)
      .forEach((h) => {
        rows.push(["??/?? ??:??", "lee_jun", "본 PC", `로그아웃 (마지막 정상 로그인) · ${ENDING_NAMES[h.ending] || "?"}`, "past"]);
      });

    // 원격 세션이 시작된 뒤에는 '지금 활성' 줄이 추가됨
    if (state.event1Done) {
      const status = state.agentKilled ? "세션 강제 종료됨" : "세션 시작 · 현재 활성";
      rows.push(["오늘 " + formatTime(state.remoteStart), "sec_choi", "원격 · 사내 10.2.0.7", status, state.agentKilled ? "" : "live"]);
    }

    const body = rows.map(([time, account, place, action, rowClass = ""]) => `
      <tr class="${rowClass}">
        <td class="t">${time}</td>
        <td class="t">${account}</td>
        <td>${place}</td>
        <td>${action}</td>
      </tr>`).join("");

    return `
      <p class="dim" style="margin-top:0">hsj-pc-0412 접속 기록 (Access Log)</p>
      <div style="overflow-x:auto">
        <table>
          <tr><th>일시</th><th>계정</th><th>위치</th><th>동작</th></tr>
          ${body}
        </table>
      </div>`;
  }

  function renderNotes() {
    if (!state.clues.length) {
      return `<p class="dim">아직 기록된 단서가 없습니다. 메일부터 열어 보세요.</p>`;
    }
    const total = Object.keys(CLUES).length;
    const items = state.clues.map((key) => `<div class="clue">${CLUES[key]}</div>`).join("");
    return `<p class="dim" style="margin-top:0">${state.clues.length} / ${total}개 기록</p>${items}`;
  }

  // 문항이 열렸는지 (필요한 단서를 모두 찾았는지)
  const isUnlocked = (q) => q.requires.every((key) => state.clues.includes(key));

  function renderReport() {
    // 정답을 맞힌 뒤: 엔딩 선택
    if (state.reportResult === "solved") {
      return `
        <p style="margin-top:0">보고서가 완성되었다. 모든 근거가 한 사람을 가리킨다.</p>
        <p>이제 이 보고서로 무엇을 할지 선택해야 한다.</p>
        <div class="ends">
          <button class="btn red" data-act="end" data-arg="A">보험 폴더를 지우고 퇴근한다</button>
          <button class="btn" data-act="end" data-arg="B">보험 폴더를 기자에게 보낸다</button>
          <button class="btn" data-act="end" data-arg="C">hsj_backup에게 메시지를 보낸다</button>
        </div>`;
    }

    const questions = QUESTIONS.map((q, i) => {
      if (!isUnlocked(q)) {
        return `
          <div class="q locked">
            <b>${i + 1}. ${q.question}</b>
            <p class="dim" style="margin:4px 0 0">잠김 · 아직 판단할 근거가 부족하다.</p>
          </div>`;
      }

      // 입력값을 HTML에 넣기 전에 특수문자 처리
      const saved = state.reportAnswers[i].replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

      return `
        <div class="q">
          <label for="q${i}">${i + 1}. ${q.question}</label>
          <input id="q${i}" name="q${i}" autocomplete="off" placeholder="${q.placeholder}" value="${saved}">
        </div>`;
    }).join("");

    // 제출 결과: 몇 개 맞았는지는 절대 알려 주지 않음
    const messages = {
      incomplete: `<p class="dim" style="margin-top:12px">세 칸을 모두 채워야 제출할 수 있다.</p>`,
      rejected: `<p class="redt" style="margin-top:12px">보고서가 반려되었다. 어딘가 틀렸다.</p>`,
    };

    const allUnlocked = QUESTIONS.every(isUnlocked);

    return `
      <form id="rf">
        <p class="dim" style="margin-top:0">
          조사한 내용을 바탕으로 세 가지 답을 짧게 적으세요.
          문항은 필요한 단서를 찾으면 열립니다.
        </p>
        ${questions}
        <button class="btn" ${allUnlocked ? "" : "disabled"}>제출</button>
        <span class="dim" style="margin-left:8px">남은 제출 기회: ${state.submitsLeft}</span>
      </form>
      ${messages[state.reportResult] || ""}`;
  }

  function renderFolderLock() {
    return `
      <form id="lf" class="lock">
        <p style="margin:0">이 폴더는 암호로 보호되어 있습니다.</p>
        <label for="pw">암호</label>
        <input id="pw" autocomplete="off">
        <button class="btn">열기</button>
        <p id="lmsg" class="dim" style="margin:0"></p>
      </form>`;
  }

  function renderFileViewer(file) {
    if (file.type === "img") {
      return `<div class="pic">${PICTURES[file.image]()}</div><p class="cap">${file.caption}</p>`;
    }
    return `<pre class="doc">${file.body}</pre>`;
  }

  /* ---------------------------------------------------------
     8. 앱 열기
     --------------------------------------------------------- */

  const APPS = {
    mail() {
      openWindow("mail", "메일 — hsj@hangyeol", renderMail, 760, 480);
      addClue(MAILS[state.selectedMail].clue);
    },
    msg() {
      openWindow("msg", "메신저", renderMessenger, 600, 480);
      addClue("c_login");
      readDoyunChat();
      hijackMessenger();
    },
    cmd() {
      openWindow("cmd", "명령 프롬프트", renderCmd, 620, 400);
      focusCmd();
    },
    pc() {
      openWindow("pc", "내 PC", renderMyPC, 440, 260);
    },
    trash() {
      openWindow("trash", "휴지통", renderTrash, 460, 280);
    },
    log() {
      openWindow("log", "접속 기록", renderAccessLog, 640, 380);
      addClue("c_log");
    },
    notes() {
      openWindow("notes", "단서 수첩", renderNotes, 420, 440);
    },
    report() {
      openWindow("report", "보고서 제출", renderReport, 460, 520);
    },
  };

  // 바탕화면 아이콘 [앱 키, 이름]
  const DESKTOP_ICONS = [
    ["mail", "메일"],
    ["msg", "메신저"],
    ["pc", "내 PC"],
    ["trash", "휴지통"],
    ["log", "접속 기록"],
    ["notes", "단서 수첩"],
    ["cmd", "명령 프롬프트"],
    ["report", "보고서 제출"],
  ];

  // 처음 한 번, 그리고 브라우저 크기가 바뀔 때마다 화면 맞추기
  updateStage();
  addEventListener("resize", updateStage);

  $("#icons").innerHTML = DESKTOP_ICONS.map(([key, label]) =>
    `<button class="ic" data-act="app" data-arg="${key}">${ICONS[key]}${label}</button>`
  ).join("");

  function openFolderLock() {
    openWindow("lock", "보험 — 잠긴 폴더", renderFolderLock, 380, 270);
    setTimeout(() => $("#pw") && $("#pw").focus(), 50);
  }

  /* ---------------------------------------------------------
     9. 공포 연출
     --------------------------------------------------------- */

  // 원격 커서를 요소 위로 움직이고, 도착하면 onArrive 실행
  // 움직이는 동안 플레이어의 커서는 숨겨지고 클릭도 막힘
  let ghostWatchdog = 0;

  function moveGhostCursor(target, onArrive) {
    const cursor = $("#gc");
    document.body.classList.add("taken");

    // 안전장치: 어떤 이유로든 원격 조작이 8초 넘게 안 끝나면 조작권을 강제로 돌려줌
    clearTimeout(ghostWatchdog);
    ghostWatchdog = setTimeout(() => hideGhostCursor(0), 8000);

    // 처음 나타날 때는 오른쪽 위에서 시작
    if (cursor.style.display !== "block") {
      cursor.style.transition = "none";
      cursor.style.left = view.width - 30 + "px";
      cursor.style.top = "40px";
      cursor.style.display = "block";
      cursor.getBoundingClientRect(); // 위치를 먼저 확정시켜야 애니메이션이 적용됨
      cursor.style.transition = "";
    }

    // 목표 요소의 가운데 (브라우저 좌표 → 게임 화면 좌표로 변환)
    const rect = target.getBoundingClientRect();
    const point = toStage(rect.left + rect.width / 2, rect.top + rect.height / 2);
    cursor.style.left = point.x + "px";
    cursor.style.top = point.y + "px";
    setTimeout(() => onArrive && onArrive(), 1300);
  }

  // 원격 커서를 숨기고 플레이어에게 조작권 돌려주기
  function hideGhostCursor(delay = 600) {
    clearTimeout(ghostWatchdog);
    setTimeout(() => {
      $("#gc").style.display = "none";
      document.body.classList.remove("taken");
    }, delay);
  }

  // 원격 커서가 창의 X 버튼을 눌러 닫아 버림
  function forceClose(id, message) {
    const win = windows[id];
    if (!win) return;
    const closeButton = win.querySelector(".x");

    moveGhostCursor(closeButton, () => {
      closeButton.style.background = "var(--red)";
      setTimeout(() => {
        closeWindow(id);
        glitch();
        showToast(message, "red");
        hideGhostCursor(400);
      }, 350);
    });
  }

  // 글자를 한 자씩 써 내려가기 (요소의 글자)
  function typeText(element, text, onDone) {
    let i = 0;
    const timer = setInterval(() => {
      // 대상이 화면에서 사라져도 '끝났다'는 신호는 꼭 보냄 (안 보내면 조작권이 영영 안 돌아옴)
      if (!element.isConnected) {
        clearInterval(timer);
        if (onDone) onDone();
        return;
      }
      element.textContent = text.slice(0, ++i);
      sound.key();
      if (i >= text.length) {
        clearInterval(timer);
        if (onDone) onDone();
      }
    }, 75);
  }

  // 글자를 한 자씩 써 내려가기 (입력창의 값)
  function typeValue(input, text, onDone) {
    let i = 0;
    const timer = setInterval(() => {
      if (!input.isConnected) {
        clearInterval(timer);
        if (onDone) onDone();
        return;
      }
      input.value = text.slice(0, ++i);
      sound.key();
      if (i >= text.length) {
        clearInterval(timer);
        if (onDone) onDone();
      }
    }, 90);
  }

  // 입력 가로채기 ①: 최문혁 대화방에서 내 이름으로 답장이 써지고 전송됨
  function hijackMessenger() {
    if (state.chatHijacked || !state.event2Done || state.gameOver || state.agentKilled) return;
    if (state.selectedChat !== "choi" || !windows.msg) return;
    state.chatHijacked = true;
    state.messengerLocked = true;

    const reply = "네 팀장님. 지금 지우겠습니다.";

    setTimeout(() => {
      const input = $("#mi");
      if (!input) {
        // 그 사이 메신저 창을 닫았으면 다음에 다시 열 때 일어나게 함
        state.chatHijacked = false;
        state.messengerLocked = false;
        return;
      }
      moveGhostCursor(input, () => {
        typeValue(input, reply, () => {
          setTimeout(() => {
            CHATS.choi.messages.push(["me", reply], ["threat", "착하네요."]);
            state.messengerLocked = false;
            rerender("msg");
            const chatArea = windows.msg && windows.msg.querySelector(".read");
            if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
            glitch();
            hideGhostCursor(300);
            showToast("내 계정으로 메시지가 전송되었습니다", "red");
          }, 600);
        });
      });
    }, 1500);
  }

  // 여러 입력칸에 차례로 글자 써 넣기 (fields: [[입력칸, 글자], ...])
  function typeSequence(fields, onDone) {
    if (!fields.length) return onDone && onDone();
    const [[input, text], ...rest] = fields;
    moveGhostCursor(input, () => {
      input.value = "";
      typeValue(input, text, () => setTimeout(() => typeSequence(rest, onDone), 250));
    });
  }

  /* ---------------------------------------------------------
     10. 이벤트
     --------------------------------------------------------- */

  // 이벤트 1: 보험 폴더를 연 직후, 원격 세션 시작
  function startEvent1() {
    if (state.event1Done) return;
    state.event1Done = true;
    state.remoteStart = gameMinutes;

    glitch();
    sound.scratch();
    $("#remote").style.display = "inline";
    rerender("log");
    showToast("원격 데스크톱 세션이 연결되었습니다", "red", () => APPS.log());

    // 메모장이 혼자 열리고 경고가 써짐 (두 번째 판부터는 나를 기억함)
    const warning = previousRuns > 0
      ? "…또 여기까지 왔네요.\n\n이번엔 다르게 끝날 것 같아요?"
      : "…거기까지만 보세요.\n\n지금 닫으면, 아무 일도 없었던 겁니다.";
    const openWarningNote = () => {
      openWindow("ghost", "제목 없음 - 메모장", () => `<pre class="doc" id="gt"></pre>`, 380, 210);
      typeText($("#gt"), warning, () => hideGhostCursor(900));
    };

    setTimeout(() => moveGhostCursor($("#desk"), openWarningNote), 1000);

    // 김도윤 ①: 누군가 서진의 PC를 켠 걸 눈치챔
    setTimeout(() => doyunMessage(1, [
      "…서진씨?",
      "지금 그 PC 켠 거 서진씨예요?",
      "아니면 누구예요?",
    ]), 25000);
  }

  // 이벤트 2: 음성메모를 읽은 뒤, 뒷모습 사진과 협박 메시지
  function startEvent2() {
    if (state.event2Done || state.gameOver || state.agentKilled) return;
    state.event2Done = true;
    state.photoTime = gameMinutes - 5; // 5분 전에 찍힌 사진

    // 사진 폴더에 새 파일 추가
    const photoName = "IMG_" + formatTime(state.photoTime).replace(":", "") + ".jpg";
    FILES[photoName] = {
      type: "img",
      image: "back",
      clue: "c_photo",
      caption: `생성: 오늘 ${formatTime(state.photoTime)} · 생성 계정: sec_choi`,
    };
    FOLDERS["사진"].push(photoName);

    // 최문혁의 협박 메시지
    CHATS.choi.status = "접속 중 · 지금";
    CHATS.choi.messages.push(
      ["day", "오늘 " + formatTime(gameMinutes)],
      ["threat", "이준 씨."],
      ["threat", "그 PC로 보고 있는 거 알아요."],
      ["threat", "보험 폴더째로 지우고 퇴근하세요."],
      ["threat", "뒤는 돌아보지 말고."]
    );

    glitch();
    rerender("f:사진");
    rerender("msg");
    rerender("pc");

    showToast("새 메시지 · 최문혁 팀장", "red", () => {
      state.selectedChat = "choi";
      APPS.msg();
    });
    setTimeout(() => {
      showToast("사진 폴더에 새 파일: " + photoName, "", () => ACTIONS.file(photoName));
    }, 1400);

    // 김도윤 ②: 경고 + 명령 프롬프트 힌트 + 고백
    setTimeout(() => doyunMessage(2, [
      "누군지 몰라도, 그 PC 지금 최 팀장이 원격으로 보고 있어요.",
      "명령 프롬프트에서 tasklist 쳐 봐요. 원격 프로그램이 보일 거예요.",
      "그거 끄면 더는 못 봐요. …대신 화가 많이 나겠죠.",
      "그리고 하나만 말할게요.",
      "최 팀장이 '보험' 얘기를 어떻게 알았는지 알아요?",
      "내가 말했어요. 그날 아침 불려 가서… 무서워서.",
      "서진씨한테 미안하다고 전해 줘요. 살아 있으면.",
    ], "자리 비움"), 30000);
  }

  /* ---------------------------------------------------------
     10-1. 김도윤 서브 미스터리
     ---------------------------------------------------------
     서진의 동료. 처음엔 '보안팀이 읽는다'고 경고하던 사람인데,
     사실은 그 자신이 최문혁에게 '보험'을 말해 버린 사람이었다.
     ① 원격 세션 직후: 서진의 PC를 누가 켰는지 묻는다
     ② 뒷모습 사진 이후: 명령 프롬프트 힌트를 주고, 고백한다 */

  let doyunStage = 0;

  function doyunMessage(stage, lines, status = "접속 중") {
    if (state.gameOver || doyunStage >= stage) return;
    doyunStage = stage;

    CHATS.doyun.status = status;
    CHATS.doyun.messages.push(["day", "오늘 " + formatTime(gameMinutes)], ...lines.map((t) => ["other", t]));
    rerender("msg");
    readDoyunChat();

    showToast("새 메시지 · 김도윤", "msg", () => {
      state.selectedChat = "doyun";
      APPS.msg();
    });
  }

  // 김도윤 대화방을 보고 있을 때 단서 기록
  function readDoyunChat() {
    if (!windows.msg || state.selectedChat !== "doyun") return;
    addClue("c_pwhint");
    if (doyunStage >= 2) addClue("c_doyun");
  }

  /* ---------------------------------------------------------
     11. 명령 프롬프트
     ---------------------------------------------------------
     IT 담당자인 주인공이 처음으로 '반격'할 수 있는 곳.
     tasklist로 원격 프로그램을 찾고 taskkill로 끄면 숨겨진 엔딩 H */

  const CMD_PROMPT = "C:\\Users\\hsj>";

  function renderCmd() {
    const output = state.cmdLines.map(escapeHtml).join("\n");
    return `
      <div class="cmd">
        <pre class="cmd-out" id="cmdout">${output}</pre>
        <form id="cmdf" class="cmd-line">
          <label for="cmdin">${CMD_PROMPT}</label>
          <input id="cmdin" autocomplete="off" spellcheck="false" autocapitalize="off" aria-label="명령어 입력">
        </form>
      </div>`;
  }

  // 출력 맨 아래로 스크롤하고 입력칸에 커서 두기
  function focusCmd() {
    const out = $("#cmdout");
    if (out) out.scrollTop = out.scrollHeight;
    const input = $("#cmdin");
    if (input && !view.narrow) input.focus();
  }

  function runCommand(raw) {
    const input = raw.trim();
    state.cmdLines.push(CMD_PROMPT + input);
    const [name = "", ...args] = input.toLowerCase().split(/\s+/);
    const remoteActive = state.event1Done && !state.agentKilled;
    const print = (...lines) => state.cmdLines.push(...lines, "");

    switch (name) {
      case "":
        break;

      case "help":
        print(
          "사용할 수 있는 명령어:",
          "  whoami      현재 사용자 확인",
          "  ipconfig    네트워크 정보",
          "  netstat     현재 네트워크 연결 목록",
          "  tasklist    실행 중인 프로그램 목록",
          "  query       로그인한 세션 목록 (query session)",
          "  dir         폴더 목록",
          "  cls         화면 지우기",
          "  exit        창 닫기"
        );
        break;

      case "whoami":
        print("hsj-pc-0412\\hsj", "(원격 대리 로그인: lee_jun)");
        break;

      case "ipconfig":
        print("IPv4 주소 . . . . . . : 10.2.3.41", "서브넷 마스크 . . . . : 255.255.0.0", "기본 게이트웨이 . . . : 10.2.0.1");
        break;

      case "netstat": {
        const rows = [
          "  프로토콜  로컬 주소           외부 주소           상태",
          "  TCP       10.2.3.41:49702     10.2.0.1:443        ESTABLISHED",
        ];
        if (remoteActive) rows.push("  TCP       10.2.3.41:3389      10.2.0.7:51544      ESTABLISHED  (원격 데스크톱)");
        rows.push("  TCP       10.2.3.41:5222      알 수 없음:443      TIME_WAIT");
        print(...rows);
        break;
      }

      case "tasklist": {
        const rows = [
          "이미지 이름              PID    사용자",
          "======================== ====== ==========",
          "explorer.exe             1840   hsj",
          "messenger.exe            2204   hsj",
          "cmd.exe                  5012   lee_jun",
        ];
        if (remoteActive) {
          rows.push("remote_agent.exe         4120   sec_choi");
          addClue("c_agent");
        }
        print(...rows);
        break;
      }

      case "query":
      case "qwinsta": {
        const rows = ["세션 이름      사용자 이름   ID  상태", "console        hsj           1   활성"];
        if (remoteActive) rows.push("rdp-tcp#3      sec_choi      2   활성");
        print(...rows);
        break;
      }

      case "dir":
        print(" C:\\Users\\hsj 디렉터리", "", "<DIR>          사진", "<DIR>          문서", "<DIR>          보험");
        break;

      case "taskkill":
        killRemoteAgent(args.join(" "), print);
        break;

      // 세션을 직접 끊는 명령은 관리자 권한이 없어서 막힘 (잠금 화면 단서와 연결)
      case "logoff":
      case "rwinsta":
      case "tsdiscon":
      case "shutdown":
        print("액세스가 거부되었습니다.", "(이 PC의 관리자 권한은 11/05 03:12에 해제되었습니다)");
        break;

      case "cls":
        state.cmdLines = [];
        break;

      case "exit":
        closeWindow("cmd");
        return;

      default:
        print(`'${input.split(/\s+/)[0]}'은(는) 내부 또는 외부 명령, 실행할 수 있는 프로그램, 또는`, "배치 파일이 아닙니다.");
    }

    rerender("cmd");
    focusCmd();
  }

  function killRemoteAgent(target, print) {
    const aimsAtAgent = target.includes("remote_agent") || target.includes("4120");
    if (!aimsAtAgent || !state.event1Done || state.agentKilled) {
      print("오류: 프로세스를 찾을 수 없습니다.");
      return;
    }
    if (state.gameOver) {
      print("오류: 액세스가 거부되었습니다.");
      return;
    }
    print('성공: 프로세스 "remote_agent.exe"(PID 4120)이(가) 종료되었습니다.');
    startEndingH();
  }

  // 숨겨진 엔딩 H: 원격을 끊자 정적… 그리고 출입문이 열린다
  function startEndingH() {
    state.agentKilled = true;
    state.gameOver = true; // 다른 이벤트 멈춤
    $("#remote").style.display = "none";
    hideGhostCursor(0);
    rerender("log");

    setTimeout(() => showToast("원격 데스크톱 세션이 종료되었습니다", "msg"), 800);
    setTimeout(() => {
      sound.door();
      glitch();
      showToast("IT지원실 출입문이 열렸습니다 · 출입카드: 최문혁", "red");
    }, 9000);
    setTimeout(() => finishGame("H"), 13000);
  }

  /* ---------------------------------------------------------
     12. 엔딩
     --------------------------------------------------------- */

  // 엔딩 문장이 한 줄씩 천천히 나타나게 만들기
  function renderEnding(lines, title) {
    const step = 0.9; // 줄 사이 간격 (초)
    const paragraphs = lines.map((line, i) =>
      `<p style="animation-delay:${i * step}s">${line}</p>`
    ).join("");
    const titleDelay = lines.length * step + 0.4;
    const buttonDelay = lines.length * step + 1;

    return `
      <div class="endbox">
        ${paragraphs}
        <h2 style="animation-delay:${titleDelay}s">${title}</h2>
        <button class="btn" data-act="restart" style="animation-delay:${buttonDelay}s">처음부터</button>
      </div>`;
  }

  // 엔딩 D: 보고서를 3번 틀리면, 원격 사용자가 보고서를 빼앗아 가짜 답으로 제출함
  function startEndingD() {
    state.gameOver = true;
    APPS.report();
    const inputs = [0, 1, 2].map((i) => $("#q" + i));
    const fakeAnswers = ["아무도 없었다", "없음", "없음"];
    const submitButton = $("#rf .btn");

    glitch();
    showToast("원격 사용자가 보고서를 작성하고 있습니다", "red");

    setTimeout(() => {
      typeSequence(inputs.map((input, i) => [input, fakeAnswers[i]]), () => {
        // 제출 버튼을 누름
        moveGhostCursor(submitButton, () => {
          submitButton.style.background = "var(--red)";
          setTimeout(() => {
            closeWindow("report");
            hideGhostCursor(300);

            // 한서진이 받았던 것과 같은 문장의 메일이 도착
            MAILS.unshift({
              from: "최문혁 (보안팀장)",
              to: "이준",
              date: "오늘 " + formatTime(gameMinutes),
              subject: "[보안] 보고서 잘 받았습니다",
              clue: null,
              body: `이준 씨,

보고서 잘 받았습니다.
사고 당시 현장에는 아무도 없었다. 맞죠?

내일 아침 일찍 보안팀으로 오세요.
혼자.`,
            });
            state.selectedMail = 0;
            closeWindow("mail");
            APPS.mail();
            glitch();

            setTimeout(() => finishGame("D"), 7000);
          }, 400);
        });
      });
    }, 1200);
  }

  // 엔딩 확정: 도감과 회차 기록에 저장하고 엔딩 화면 표시
  function finishGame(key) {
    state.gameOver = true;
    hideGhostCursor(0);

    if (!save.endings.includes(key)) save.endings.push(key);
    save.history.push({ run: state.runNumber, ending: key });
    save.history = save.history.slice(-3); // 최근 3판만 기억
    writeSave();

    let [lines, title] = ENDINGS[key];

    // 진엔딩: 김도윤의 고백을 들었다면 한서진이 답을 남김
    if (key === "C" && state.clues.includes("c_doyun")) {
      lines = [...lines];
      lines.splice(lines.length - 1, 0, "[hsj_backup] 도윤씨 얘기는 들었어요. …괜찮다고 전해 줘요.");
    }

    showEnding(renderEnding(lines, title));
  }

  function showEnding(html) {
    const overlay = $("#end");
    overlay.innerHTML = `<div class="box">${html}</div>`;
    overlay.hidden = false;
  }

  // 엔딩 B: 업로드 중 원격 사용자의 취소 시도를 3번 막아야 함
  function startEndingB() {
    state.gameOver = true;
    showEnding(`
      <h2 style="margin-top:0">제보 메일 전송</h2>
      <p class="dim">받는 사람: 제보 데스크 · 첨부: 보험.zip (사고보고서 원본, CCTV 원본, 음성메모)</p>
      <div class="pb"><i id="pbi"></i></div>
      <p id="pbt">업로드 중… 0%</p>
      <div id="intr"></div>`);

    const interruptAt = [28, 57, 83]; // 이 진행률에서 방해가 들어옴
    const reactionTime = 2300;        // 버튼을 눌러야 하는 제한 시간 (ms)
    let progress = 0;
    let deadline = 0;                 // 0이 아니면 방해 중

    const timer = setInterval(() => {
      // 방해 중: 제한 시간 안에 못 누르면 실패
      if (deadline) {
        if (Date.now() > deadline) {
          clearInterval(timer);
          finishGame("B_FAIL");
        }
        return;
      }

      progress++;
      $("#pbi").style.width = progress + "%";
      $("#pbt").textContent = `업로드 중… ${progress}%`;

      if (interruptAt.includes(progress)) {
        deadline = Date.now() + reactionTime;
        glitch();
        $("#intr").innerHTML = `
          <p class="redt">원격 사용자가 전송을 취소하려고 합니다</p>
          <button class="btn red" data-act="keep">전송 유지</button>`;
      }

      if (progress >= 100) {
        clearInterval(timer);
        finishGame("B");
      }
    }, 90);

    state.keepSending = () => {
      deadline = 0;
      $("#intr").innerHTML = "";
    };
  }

  /* ---------------------------------------------------------
     13. 버튼 동작 (data-act 값 → 함수)
     --------------------------------------------------------- */

  const ACTIONS = {
    // 시작 화면 → 잠금 화면
    boot() {
      sound.start(); // 첫 클릭에서 소리 켜기
      $("#boot").hidden = true;
      $("#wall").innerHTML = PICTURES.lockWallpaper();
      // 두 번째 판부터: 잠금 화면이 나를 알아봄
      if (previousRuns > 0) {
        $("#lsmsg").innerHTML = `<span class="redt">또 오셨네요, 이준 씨.</span>`;
      }
      $("#ls").hidden = false;
      setTimeout(() => $("#lpw").focus(), 50);
    },

    // 잠금 화면: 관리자 로그인 시도 (항상 실패, 하지만 단서를 줌)
    admin() {
      state.triedAdmin = true;
      $("#lsmsg").innerHTML = `
        <span class="redt">관리자 원격 로그인 권한이 해제된 PC입니다.<br>
        해제한 계정: sec_choi · 11/05 03:12</span><br>
        사용자 본인의 암호로만 로그인할 수 있습니다.`;
    },

    // 잠금 화면: 암호 힌트
    loginHint() {
      $("#lsmsg").textContent = "암호 힌트: 막내 + 그날 (숫자 4자리)";
    },

    app: (key) => APPS[key](),
    focus: (id) => focusWindow(id),
    close: (id) => closeWindow(id),

    mail(index) {
      state.selectedMail = Number(index);
      rerender("mail");
      addClue(MAILS[state.selectedMail].clue);
    },

    chat(key) {
      state.selectedChat = key;
      rerender("msg");
      readDoyunChat();
      hijackMessenger();
    },

    folder(name) {
      if (name === "보험" && !state.insuranceUnlocked) return openFolderLock();
      openWindow("f:" + name, name, () => renderFileGrid(FOLDERS[name], "file"), 460, 300);
    },

    file(name) {
      const file = FILES[name];
      const isImage = file.type === "img";
      openWindow("v:" + name, name, () => renderFileViewer(file), isImage ? 560 : 520, isImage ? 460 : 440);
      addClue(file.clue);

      // 처음 열 때만 실행되는 동작
      if (file.onOpen && !file.opened) {
        file.opened = true;
        file.onOpen();
      }

      // 원격 세션 중에 중요한 파일을 처음 열면 3.5초 뒤 강제 종료
      if (state.event1Done && FORCE_CLOSE_FILES.includes(name) && !state.forceClosed[name]) {
        state.forceClosed[name] = true;
        setTimeout(() => forceClose("v:" + name, "원격 사용자가 창을 닫았습니다: " + name), 3500);
      }
    },

    restore(name) {
      state.restored[name] = true;
      rerender("trash");
      ACTIONS.file(name);
    },

    end(key) {
      if (key === "B") return startEndingB();
      finishGame(key);
    },

    keep: () => state.keepSending && state.keepSending(),
    restart: () => location.reload(),

    // 작업표시줄: 소리 켜기/끄기
    toggleSound() {
      sound.start();
      sound.setEnabled(!sound.enabled);
      $("#mute").textContent = sound.enabled ? "소리 켬" : "소리 끔";
      $("#mute").setAttribute("aria-pressed", String(!sound.enabled));
    },

    // 시작 화면: 기록 지우기 (실수 방지로 두 번 눌러야 지워짐)
    resetSave(arg, button) {
      if (button.dataset.confirm !== "yes") {
        button.dataset.confirm = "yes";
        button.textContent = "정말 지울까요? 한 번 더 누르세요";
        return;
      }
      try {
        localStorage.removeItem(SAVE_KEY);
      } catch {}
      location.reload();
    },
  };

  // 시작 화면의 엔딩 도감
  function renderEndingDex() {
    const seen = save.endings;
    const items = ENDING_DEX.map(([key, name]) => {
      const found = seen.includes(key);
      const label = found ? name : key === "H" ? "??? (숨겨진 엔딩)" : "???";
      return `<li class="${found ? "seen" : ""}">${label}</li>`;
    }).join("");

    $("#dex").innerHTML = `
      <div class="dex-head">
        <b>엔딩 도감</b>
        <span class="dim">${seen.length} / ${ENDING_DEX.length}</span>
      </div>
      <ul class="dex-list">${items}</ul>
      ${save.runs ? `
        <p class="dex-foot dim">
          지금까지 ${save.runs}번 접속했다.
          <button type="button" class="linkbtn" data-act="resetSave">기록 지우기</button>
        </p>` : ""}`;

    if (save.runs) {
      $("#boot .eyebrow").textContent += ` · ${save.runs + 1}번째 접속`;
    }
  }

  renderEndingDex();

  /* ---------------------------------------------------------
     14. 입력 처리
     --------------------------------------------------------- */

  // 암호 비교 전에 띄어쓰기 제거
  const clean = (text) => text.replace(/\s/g, "");

  // 틀렸을 때 흔들리는 효과
  function shake(element) {
    element.classList.remove("shake");
    void element.offsetWidth; // 애니메이션을 다시 시작시키기 위한 트릭
    element.classList.add("shake");
  }

  // 로그인 제출
  function submitLogin() {
    const input = clean($("#lpw").value);

    if (LOGIN_PASSWORDS.includes(input)) {
      $("#ls").hidden = true;
      sound.startHum();

      // 회차 기록
      save.runs++;
      state.runNumber = save.runs;
      writeSave();

      // 게임 시계 시작 (실제 5초 = 게임 1분)
      setInterval(() => {
        gameMinutes++;
        $("#clock").textContent = formatTime(gameMinutes);
      }, 5000);
      if (state.triedAdmin) addClue("c_admin");
      APPS.mail();
      setTimeout(() => showToast("위쪽(또는 왼쪽) 아이콘으로 앱을 열 수 있습니다. 막히면 단서 수첩을 보세요."), 800);
      return;
    }

    state.loginTries++;
    sound.error();
    shake($("#lsf"));
    const n = state.loginTries;
    const message = $("#lsmsg");

    if (n >= 5) {
      message.innerHTML = `<span class="redt">암호가 틀렸습니다 (${n}회). 로그인 실패가 보안팀에 보고되었습니다.</span><br>
        힌트: 액자 속 이름 + 달력에 동그라미 친 날`;
    } else if (n >= 3) {
      message.innerHTML = `암호가 틀렸습니다 (${n}회).<br>힌트: 액자 속 이름 + 달력에 동그라미 친 날 (월일 4자리)`;
    } else {
      message.textContent = `암호가 틀렸습니다 (${n}회).`;
    }
  }

  // 보험 폴더 암호 제출
  function submitFolderPassword() {
    if (clean($("#pw").value) === FOLDER_PASSWORD) {
      state.insuranceUnlocked = true;
      closeWindow("lock");
      rerender("pc");
      ACTIONS.folder("보험");
      setTimeout(startEvent1, 2600); // 열고 2.6초 뒤 원격 접속 시작
      return;
    }

    state.folderTries++;
    sound.error();
    shake($("#lf"));
    $("#lmsg").textContent = "암호가 올바르지 않습니다." +
      (state.folderTries >= 2 ? " 힌트: 팀 첫 회식 가게 이름" : "");
  }

  // 보고서 제출
  function submitReport(form) {
    const data = new FormData(form);
    state.reportAnswers = [0, 1, 2].map((i) => (data.get("q" + i) || "").trim());

    // 빈칸이 있으면 기회를 쓰지 않고 안내만
    if (state.reportAnswers.some((v) => !v)) {
      state.reportResult = "incomplete";
      return rerender("report");
    }

    // 세 답이 모두 맞아야 정답 (몇 개 맞았는지는 알려 주지 않음)
    const allCorrect = QUESTIONS.every((q, i) => isCorrectAnswer(i, state.reportAnswers[i]));

    if (allCorrect) {
      state.reportResult = "solved";
      return rerender("report");
    }

    state.submitsLeft--;
    if (state.submitsLeft <= 0) {
      return startEndingD();
    }

    state.reportResult = "rejected";
    rerender("report");
    glitch();
    // 틀릴 때마다 원격 사용자가 보고서를 들여다봄
    if (state.event1Done) showToast("원격 사용자가 보고서를 열람했습니다", "red");
  }

  // 클릭: data-act가 있는 요소를 누르면 ACTIONS에서 찾아 실행
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act]");
    if (!target) return;
    const action = ACTIONS[target.dataset.act];
    if (action) {
      event.preventDefault();
      action(target.dataset.arg, target);
    }
  });

  // 폼 제출
  document.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.id === "lsf") submitLogin();
    if (form.id === "lf") submitFolderPassword();
    if (form.id === "rf") submitReport(form);
    if (form.id === "cmdf") runCommand($("#cmdin").value);
  });

  // 탭 이탈 감지: 원격 세션 중에 다른 탭에 다녀오면 최문혁이 알아챔 (최대 2번)
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const secondsAway = Math.round((Date.now() - hiddenAt) / 1000);
    hiddenAt = 0;

    if (secondsAway < 3 || !state.event1Done) return;
    if (state.gameOver || state.agentKilled || state.tabWarnings >= 2) return;

    state.tabWarnings++;
    const lines = state.tabWarnings === 1
      ? [`${secondsAway}초 동안 어디 다녀오셨어요?`]
      : ["자리 비우지 마세요.", "그 화면, 저도 같이 보고 있으니까요."];

    CHATS.choi.status = "접속 중 · 지금";
    CHATS.choi.messages.push(["day", "오늘 " + formatTime(gameMinutes)], ...lines.map((t) => ["threat", t]));
    rerender("msg");

    setTimeout(() => {
      glitch();
      showToast("새 메시지 · 최문혁 팀장: " + lines[0], "red", () => {
        state.selectedChat = "choi";
        APPS.msg();
      });
    }, 700);
  });

  // 보고서 입력값을 기억해 둠 (새 단서로 보고서가 다시 그려져도 유지되도록)
  function rememberReportField(field) {
    const match = /^q(\d)$/.exec(field.id);
    if (match) state.reportAnswers[Number(match[1])] = field.value;
  }

  document.addEventListener("input", (event) => rememberReportField(event.target));

  document.addEventListener("change", (event) => rememberReportField(event.target));

  // 창 드래그 (제목 표시줄을 잡고 끌기)
  document.addEventListener("pointerdown", (event) => {
    const win = event.target.closest(".win");
    if (win) focusWindow(win.dataset.id);

    const titleBar = event.target.closest(".tb");
    if (!titleBar || event.target.closest(".x")) return;

    // 모든 계산은 게임 화면 좌표로 (확대·축소된 상태에서도 마우스를 정확히 따라오게)
    const start = toStage(event.clientX, event.clientY);
    const offsetX = start.x - win.offsetLeft;
    const offsetY = start.y - win.offsetTop;
    const winWidth = win.offsetWidth;
    titleBar.setPointerCapture(event.pointerId);

    const onMove = (e) => {
      const point = toStage(e.clientX, e.clientY);
      // 창이 화면 밖으로 완전히 사라지지 않도록 제한
      const left = Math.max(80 - winWidth, Math.min(view.width - 80, point.x - offsetX));
      const top = Math.max(0, Math.min(view.height - 90, point.y - offsetY));
      win.style.left = left + "px";
      win.style.top = top + "px";
    };
    const onUp = () => {
      titleBar.removeEventListener("pointermove", onMove);
      titleBar.removeEventListener("pointerup", onUp);
    };

    titleBar.addEventListener("pointermove", onMove);
    titleBar.addEventListener("pointerup", onUp);
  });
}
