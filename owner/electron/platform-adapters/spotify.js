const SPOTIFY_CLICK_PLAY_IF_PAUSED = `
  (function() {
    const btn = document.querySelector('[data-testid="control-button-playpause"]');
    if (!btn) return 'no-btn';
    const label = btn.getAttribute('aria-label') || '';
    const isPaused = label.includes('재생') || label.toLowerCase().includes('play');
    if (isPaused) { btn.click(); return 'clicked'; }
    return 'already-playing';
  })()
`;

const SPOTIFY_CLICK_PAGE_PLAY = `
  (function() {
    const candidates = [
      '[data-testid="action-bar-row"] [data-testid="play-button"]',
      '[data-testid="action-bar-row"] button[aria-label*="재생"]',
      '[data-testid="action-bar-row"] button[aria-label*="Play"]',
      'section [data-testid="play-button"]',
      'main [data-testid="play-button"]',
      'button[data-testid="play-button"]',
      '[data-testid="play-button"]',
      'button[data-encore-id="buttonPrimary"][aria-label*="재생"]',
      'button[data-encore-id="buttonPrimary"][aria-label*="Play"]',
    ];
    for (const sel of candidates) {
      const btn = document.querySelector(sel);
      if (!btn) continue;
      const label = btn.getAttribute('aria-label') || '';
      const isPause = label.includes('일시 정지') || label.toLowerCase().includes('pause');
      if (isPause) { console.log('[CF page-play]', sel, '→ already playing'); return 'already-playing'; }
      btn.click();
      console.log('[CF page-play] clicked:', sel, 'label:', label);
      return 'clicked';
    }
    console.log('[CF page-play] no button found');
    return 'no-btn';
  })()
`;

function buildClickPlaylistRow(meta) {
  return `
    (function() {
      const targetTrackId = ${JSON.stringify(meta?.trackId || null)};
      const targetTitle = ${JSON.stringify(meta?.title || null)};
      if (!targetTrackId && !targetTitle) return 'no-meta';

      const rows = document.querySelectorAll('[data-testid="tracklist-row"]');
      if (rows.length === 0) return 'no-rows';

      for (const row of rows) {
        const link = row.querySelector('a[href*="/track/"]');
        if (!link) continue;
        const rowTrackId = (link.href.match(/\/track\/([A-Za-z0-9]+)/) || [])[1];
        const rowTitle = (link.textContent || '').trim();
        const matchById = targetTrackId && rowTrackId === targetTrackId;
        const matchByTitle = targetTitle && rowTitle === targetTitle;
        if (!matchById && !matchByTitle) continue;

        const btns = row.querySelectorAll('button, [role="button"]');
        for (const btn of btns) {
          const label = btn.getAttribute('aria-label') || '';
          if (label.includes('재생') || label.toLowerCase().includes('play')) {
            btn.click();
            console.log('[CF row-play] clicked btn for:', rowTitle);
            return 'clicked';
          }
        }
        const evt = new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window });
        row.dispatchEvent(evt);
        console.log('[CF row-play] dblclick on:', rowTitle);
        return 'clicked';
      }
      return 'not-found';
    })()
  `;
}

function isSpotifyUrl(url) {
  return typeof url === 'string' && url.includes('open.spotify.com');
}

async function clickPlayIfPaused(view) {
  if (!view || view.webContents.isDestroyed()) return;
  await view.webContents.executeJavaScript(SPOTIFY_CLICK_PLAY_IF_PAUSED).catch(() => {});
}

function navigateAndPlay(view, targetUrl, resumeMeta = null) {
  if (!view || view.webContents.isDestroyed() || !targetUrl) return;
  console.log('[bgmNav] loadURL →', targetUrl, resumeMeta ? '(with resume meta)' : '');
  view.webContents.loadURL(targetUrl);

  let retries = 0;
  const maxRetries = 10;
  const tryPlay = async () => {
    if (view.webContents.isDestroyed() || retries >= maxRetries) return;
    retries += 1;

    if (resumeMeta && (resumeMeta.title || resumeMeta.trackId)) {
      const result = await view.webContents
        .executeJavaScript(buildClickPlaylistRow(resumeMeta))
        .catch(() => 'err');
      console.log('[bgmNav] row-play attempt', retries, '→', result);
      if (result === 'clicked') {
        try { view.webContents.setAudioMuted(false); } catch {}
        return;
      }
      if (result === 'no-rows') {
        setTimeout(tryPlay, 1000);
        return;
      }
    }

    const result = await view.webContents
      .executeJavaScript(SPOTIFY_CLICK_PAGE_PLAY)
      .catch(() => 'err');
    console.log('[bgmNav] page-play attempt', retries, '→', result);
    if (result === 'clicked' || result === 'already-playing') {
      try { view.webContents.setAudioMuted(false); } catch {}
      return;
    }
    setTimeout(tryPlay, 1000);
  };

  view.webContents.once('did-finish-load', () => {
    setTimeout(tryPlay, 2000);
  });
  setTimeout(tryPlay, 5000);
}

async function readCurrentTrackMeta(view) {
  if (!view || view.webContents.isDestroyed()) return null;
  return view.webContents.executeJavaScript(`
    (function() {
      const m = navigator.mediaSession && navigator.mediaSession.metadata;
      const title = m && m.title || null;
      const artist = m && m.artist || null;
      let trackId = null;
      const sels = [
        '[data-testid="context-item-link-title"]',
        '[data-testid="nowplaying-track-link"]',
        'footer a[href*="/track/"]',
      ];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        const link = el && el.href ? el : el && el.querySelector ? el.querySelector('a[href*="/track/"]') : null;
        if (!link || !link.href) continue;
        try {
          const u = new URL(link.href);
          const uri = u.searchParams.get('uri') || '';
          const matchFromUri = uri.match(/track[:%3A]+([A-Za-z0-9]+)/i);
          if (matchFromUri) { trackId = matchFromUri[1]; break; }
          const matchFromPath = link.href.match(/\/track\/([A-Za-z0-9]+)/);
          if (matchFromPath) trackId = matchFromPath[1];
        } catch {}
      }
      return { title: title, artist: artist, trackId: trackId };
    })()
  `).catch(() => null);
}

module.exports = {
  clickPlayIfPaused,
  isSpotifyUrl,
  navigateAndPlay,
  readCurrentTrackMeta,
};
