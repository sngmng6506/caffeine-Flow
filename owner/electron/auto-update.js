function createAutoUpdateManager({ ipcMain, isDev, safeSend, isTrustedSender, updater }) {
  const activeUpdater = updater || require('electron-updater').autoUpdater;
  let revision = 0;
  let updateStatus = {
    state: isDev ? 'disabled' : 'idle',
    version: null,
    revision,
  };

  function snapshot() {
    return { ...updateStatus };
  }

  function publish(state, version = null) {
    revision += 1;
    updateStatus = { state, version: version || null, revision };
    safeSend('update-status', snapshot());
  }

  async function checkForUpdates() {
    if (isDev) return snapshot();
    try {
      await activeUpdater.checkForUpdates();
    } catch (error) {
      console.error('[autoUpdater] check failed:', error);
      publish('error');
    }
    return snapshot();
  }

  function registerIpcHandlers() {
    ipcMain.handle('get-update-status', (event) => isTrustedSender(event.sender)
      ? snapshot()
      : { state: 'unavailable', version: null, revision: 0 });
    ipcMain.handle('check-for-updates', (event) => isTrustedSender(event.sender)
      ? checkForUpdates()
      : { state: 'unavailable', version: null, revision: 0 });
    ipcMain.on('restart-app', (event) => {
      if (isTrustedSender(event.sender) && updateStatus.state === 'downloaded') {
        activeUpdater.quitAndInstall();
      }
    });
  }

  function start() {
    if (isDev) return;

    activeUpdater.on('error', (error) => {
      console.error('[autoUpdater] error:', error);
      publish('error');
    });
    activeUpdater.on('checking-for-update', () => {
      console.log('[autoUpdater] checking…');
      publish('checking');
    });
    activeUpdater.on('update-available', (info) => {
      console.log('[autoUpdater] available:', info.version);
      publish('available', info.version);
    });
    activeUpdater.on('update-not-available', () => {
      console.log('[autoUpdater] up to date');
      publish('current');
    });
    activeUpdater.on('update-downloaded', (info) => {
      console.log('[autoUpdater] downloaded:', info.version);
      publish('downloaded', info.version);
      // 구버전 renderer가 새 Electron 셸과 함께 동작하는 전환 구간을 지원한다.
      safeSend('update-downloaded', info.version);
    });
    void checkForUpdates();
  }

  return { registerIpcHandlers, start, getStatus: snapshot };
}

module.exports = { createAutoUpdateManager };
