const {
  VALID_PLATFORMS,
  PLAYBACK_THUMBNAIL_HOSTS,
} = require('../constants/platforms');
const {
  PLAYBACK_TRACK_TEXT_MAX_LENGTH,
  PLAYBACK_THUMBNAIL_URL_MAX_LENGTH,
} = require('../constants/limits');

function optionalText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, PLAYBACK_TRACK_TEXT_MAX_LENGTH) : null;
}

function safeThumbnail(value) {
  if (typeof value !== 'string' || value.length > PLAYBACK_THUMBNAIL_URL_MAX_LENGTH) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !PLAYBACK_THUMBNAIL_HOSTS.some(host =>
      url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizePlaybackTrack(value) {
  if (!value || typeof value !== 'object') return null;
  const title = optionalText(value.title);
  if (!title || !VALID_PLATFORMS.includes(value.platform)) return null;
  return {
    title,
    artist: optionalText(value.artist),
    thumbnail: safeThumbnail(value.thumbnail),
    platform: value.platform,
  };
}

module.exports = { sanitizePlaybackTrack };
