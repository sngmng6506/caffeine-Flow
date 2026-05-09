const { app, BrowserWindow, BrowserView, ipcMain, screen } = require('electron');
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

const LEFT_RATIO = 0.42;

let mainWindow      = null;
// bgmView: 매장 BGM (Spotify/YouTube 플레이리스트 등 — 항상 살아있음, 신청곡 사이에도 상태 유지)
let bgmView         = null;
// recView: 손님 신청곡 (필요할 때만 생성, 끝나면 destroy)
let recView         = null;
let recViewAttached = false;
let panelVisible    = false;

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

// BGM URL 설정 — bgmView에 로드 (한 번 로드 후 신청곡 사이에도 상태 유지)
ipcMain.on('set-bgm-url', (_e, url) => {
  if (!bgmView) createBgmView();
  bgmView.webContents.loadURL(url);
});

// BGM 해제 — 빈 페이지로
ipcMain.on('clear-bgm', () => {
  if (!bgmView) return;
  bgmView.webContents.loadURL('https://www.google.com');
});

// 신청곡 시작: BGM 음소거 + recView 위에 띄움
ipcMain.on('play-rec', (_e, videoIdOrUrl) => {
  if (bgmView) bgmView.webContents.setAudioMuted(true);

  if (!recView) createRecView();
  if (panelVisible && !recViewAttached) {
    mainWindow.addBrowserView(recView); // bgmView 위에 z-index 우선
    recViewAttached = true;
    resizeViews();
  }

  const url = videoIdOrUrl.startsWith('http')
    ? videoIdOrUrl
    : `https://www.youtube.com/watch?v=${videoIdOrUrl}`;
  recView.webContents.loadURL(url);
  recView.webContents.once('dom-ready', () => {
    recView.webContents.send('block-next-play');
  });
});

// 신청곡 종료: recView 제거 + BGM 음소거 해제 → BGM이 끊김 없이 이어 재생
ipcMain.on('end-rec', () => {
  if (recView && recViewAttached) {
    mainWindow.removeBrowserView(recView);
    recViewAttached = false;
  }
  if (recView) {
    recView.webContents.destroy();
    recView = null;
  }
  if (bgmView) bgmView.webContents.setAudioMuted(false);
  mainWindow.webContents.send('now-playing', null);
});

app.whenReady().then(() => {
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
