const spotify = require('./platform-adapters/spotify');
const soundcloud = require('./platform-adapters/soundcloud');
const {
  createSoundCloudDetector,
  createSpotifyOverlayDetector,
  createSpotifyTakeoverDetector,
} = require('./end-detection');
const { PLAYBACK_STATE, createPlaybackStateDetector } = require('./playback-state');
const { createCurrentTrackDetector } = require('./platform-adapters/current-track');
const { isAllowedMusicUrl, isRecPlaybackUrl, toRecommendationUrl } = require('./navigation-policy');

function createPlaybackController({ ipcMain, windowManager, isQuitting }) {
  let currentBgmUrl = null;
  let currentRecMode = null;
  let savedBgmMeta = null;
  let spotifyOverlayDetector = null;
  let soundCloudDetector = null;
  let spotifyTakeoverDetector = null;
  let playbackStateDetector = null;
  let currentTrackDetector = null;

  function stopDetectors(finalizeManualTrack = false) {
    spotifyOverlayDetector?.stop();
    soundCloudDetector?.stop();
    spotifyTakeoverDetector?.stop();
    playbackStateDetector?.stop();
    currentTrackDetector?.stop(finalizeManualTrack);
    spotifyOverlayDetector = null;
    soundCloudDetector = null;
    spotifyTakeoverDetector = null;
    playbackStateDetector = null;
    currentTrackDetector = null;
  }

  function startCurrentTrackDetector() {
    currentTrackDetector = createCurrentTrackDetector({
      getView: () => currentRecMode === 'overlay'
        ? windowManager.getRecView()
        : windowManager.getBgmView(),
      safeSend: windowManager.safeSend,
      isQuitting,
      reportLifecycle: currentRecMode === null,
    });
    currentTrackDetector.start();
  }

  function startPlaybackStateDetector() {
    playbackStateDetector = createPlaybackStateDetector({
      getView: () => currentRecMode === 'spotify-takeover'
        ? windowManager.getBgmView()
        : windowManager.getRecView(),
      safeSend: windowManager.safeSend,
      isQuitting,
    });
    playbackStateDetector.start();
  }

  function showPanel() {
    windowManager.attachBgmPanel();
    windowManager.safeSend('youtube-state', true);
  }

  function hidePanel() {
    stopDetectors(currentRecMode === null);
    windowManager.safeSend('current-track', null);
    windowManager.detachAll();
    windowManager.safeSend('youtube-state', false);
  }

  function setBgmUrl(url) {
    // 신청곡 재생 중, 특히 Spotify takeover는 bgmView 자체가 신청곡
    // 플레이어다. 이때 BGM URL을 바꾸면 종료 이벤트 없이 DB만 playing에
    // 남으므로 신청곡이 끝난 뒤에만 변경을 허용한다.
    if (currentRecMode || !isAllowedMusicUrl(url)) return false;
    stopDetectors(true);
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
    startCurrentTrackDetector();
    return true;
  }

  function clearBgm() {
    if (currentRecMode) return false;
    // takeover 종료가 과거 Spotify BGM을 되살리지 않도록 메모리 상태도
    // 함께 비운다. 뷰가 아직 생성되지 않은 경우에도 해제는 유효하다.
    currentBgmUrl = null;
    savedBgmMeta = null;
    stopDetectors(true);
    windowManager.safeSend('current-track', null);
    const bgmView = windowManager.getBgmView();
    if (!bgmView || bgmView.webContents.isDestroyed()) return true;
    bgmView.webContents.loadURL('https://www.google.com');
    return true;
  }

  async function playRecommendation(videoIdOrUrl) {
    const url = toRecommendationUrl(videoIdOrUrl);
    if (!url) return { ok: false, error: '지원하지 않는 신청곡 URL입니다.' };
    stopDetectors(currentRecMode === null);
    const isSpotifyRecommendation = spotify.isSpotifyUrl(url);
    const bgmIsSpotify = spotify.isSpotifyUrl(currentBgmUrl);
    const bgmView = windowManager.getBgmView();

    if (bgmView && isSpotifyRecommendation && bgmIsSpotify) {
      currentRecMode = 'spotify-takeover';
      savedBgmMeta = await spotify.readCurrentTrackMeta(bgmView);
      console.log('[takeover] saved BGM meta:', savedBgmMeta);
      console.log('[takeover] play rec in bgmView:', url);

      try {
        await spotify.navigateAndPlay(bgmView, url);
        spotifyTakeoverDetector = createSpotifyTakeoverDetector({
          getView: windowManager.getBgmView,
          safeSend: windowManager.safeSend,
          isQuitting,
        });
        spotifyTakeoverDetector.start();
        startCurrentTrackDetector();
        startPlaybackStateDetector();
        return { ok: true };
      } catch (error) {
        console.error('[play-rec takeover]', error);
        endRecommendation();
        return { ok: false, error: 'Spotify 신청곡 화면을 열지 못했습니다.' };
      }
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
    try {
      await recView.webContents.loadURL(url);
      startCurrentTrackDetector();
      startPlaybackStateDetector();

      // 신청곡 재생 중 사장님이 플레이어를 신청곡 밖(유튜브 홈·검색 등)으로
      // 이동하면 그 곡을 종료 처리하도록 렌더러에 알린다. 렌더러는 곡을
      // played로 종료만 하고 자동 다음곡 재생은 하지 않는다(사장님이 직접
      // recView에서 브라우징/재생 중이므로). 최초 신청곡 로드는 이미 끝났고,
      // 이후 플레이어를 벗어나는 네비게이션에서만 한 번 발화한다.
      let recLeftFired = false;
      const handleRecNavigation = (targetUrl) => {
        if (recLeftFired || currentRecMode !== 'overlay') return;
        if (windowManager.getRecView() !== recView) return;
        if (isRecPlaybackUrl(targetUrl)) return;
        recLeftFired = true;
        windowManager.safeSend('rec-left');
      };
      recView.webContents.on('did-navigate', (_event, targetUrl) => handleRecNavigation(targetUrl));
      recView.webContents.on('did-navigate-in-page', (_event, targetUrl, isMainFrame) => {
        if (isMainFrame) handleRecNavigation(targetUrl);
      });

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
      return { ok: true };
    } catch (error) {
      console.error('[play-rec overlay]', error);
      endRecommendation();
      return { ok: false, error: '신청곡 화면을 열지 못했습니다.' };
    }
  }

  function endRecommendation() {
    stopDetectors();

    const mode = currentRecMode;
    currentRecMode = null;
    windowManager.safeSend('playback-state', PLAYBACK_STATE.UNKNOWN);

    if (mode === 'spotify-takeover') {
      const resumeMeta = savedBgmMeta;
      savedBgmMeta = null;
      const bgmView = windowManager.getBgmView();
      console.log('[end-rec takeover] restore to BGM URL:', currentBgmUrl, 'resume:', resumeMeta);
      if (bgmView && currentBgmUrl) {
        void spotify.navigateAndPlay(bgmView, currentBgmUrl, resumeMeta)
          .then(startCurrentTrackDetector)
          .catch(error => console.error('[end-rec takeover restore]', error));
      }
      windowManager.safeSend('now-playing', null);
      return;
    }

    windowManager.destroyRecView();
    const bgmView = windowManager.getBgmView();
    if (bgmView && !bgmView.webContents.isDestroyed()) {
      bgmView.webContents.setAudioMuted(false);
      spotify.clickPlayIfPaused(bgmView);
      if (currentBgmUrl) startCurrentTrackDetector();
    }
    windowManager.safeSend('now-playing', null);
  }

  function isRecommendationActive() {
    return currentRecMode !== null;
  }

  function registerIpcHandlers() {
    const trusted = (event) => windowManager.isFromMainRenderer(event.sender);
    ipcMain.on('show-youtube', (event) => { if (trusted(event)) showPanel(); });
    ipcMain.on('hide-youtube', (event) => { if (trusted(event)) hidePanel(); });
    ipcMain.handle('set-bgm-url', (event, url) => trusted(event) && setBgmUrl(url));
    ipcMain.handle('clear-bgm', (event) => trusted(event) && clearBgm());
    ipcMain.handle('is-rec-active', (event) => trusted(event) && isRecommendationActive());
    ipcMain.handle('play-rec', (event, videoIdOrUrl) => trusted(event)
      ? playRecommendation(videoIdOrUrl)
      : { ok: false, error: 'Forbidden' });
    ipcMain.on('end-rec', (event) => { if (trusted(event)) endRecommendation(); });
  }

  return {
    cleanupForQuit: stopDetectors,
    clearBgm,
    endRecommendation,
    isRecommendationActive,
    playRecommendation,
    registerIpcHandlers,
    setBgmUrl,
  };
}

module.exports = { createPlaybackController };
