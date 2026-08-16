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

const QR_IMAGE_HOST = 'api.qrserver.com';

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

function isAllowedQrImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && url.hostname === QR_IMAGE_HOST
      && url.pathname === '/v1/create-qr-code/'
      && url.searchParams.has('data')
      && url.searchParams.get('data').length <= 2048
      && url.searchParams.get('size') === '600x600'
      && url.searchParams.get('margin') === '20'
      && url.searchParams.get('format') === 'jpg';
  } catch {
    return false;
  }
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

// 신청곡이 실제로 '재생'되는 플레이어 URL인지 판별한다. 같은 음악 호스트라도
// 홈·검색·라이브러리처럼 재생 화면이 아닌 곳으로 이동하면 false다. 신청곡
// 재생 중 사장님이 플레이어를 벗어났는지 감지하는 데 쓴다.
function isRecPlaybackUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    const path = url.pathname;
    if (host === 'youtu.be') return path.length > 1;
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      return path === '/watch' || path.startsWith('/shorts/');
    }
    if (host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) {
      return path.split('/').filter(Boolean).length >= 2;
    }
    if (host === 'spotify.com' || host.endsWith('.spotify.com') || host === 'open.spotify.com') {
      return /\/(track|playlist|album)\//.test(path);
    }
    return false;
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

module.exports = {
  isAllowedMusicUrl,
  isAllowedLoginUrl,
  isAllowedQrImageUrl,
  isAllowedOwnerRendererUrl,
  isRecPlaybackUrl,
  toRecommendationUrl,
};
