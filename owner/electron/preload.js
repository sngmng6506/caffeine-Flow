const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 신청곡 시작/종료 — bgmView는 백그라운드 유지 + 음소거 토글
  playRec:          (videoIdOrUrl) => ipcRenderer.send('play-rec', videoIdOrUrl),
  endRec:           ()             => ipcRenderer.send('end-rec'),

  // 매장 BGM URL 설정/해제
  setBgmUrl:        (url) => ipcRenderer.send('set-bgm-url', url),
  clearBgm:         ()    => ipcRenderer.send('clear-bgm'),

  showYoutube:      () => ipcRenderer.send('show-youtube'),
  hideYoutube:      () => ipcRenderer.send('hide-youtube'),

  onYoutubeState:   (cb) => ipcRenderer.on('youtube-state', (_e, v)    => cb(v)),
  onVideoEnded:     (cb) => ipcRenderer.on('video-ended',   ()         => cb()),
  onNowPlaying:     (cb) => ipcRenderer.on('now-playing',   (_e, info) => cb(info)),

  openBgmDevTools:     ()    => ipcRenderer.send('open-bgm-devtools'),
  openLoginWindow:     (url) => ipcRenderer.send('open-login-window', url),
  onLoginWindowClosed: (cb)  => ipcRenderer.on('login-window-closed', () => cb()),
  onWidevineStatus:    (cb)  => ipcRenderer.on('widevine-status', (_e, s) => cb(s)),

  setPanelRatio:      (ratio) => ipcRenderer.send('set-panel-ratio', ratio),
  dividerDragStart:   ()      => ipcRenderer.send('divider-drag-start'),
  dividerDragEnd:     ()      => ipcRenderer.send('divider-drag-end'),

  clearSoundCloudSession: () => ipcRenderer.invoke('clear-soundcloud-session'),
  clearSpotifySession:    () => ipcRenderer.invoke('clear-spotify-session'),
  openExternal:           (url) => ipcRenderer.send('open-external', url),
  importCookiesFromFile:  ()    => ipcRenderer.invoke('import-cookies-from-file'),

  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_e, version) => cb(version)),
  restartApp:         ()   => ipcRenderer.send('restart-app'),

  // 종료 전 cleanup: main에서 'cleanup-before-quit' 보내면 renderer가 playing → played
  // 처리 후 'cleanup-done' 회신. main이 회신 받으면 quit 진행 (3초 timeout fallback).
  onCleanupBeforeQuit: (cb) => ipcRenderer.on('cleanup-before-quit', () => cb()),
  cleanupDone:         ()   => ipcRenderer.send('cleanup-done'),

  removeAllListeners: () => {
    ['youtube-state', 'video-ended', 'now-playing', 'cleanup-before-quit'].forEach(ch => ipcRenderer.removeAllListeners(ch));
  },
});
