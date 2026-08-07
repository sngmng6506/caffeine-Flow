function createSignatureChangeDetector({
  getView,
  isQuitting,
  delayMs,
  requiredChanges,
  readSignature,
  onEnd,
  label,
}) {
  let startTimer = null;
  let poll = null;
  let endFired = false;
  let baseline = null;
  let changeCount = 0;

  function stop() {
    if (startTimer) {
      clearTimeout(startTimer);
      startTimer = null;
    }
    if (poll) {
      clearInterval(poll);
      poll = null;
    }
  }

  function fireEnd(view) {
    if (endFired) return;
    endFired = true;
    stop();
    try { onEnd(view); } catch {}
  }

  function start() {
    stop();
    startTimer = setTimeout(() => {
      startTimer = null;
      if (endFired || isQuitting()) return;

      poll = setInterval(async () => {
        const view = getView();
        if (isQuitting() || endFired || !view || view.webContents.isDestroyed()) {
          stop();
          return;
        }

        try {
          const signature = await readSignature(view);
          if (!signature) return;

          if (!baseline) {
            baseline = signature;
            if (label) console.log(`[${label}] baseline saved:`, signature);
            return;
          }

          if (signature !== baseline) {
            changeCount += 1;
            if (label) console.log(`[${label}] changed →`, signature, 'count:', changeCount);
            if (changeCount >= requiredChanges) fireEnd(view);
          } else {
            changeCount = 0;
          }
        } catch {}
      }, 1000);
    }, delayMs);
  }

  return { start, stop };
}

const READ_MEDIA_SESSION_SIGNATURE = `
  (function() {
    const meta = navigator.mediaSession && navigator.mediaSession.metadata;
    const title = meta && meta.title || null;
    const artist = meta && meta.artist || null;
    return title ? title + '|' + (artist || '') : null;
  })()
`;

const READ_SPOTIFY_OVERLAY_SIGNATURE = `
  (function() {
    const meta = navigator.mediaSession && navigator.mediaSession.metadata;
    const title = meta && meta.title || null;
    const artist = meta && meta.artist || null;
    let domHref = null;
    const sels = [
      '[data-testid="context-item-link-title"]',
      '[data-testid="nowplaying-track-link"]',
      '[data-testid="context-item-info-title"] a',
      'footer a[href*="/track/"]',
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      const link = el && el.href ? el : el && el.querySelector ? el.querySelector('a[href*="/track/"]') : null;
      if (link && link.href && link.href.includes('/track/')) { domHref = link.href; break; }
    }
    const match = domHref && domHref.match(/\/track\/([A-Za-z0-9]+)/);
    const trackId = match && match[1] || null;
    return trackId || (title ? title + '|' + (artist || '') : null);
  })()
`;

function createSpotifyTakeoverDetector({ getView, safeSend, isQuitting }) {
  return createSignatureChangeDetector({
    getView,
    isQuitting,
    delayMs: 5000,
    requiredChanges: 1,
    label: 'takeover',
    readSignature: (view) => view.webContents.executeJavaScript(READ_MEDIA_SESSION_SIGNATURE),
    onEnd: (view) => {
      try { view.webContents.setAudioMuted(true); } catch {}
      console.log('[takeover] firing video-ended');
      safeSend('video-ended');
    },
  });
}

function createSoundCloudDetector({ getView, safeSend, isQuitting }) {
  return createSignatureChangeDetector({
    getView,
    isQuitting,
    delayMs: 4000,
    requiredChanges: 2,
    readSignature: (view) => view.webContents.executeJavaScript(READ_MEDIA_SESSION_SIGNATURE),
    onEnd: (view) => {
      try { view.webContents.setAudioMuted(true); } catch {}
      safeSend('video-ended');
    },
  });
}

function createSpotifyOverlayDetector({ getView, safeSend, isQuitting }) {
  return createSignatureChangeDetector({
    getView,
    isQuitting,
    delayMs: 5000,
    requiredChanges: 2,
    readSignature: (view) => view.webContents.executeJavaScript(READ_SPOTIFY_OVERLAY_SIGNATURE),
    onEnd: (view) => {
      try { view.webContents.setAudioMuted(true); } catch {}
      safeSend('video-ended');
    },
  });
}

module.exports = {
  createSoundCloudDetector,
  createSpotifyOverlayDetector,
  createSpotifyTakeoverDetector,
};
