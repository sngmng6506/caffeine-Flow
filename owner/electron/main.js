const { app, BrowserWindow, BrowserView, ipcMain, screen, components } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

// navigator.webdriver 숨김 — SoundCloud·Spotify 등이 Electron 감지 후 팝업 차단하는 것 방지
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

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
let spotifyPoll        = null; // Spotify 트랙 종료 감지 폴링 — end-rec 시 반드시 clear
let savedBgmTrackUrl   = null; // play-rec 직전 bgmView에서 재생 중이던 트랙 URL

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

// 신청곡 시작: bgmView 음소거
// setAudioMuted(true)가 Spotify를 pause시키므로, 잠시 후 play 클릭해 무음 재생 상태 유지
ipcMain.on('play-rec', (_e, videoIdOrUrl) => {
  // BGM이 Spotify일 때 현재 재생 중인 트랙 URL 저장 → end-rec 시 복원에 사용
  savedBgmTrackUrl = null;
  if (bgmView && currentBgmUrl?.includes('open.spotify.com')) {
    bgmView.webContents.executeJavaScript(`
      (function() {
        const selectors = [
          '[data-testid="context-item-link-title"]',
          '[data-testid="nowplaying-track-link"]',
          '[data-testid="now-playing-widget"] a[href*="/track/"]',
          'footer a[href*="/track/"]',
          'a[href*="/track/"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.href && el.href.includes('/track/')) return el.href;
        }
        return null;
      })()
    `).then(u => {
      savedBgmTrackUrl = u || currentBgmUrl;
      console.log('[BGM] saved track URL:', savedBgmTrackUrl);
    }).catch(() => { savedBgmTrackUrl = currentBgmUrl; });
  }

  if (bgmView) {
    bgmView.webContents.setAudioMuted(true);
    // Spotify가 pause 처리할 시간(300ms) 후 play 클릭 → 무음 상태로 플리 계속 재생
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

  const url = videoIdOrUrl.startsWith('http')
    ? videoIdOrUrl
    : `https://www.youtube.com/watch?v=${videoIdOrUrl}`;
  recView.webContents.loadURL(url);

  // Spotify 수락곡 — 정확히 한 곡만 재생하고 종료
  if (url.includes('open.spotify.com')) {
    const trackPath = (() => { try { return new URL(url).pathname; } catch { return null; } })();
    if (trackPath) {
      let spotifyEndFired = false;

      // 트랙 변경 감지 즉시: recView 음소거 + video-ended 전송
      const fireSpotifyEnd = () => {
        if (spotifyEndFired) return;
        spotifyEndFired = true;
        if (spotifyPoll) { clearInterval(spotifyPoll); spotifyPoll = null; }
        // recView가 살아있는 동안 다음 곡 소리 즉시 차단
        try { if (recView) recView.webContents.setAudioMuted(true); } catch {}
        mainWindow.webContents.send('video-ended');
      };

      // Spotify 페이지 로드 안정화(5s) 후 감지 시작
      setTimeout(() => {
        if (!recView || spotifyEndFired) return;

        // ① 오토플레이 비활성화 시도 (근본 차단)
        recView.webContents.executeJavaScript(`
          (function() {
            const btn = document.querySelector('[data-testid="autoplay-button"]');
            if (btn && btn.getAttribute('aria-checked') === 'true') { btn.click(); return 'disabled'; }
            return btn ? 'already-off' : 'not-found';
          })()
        `).then(r => console.log('[Spotify] autoplay toggle:', r)).catch(() => {});

        // ② did-navigate-in-page — 즉시 감지 (SPA 라우팅)
        const onNav = (_e, navUrl) => {
          if (!navUrl.includes(trackPath)) {
            try { recView?.webContents.removeListener('did-navigate-in-page', onNav); } catch {}
            fireSpotifyEnd();
          }
        };
        if (recView) recView.webContents.on('did-navigate-in-page', onNav);

        // ③ URL 폴링 2s 간격 — did-navigate-in-page 미발생 케이스 보완
        spotifyPoll = setInterval(() => {
          if (spotifyEndFired || !recView) { clearInterval(spotifyPoll); spotifyPoll = null; return; }
          try {
            const cur = recView.webContents.getURL();
            if (cur && !cur.includes(trackPath)) fireSpotifyEnd();
          } catch { clearInterval(spotifyPoll); spotifyPoll = null; }
        }, 2000);
      }, 5000);
    }
  }
});

// 신청곡 종료: recView 제거 + bgmView 복원
ipcMain.on('end-rec', () => {
  if (spotifyPoll) { clearInterval(spotifyPoll); spotifyPoll = null; }
  if (recView && recViewAttached) {
    mainWindow.removeBrowserView(recView);
    recViewAttached = false;
  }
  if (recView) {
    recView.webContents.destroy();
    recView = null;
  }

  if (!bgmView) { mainWindow.webContents.send('now-playing', null); return; }

  bgmView.webContents.setAudioMuted(false);

  const bgmIsSpotify = currentBgmUrl?.includes('open.spotify.com');
  if (bgmIsSpotify) {
    // Spotify BGM 복원:
    // recView가 Spotify 세션을 점유했으므로 bgmView에서 저장해둔 트랙으로 명시적 이동 후 play
    const targetUrl = savedBgmTrackUrl || currentBgmUrl;
    savedBgmTrackUrl = null;
    console.log('[end-rec] Spotify BGM restore → ', targetUrl);

    const clickPlayAfterNav = () => {
      // Spotify SPA가 초기화될 시간 대기 후 play 클릭
      setTimeout(() => {
        if (bgmView) bgmView.webContents.executeJavaScript(SPOTIFY_CLICK_PLAY_IF_PAUSED).catch(() => {});
      }, 2000);
    };

    const curUrl = bgmView.webContents.getURL();
    const isSameUrl = curUrl === targetUrl;

    if (isSameUrl || !curUrl.includes('open.spotify.com')) {
      // 같은 URL이거나 Spotify가 아닌 경우 → loadURL로 강제 이동
      bgmView.webContents.loadURL(targetUrl);
      bgmView.webContents.once('did-finish-load', clickPlayAfterNav);
    } else {
      // 다른 Spotify URL → SPA 라우팅 (전체 새로고침 없이 이동)
      bgmView.webContents.once('did-navigate-in-page', clickPlayAfterNav);
      bgmView.webContents.executeJavaScript(
        `window.location.href = ${JSON.stringify(targetUrl)}`
      ).catch(() => {});
      // 혹시 did-navigate-in-page 미발생 시 fallback
      setTimeout(clickPlayAfterNav, 4000);
    }
  } else {
    // YouTube·SoundCloud: 오버레이 정상 작동 — 음소거 해제만으로 이어짐
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
