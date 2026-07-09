export const PLATFORM = Object.freeze({
  YOUTUBE: 'youtube',
  SOUNDCLOUD: 'soundcloud',
  SPOTIFY: 'spotify',
});

export const VALID_PLATFORMS = Object.freeze(Object.values(PLATFORM));

export const PLATFORM_OPTIONS = Object.freeze([
  { id: PLATFORM.YOUTUBE, label: 'YouTube', color: '#ff0000' },
  { id: PLATFORM.SOUNDCLOUD, label: 'SoundCloud', color: '#ff5500' },
  { id: PLATFORM.SPOTIFY, label: 'Spotify', color: '#1db954' },
]);

export function parseAllowedPlatforms(value) {
  if (!value) return [...VALID_PLATFORMS];
  if (Array.isArray(value)) return value.filter(p => VALID_PLATFORMS.includes(p));
  return String(value)
    .split(',')
    .map(p => p.trim())
    .filter(p => VALID_PLATFORMS.includes(p));
}
