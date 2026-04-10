const { app, BrowserWindow, BrowserView, ipcMain, screen } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;
const OWNER_URL = isDev
  ? 'http://localhost:5174'
  : `file://${path.join(__dirname, '../dist/index.html')}`;

const LEFT_RATIO = 0.42;

let mainWindow     = null;
let youtubeView    = null;
let youtubeVisible = false;
let prevYoutubeUrl = null;
let currentVideoId = null;
let defaultVideoId = null;

function getContentSize() {
  return mainWindow.getContentSize();
}

// 앱 시작 시 백그라운드로 YouTube 미리 로드 (로그인 전에 로딩 완료)
function preloadYoutube() {
  if (youtubeView) return;
  youtubeView = new BrowserView({
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      preload: path.join(__dirname, 'youtube-preload.js'),
    },
  });

  youtubeView.webContents.on('ipc-message', (_e, channel) => {
    if (channel === 'youtube-video-ended') {
      if (!currentVideoId) return;
      // 기본 재생 곡이 끝나면 React에 알리지 않고 바로 루프
      if (currentVideoId === defaultVideoId) {
        currentVideoId = null;
        mainWindow.webContents.send('default-playing', false);
        youtubeView.webContents.loadURL(`https://www.youtube.com/watch?v=${defaultVideoId}&autoplay=1`);
        currentVideoId = defaultVideoId;
        mainWindow.webContents.send('default-playing', true);
        return;
      }
      currentVideoId = null;
      mainWindow.webContents.send('video-ended');
    }
  });

  // 현재 재생 영상 감지 → React에 전달
  youtubeView.webContents.on('page-title-updated', (_e, title) => {
    const url = youtubeView.webContents.getURL();
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

  youtubeView.webContents.loadURL('https://www.youtube.com');
  // mainWindow에는 붙이지 않음 — 로그인 시 attachYoutube()에서 붙임
}

function attachYoutube() {
  if (!youtubeView) preloadYoutube();
  if (youtubeVisible) return;
  mainWindow.addBrowserView(youtubeView);
  youtubeVisible = true;
  resizeYoutube();
}

function detachYoutube() {
  if (!youtubeVisible) return;
  mainWindow.removeBrowserView(youtubeView);
  youtubeView.webContents.destroy();
  youtubeView = null;
  youtubeVisible = false;
}

function resizeYoutube() {
  if (!youtubeView || !youtubeVisible) return;
  const [w, h] = getContentSize();
  const leftW  = Math.floor(w * LEFT_RATIO);
  youtubeView.setBounds({ x: leftW, y: 0, width: w - leftW, height: h });
  youtubeView.setAutoResize({ width: false, height: true });
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width,
    height,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Caffeine Flow — owner',
  });

  // Electron UA 제거 — Google OAuth 차단 방지
  const ua = mainWindow.webContents.getUserAgent().replace(/Electron\/[\d.]+ /, '');
  mainWindow.webContents.setUserAgent(ua);

  mainWindow.loadURL(OWNER_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    preloadYoutube();  // 백그라운드 미리 로드
  });
  mainWindow.on('resize', resizeYoutube);

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// 로그인 후 YouTube 패널 표시 (이미 로드된 상태)
ipcMain.on('show-youtube', () => {
  attachYoutube();
  mainWindow.webContents.send('youtube-state', true);
});

// 로그아웃 시 YouTube 패널 제거
ipcMain.on('hide-youtube', () => {
  detachYoutube();
  mainWindow.webContents.send('youtube-state', false);
});

// 신청곡 재생 → 현재 URL 저장 후 해당 영상으로 이동
ipcMain.on('play-video', (_e, videoId) => {
  if (!youtubeView) preloadYoutube();
  const current = youtubeView.webContents.getURL();
  // 큐 재생 중(prevYoutubeUrl 이미 있음)엔 덮어쓰지 않음 — 원래 보던 영상으로 복귀하기 위해
  if (!prevYoutubeUrl) {
    prevYoutubeUrl = (current && current !== 'about:blank') ? current : null;
    mainWindow.webContents.send('queue-restore', prevYoutubeUrl);
  }
  currentVideoId = null;  // 네비게이션 중 오감지 방지
  mainWindow.webContents.send('default-playing', false);
  youtubeView.webContents.loadURL(`https://www.youtube.com/watch?v=${videoId}&autoplay=1`);
  currentVideoId = videoId;
});

// 추천곡 대기열 소진 → 기본 재생 곡 or 이전 URL 복원
ipcMain.on('stop-video', () => {
  currentVideoId = null;
  prevYoutubeUrl = null;
  mainWindow.webContents.send('queue-restore', null);
  if (!youtubeView) return;
  if (defaultVideoId) {
    youtubeView.webContents.loadURL(`https://www.youtube.com/watch?v=${defaultVideoId}&autoplay=1`);
    currentVideoId = defaultVideoId;
    mainWindow.webContents.send('default-playing', true);
  } else {
    youtubeView.webContents.loadURL('https://www.youtube.com');
  }
});

ipcMain.on('set-default-video', (_e, videoId) => { defaultVideoId = videoId; });
ipcMain.on('clear-default-video', () => { defaultVideoId = null; });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
