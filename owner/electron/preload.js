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

  removeAllListeners: () => {
    ['youtube-state', 'video-ended', 'now-playing'].forEach(ch => ipcRenderer.removeAllListeners(ch));
  },
});
