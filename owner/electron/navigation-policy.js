const MUSIC_HOSTS = Object.freeze([
  'youtube.com',
  'youtu.be',
  'soundcloud.com',
  'spotify.com',
  'spotify.link',
]);

const LOGIN_HOSTS = Object.freeze([
  'accounts.google.com',
  'accounts.spotify.com',
]);

const DEFAULT_OWNER_ORIGINS = Object.freeze([
  'http://localhost:5174',
  'https://caffeine-flow-production.up.railway.app',
]);

function hostAllowed(hostname, allowedHosts) {
  const host = String(hostname || '').toLowerCase();
  return allowedHosts.some(domain => host === domain || host.endsWith(`.${domain}`));
}

function isAllowedHttpsUrl(value, allowedHosts) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && hostAllowed(url.hostname, allowedHosts);
  } catch {
    return false;
  }
}

function isAllowedMusicUrl(value) {
  return isAllowedHttpsUrl(value, MUSIC_HOSTS);
}

function isAllowedLoginUrl(value) {
  return isAllowedHttpsUrl(value, LOGIN_HOSTS);
}

function isAllowedOwnerRendererUrl(value, configuredOwnerUrl) {
  try {
    const origin = new URL(String(value || '')).origin;
    if (configuredOwnerUrl) return origin === new URL(configuredOwnerUrl).origin;
    return DEFAULT_OWNER_ORIGINS.includes(origin);
  } catch {
    return false;
  }
}

function toRecommendationUrl(value) {
  const input = String(value || '').trim();
  if (/^[A-Za-z0-9_-]{6,64}$/.test(input)) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(input)}`;
  }
  return isAllowedMusicUrl(input) ? input : null;
}

module.exports = { isAllowedMusicUrl, isAllowedLoginUrl, isAllowedOwnerRendererUrl, toRecommendationUrl };
