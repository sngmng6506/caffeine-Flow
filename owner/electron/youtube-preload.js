const { ipcRenderer } = require('electron');

// 자동재생 차단: main에서 block-next-play 수신 시 다음 play() 한 번만 막음
let blockNextPlay = false;
ipcRenderer.on('block-next-play', () => { blockNextPlay = true; });
const origPlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function() {
  if (blockNextPlay && this.tagName === 'VIDEO') {
    blockNextPlay = false;
    this.pause();
    return Promise.resolve();
  }
  return origPlay.apply(this, arguments);
};

let videoEndedSent = false;

// YouTube SPA 이동 시 플래그 리셋 (새 영상 end 감지 가능하도록)
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

  // YouTube MSE 스트리밍은 ended가 안 fires되므로 duration 근접 감지
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
