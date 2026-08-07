const { app, BrowserWindow, components, ipcMain } = require('electron');
const { createAutoUpdateManager } = require('./auto-update');
const { createPlaybackController } = require('./playback-controller');
const { createSessionTools } = require('./session-tools');
const { createWindowManager } = require('./window-manager');

app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const WIDEVINE_STATUS = 'castlabs';
const isDev = !app.isPackaged;
const ownerUrl = process.env.OWNER_URL || (isDev
  ? 'http://localhost:5174/owner/'
  : 'https://caffeine-flow-production.up.railway.app/owner/');

let isQuitting = false;
let cleanupRequested = false;

const windowManager = createWindowManager({
  ownerUrl,
  isDev,
  widevineStatus: WIDEVINE_STATUS,
  isQuitting: () => isQuitting,
});
const playbackController = createPlaybackController({
  ipcMain,
  windowManager,
  isQuitting: () => isQuitting,
});
const sessionTools = createSessionTools({ ipcMain, windowManager });
const autoUpdateManager = createAutoUpdateManager({
  ipcMain,
  isDev,
  safeSend: windowManager.safeSend,
});

windowManager.registerIpcHandlers(ipcMain);
playbackController.registerIpcHandlers();
sessionTools.registerIpcHandlers();
autoUpdateManager.registerIpcHandlers();

app.whenReady().then(async () => {
  if (components) {
    await components.whenReady();
    console.log('[widevine] components ready:', components.status());
  } else {
    console.log('[widevine] components API 없음 (표준 electron dev 실행) — skip');
  }

  sessionTools.configureDefaultSession();
  windowManager.createWindow();
  autoUpdateManager.start();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) windowManager.createWindow();
});

app.on('before-quit', (event) => {
  playbackController.cleanupForQuit();

  if (cleanupRequested) return;
  const mainWindow = windowManager.getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    isQuitting = true;
    return;
  }

  event.preventDefault();
  cleanupRequested = true;
  windowManager.safeSend('cleanup-before-quit');
  setTimeout(() => {
    isQuitting = true;
    app.quit();
  }, 3000);
});

ipcMain.on('cleanup-done', () => {
  isQuitting = true;
  app.quit();
});
