const { randomUUID } = require('crypto');

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
    const mediaElement = Array.from(document.querySelectorAll('video, audio'))
      .find(element => Number.isFinite(element.duration) && element.duration > 0);
    // 실제로 소리내며 재생 중인 미디어. 유튜브 홈의 음소거 hover 미리보기를
    // '재생 중'으로 오인하지 않도록 muted/paused/미시작 미디어는 제외한다.
    const audibleMedia = Array.from(document.querySelectorAll('video, audio'))
      .find(element => Number.isFinite(element.duration) && element.duration > 0
        && !element.paused && !element.muted && element.currentTime > 0);

    let title = media?.title?.trim() || null;
    let artist = media?.artist?.trim() || null;
    const thumbnail = artwork || meta('meta[property="og:image"]');
    let videoId = null;

    if (platform === 'youtube') {
      // 홈(/)·검색 등에서는 음소거 미리보기가 mediaSession 제목을 세팅해도
      // 곡으로 잡지 않는다. watch·shorts 페이지이거나 실제 소리내는 재생일 때만.
      const hasTrackContext = location.pathname === '/watch'
        || location.pathname.startsWith('/shorts/')
        || host === 'youtu.be'
        || Boolean(audibleMedia);
      if (!hasTrackContext) return null;
      title = title
        || text('ytd-watch-metadata h1 yt-formatted-string')
        || text('ytmusic-player-bar .title')
        || document.title.replace(/\\s+-\\s+YouTube(?: Music)?$/, '').trim();
      artist = artist
        || text('ytd-video-owner-renderer #channel-name a')
        || text('ytmusic-player-bar .byline');
      const youtubeUrl = new URL(location.href);
      videoId = youtubeUrl.searchParams.get('v')
        || (location.pathname.startsWith('/shorts/') ? location.pathname.split('/')[2] : null)
        || (host === 'youtu.be' ? location.pathname.split('/')[1] : null);
    } else if (platform === 'spotify') {
      title = title || text('[data-testid="context-item-info-title"]');
      artist = artist || text('[data-testid="context-item-info-artist"]');
      const trackLink = document.querySelector('[data-testid="context-item-link-title"], [data-testid="nowplaying-track-link"], footer a[href*="/track/"]');
      const spotifyTrackId = (trackLink?.href?.match(/\\/track\\/([A-Za-z0-9]+)/) || [])[1] || null;
      videoId = spotifyTrackId ? 'https://open.spotify.com/track/' + spotifyTrackId : null;
    } else if (platform === 'soundcloud') {
      title = title || text('.playbackSoundBadge__titleLink');
      artist = artist || text('.playbackSoundBadge__lightLink');
      const trackLink = document.querySelector('.playbackSoundBadge__titleLink');
      if (trackLink?.href) {
        try { videoId = new URL(trackLink.href).origin + new URL(trackLink.href).pathname; } catch {}
      }
    }

    return {
      title,
      artist,
      thumbnail,
      platform,
      videoId,
      mediaDuration: mediaElement?.duration || null,
      mediaCurrentTime: mediaElement?.currentTime || null,
      mediaEnded: mediaElement?.ended === true,
    };
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
  const track = {
    title,
    artist: typeof value.artist === 'string' && value.artist.trim() ? value.artist.trim() : null,
    thumbnail: typeof value.thumbnail === 'string' && value.thumbnail.trim() ? value.thumbnail.trim() : null,
    platform: value.platform,
  };
  if (typeof value.videoId === 'string' && value.videoId.trim()) track.videoId = value.videoId.trim();
  if (Number.isFinite(value.mediaDuration) && value.mediaDuration > 0) track.mediaDuration = value.mediaDuration;
  if (Number.isFinite(value.mediaCurrentTime) && value.mediaCurrentTime >= 0) track.mediaCurrentTime = value.mediaCurrentTime;
  if (value.mediaEnded === true) track.mediaEnded = true;
  return track;
}

function createCurrentTrackDetector({ getView, safeSend, isQuitting, reportLifecycle = false }) {
  let poll = null;
  let lastSignature = null;
  let lastSentAt = 0;
  let runId = 0;
  let checking = false;
  let activeSession = null;
  let lastEndedIdentity = null;

  function identity(track) {
    return track.videoId
      ? `${track.platform}:${track.videoId}`
      : `${track.platform}:${track.title}:${track.artist || ''}`;
  }

  function isSameTrack(left, right) {
    if (!left || !right || left.platform !== right.platform) return false;
    if (left.videoId && right.videoId) return left.videoId === right.videoId;
    return left.title === right.title && left.artist === right.artist;
  }

  function publicTrack(track, session) {
    return {
      title: track.title,
      artist: track.artist,
      thumbnail: track.thumbnail,
      platform: track.platform,
      videoId: track.videoId,
      sessionId: session.sessionId,
      commentKey: session.commentKey,
    };
  }

  function send(track) {
    lastSignature = track ? JSON.stringify(track) : null;
    lastSentAt = Date.now();
    safeSend('current-track', track);
  }

  function finishActive(endReason) {
    if (!activeSession) return;
    const finished = activeSession;
    activeSession = null;
    lastEndedIdentity = endReason === 'ended' ? identity(finished.track) : null;
    if (reportLifecycle) {
      safeSend('manual-track-ended', {
        ...publicTrack(finished.track, finished),
        durationSeconds: Math.max(0, Math.round((Date.now() - finished.startedAt) / 1000)),
        endReason,
      });
    }
  }

  function observe(track) {
    if (!track) {
      if (activeSession) finishActive(activeSession.completed ? 'ended' : 'changed');
      send(null);
      return;
    }

    const nextIdentity = identity(track);
    if (!activeSession && lastEndedIdentity === nextIdentity && track.mediaEnded) return;
    if (!activeSession || !isSameTrack(activeSession.track, track)) {
      if (activeSession) finishActive(activeSession.completed ? 'ended' : 'changed');
      activeSession = {
        sessionId: randomUUID(),
        commentKey: track.videoId || `playback:${randomUUID()}`,
        track,
        startedAt: Date.now(),
        completed: false,
      };
      lastEndedIdentity = null;
    } else {
      activeSession.track = { ...activeSession.track, ...track };
    }

    const current = activeSession.track;
    if (current.mediaEnded || (
      current.mediaDuration
      && current.mediaCurrentTime / current.mediaDuration >= 0.98
    )) activeSession.completed = true;

    const nextPublicTrack = publicTrack(current, activeSession);
    const signature = JSON.stringify(nextPublicTrack);
    const heartbeatDue = Date.now() - lastSentAt >= CURRENT_TRACK_HEARTBEAT_MS;
    if (signature !== lastSignature || heartbeatDue) send(nextPublicTrack);

    if (current.mediaEnded) {
      finishActive('ended');
      send(null);
    }
  }

  function stop(finalize = false) {
    if (finalize && activeSession) finishActive(activeSession.completed ? 'ended' : 'changed');
    runId += 1;
    if (poll) clearInterval(poll);
    poll = null;
    lastSignature = null;
    lastSentAt = 0;
    checking = false;
    activeSession = null;
    lastEndedIdentity = null;
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
      observe(track);
    }, CURRENT_TRACK_POLL_MS);
  }

  return { start, stop };
}

module.exports = { READ_CURRENT_TRACK, createCurrentTrackDetector, normalizeTrack };
