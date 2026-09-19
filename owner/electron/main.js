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
  isTrustedSender: windowManager.isFromMainRenderer,
});

windowManager.registerIpcHandlers(ipcMain);
playbackController.registerIpcHandlers();
sessionTools.registerIpcHandlers();
autoUpdateManager.registerIpcHandlers();

// 한 기기에서 앱이 두 번 뜨면 재생 플레이어도 두 개가 되어 같은 매장에서 소리가
// 겹친다. 서버 쪽 리더 인계로 뒤늦게 정리하는 것보다 아예 두 번째를 띄우지 않는
// 편이 낫다 — 사장님이 아이콘을 다시 누른 것은 "앱을 보고 싶다"는 뜻이지
// "새로 시작하고 싶다"는 뜻이 아니다.
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  // 두 번째 실행은 창을 만들지 않고 바로 빠진다. 먼저 뜬 앱이 second-instance를
  // 받아 자기 창을 앞으로 가져온다.
  app.quit();
} else {
  app.on('second-instance', () => {
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
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
  autoUpdateManager.stop();
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

ipcMain.on('cleanup-done', (event) => {
  if (!windowManager.isFromMainRenderer(event.sender)) return;
  isQuitting = true;
  app.quit();
});

// 다른 기기에서 로그인해 재생 리더를 넘겨준 뒤 renderer가 부른다. 평범한 종료와
// 같은 경로를 타도록 app.quit()만 부른다 — before-quit이 cleanup을 돌린다.
ipcMain.on('quit-app', (event) => {
  if (!windowManager.isFromMainRenderer(event.sender)) return;
  app.quit();
});
