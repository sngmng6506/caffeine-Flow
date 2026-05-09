const { ipcRenderer } = require('electron');

let videoEndedSent = false;

// YouTube SPA 이동 시 플래그 리셋
window.addEventListener('yt-navigate-start',  () => { videoEndedSent = false; });
window.addEventListener('yt-navigate-finish', () => { videoEndedSent = false; });

function attachEndedListener(video) {
  if (video._cfListening) return;
  video._cfListening = true;

  video.addEventListener('ended', () => {
    if (videoEndedSent) return;
    videoEndedSent = true;
    ipcRenderer.send('youtube-video-ended');
  });

  // YouTube MSE 스트리밍은 ended가 fires 안되므로 duration 근접 감지
  video.addEventListener('timeupdate', () => {
    if (videoEndedSent) return;
    if (video.duration > 0 && video.currentTime >= video.duration - 0.5) {
      videoEndedSent = true;
      ipcRenderer.send('youtube-video-ended');
    }
  });
}

const observer = new MutationObserver(() => {
  document.querySelectorAll('video').forEach(attachEndedListener);
});

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('video').forEach(attachEndedListener);
  observer.observe(document.body, { childList: true, subtree: true });
});
