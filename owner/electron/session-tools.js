const { dialog, session, shell } = require('electron');
const fs = require('fs');

function createSessionTools({ ipcMain, windowManager }) {
  async function clearDomainSession(domains) {
    const activeSession = session.defaultSession;
    try {
      const allCookies = await activeSession.cookies.get({});
      const targets = allCookies.filter((cookie) =>
        domains.some((domain) => (cookie.domain || '').includes(domain))
      );

      for (const cookie of targets) {
        const cleanDomain = (cookie.domain || '').replace(/^\./, '');
        const url = `https://${cleanDomain}${cookie.path || '/'}`;
        try { await activeSession.cookies.remove(url, cookie.name); } catch {}
      }
      console.log('[clear-session] removed', targets.length, 'cookies for', domains.join(','));

      for (const domain of domains) {
        try {
          await activeSession.clearStorageData({
            origin: `https://${domain}`,
            storages: ['localstorage', 'sessionstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
          });
        } catch {}
      }
      return targets.length;
    } catch (error) {
      console.error('[clear-session] failed:', error);
      return 0;
    }
  }

  async function importCookiesFromFile() {
    const result = await dialog.showOpenDialog({
      title: 'Cookie Editor에서 export한 JSON 파일 선택',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };

    try {
      const json = await fs.promises.readFile(result.filePaths[0], 'utf8');
      const cookies = JSON.parse(json);
      if (!Array.isArray(cookies)) {
        throw new Error('JSON이 배열 형식이 아닙니다 (Cookie Editor 형식이어야 함)');
      }

      const activeSession = session.defaultSession;
      let success = 0;
      let failed = 0;
      const errors = [];

      for (const cookie of cookies) {
        try {
          if (!cookie.name || !cookie.domain) {
            failed += 1;
            continue;
          }
          const cleanDomain = String(cookie.domain).replace(/^\./, '');
          const url = `${cookie.secure === false ? 'http' : 'https'}://${cleanDomain}${cookie.path || '/'}`;
          let sameSite = cookie.sameSite || 'no_restriction';
          if (sameSite === 'unspecified' || sameSite === 'none') sameSite = 'no_restriction';
          if (!['no_restriction', 'lax', 'strict'].includes(sameSite)) sameSite = 'no_restriction';

          await activeSession.cookies.set({
            url,
            name: cookie.name,
            value: String(cookie.value || ''),
            domain: cookie.domain,
            path: cookie.path || '/',
            secure: !!cookie.secure,
            httpOnly: !!cookie.httpOnly,
            expirationDate: cookie.expirationDate
              || (cookie.session ? undefined : (Date.now() / 1000) + 86400 * 365),
            sameSite,
          });
          success += 1;
        } catch (error) {
          failed += 1;
          if (errors.length < 3) errors.push(`${cookie.name}: ${error.message}`);
        }
      }

      console.log(`[cookie-import] success ${success} / failed ${failed} / total ${cookies.length}`);
      if (errors.length) console.error('[cookie-import] sample errors:', errors);
      return { success, failed, total: cookies.length, errors };
    } catch (error) {
      console.error('[cookie-import] failed:', error);
      return { error: error.message };
    }
  }

  function registerIpcHandlers() {
    ipcMain.handle('clear-soundcloud-session', () =>
      clearDomainSession(['soundcloud.com', 'datadome.co', 'datadome.com']));
    ipcMain.handle('clear-spotify-session', () =>
      clearDomainSession(['spotify.com', 'scdn.co']));
    ipcMain.handle('import-cookies-from-file', importCookiesFromFile);
    ipcMain.on('open-external', (_event, url) => {
      try {
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
      } catch (error) {
        console.error('[open-external]', error);
      }
    });
  }

  function configureDefaultSession() {
    const activeSession = session.defaultSession;

    activeSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(['media', 'mediaKeySystem'].includes(permission));
    });
    activeSession.setPermissionCheckHandler((_webContents, permission) => {
      if (['media', 'mediaKeySystem'].includes(permission)) return true;
      return null;
    });

    activeSession.webRequest.onBeforeRequest(
      { urls: ['*://secure.soundcloud.com/*', '*://accounts.google.com/gsi/iframe*'] },
      (details, callback) => callback({
        cancel: windowManager.isFromMusicView(details.webContents),
      })
    );

    activeSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = details.responseHeaders || {};
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'feature-policy') delete headers[key];
      }
      callback({ responseHeaders: headers });
    });
  }

  return {
    configureDefaultSession,
    registerIpcHandlers,
  };
}

module.exports = { createSessionTools };
