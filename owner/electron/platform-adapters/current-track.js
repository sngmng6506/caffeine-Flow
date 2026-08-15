const CURRENT_TRACK_POLL_MS = 1000;
const CURRENT_TRACK_HEARTBEAT_MS = 5000;

const READ_CURRENT_TRACK = `
  (function() {
    const host = location.hostname.toLowerCase();
    const platform = host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')
      ? 'youtube'
      : host === 'soundcloud.com' || host.endsWith('.soundcloud.com')
        ? 'soundcloud'
        : host === 'spotify.com' || host.endsWith('.spotify.com')
          ? 'spotify'
          : null;
    if (!platform) return null;

    const text = selector => document.querySelector(selector)?.textContent?.trim() || null;
    const meta = selector => document.querySelector(selector)?.content?.trim() || null;
    const media = navigator.mediaSession?.metadata;
    const artwork = media?.artwork?.length ? media.artwork[media.artwork.length - 1]?.src : null;

    let title = media?.title?.trim() || null;
    let artist = media?.artist?.trim() || null;
    const thumbnail = artwork || meta('meta[property="og:image"]');

    if (platform === 'youtube') {
      const hasTrackContext = Boolean(media?.title)
        || location.pathname === '/watch'
        || location.pathname.startsWith('/shorts/')
        || host === 'youtu.be';
      if (!hasTrackContext) return null;
      title = title
        || text('ytd-watch-metadata h1 yt-formatted-string')
        || text('ytmusic-player-bar .title')
        || document.title.replace(/\\s+-\\s+YouTube(?: Music)?$/, '').trim();
      artist = artist
        || text('ytd-video-owner-renderer #channel-name a')
        || text('ytmusic-player-bar .byline');
    } else if (platform === 'spotify') {
      title = title || text('[data-testid="context-item-info-title"]');
      artist = artist || text('[data-testid="context-item-info-artist"]');
    } else if (platform === 'soundcloud') {
      title = title || text('.playbackSoundBadge__titleLink');
      artist = artist || text('.playbackSoundBadge__lightLink');
    }

    return { title, artist, thumbnail, platform };
  })()
`;

const GENERIC_TITLES = new Set([
  'YouTube',
  'YouTube Music',
  'Spotify',
  'Spotify – Web Player',
  'SoundCloud',
]);

function normalizeTrack(value) {
  if (!value || typeof value !== 'object') return null;
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  if (!title || GENERIC_TITLES.has(title)) return null;
  if (!['youtube', 'soundcloud', 'spotify'].includes(value.platform)) return null;
  return {
    title,
    artist: typeof value.artist === 'string' && value.artist.trim() ? value.artist.trim() : null,
    thumbnail: typeof value.thumbnail === 'string' && value.thumbnail.trim() ? value.thumbnail.trim() : null,
    platform: value.platform,
  };
}

function createCurrentTrackDetector({ getView, safeSend, isQuitting }) {
  let poll = null;
  let lastSignature = null;
  let lastSentAt = 0;
  let runId = 0;
  let checking = false;

  function send(track) {
    lastSignature = track ? JSON.stringify(track) : null;
    lastSentAt = Date.now();
    safeSend('current-track', track);
  }

  function stop() {
    runId += 1;
    if (poll) clearInterval(poll);
    poll = null;
    lastSignature = null;
    lastSentAt = 0;
    checking = false;
  }

  function start() {
    stop();
    const activeRunId = runId;
    send(null);

    poll = setInterval(async () => {
      if (checking) return;
      const view = getView();
      if (isQuitting() || !view || view.webContents.isDestroyed()) {
        stop();
        return;
      }

      checking = true;
      let track = null;
      try {
        track = normalizeTrack(await view.webContents.executeJavaScript(READ_CURRENT_TRACK));
      } catch {}

      if (activeRunId !== runId) return;
      checking = false;
      const signature = track ? JSON.stringify(track) : null;
      const heartbeatDue = Date.now() - lastSentAt >= CURRENT_TRACK_HEARTBEAT_MS;
      if (signature !== lastSignature || heartbeatDue) send(track);
    }, CURRENT_TRACK_POLL_MS);
  }

  return { start, stop };
}

module.exports = { READ_CURRENT_TRACK, createCurrentTrackDetector, normalizeTrack };
