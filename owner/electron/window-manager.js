const { BrowserWindow, BrowserView, screen } = require('electron');
const path = require('path');
const { calculatePanelLayout, clampPanelRatio } = require('./panel-layout');
const {
  isAllowedLoginUrl,
  isAllowedQrImageUrl,
  isAllowedOwnerRendererUrl,
} = require('./navigation-policy');
const {
  ISOLATED_EXTERNAL_WEB_PREFERENCES,
  STEALTH_EXTERNAL_WEB_PREFERENCES,
} = require('./web-preferences');

function createWindowManager({ ownerUrl, isDev, widevineStatus, isQuitting }) {
  let leftRatio = 0.42;
  let mainWindow = null;
  let bgmView = null;
  let recView = null;
  let recViewAttached = false;
  let panelVisible = false;
  let panelCollapsed = false;
  let loginWin = null;
  let viewsDetachedForDrag = false;

  function safeSend(channel, ...args) {
    if (isQuitting()) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      if (!mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(channel, ...args);
      }
    } catch {}
  }

  function blockExternalProtocol(view) {
    const handler = (event, url) => {
      if (!/^(https?|about|data|blob):/i.test(url)) event.preventDefault();
    };

    view.webContents.on('will-navigate', handler);
    view.webContents.on('will-redirect', handler);
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (!/^https?:\/\//i.test(url)) return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500,
          height: 700,
          webPreferences: {
            ...ISOLATED_EXTERNAL_WEB_PREFERENCES,
          },
        },
      };
    });
    view.webContents.on('did-create-window', (popup) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          popup.webContents.setUserAgent(mainWindow.webContents.getUserAgent());
        }
      } catch {}
      popup.show();
    });
  }

  function createBgmView() {
    if (bgmView && !bgmView.webContents.isDestroyed()) return bgmView;

    bgmView = new BrowserView({
      webPreferences: {
        // stealth-preload가 외부 서비스의 main world 속성을 보정해야 하므로
        // contextIsolation 예외는 유지하되 Chromium sandbox로 Node 접근을 차단한다.
        ...STEALTH_EXTERNAL_WEB_PREFERENCES,
        preload: path.join(__dirname, 'stealth-preload.js'),
        backgroundThrottling: false,
      },
    });
    blockExternalProtocol(bgmView);
    bgmView.webContents.loadURL('https://www.google.com');
    return bgmView;
  }

  function createRecView() {
    if (recView && !recView.webContents.isDestroyed()) return recView;

    recView = new BrowserView({
      webPreferences: {
        // YouTube preload는 DOM 관찰과 제한된 ipcRenderer 전송만 필요하므로
        // 외부 페이지의 main world와 완전히 분리한다.
        ...ISOLATED_EXTERNAL_WEB_PREFERENCES,
        preload: path.join(__dirname, 'youtube-preload.js'),
      },
    });
    blockExternalProtocol(recView);

    recView.webContents.on('ipc-message', (_event, channel) => {
      if (channel === 'youtube-video-ended') safeSend('video-ended');
    });

    recView.webContents.on('page-title-updated', (_event, title) => {
      if (!recView || recView.webContents.isDestroyed()) return;
      const url = recView.webContents.getURL();
      const match = url.match(/[?&]v=([^&]+)/);
      if (!match) {
        safeSend('now-playing', null);
        return;
      }

      const videoId = match[1];
      safeSend('now-playing', {
        videoId,
        title: title.replace(/ - YouTube$/, ''),
        thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      });
    });

    return recView;
  }

  function resizeViews() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [width, height] = mainWindow.getContentSize();
    const { browserViewBounds: bounds } = calculatePanelLayout(width, height, leftRatio, panelCollapsed);

    if (bgmView && !bgmView.webContents.isDestroyed()) {
      bgmView.setBounds(bounds);
      bgmView.setAutoResize({ width: false, height: true });
    }
    if (recView && !recView.webContents.isDestroyed()) {
      recView.setBounds(bounds);
      recView.setAutoResize({ width: false, height: true });
    }
  }

  function attachBgmPanel() {
    if (panelVisible) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const view = createBgmView();
    mainWindow.addBrowserView(view);
    panelVisible = true;
    resizeViews();
  }

  function attachRecView() {
    if (!panelVisible || recViewAttached) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const view = createRecView();
    mainWindow.addBrowserView(view);
    recViewAttached = true;
    resizeViews();
  }

  function destroyRecView() {
    if (recView && recViewAttached && mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.removeBrowserView(recView); } catch {}
    }
    recViewAttached = false;

    if (recView) {
      try {
        if (!recView.webContents.isDestroyed()) recView.webContents.destroy();
      } catch {}
      recView = null;
    }
  }

  function detachAll() {
    if (!panelVisible) return;
    destroyRecView();

    if (bgmView && mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.removeBrowserView(bgmView); } catch {}
    }
    if (bgmView) {
      try {
        if (!bgmView.webContents.isDestroyed()) bgmView.webContents.destroy();
      } catch {}
      bgmView = null;
    }
    panelVisible = false;
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
        sandbox: false, // preload가 로컬 navigation-policy 모듈을 사용한다.
      },
      title: 'Caffeine Flow — owner',
    });

    const originalUa = mainWindow.webContents.getUserAgent();
    const chromeMatch = originalUa.match(/Chrome\/[\d.]+/);
    const chromeVersion = chromeMatch ? chromeMatch[0] : 'Chrome/128.0.0.0';
    const fakeUa = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ${chromeVersion} Safari/537.36`;
    mainWindow.webContents.setUserAgent(fakeUa);
    mainWindow.webContents.session.setUserAgent(fakeUa);

    mainWindow.loadURL(ownerUrl);
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      createBgmView();
    });
    mainWindow.webContents.once('did-finish-load', () => {
      safeSend('widevine-status', widevineStatus);
    });
    mainWindow.on('resize', resizeViews);

    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
    return mainWindow;
  }

  function openLoginWindow(url) {
    if (!isAllowedLoginUrl(url)) return;
    if (loginWin && !loginWin.isDestroyed()) {
      loginWin.focus();
      return;
    }

    loginWin = new BrowserWindow({
      width: 520,
      height: 720,
      title: '로그인',
      webPreferences: {
        // 로그인 호환용 stealth-preload는 main world 접근이 필요하다.
        // Node integration은 끄고 sandbox를 켜 예외 범위를 좁힌다.
        ...STEALTH_EXTERNAL_WEB_PREFERENCES,
        preload: path.join(__dirname, 'stealth-preload.js'),
      },
    });

    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        loginWin.webContents.setUserAgent(mainWindow.webContents.getUserAgent());
      }
    } catch {}

    loginWin.loadURL(url);
    loginWin.on('closed', () => {
      loginWin = null;
      safeSend('login-window-closed');
    });
  }

  function setPanelRatio(ratio) {
    leftRatio = clampPanelRatio(ratio);
    resizeViews();
  }

  function setPanelCollapsed(collapsed) {
    panelCollapsed = collapsed;
    resizeViews();
  }

  function dividerDragStart() {
    if (viewsDetachedForDrag || !mainWindow || mainWindow.isDestroyed()) return;
    if (recView && recViewAttached) mainWindow.removeBrowserView(recView);
    if (bgmView && panelVisible) mainWindow.removeBrowserView(bgmView);
    viewsDetachedForDrag = true;
  }

  function dividerDragEnd() {
    if (!viewsDetachedForDrag || !mainWindow || mainWindow.isDestroyed()) return;
    if (bgmView && panelVisible) mainWindow.addBrowserView(bgmView);
    if (recView && recViewAttached) mainWindow.addBrowserView(recView);
    resizeViews();
    viewsDetachedForDrag = false;
  }

  function registerIpcHandlers(ipcMain) {
    ipcMain.on('open-login-window', (event, url) => {
      if (isFromMainRenderer(event.sender)) openLoginWindow(url);
    });
    ipcMain.on('set-panel-ratio', (event, ratio) => {
      if (isFromMainRenderer(event.sender) && Number.isFinite(ratio)) setPanelRatio(ratio);
    });
    ipcMain.on('set-panel-collapsed', (event, collapsed) => {
      if (isFromMainRenderer(event.sender) && typeof collapsed === 'boolean') setPanelCollapsed(collapsed);
    });
    ipcMain.on('divider-drag-start', (event) => {
      if (isFromMainRenderer(event.sender)) dividerDragStart();
    });
    ipcMain.on('divider-drag-end', (event) => {
      if (isFromMainRenderer(event.sender)) dividerDragEnd();
    });
    ipcMain.on('open-bgm-devtools', (event) => {
      if (!isFromMainRenderer(event.sender)) return;
      if (bgmView && !bgmView.webContents.isDestroyed()) {
        bgmView.webContents.openDevTools({ mode: 'detach' });
      }
    });
    ipcMain.handle('download-qr-image', (event, url) => {
      if (!isFromMainRenderer(event.sender) || !isAllowedQrImageUrl(url)) return false;
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return false;
      try {
        mainWindow.webContents.downloadURL(url);
        return true;
      } catch {
        return false;
      }
    });
  }

  function isFromMusicView(webContents) {
    if (!webContents) return false;
    const matches = (view) => view
      && !view.webContents.isDestroyed()
      && view.webContents.id === webContents.id;
    return matches(recView) || matches(bgmView);
  }

  function isFromMainRenderer(webContents) {
    return Boolean(webContents
      && mainWindow
      && !mainWindow.isDestroyed()
      && !mainWindow.webContents.isDestroyed()
      && mainWindow.webContents.id === webContents.id
      && isAllowedOwnerRendererUrl(webContents.getURL(), ownerUrl));
  }

  return {
    attachBgmPanel,
    attachRecView,
    createBgmView,
    createRecView,
    createWindow,
    destroyRecView,
    detachAll,
    getBgmView: () => bgmView,
    getMainWindow: () => mainWindow,
    getRecView: () => recView,
    isFromMusicView,
    isFromMainRenderer,
    isPanelVisible: () => panelVisible,
    isRecViewAttached: () => recViewAttached,
    registerIpcHandlers,
    resizeViews,
    safeSend,
  };
}

module.exports = { createWindowManager };
