const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback, project = (...args) => args[0]) {
  const listener = (_event, ...args) => callback(project(...args));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('electronAPI', {
  // 신청곡 시작/종료 — bgmView는 백그라운드 유지 + 음소거 토글
  playRec:          (videoIdOrUrl) => ipcRenderer.send('play-rec', videoIdOrUrl),
  endRec:           ()             => ipcRenderer.send('end-rec'),

  // 매장 BGM URL 설정/해제
  setBgmUrl:        (url) => ipcRenderer.send('set-bgm-url', url),
  clearBgm:         ()    => ipcRenderer.send('clear-bgm'),

  showYoutube:      () => ipcRenderer.send('show-youtube'),
  hideYoutube:      () => ipcRenderer.send('hide-youtube'),

  onYoutubeState:   (cb) => subscribe('youtube-state', cb),
  onVideoEnded:     (cb) => subscribe('video-ended', cb, () => undefined),
  onNowPlaying:     (cb) => subscribe('now-playing', cb),
  onPlaybackState:  (cb) => subscribe('playback-state', cb),

  openBgmDevTools:     ()    => ipcRenderer.send('open-bgm-devtools'),
  openLoginWindow:     (url) => ipcRenderer.send('open-login-window', url),
  onLoginWindowClosed: (cb)  => subscribe('login-window-closed', cb, () => undefined),
  onWidevineStatus:    (cb)  => subscribe('widevine-status', cb),

  setPanelRatio:      (ratio) => ipcRenderer.send('set-panel-ratio', ratio),
  dividerDragStart:   ()      => ipcRenderer.send('divider-drag-start'),
  dividerDragEnd:     ()      => ipcRenderer.send('divider-drag-end'),

  clearSoundCloudSession: () => ipcRenderer.invoke('clear-soundcloud-session'),
  clearSpotifySession:    () => ipcRenderer.invoke('clear-spotify-session'),
  openExternal:           (url) => ipcRenderer.send('open-external', url),
  importCookiesFromFile:  ()    => ipcRenderer.invoke('import-cookies-from-file'),

  onUpdateDownloaded: (cb) => subscribe('update-downloaded', cb),
  restartApp:         ()   => ipcRenderer.send('restart-app'),

  // 종료 전 cleanup: main에서 'cleanup-before-quit' 보내면 renderer가 playing → played
  // 처리 후 'cleanup-done' 회신. main이 회신 받으면 quit 진행 (3초 timeout fallback).
  onCleanupBeforeQuit: (cb) => subscribe('cleanup-before-quit', cb, () => undefined),
  cleanupDone:         ()   => ipcRenderer.send('cleanup-done'),
});
