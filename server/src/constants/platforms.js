const PLATFORM = Object.freeze({
  YOUTUBE: 'youtube',
  SOUNDCLOUD: 'soundcloud',
  SPOTIFY: 'spotify',
});

const VALID_PLATFORMS = Object.freeze(Object.values(PLATFORM));

const PLAYBACK_THUMBNAIL_HOSTS = Object.freeze([
  'i.ytimg.com',
  'img.youtube.com',
  'yt3.ggpht.com',
  'lh3.googleusercontent.com',
  'i.scdn.co',
  'mosaic.scdn.co',
  'image-cdn-ak.spotifycdn.com',
  'i1.sndcdn.com',
  'a1.sndcdn.com',
]);

const PLATFORM_LABELS = Object.freeze({
  [PLATFORM.YOUTUBE]: 'YouTube',
  [PLATFORM.SOUNDCLOUD]: 'SoundCloud',
  [PLATFORM.SPOTIFY]: 'Spotify',
});

function parseAllowedPlatforms(value) {
  if (!value) return [...VALID_PLATFORMS];
  return String(value)
    .split(',')
    .map(p => p.trim())
    .filter(p => VALID_PLATFORMS.includes(p));
}

function formatAllowedPlatforms(platforms) {
  return platforms.filter(p => VALID_PLATFORMS.includes(p)).join(',');
}

function platformLabel(platform) {
  return PLATFORM_LABELS[platform] || platform;
}

module.exports = {
  PLATFORM,
  VALID_PLATFORMS,
  PLAYBACK_THUMBNAIL_HOSTS,
  PLATFORM_LABELS,
  parseAllowedPlatforms,
  formatAllowedPlatforms,
  platformLabel,
};
