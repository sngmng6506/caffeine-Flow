const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  playVideo:      (videoId) => ipcRenderer.send('play-video', videoId),
  stopVideo:      ()        => ipcRenderer.send('stop-video'),
  showYoutube:    ()        => ipcRenderer.send('show-youtube'),
  hideYoutube:    ()        => ipcRenderer.send('hide-youtube'),
  onYoutubeState:   (cb) => ipcRenderer.on('youtube-state', (_e, visible) => cb(visible)),
  onVideoEnded:     (cb) => ipcRenderer.on('video-ended', () => cb()),
  onQueueRestore:   (cb) => ipcRenderer.on('queue-restore', (_e, url) => cb(url)),
  onNowPlaying:        (cb)      => ipcRenderer.on('now-playing', (_e, info) => cb(info)),
  setDefaultVideo:     (videoId) => ipcRenderer.send('set-default-video', videoId),
  clearDefaultVideo:   ()        => ipcRenderer.send('clear-default-video'),
  onDefaultPlaying:    (cb)      => ipcRenderer.on('default-playing', (_e, v) => cb(v)),
});
