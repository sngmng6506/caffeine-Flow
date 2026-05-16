const { app, BrowserWindow, BrowserView, ipcMain, screen, components, shell, dialog } = require('electron');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const path = require('path');

// navigator.webdriver 숨김 — SoundCloud·Spotify 등이 Electron 감지 후 팝업 차단하는 것 방지
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// 신청곡 자동 재생 허용 — Chromium 기본 정책은 user gesture 없는 오디오를 차단함.
// 신청 수락 시 recView가 새 페이지를 로드하면 클릭 컨텍스트가 끊겨 SoundCloud autoplay가 막히므로 정책 자체를 풀어줌.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// CastLabs Electron에 Widevine CDM 내장 — 별도 로딩 불필요
const widevineStatus = 'castlabs';

const isDev = !app.isPackaged;
const OWNER_URL = isDev
  ? 'http://localhost:5174/owner/'
  : 'https://caffeine-flow-production.up.railway.app/owner/';

let LEFT_RATIO = 0.42;

let mainWindow      = null;
let currentBgmUrl   = null; // 현재 설정된 BGM URL — end-rec 시 이탈 여부 확인용
// bgmView: 매장 BGM (Spotify/YouTube 플레이리스트 등 — 항상 살아있음, 신청곡 사이에도 상태 유지)
let bgmView         = null;
// recView: 손님 신청곡 (필요할 때만 생성, 끝나면 destroy)
let recView         = null;
let recViewAttached = false;
let panelVisible    = false;
let spotifyPoll          = null; // recView Spotify 트랙 종료 감지 폴링 (overlay 모드)
let soundcloudPoll       = null; // recView SoundCloud 트랙 종료 감지 폴링 (autoplay로 넘어간 트랙 변화 감지)
let currentRecMode       = null; // 'overlay' | 'spotify-takeover' | null
let bgmSpotifyEndCleanup = null; // takeover 모드: bgmView 종료 감지 cleanup fn
let savedBgmMeta         = null; // takeover 모드: 재생 중이던 BGM 트랙 메타 ({title, artist, trackId})

function getContentSize() {
  return mainWindow.getContentSize();
}

// http(s) 외 외부 프로토콜(spotify:, ms-windows-store: 등) 차단 — Windows에서 Store 팝업 방지
function blockExternalProtocol(view) {
  const handler = (e, url) => {
    if (!/^(https?|about|data|blob):/i.test(url)) e.preventDefault();
  };
  view.webContents.on('will-navigate', handler);
  view.webContents.on('will-redirect', handler);
  // SoundCloud·Spotify 로그인 팝업 허용 — 적절한 크기로 BrowserWindow 생성
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (!/^https?:\/\//i.test(url)) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 500,
        height: 700,
        webPreferences: { contextIsolation: false, nodeIntegration: false },
      },
    };
  });
  // 팝업 윈도우에도 동일한 UA 적용 + 명시적으로 표시 (OAuth 차단 방지)
  view.webContents.on('did-create-window', (popup) => {
    popup.webContents.setUserAgent(mainWindow.webContents.getUserAgent());
    popup.show();
  });
}

// BGM용 BrowserView — 한 번 만들면 신청곡 사이에도 destroy 안 함 (재생 위치 유지가 핵심)
function createBgmView() {
  if (bgmView) return;
  bgmView = new BrowserView({
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      preload: path.join(__dirname, 'stealth-preload.js'),
      backgroundThrottling: false, // 뒤에 가려져 있어도 JS 실행 유지 (Spotify 플레이어 중단 방지)
    },
  });
  blockExternalProtocol(bgmView);
  bgmView.webContents.loadURL('https://www.google.com');
}

// 신청곡용 BrowserView — 매번 새로 만들고 끝나면 destroy
function createRecView() {
  if (recView) return;
  recView = new BrowserView({
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      preload: path.join(__dirname, 'youtube-preload.js'),
    },
  });
  blockExternalProtocol(recView);

  // 영상 종료 감지 → React에 video-ended 전달
  recView.webContents.on('ipc-message', (_e, channel) => {
    if (channel === 'youtube-video-ended') {
      mainWindow.webContents.send('video-ended');
    }
  });

  // 현재 재생 영상 정보 업데이트
  recView.webContents.on('page-title-updated', (_e, title) => {
    if (!recView) return;
    const url = recView.webContents.getURL();
    const match = url.match(/[?&]v=([^&]+)/);
    if (match) {
      const videoId = match[1];
      mainWindow.webContents.send('now-playing', {
        videoId,
        title: title.replace(/ - YouTube$/, ''),
        thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      });
    } else {
      mainWindow.webContents.send('now-playing', null);
    }
  });
}

function attachBgmPanel() {
  if (panelVisible) return;
  if (!bgmView) createBgmView();
  mainWindow.addBrowserView(bgmView);
  panelVisible = true;
  resizeViews();
}

function detachAll() {
  if (!panelVisible) return;
  if (recView && recViewAttached) {
    mainWindow.removeBrowserView(recView);
    recViewAttached = false;
  }
  if (recView) {
    recView.webContents.destroy();
    recView = null;
  }
  if (bgmView) {
    mainWindow.removeBrowserView(bgmView);
    bgmView.webContents.destroy();
    bgmView = null;
  }
  panelVisible = false;
}

function resizeViews() {
  const [w, h] = getContentSize();
  const leftW  = Math.floor(w * LEFT_RATIO);
  const bounds = { x: leftW, y: 0, width: w - leftW, height: h };
  if (bgmView) {
    bgmView.setBounds(bounds);
    bgmView.setAutoResize({ width: false, height: true });
  }
  if (recView) {
    recView.setBounds(bounds);
    recView.setAutoResize({ width: false, height: true });
  }
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width,
    height,
    show: false,
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Caffeine Flow — owner',
  });

  // Google OAuth "embedded user agent" 차단 우회 — 순수 Chrome UA로 위장
  const origUa = mainWindow.webContents.getUserAgent();
  const chromeMatch = origUa.match(/Chrome\/[\d.]+/);
  const chromeVer = chromeMatch ? chromeMatch[0] : 'Chrome/128.0.0.0';
  const fakeUa = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ${chromeVer} Safari/537.36`;
  mainWindow.webContents.setUserAgent(fakeUa);
  mainWindow.webContents.session.setUserAgent(fakeUa);

  mainWindow.loadURL(OWNER_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    createBgmView();
  });
  // React 앱이 완전히 로드된 후 widevine 상태 전달
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('widevine-status', widevineStatus);
  });
  mainWindow.on('resize', resizeViews);

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// Spotify·SoundCloud 로그인용 독립 창 — BrowserView와 같은 세션 공유 → 로그인 후 bgmView에서도 인증 유지
let loginWin = null;
ipcMain.on('open-login-window', (_e, url) => {
  if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return; }
  loginWin = new BrowserWindow({
    width: 520, height: 720,
    title: '로그인',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      preload: path.join(__dirname, 'stealth-preload.js'),
    },
  });
  // 메인창과 동일한 페이크 UA 적용 (Electron 흔적 제거)
  try {
    const ua = mainWindow.webContents.getUserAgent();
    loginWin.webContents.setUserAgent(ua);
  } catch (_) {}
  loginWin.loadURL(url);
  loginWin.on('closed', () => {
    loginWin = null;
    mainWindow.webContents.send('login-window-closed');
  });
});

// 좌우 패널 비율 조정 — React 드래그 핸들에서 호출
ipcMain.on('set-panel-ratio', (_e, ratio) => {
  LEFT_RATIO = Math.min(0.85, Math.max(0.15, ratio));
  resizeViews();
});

// 특정 도메인의 모든 쿠키/스토리지 초기화 (DataDome 봇 차단 마커 제거용)
async function clearDomainSession(domains) {
  const { session } = require('electron');
  const sess = session.defaultSession;
  try {
    const allCookies = await sess.cookies.get({});
    const targets = allCookies.filter(c =>
      domains.some(d => (c.domain || '').includes(d))
    );
    for (const c of targets) {
      const cleanDomain = (c.domain || '').replace(/^\./, '');
      const url = `https://${cleanDomain}${c.path || '/'}`;
      try { await sess.cookies.remove(url, c.name); } catch (_) {}
    }
    console.log('[clear-session] removed', targets.length, 'cookies for', domains.join(','));
    // localStorage / IndexedDB 등도 origin 단위로 초기화
    for (const d of domains) {
      try {
        await sess.clearStorageData({
          origin: `https://${d}`,
          storages: ['localstorage', 'sessionstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
        });
      } catch (_) {}
    }
    return targets.length;
  } catch (e) {
    console.error('[clear-session] failed:', e);
    return 0;
  }
}

ipcMain.handle('clear-soundcloud-session', async () => {
  return await clearDomainSession(['soundcloud.com', 'datadome.co', 'datadome.com']);
});

ipcMain.handle('clear-spotify-session', async () => {
  return await clearDomainSession(['spotify.com', 'scdn.co']);
});

// 외부 브라우저(시스템 기본 브라우저)로 URL 열기 — DataDome 등 진단/우회용
ipcMain.on('open-external', (_e, url) => {
  try {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  } catch (e) { console.error('[open-external]', e); }
});

// Chrome 쿠키 import — Cookie Editor 등 확장에서 JSON으로 export한 파일 읽어 Electron 세션에 주입
// DataDome이 Electron 자체 로그인을 차단할 때, Chrome에서 성공한 세션을 그대로 복제하는 우회로
ipcMain.handle('import-cookies-from-file', async () => {
  const { session } = require('electron');
  const result = await dialog.showOpenDialog({
    title: 'Cookie Editor에서 export한 JSON 파일 선택',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };

  try {
    const json    = await fs.promises.readFile(result.filePaths[0], 'utf8');
    const cookies = JSON.parse(json);
    if (!Array.isArray(cookies)) throw new Error('JSON이 배열 형식이 아닙니다 (Cookie Editor 형식이어야 함)');

    const sess  = session.defaultSession;
    let success = 0, failed = 0;
    const errors = [];
    for (const c of cookies) {
      try {
        if (!c.name || !c.domain) { failed++; continue; }
        const cleanDomain = String(c.domain).replace(/^\./, '');
        const url = `${c.secure === false ? 'http' : 'https'}://${cleanDomain}${c.path || '/'}`;
        // sameSite 매핑 (Cookie Editor 'unspecified' → Electron 'no_restriction')
        let sameSite = c.sameSite || 'no_restriction';
        if (sameSite === 'unspecified' || sameSite === 'no_restriction') sameSite = 'no_restriction';
        else if (sameSite === 'lax')    sameSite = 'lax';
        else if (sameSite === 'strict') sameSite = 'strict';
        else if (sameSite === 'no_restriction' || sameSite === 'none') sameSite = 'no_restriction';
        else sameSite = 'no_restriction';

        await sess.cookies.set({
          url,
          name:           c.name,
          value:          String(c.value || ''),
          domain:         c.domain,
          path:           c.path || '/',
          secure:         !!c.secure,
          httpOnly:       !!c.httpOnly,
          expirationDate: c.expirationDate || (c.session ? undefined : (Date.now() / 1000) + 86400 * 365),
          sameSite,
        });
        success++;
      } catch (e) {
        failed++;
        if (errors.length < 3) errors.push(`${c.name}: ${e.message}`);
      }
    }
    console.log(`[cookie-import] success ${success} / failed ${failed} / total ${cookies.length}`);
    if (errors.length) console.error('[cookie-import] sample errors:', errors);
    return { success, failed, total: cookies.length, errors };
  } catch (e) {
    console.error('[cookie-import] failed:', e);
    return { error: e.message };
  }
});

// bgmView DevTools 토글 (디버깅용)
ipcMain.on('open-bgm-devtools', () => {
  if (bgmView) bgmView.webContents.openDevTools({ mode: 'detach' });
});

// 로그인 후 BGM 패널 표시
ipcMain.on('show-youtube', () => {
  attachBgmPanel();
  mainWindow.webContents.send('youtube-state', true);
});

// 로그아웃 시 모든 view 제거
ipcMain.on('hide-youtube', () => {
  detachAll();
  mainWindow.webContents.send('youtube-state', false);
});

// BGM URL 설정 — bgmView에 로드 + 패널이 닫혀있으면 자동으로 붙임
ipcMain.on('set-bgm-url', (_e, url) => {
  currentBgmUrl = url;
  if (!bgmView) createBgmView();
  // 패널이 숨겨진 상태면 자동 attach — 클릭 시 즉시 오른쪽에 표시
  if (!panelVisible) {
    mainWindow.addBrowserView(bgmView);
    panelVisible = true;
    resizeViews();
    mainWindow.webContents.send('youtube-state', true);
  }
  const currentUrl = bgmView.webContents.getURL();
  // Spotify는 이미 로드된 상태면 SPA 라우팅으로 이동 — loadURL은 전체 새로고침이라 플레이어 상태 초기화됨
  const spotifyToSpotify = url.includes('open.spotify.com') && currentUrl.includes('open.spotify.com');
  if (spotifyToSpotify) {
    bgmView.webContents.executeJavaScript(`window.location.href = ${JSON.stringify(url)}`);
  } else {
    bgmView.webContents.loadURL(url);
  }
});

// BGM 해제 — 빈 페이지로
ipcMain.on('clear-bgm', () => {
  if (!bgmView) return;
  bgmView.webContents.loadURL('https://www.google.com');
});

// Spotify play/pause 버튼 클릭 — aria-label로 현재 상태 판단
const SPOTIFY_CLICK_PLAY_IF_PAUSED = `
  (function() {
    const btn = document.querySelector('[data-testid="control-button-playpause"]');
    if (!btn) return 'no-btn';
    const label = btn.getAttribute('aria-label') || '';
    const isPaused = label.includes('재생') || label.toLowerCase().includes('play');
    if (isPaused) { btn.click(); return 'clicked'; }
    return 'already-playing';
  })()
`;

// === Spotify+Spotify takeover 헬퍼들 ===

// 페이지의 메인 재생 버튼 클릭 (트랙/앨범/플리 페이지의 큰 재생 버튼)
// widget 토글이 아닌 "이 페이지 콘텐츠를 처음부터 재생" → Spotify Connect 상태 강제 덮어쓰기
const SPOTIFY_CLICK_PAGE_PLAY = `
  (function() {
    const candidates = [
      '[data-testid="action-bar-row"] [data-testid="play-button"]',
      '[data-testid="action-bar-row"] button[aria-label*="재생"]',
      '[data-testid="action-bar-row"] button[aria-label*="Play"]',
      'section [data-testid="play-button"]',
      'main [data-testid="play-button"]',
      'button[data-testid="play-button"]',
      '[data-testid="play-button"]',
      'button[data-encore-id="buttonPrimary"][aria-label*="재생"]',
      'button[data-encore-id="buttonPrimary"][aria-label*="Play"]',
    ];
    for (const sel of candidates) {
      const btn = document.querySelector(sel);
      if (!btn) continue;
      const label = btn.getAttribute('aria-label') || '';
      const isPause = label.includes('일시 정지') || label.toLowerCase().includes('pause');
      if (isPause) { console.log('[CF page-play]', sel, '→ already playing'); return 'already-playing'; }
      btn.click();
      console.log('[CF page-play] clicked:', sel, 'label:', label);
      return 'clicked';
    }
    console.log('[CF page-play] no button found');
    return 'no-btn';
  })()
`;

// 플리 페이지에서 특정 트랙 row를 찾아 클릭 (resume 용)
// 리턴값: 'clicked' | 'no-rows' | 'not-found' | 'err'
const SPOTIFY_CLICK_PLAYLIST_ROW = (meta) => `
  (function() {
    const targetTrackId = ${JSON.stringify(meta?.trackId || null)};
    const targetTitle = ${JSON.stringify(meta?.title || null)};
    if (!targetTrackId && !targetTitle) return 'no-meta';

    const rows = document.querySelectorAll('[data-testid="tracklist-row"]');
    if (rows.length === 0) return 'no-rows';

    for (const row of rows) {
      const link = row.querySelector('a[href*="/track/"]');
      if (!link) continue;
      const rowTrackId = (link.href.match(/\\/track\\/([A-Za-z0-9]+)/) || [])[1];
      const rowTitle = (link.textContent || '').trim();
      const matchById = targetTrackId && rowTrackId === targetTrackId;
      const matchByTitle = targetTitle && rowTitle === targetTitle;
      if (!matchById && !matchByTitle) continue;

      // row 내부 재생 버튼 (호버 시 노출되는 ▶) 찾기
      const btns = row.querySelectorAll('button, [role="button"]');
      for (const btn of btns) {
        const label = btn.getAttribute('aria-label') || '';
        if (label.includes('재생') || label.toLowerCase().includes('play')) {
          btn.click();
          console.log('[CF row-play] clicked btn for:', rowTitle);
          return 'clicked';
        }
      }
      // fallback: row를 더블클릭해 재생
      const evt = new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window });
      row.dispatchEvent(evt);
      console.log('[CF row-play] dblclick on:', rowTitle);
      return 'clicked';
    }
    return 'not-found';
  })()
`;

// bgmView를 loadURL로 강제 전환 + 재생
// resumeMeta가 있으면 플리에서 해당 트랙 row를 찾아 클릭, 없으면 페이지 메인 재생 버튼 클릭
function bgmSpotifyNavigateAndPlay(targetUrl, resumeMeta = null) {
  if (!bgmView || !targetUrl) return;
  console.log('[bgmNav] loadURL →', targetUrl, resumeMeta ? '(with resume meta)' : '');
  bgmView.webContents.loadURL(targetUrl);

  let retries = 0;
  const maxRetries = 10;
  const tryPlay = async () => {
    if (!bgmView || retries >= maxRetries) return;
    retries++;

    // resume이 요청되면 먼저 플리 row 클릭 시도
    if (resumeMeta && (resumeMeta.title || resumeMeta.trackId)) {
      const r = await bgmView.webContents.executeJavaScript(SPOTIFY_CLICK_PLAYLIST_ROW(resumeMeta)).catch(() => 'err');
      console.log('[bgmNav] row-play attempt', retries, '→', r);
      if (r === 'clicked') {
        // 성공 → 음소거 해제
        try { bgmView.webContents.setAudioMuted(false); } catch {}
        return;
      }
      if (r === 'no-rows') {
        // 아직 트랙 목록 미로드 → 재시도
        setTimeout(tryPlay, 1000);
        return;
      }
      // 'not-found' / 'no-meta' / 'err' → 페이지 재생 버튼으로 fallback
    }

    // 페이지 메인 재생 버튼 (플리 처음부터 / 트랙 시작)
    const r = await bgmView.webContents.executeJavaScript(SPOTIFY_CLICK_PAGE_PLAY).catch(() => 'err');
    console.log('[bgmNav] page-play attempt', retries, '→', r);
    if (r === 'clicked' || r === 'already-playing') {
      try { bgmView.webContents.setAudioMuted(false); } catch {}
      return;
    }
    setTimeout(tryPlay, 1000);
  };

  bgmView.webContents.once('did-finish-load', () => {
    setTimeout(tryPlay, 2000);
  });
  setTimeout(tryPlay, 5000);
}

// takeover 모드: bgmView 신청곡 종료 감지
// 핵심: DOM 셀렉터는 Spotify 버전마다 바뀌므로 표준 navigator.mediaSession.metadata 사용
//      (OS 미디어 컨트롤용으로 Spotify가 늘 갱신함 → title/artist 안정적으로 획득)
function setupBgmSpotifyEndDetection(requestUrl) {
  if (!bgmView) return;
  console.log('[takeover] detection setup for:', requestUrl);

  let endFired = false;
  let savedSig = null;       // 신청곡이 처음 잡혔을 때의 시그니처 (baseline)
  let changeCount = 0;       // baseline에서 바뀐 폴링 연속 횟수

  const fireEnd = () => {
    if (endFired) return;
    endFired = true;
    cleanup();
    // 다음 곡 음성 즉시 차단 — navigation 완료 전까지 무음
    try { if (bgmView) bgmView.webContents.setAudioMuted(true); } catch {}
    console.log('[takeover] firing video-ended');
    mainWindow.webContents.send('video-ended');
  };

  // 1초 간격 폴링: mediaSession 우선, DOM은 backup
  const poll = setInterval(async () => {
    if (endFired || !bgmView) { clearInterval(poll); return; }
    try {
      const info = await bgmView.webContents.executeJavaScript(`
        (function() {
          const meta = navigator.mediaSession && navigator.mediaSession.metadata;
          const title = meta && meta.title || null;
          const artist = meta && meta.artist || null;
          // DOM backup
          let domHref = null;
          const sels = [
            '[data-testid="context-item-link-title"]',
            '[data-testid="nowplaying-track-link"]',
            '[data-testid="context-item-info-title"] a',
            'footer a[href*="/track/"]',
            'aside a[href*="/track/"]',
          ];
          for (const sel of sels) {
            const el = document.querySelector(sel);
            const link = el && el.href ? el : el && el.querySelector ? el.querySelector('a[href*="/track/"]') : null;
            if (link && link.href && link.href.includes('/track/')) { domHref = link.href; break; }
          }
          const out = { title: title, artist: artist, domHref: domHref };
          console.log('[CF takeover poll]', JSON.stringify(out));
          return out;
        })()
      `);
      if (!info) return;

      // 시그니처: mediaSession title|artist 우선 (DOM path는 실제 재생곡과 다를 수 있음)
      const sig = info.title ? `${info.title}|${info.artist || ''}` : null;
      if (!sig) return;

      if (!savedSig) {
        savedSig = sig;
        console.log('[takeover] baseline saved:', sig);
        return;
      }
      if (sig !== savedSig) {
        changeCount++;
        console.log('[takeover] changed →', sig, 'count:', changeCount);
        if (changeCount >= 1) fireEnd();
      } else {
        changeCount = 0;
      }
    } catch (e) {
      // ignore
    }
  }, 1000);

  const cleanup = () => clearInterval(poll);
  bgmSpotifyEndCleanup = cleanup;
}

// 신청곡 시작 — Spotify+Spotify는 takeover, 그 외는 overlay
ipcMain.on('play-rec', async (_e, videoIdOrUrl) => {
  const url = videoIdOrUrl.startsWith('http')
    ? videoIdOrUrl
    : `https://www.youtube.com/watch?v=${videoIdOrUrl}`;
  const isSpotifyRec = url.includes('open.spotify.com');
  const bgmIsSpotify = currentBgmUrl?.includes('open.spotify.com');

  // === takeover 모드: BGM=Spotify + rec=Spotify ===
  // 두 개의 동시 Spotify 세션은 Connect 충돌로 작동 불가 → bgmView 하나로 처리
  if (bgmView && isSpotifyRec && bgmIsSpotify) {
    currentRecMode = 'spotify-takeover';

    // rec 시작 전 재생 중이던 BGM 트랙 메타 저장 (end-rec 시 플리 위치 복원용)
    savedBgmMeta = await bgmView.webContents.executeJavaScript(`
      (function() {
        const m = navigator.mediaSession && navigator.mediaSession.metadata;
        const title = m && m.title || null;
        const artist = m && m.artist || null;
        // now-playing 위젯 링크의 URI 파라미터에서 실제 재생 중 트랙 ID 추출
        let trackId = null;
        const sels = [
          '[data-testid="context-item-link-title"]',
          '[data-testid="nowplaying-track-link"]',
          'footer a[href*="/track/"]',
        ];
        for (const sel of sels) {
          const el = document.querySelector(sel);
          const link = el && el.href ? el : el && el.querySelector ? el.querySelector('a[href*="/track/"]') : null;
          if (!link || !link.href) continue;
          try {
            const u = new URL(link.href);
            const uri = u.searchParams.get('uri') || '';
            const m2 = uri.match(/track[:%3A]+([A-Za-z0-9]+)/i);
            if (m2) { trackId = m2[1]; break; }
            // URI 없으면 path에서
            const m3 = link.href.match(/\\/track\\/([A-Za-z0-9]+)/);
            if (m3) { trackId = m3[1]; }
          } catch {}
        }
        return { title: title, artist: artist, trackId: trackId };
      })()
    `).catch(() => null);
    console.log('[takeover] saved BGM meta:', savedBgmMeta);

    console.log('[takeover] play rec in bgmView:', url);
    bgmSpotifyNavigateAndPlay(url);
    setTimeout(() => setupBgmSpotifyEndDetection(url), 5000);
    return;
  }

  // === overlay 모드: 그 외 모든 케이스 ===
  currentRecMode = 'overlay';

  if (bgmView) {
    bgmView.webContents.setAudioMuted(true);
    // setAudioMuted가 Spotify를 pause시키므로 잠시 후 play 클릭해 무음 재생 유지
    setTimeout(() => {
      if (bgmView) bgmView.webContents.executeJavaScript(SPOTIFY_CLICK_PLAY_IF_PAUSED).catch(() => {});
    }, 300);
  }

  if (!recView) createRecView();
  if (panelVisible && !recViewAttached) {
    mainWindow.addBrowserView(recView);
    recViewAttached = true;
    resizeViews();
  }
  recView.webContents.loadURL(url);

  // SoundCloud 인증 모달 강제 비표시 — insertCSS는 executeJavaScript와 달리
  // JS 실행 실패·타이밍 이슈와 무관하게 렌더러 레벨에서 항상 적용됨. 1차 방어선.
  // DOM 제거(아래 executeJavaScript)는 2차 방어선으로 유지.
  if (url.includes('soundcloud.com')) {
    recView.webContents.insertCSS(`
      .auth-modal, .modalWhiteout, .webAuthContainerWrapper, .onetapAuthContainer { display: none !important; }
      body.show-onetap, body.g-overflow-hidden { overflow: auto !important; }
    `).catch((e) => console.error('[CF insertCSS]', e));
  }

  // SoundCloud는 페이지 로드만으론 재생 안 됨 — 메인 재생 버튼을 직접 클릭.
  // DOM이 늦게 붙는 경우가 있어 짧은 간격으로 몇 번 재시도.
  const isSoundCloudRec = url.includes('soundcloud.com');
  if (isSoundCloudRec) {
    recView.webContents.once('did-finish-load', () => {
      // 2차 방어선: DOM 제거 + MutationObserver. JS 실패해도 1차 CSS가 처리.
      recView.webContents.executeJavaScript(`
        (function() {
          const style = document.createElement('style');
          style.textContent = \`
            .modal, .modal__modal, .modal__overlay, .signupOverlay, .signinModal,
            [role="dialog"], [aria-modal="true"], dialog[open] { display: none !important; }
            body { overflow: auto !important; }
          \`;
          (document.head || document.documentElement).appendChild(style);

          function killModals() {
            // 0) SoundCloud 로그인 위젯 iframe (one-tap / web-auth / signin)을 감싸는 모달 wrapper 제거.
            //    iframe 로드는 webRequest에서 cancel돼도 wrapper(X 버튼+반투명 배경)는 DOM에 남기 때문.
            //    SoundCloud는 엔드포인트를 자주 바꿔서 src에 secure.soundcloud.com 만 매칭.
            document.querySelectorAll('iframe').forEach(f => {
              if (!f.src) return;
              if (!/secure\.soundcloud\.com|accounts\.google\.com\/gsi|api-auth\.soundcloud\.com/i.test(f.src)) return;
              let target = f;
              let cur = f.parentElement;
              for (let i = 0; i < 8 && cur; i++) {
                if (getComputedStyle(cur).position === 'fixed') { target = cur; break; }
                cur = cur.parentElement;
              }
              try { target.remove(); } catch {}
            });
            // 1) SoundCloud 인증 모달 정밀 셀렉터 — 실제 DOM 분석 결과 적용.
            //    .auth-modal: X 버튼 + 반투명 배경(modalWhiteout)
            //    .webAuthContainerWrapper: web-auth iframe 컨테이너 (모달과 형제 관계)
            //    .onetapAuthContainer: 헤더의 one-tap intermediate iframe 컨테이너
            document.querySelectorAll('.auth-modal, .webAuthContainerWrapper, .onetapAuthContainer, .modalWhiteout').forEach(el => {
              try { el.remove(); } catch {}
            });
            // 2) 표준 모달 셀렉터 (기타 SC 모달 대비 안전망)
            document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open], [class*="signupModal"], [class*="signinModal"], [class*="onboardingModal"]').forEach(el => {
              try { el.remove(); } catch {}
            });
            // 3) body 스크롤 잠금 해제 + show-onetap 같은 마커 클래스 제거
            if (document.body) {
              document.body.classList.remove('show-onetap', 'g-overflow-hidden', 'modalOpen', 'no-scroll');
              document.body.style.overflow = '';
              document.body.style.paddingRight = '';
            }
          }
          killModals();
          try {
            let pending = null;
            const obs = new MutationObserver(() => {
              if (pending) return;
              pending = setTimeout(() => { pending = null; killModals(); }, 100);
            });
            obs.observe(document.documentElement, { childList: true, subtree: true });
          } catch (e) { console.error('[CF observer]', e); }
        })()
      `).catch((e) => console.error('[CF killModals]', e));

      let attempts = 0;
      const tryClick = () => {
        if (!recView || attempts >= 10) return;
        attempts++;
        // 두 번째 인자 true: executeJavaScript를 user gesture로 실행 → synthetic click이
        // 실제 사용자 클릭으로 인정돼 첫 신청곡도 audio 재생 허용됨.
        // (기본값 false 상태에선 Chromium이 첫 재생을 막아 사용자가 수동 클릭해야 했음)
        recView.webContents.executeJavaScript(`
          (function() {
            const sels = ['button.playButton', '.sc-button-play', 'button[aria-label="Play"]', 'button[title="Play"]'];
            for (const sel of sels) {
              const btn = document.querySelector(sel);
              if (btn) { btn.click(); return 'clicked'; }
            }
            return 'not-found';
          })()
        `, true).then((r) => {
          if (r !== 'clicked') setTimeout(tryClick, 500);
        }).catch(() => setTimeout(tryClick, 500));
      };
      setTimeout(tryClick, 400);
    });

    // SoundCloud는 트랙 끝나면 자체적으로 다음 추천 트랙 autoplay → ended 이벤트 미발생.
    // mediaSession 제목 변화로 종료 감지 (Spotify와 동일 패턴, 2회 연속 변경되면 fire).
    let endFired = false;
    let savedSig = null;
    let changeCount = 0;
    setTimeout(() => {
      if (!recView || endFired) return;
      soundcloudPoll = setInterval(async () => {
        if (endFired || !recView) { clearInterval(soundcloudPoll); soundcloudPoll = null; return; }
        try {
          const info = await recView.webContents.executeJavaScript(`
            (function() {
              const m = navigator.mediaSession && navigator.mediaSession.metadata;
              return { title: m && m.title || null, artist: m && m.artist || null };
            })()
          `);
          const sig = info && info.title ? `${info.title}|${info.artist || ''}` : null;
          if (!sig) return;
          if (!savedSig) { savedSig = sig; return; }
          if (sig !== savedSig) {
            changeCount++;
            if (changeCount >= 2) {
              endFired = true;
              clearInterval(soundcloudPoll); soundcloudPoll = null;
              try { recView.webContents.setAudioMuted(true); } catch {}
              mainWindow.webContents.send('video-ended');
            }
          } else {
            changeCount = 0;
          }
        } catch {}
      }, 1000);
    }, 4000);
  }

  // overlay 모드 + rec=Spotify (BGM=YouTube/SoundCloud) — mediaSession baseline 감시
  if (isSpotifyRec) {
    let endFired = false;
    let savedSig = null;
    let changeCount = 0;

    const fireEnd = () => {
      if (endFired) return;
      endFired = true;
      if (spotifyPoll) { clearInterval(spotifyPoll); spotifyPoll = null; }
      try { if (recView) recView.webContents.setAudioMuted(true); } catch {}
      mainWindow.webContents.send('video-ended');
    };

    setTimeout(() => {
      if (!recView || endFired) return;

      spotifyPoll = setInterval(async () => {
        if (endFired || !recView) { clearInterval(spotifyPoll); spotifyPoll = null; return; }
        try {
          const info = await recView.webContents.executeJavaScript(`
            (function() {
              const meta = navigator.mediaSession && navigator.mediaSession.metadata;
              const title = meta && meta.title || null;
              const artist = meta && meta.artist || null;
              let domHref = null;
              const sels = [
                '[data-testid="context-item-link-title"]',
                '[data-testid="nowplaying-track-link"]',
                '[data-testid="context-item-info-title"] a',
                'footer a[href*="/track/"]',
              ];
              for (const sel of sels) {
                const el = document.querySelector(sel);
                const link = el && el.href ? el : el && el.querySelector ? el.querySelector('a[href*="/track/"]') : null;
                if (link && link.href && link.href.includes('/track/')) { domHref = link.href; break; }
              }
              const out = { title: title, artist: artist, domHref: domHref };
              console.log('[CF overlay poll]', JSON.stringify(out));
              return out;
            })()
          `);
          if (!info) return;
          const id = info.domHref ? (info.domHref.match(/\/track\/([A-Za-z0-9]+)/) || [])[1] : null;
          const sig = id || (info.title ? `${info.title}|${info.artist || ''}` : null);
          if (!sig) return;
          if (!savedSig) { savedSig = sig; return; }
          if (sig !== savedSig) {
            changeCount++;
            if (changeCount >= 2) fireEnd();
          } else {
            changeCount = 0;
          }
        } catch {}
      }, 1000);
    }, 5000);
  }
});

// 신청곡 종료 — 모드별 분기
ipcMain.on('end-rec', () => {
  // overlay 모드 detector cleanup
  if (spotifyPoll) { clearInterval(spotifyPoll); spotifyPoll = null; }
  if (soundcloudPoll) { clearInterval(soundcloudPoll); soundcloudPoll = null; }
  // takeover 모드 detector cleanup
  if (bgmSpotifyEndCleanup) { bgmSpotifyEndCleanup(); bgmSpotifyEndCleanup = null; }

  const mode = currentRecMode;
  currentRecMode = null;

  // === takeover 모드 종료: bgmView를 원래 BGM URL(플리/앨범)로 복귀 ===
  // 저장한 BGM 트랙 메타가 있으면 그 트랙 row 클릭 (위치 복원)
  // 없으면 페이지 메인 재생 버튼 (플리 처음부터)
  if (mode === 'spotify-takeover') {
    const resumeMeta = savedBgmMeta;
    savedBgmMeta = null;
    console.log('[end-rec takeover] restore to BGM URL:', currentBgmUrl, 'resume:', resumeMeta);
    if (bgmView && currentBgmUrl) bgmSpotifyNavigateAndPlay(currentBgmUrl, resumeMeta);
    mainWindow.webContents.send('now-playing', null);
    return;
  }

  // === overlay 모드 종료: recView 제거 + bgmView 음소거 해제 ===
  if (recView && recViewAttached) {
    mainWindow.removeBrowserView(recView);
    recViewAttached = false;
  }
  if (recView) {
    recView.webContents.destroy();
    recView = null;
  }
  if (bgmView) {
    bgmView.webContents.setAudioMuted(false);
    // 혹시 paused 상태로 남아있으면 play 클릭 (Spotify BGM + 비-Spotify rec 케이스 등)
    bgmView.webContents.executeJavaScript(SPOTIFY_CLICK_PLAY_IF_PAUSED).catch(() => {});
  }
  mainWindow.webContents.send('now-playing', null);
});

app.whenReady().then(async () => {
  // Widevine CDM 초기화 대기 (wvcus: 첫 실행 시 CDM 다운로드 후 사용 가능)
  await components.whenReady();
  console.log('[widevine] components ready:', components.status());

  // DRM 관련 권한 자동 허용 (Spotify Widevine 라이선스 요청 등)
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'mediaKeySystem'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    if (['media', 'mediaKeySystem'].includes(permission)) return true;
    return null;
  });

  // SoundCloud 로그인 팝업 네트워크 차단.
  // secure.soundcloud.com 은 /one-tap, /web-auth 등 임베디드 로그인 위젯 전용 서브도메인.
  // 트랙 재생·메타데이터는 soundcloud.com / api-v2.soundcloud.com / sndcdn.com 사용.
  // 운영 시 로그인 UI를 제거했으므로 서브도메인 전체를 막아도 손해 없음.
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://secure.soundcloud.com/*', '*://accounts.google.com/gsi/iframe*'] },
    (_details, callback) => callback({ cancel: true })
  );

  // Feature-Policy 응답 헤더 제거 — SoundCloud가 ambient-light-sensor / battery / wake-lock /
  // document-domain 같은 미지원·구식 feature를 헤더에 박아 보내서 Chromium이 "Unrecognized
  // feature" 경고를 콘솔에 매번 뿌림. 기능에는 영향 없으므로 그냥 스트립.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'feature-policy') delete headers[k];
    }
    callback({ responseHeaders: headers });
  });

  createWindow();
  if (!isDev) {
    autoUpdater.on('error',                err  => console.error('[autoUpdater] error:', err));
    autoUpdater.on('checking-for-update',  ()   => console.log('[autoUpdater] checking…'));
    autoUpdater.on('update-available',     info => console.log('[autoUpdater] available:', info.version));
    autoUpdater.on('update-not-available', ()   => console.log('[autoUpdater] up to date'));
    autoUpdater.on('update-downloaded',    info => {
      console.log('[autoUpdater] downloaded:', info.version);
      mainWindow.webContents.send('update-downloaded', info.version);
    });
    autoUpdater.checkForUpdates();
  }
  ipcMain.on('restart-app', () => autoUpdater.quitAndInstall());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
