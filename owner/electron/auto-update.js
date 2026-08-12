const { autoUpdater } = require('electron-updater');

function createAutoUpdateManager({ ipcMain, isDev, safeSend, isTrustedSender }) {
  function registerIpcHandlers() {
    ipcMain.on('restart-app', (event) => {
      if (isTrustedSender(event.sender)) autoUpdater.quitAndInstall();
    });
  }

  function start() {
    if (isDev) return;

    autoUpdater.on('error', (error) => console.error('[autoUpdater] error:', error));
    autoUpdater.on('checking-for-update', () => console.log('[autoUpdater] checking…'));
    autoUpdater.on('update-available', (info) => console.log('[autoUpdater] available:', info.version));
    autoUpdater.on('update-not-available', () => console.log('[autoUpdater] up to date'));
    autoUpdater.on('update-downloaded', (info) => {
      console.log('[autoUpdater] downloaded:', info.version);
      safeSend('update-downloaded', info.version);
    });
    autoUpdater.checkForUpdates();
  }

  return { registerIpcHandlers, start };
}

module.exports = { createAutoUpdateManager };
