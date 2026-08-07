const spotify = require('./platform-adapters/spotify');
const soundcloud = require('./platform-adapters/soundcloud');
const {
  createSoundCloudDetector,
  createSpotifyOverlayDetector,
  createSpotifyTakeoverDetector,
} = require('./end-detection');

function createPlaybackController({ ipcMain, windowManager, isQuitting }) {
  let currentBgmUrl = null;
  let currentRecMode = null;
  let savedBgmMeta = null;
  let spotifyOverlayDetector = null;
  let soundCloudDetector = null;
  let spotifyTakeoverDetector = null;

  function stopDetectors() {
    spotifyOverlayDetector?.stop();
    soundCloudDetector?.stop();
    spotifyTakeoverDetector?.stop();
    spotifyOverlayDetector = null;
    soundCloudDetector = null;
    spotifyTakeoverDetector = null;
  }

  function showPanel() {
    windowManager.attachBgmPanel();
    windowManager.safeSend('youtube-state', true);
  }

  function hidePanel() {
    stopDetectors();
    windowManager.detachAll();
    windowManager.safeSend('youtube-state', false);
  }

  function setBgmUrl(url) {
    currentBgmUrl = url;
    const bgmView = windowManager.createBgmView();
    if (!windowManager.isPanelVisible()) showPanel();

    const currentUrl = bgmView.webContents.getURL();
    const spotifyToSpotify = spotify.isSpotifyUrl(url) && spotify.isSpotifyUrl(currentUrl);
    if (spotifyToSpotify) {
      bgmView.webContents.executeJavaScript(`window.location.href = ${JSON.stringify(url)}`);
    } else {
      bgmView.webContents.loadURL(url);
    }
  }

  function clearBgm() {
    const bgmView = windowManager.getBgmView();
    if (!bgmView || bgmView.webContents.isDestroyed()) return;
    bgmView.webContents.loadURL('https://www.google.com');
  }

  async function playRecommendation(videoIdOrUrl) {
    stopDetectors();

    const url = videoIdOrUrl.startsWith('http')
      ? videoIdOrUrl
      : `https://www.youtube.com/watch?v=${videoIdOrUrl}`;
    const isSpotifyRecommendation = spotify.isSpotifyUrl(url);
    const bgmIsSpotify = spotify.isSpotifyUrl(currentBgmUrl);
    const bgmView = windowManager.getBgmView();

    if (bgmView && isSpotifyRecommendation && bgmIsSpotify) {
      currentRecMode = 'spotify-takeover';
      savedBgmMeta = await spotify.readCurrentTrackMeta(bgmView);
      console.log('[takeover] saved BGM meta:', savedBgmMeta);
      console.log('[takeover] play rec in bgmView:', url);

      spotify.navigateAndPlay(bgmView, url);
      spotifyTakeoverDetector = createSpotifyTakeoverDetector({
        getView: windowManager.getBgmView,
        safeSend: windowManager.safeSend,
        isQuitting,
      });
      spotifyTakeoverDetector.start();
      return;
    }

    currentRecMode = 'overlay';
    if (bgmView && !bgmView.webContents.isDestroyed()) {
      bgmView.webContents.setAudioMuted(true);
      setTimeout(() => {
        const currentView = windowManager.getBgmView();
        if (currentView === bgmView) spotify.clickPlayIfPaused(bgmView);
      }, 300);
    }

    const recView = windowManager.createRecView();
    windowManager.attachRecView();
    recView.webContents.loadURL(url);

    if (soundcloud.isSoundCloudUrl(url)) {
      soundcloud.preparePlayback(recView, {
        getCurrentView: windowManager.getRecView,
        isQuitting,
      });
      soundCloudDetector = createSoundCloudDetector({
        getView: windowManager.getRecView,
        safeSend: windowManager.safeSend,
        isQuitting,
      });
      soundCloudDetector.start();
    }

    if (isSpotifyRecommendation) {
      spotifyOverlayDetector = createSpotifyOverlayDetector({
        getView: windowManager.getRecView,
        safeSend: windowManager.safeSend,
        isQuitting,
      });
      spotifyOverlayDetector.start();
    }
  }

  function endRecommendation() {
    stopDetectors();

    const mode = currentRecMode;
    currentRecMode = null;

    if (mode === 'spotify-takeover') {
      const resumeMeta = savedBgmMeta;
      savedBgmMeta = null;
      const bgmView = windowManager.getBgmView();
      console.log('[end-rec takeover] restore to BGM URL:', currentBgmUrl, 'resume:', resumeMeta);
      if (bgmView && currentBgmUrl) spotify.navigateAndPlay(bgmView, currentBgmUrl, resumeMeta);
      windowManager.safeSend('now-playing', null);
      return;
    }

    windowManager.destroyRecView();
    const bgmView = windowManager.getBgmView();
    if (bgmView && !bgmView.webContents.isDestroyed()) {
      bgmView.webContents.setAudioMuted(false);
      spotify.clickPlayIfPaused(bgmView);
    }
    windowManager.safeSend('now-playing', null);
  }

  function registerIpcHandlers() {
    ipcMain.on('show-youtube', showPanel);
    ipcMain.on('hide-youtube', hidePanel);
    ipcMain.on('set-bgm-url', (_event, url) => setBgmUrl(url));
    ipcMain.on('clear-bgm', clearBgm);
    ipcMain.on('play-rec', (_event, videoIdOrUrl) => playRecommendation(videoIdOrUrl));
    ipcMain.on('end-rec', endRecommendation);
  }

  return {
    cleanupForQuit: stopDetectors,
    endRecommendation,
    registerIpcHandlers,
  };
}

module.exports = { createPlaybackController };
