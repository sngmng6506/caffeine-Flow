const PLAYBACK_STATE = Object.freeze({
  PLAYING: 'playing',
  PAUSED: 'paused',
  BUFFERING: 'buffering',
  UNKNOWN: 'unknown',
});

const READ_PLAYBACK_STATE = `
  (function() {
    const mediaState = navigator.mediaSession && navigator.mediaSession.playbackState;
    const media = Array.from(document.querySelectorAll('video, audio'));
    const active = media.find(item => !item.paused && !item.ended);

    if (active) return active.readyState < 3 ? 'buffering' : 'playing';
    if (mediaState === 'playing') return 'playing';
    if (mediaState === 'paused') return 'paused';
    if (media.some(item => item.paused && (item.currentTime > 0 || item.readyState >= 2))) return 'paused';
    if (media.length > 0) return 'buffering';
    return 'unknown';
  })()
`;

function createPlaybackStateDetector({ getView, safeSend, isQuitting }) {
  let poll = null;
  let candidate = PLAYBACK_STATE.UNKNOWN;
  let candidateCount = 0;
  let lastSent = null;
  let lastSentAt = 0;
  let runId = 0;
  let checking = false;

  function send(state) {
    lastSent = state;
    lastSentAt = Date.now();
    safeSend('playback-state', state);
  }

  function stop() {
    runId += 1;
    if (poll) clearInterval(poll);
    poll = null;
    candidate = PLAYBACK_STATE.UNKNOWN;
    candidateCount = 0;
    lastSent = null;
    lastSentAt = 0;
    checking = false;
  }

  function start() {
    stop();
    const activeRunId = runId;
    send(PLAYBACK_STATE.UNKNOWN);

    poll = setInterval(async () => {
      if (checking) return;
      const view = getView();
      if (isQuitting() || !view || view.webContents.isDestroyed()) {
        stop();
        return;
      }

      checking = true;
      let state = PLAYBACK_STATE.UNKNOWN;
      try {
        state = await view.webContents.executeJavaScript(READ_PLAYBACK_STATE);
      } catch {}

      if (activeRunId !== runId) return;
      checking = false;

      if (!Object.values(PLAYBACK_STATE).includes(state)) state = PLAYBACK_STATE.UNKNOWN;
      if (state === candidate) candidateCount += 1;
      else {
        candidate = state;
        candidateCount = 1;
      }

      const stable = candidateCount >= 2;
      const heartbeatDue = Date.now() - lastSentAt >= 5000;
      if (stable && (candidate !== lastSent || heartbeatDue)) send(candidate);
    }, 500);
  }

  return { start, stop };
}

module.exports = { PLAYBACK_STATE, createPlaybackStateDetector };
