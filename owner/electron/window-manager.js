const { BrowserWindow, BrowserView, screen } = require('electron');
const path = require('path');

function createWindowManager({ ownerUrl, isDev, widevineStatus, isQuitting }) {
  let leftRatio = 0.42;
  let mainWindow = null;
  let bgmView = null;
  let recView = null;
  let recViewAttached = false;
  let panelVisible = false;
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
          webPreferences: { contextIsolation: false, nodeIntegration: false },
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
        contextIsolation: false,
        nodeIntegration: false,
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
        contextIsolation: false,
        nodeIntegration: false,
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
    const leftWidth = Math.floor(width * leftRatio);
    const bounds = { x: leftWidth, y: 0, width: width - leftWidth, height };

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
    if (loginWin && !loginWin.isDestroyed()) {
      loginWin.focus();
      return;
    }

    loginWin = new BrowserWindow({
      width: 520,
      height: 720,
      title: '로그인',
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: false,
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
    leftRatio = Math.min(0.85, Math.max(0.15, ratio));
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
    ipcMain.on('open-login-window', (_event, url) => openLoginWindow(url));
    ipcMain.on('set-panel-ratio', (_event, ratio) => setPanelRatio(ratio));
    ipcMain.on('divider-drag-start', dividerDragStart);
    ipcMain.on('divider-drag-end', dividerDragEnd);
    ipcMain.on('open-bgm-devtools', () => {
      if (bgmView && !bgmView.webContents.isDestroyed()) {
        bgmView.webContents.openDevTools({ mode: 'detach' });
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
    isPanelVisible: () => panelVisible,
    isRecViewAttached: () => recViewAttached,
    registerIpcHandlers,
    resizeViews,
    safeSend,
  };
}

module.exports = { createWindowManager };
