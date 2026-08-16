const concepts = [
  { id: 'threads', label: 'A', name: 'Threads Minimal', summary: '무채색과 선 중심 · 콘텐츠가 먼저 보이는 가장 절제된 안' },
  { id: 'disquiet', label: 'B', name: 'Disquiet Feed', summary: '따뜻한 배경과 또렷한 섹션 · 커뮤니티 피드에 가까운 안' },
  { id: 'toss', label: 'C', name: 'Toss Compact', summary: '선명한 블루와 굵은 위계 · 행동을 빠르게 찾는 제품형 안' },
  { id: 'midnight', label: 'D', name: 'Midnight Radio', summary: '전체 다크 · 현재 재생을 방송 온에어처럼 강조하는 몰입형 안' },
  { id: 'zine', label: 'E', name: 'Paper Zine', summary: '종이 질감과 세리프 타이포 · 카페 매거진처럼 읽히는 편집형 안' },
  { id: 'messenger', label: 'F', name: 'Messenger Queue', summary: '신청곡을 대화 흐름처럼 연결 · 참여감이 강한 소셜형 안' },
  { id: 'bento', label: 'G', name: 'Bento Player', summary: '기능을 모듈 블록으로 분리 · 한눈에 상태를 읽는 대시보드형 안' },
  { id: 'jukebox', label: 'H', name: 'Retro Jukebox', summary: '크림과 레드, 굵은 테두리 · 음악적 개성을 전면에 둔 안' },
  { id: 'signal', label: 'I', name: 'Mono Signal', summary: '흑백과 형광 라임 · 디지털 포스터 같은 고대비 실험안' },
  { id: 'nightwave', label: 'J', name: 'Nightwave', summary: '딥 네이비와 전기 블루 · 부드럽지만 선명한 야간 방송형 안' },
  { id: 'acid', label: 'K', name: 'Acid Club', summary: '블랙과 애시드 옐로 · 독립 음악 클럽 포스터 같은 안' },
  { id: 'redline', label: 'L', name: 'Redline FM', summary: '차콜과 시그널 레드 · 산업적인 라디오 콘솔형 안' },
  { id: 'polar', label: 'M', name: 'Polar Signal', summary: '차가운 화이트와 시안 · 정밀한 디지털 플레이어형 안' },
  { id: 'layeredlime', label: 'N', name: 'Layered Lime', summary: '라임 신청 패널과 블랙 재생 카드를 함께 띄운 이중 레이어 안' },
  { id: 'bluefloat', label: 'O', name: 'Blue Float', summary: '딥 네이비 위에 블루 재생 카드와 흰 신청 패널을 부유시킨 안' },
  { id: 'redoffset', label: 'P', name: 'Red Offset', summary: '크림 바탕에 블랙과 레드 패널을 인쇄물처럼 어긋나게 쌓은 안' },
  { id: 'chromestack', label: 'Q', name: 'Chrome Stack', summary: '차가운 회색 바탕에 시안 프레임을 겹친 정밀한 레이어 안' },
  { id: 'cyberqueue', label: 'R', name: 'Cyber Queue', summary: '블랙·애시드 옐로 핵심 패널과 K식 평면 신청곡 목록의 최종 후보' },
  { id: 'dailysignal', label: 'S', name: 'Daily Signal', summary: '따뜻한 화이트 바탕에 형광 레이어만 남긴 일상형 조합 후보' },
  { id: 'lounge', label: 'T', name: 'Moody Lounge', summary: '에스프레소 다크에 앰버 골드 하나 · 프리미엄 야간 카페 무드의 편안한 다크' },
  { id: 'retrowarm', label: 'U', name: 'Retro Warm', summary: '크림 바탕에 빈티지 오렌지 + 틸 투톤 · 정겹고 음악적인 저자극 개성' },
  { id: 'editorial', label: 'V', name: 'Editorial Pop', summary: '따뜻한 오프화이트에 확신에 찬 코발트 히어로 · 잡지 같은 강한 위계' },
  { id: 'botanical', label: 'W', name: 'Botanical Dusk', summary: '뮤트 플럼 다크에 세이지 + 소프트 로즈 · 낯설지만 부드러운 색 이야기' },
  { id: 'cfcurrent', label: 'X', name: '현재 손님 앱', summary: '실제 tokens.css 그대로 · 네온 라임 × 순검정 × 핫핑크 하드 그림자 (색만 비교용 기준)' },
  { id: 'cfrecolor', label: 'Y', name: '리컬러 제안', summary: 'X와 레이아웃·구조 동일, 색만 교체 · 앰버 골드 × 웜 차콜 × 웜 클레이 그림자' },
  { id: 'brutalneon', label: 'E1', name: 'Neon Brutalist', summary: '순검정에 라임 + 일렉트릭 마젠타 듀얼 · 두꺼운 테두리와 스택 오프셋의 브루탈 포스터' },
  { id: 'liquidacid', label: 'E2', name: 'Liquid Acid', summary: '라임→시안 그라디언트와 네온 글로우 · 부드러운 라운드의 액체질감 실험' },
  { id: 'vaporwave', label: 'E3', name: 'Vaporwave Sunset', summary: '마젠타→퍼플→시안 선셋 그라디언트 · 딥 인디고 위 레트로 퓨처' },
  { id: 'liquidsignal', label: 'E4', name: 'Liquid Signal', summary: 'E2 × 현재 앱 블렌드 · 라임/시안 그라디언트와 글로우를 현재 앱의 네온 라임·순검정·핫핑크 정체성에 입힘' },
];

const songs = [
  { title: 'Love wins all', artist: '아이유', status: '대기 1번째', tone: 'violet', likes: 12, comments: 3 },
  { title: 'How Sweet', artist: 'NewJeans', status: '대기 2번째', tone: 'mint', likes: 8, comments: 1 },
  { title: 'Supernova', artist: 'aespa', status: '확인 중', tone: 'coral', likes: 5, comments: 0 },
];

const icons = {
  music: '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>',
  message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
};

function icon(name, size) {
  const iconSize = size || 18;
  return '<svg width="' + iconSize + '" height="' + iconSize + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>';
}

function cover(tone, large) {
  return '<div class="cover cover--' + tone + (large ? ' cover--large' : '') + '">' + icon('music', large ? 26 : 18) + '</div>';
}

function songRow(song) {
  return [
    '<article class="song">',
    '<div class="song-context"><span class="status-badge">' + song.status + '</span><span>방금 전</span></div>',
    '<div class="song-main">',
    cover(song.tone),
    '<div class="song-copy"><strong>' + song.title + '</strong><span>' + song.artist + '</span></div>',
    '</div>',
    '<div class="song-actions">',
    '<button type="button" aria-label="' + song.title + ' 좋아요">' + icon('heart', 16) + '<span>' + song.likes + '</span></button>',
    '<button type="button" aria-label="' + song.title + ' 댓글">' + icon('message', 16) + '<span>' + song.comments + '</span></button>',
    '</div>',
    '</article>',
  ].join('');
}

function screen(concept) {
  return [
    '<section class="customer-screen theme--' + concept.id + '" aria-label="' + concept.name + ' 고객 화면">',
    '<header class="cafe-header">',
    '<div class="cafe-title-row"><h2>모노 커피 성수</h2><span class="open-badge">신청 가능</span></div>',
    '<p>함께 만드는 오늘의 플레이리스트</p>',
    '</header>',
    '<section class="now-playing" aria-label="현재 재생 중">',
    '<div class="now-label"><span class="playing-dot"></span>재생 중</div>',
    '<div class="now-body">',
    cover('navy', true),
    '<div><strong>Magnetic</strong><span>ILLIT</span></div>',
    '<span class="play-icon">' + icon('play', 17) + '</span>',
    '</div></section>',
    '<nav class="tabs" aria-label="음악 목록">',
    '<button type="button" class="is-active">신청곡</button><button type="button">최근 재생</button>',
    '<button type="button">카페 TOP</button><button type="button">전체 TOP</button>',
    '</nav>',
    '<button type="button" class="composer">',
    '<span class="composer-icon">' + icon('link', 18) + '</span>',
    '<span><strong>듣고 싶은 곡이 있나요?</strong><small>음악 링크를 붙여넣어 신청하세요</small></span>',
    '<span class="composer-action">입력</span>',
    '</button>',
    '<div class="feed-heading"><div><strong>신청곡</strong><span>3곡이 기다리고 있어요</span></div>',
    '<button type="button">' + icon('search', 17) + '<span class="sr-only">목록 검색</span></button></div>',
    '<div class="sort-tabs" aria-label="정렬"><button type="button" class="is-active">신청순</button><button type="button">좋아요순</button></div>',
    '<div class="song-list">' + songs.map(songRow).join('') + '</div>',
    '</section>',
  ].join('');
}

const stage = document.querySelector('#concept-stage');

stage.innerHTML = concepts.map(function renderConcept(concept) {
  return [
    '<article class="concept" data-concept="' + concept.id + '">',
    '<header class="concept-header"><span class="concept-index">' + concept.label + '</span>',
    '<div><h2>' + concept.name + '</h2><p>' + concept.summary + '</p></div></header>',
    '<div class="device-frame">' + screen(concept) + '</div>',
    '</article>',
  ].join('');
}).join('');

document.querySelectorAll('.control-button[data-filter]').forEach(function bindFilter(button) {
  button.addEventListener('click', function applyFilter() {
    stage.dataset.filter = button.dataset.filter;
    document.querySelectorAll('.control-button[data-filter]').forEach(function updateFilter(item) {
      item.classList.toggle('is-active', item === button);
    });
  });
});

document.querySelectorAll('.control-button[data-width]').forEach(function bindWidth(button) {
  button.addEventListener('click', function applyWidth() {
    stage.dataset.width = button.dataset.width;
    document.querySelectorAll('.control-button[data-width]').forEach(function updateWidth(item) {
      item.classList.toggle('is-active', item === button);
    });
  });
});
