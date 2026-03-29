// 신청곡 탭에 주입되는 스크립트
// YouTube 영상 종료를 감지해서 background.js에 알림
(function () {
  let reported = false;

  function attachListener() {
    const video = document.querySelector('video');
    if (!video) {
      setTimeout(attachListener, 500);
      return;
    }

    video.addEventListener('ended', () => {
      if (!reported) {
        reported = true;
        chrome.runtime.sendMessage({ type: 'VIDEO_ENDED' });
      }
    });
  }

  attachListener();
})();
