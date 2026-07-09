export const PLATFORM = Object.freeze({
  YOUTUBE: 'youtube',
  SOUNDCLOUD: 'soundcloud',
  SPOTIFY: 'spotify',
});

export const VALID_PLATFORMS = Object.freeze(Object.values(PLATFORM));

export const PLATFORM_BADGE = Object.freeze({
  [PLATFORM.YOUTUBE]: { label: 'YouTube', bg: '#ff0000', color: '#fff' },
  [PLATFORM.SOUNDCLOUD]: { label: 'SoundCloud', bg: '#ff5500', color: '#fff' },
  [PLATFORM.SPOTIFY]: { label: 'Spotify', bg: '#1db954', color: '#fff' },
});

export const COMPACT_PLATFORM_BADGE = Object.freeze({
  [PLATFORM.YOUTUBE]: { label: 'YT', bg: '#ff0000' },
  [PLATFORM.SOUNDCLOUD]: { label: 'SC', bg: '#ff5500' },
  [PLATFORM.SPOTIFY]: { label: 'SP', bg: '#1db954' },
});

export const PLATFORM_LINKS = Object.freeze([
  { id: PLATFORM.YOUTUBE, href: 'https://www.youtube.com' },
  { id: PLATFORM.SPOTIFY, href: 'https://open.spotify.com' },
  { id: PLATFORM.SOUNDCLOUD, href: 'https://soundcloud.com' },
]);

export function platformLabel(platform) {
  return PLATFORM_BADGE[platform]?.label || platform;
}
