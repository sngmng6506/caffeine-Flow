const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  navigateVideo:    (videoId) => ipcRenderer.send('navigate-video', videoId),
  // [자동재생 비활성화]
  // playVideo:     (videoId) => ipcRenderer.send('play-video', videoId),
  // stopVideo:     ()        => ipcRenderer.send('stop-video'),
  showYoutube:      ()        => ipcRenderer.send('show-youtube'),
  hideYoutube:      ()        => ipcRenderer.send('hide-youtube'),
  setDefaultVideo:  (videoId) => ipcRenderer.send('set-default-video', videoId),
  clearDefaultVideo:()        => ipcRenderer.send('clear-default-video'),

  onYoutubeState:   (cb) => ipcRenderer.on('youtube-state',   (_e, v)    => cb(v)),
  onVideoEnded:     (cb) => ipcRenderer.on('video-ended',     ()         => cb()),
  onQueueRestore:   (cb) => ipcRenderer.on('queue-restore',   (_e, url)  => cb(url)),
  onNowPlaying:     (cb) => ipcRenderer.on('now-playing',     (_e, info) => cb(info)),
  onDefaultPlaying: (cb) => ipcRenderer.on('default-playing', (_e, v)    => cb(v)),

  // 컴포넌트 언마운트 시 모든 리스너 일괄 제거
  removeAllListeners: () => {
    ['youtube-state', 'video-ended', 'queue-restore', 'now-playing', 'default-playing']
      .forEach(ch => ipcRenderer.removeAllListeners(ch));
  },
});
