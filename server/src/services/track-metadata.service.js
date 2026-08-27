const axios = require('axios');
const dns = require('dns');
const net = require('net');
const { PLATFORM } = require('../constants/platforms');
const { logError, CAUSE } = require('../observability');

const PRIVATE_IPV4_RE = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|0\.|255\.)/;
const SOUNDCLOUD_ALLOWED_HOSTS = ['soundcloud.com', 'on.soundcloud.com', 'soundcloud.app.goo.gl', 'goo.gl'];
const SPOTIFY_ALLOWED_HOSTS = ['open.spotify.com', 'spotify.com', 'spotify.link'];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function metadataError(message, code = 'TRACK_METADATA_ERROR') {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
}

function isPrivateAddress(address) {
  if (!address) return true;
  if (net.isIPv6(address)) return true;
  return PRIVATE_IPV4_RE.test(address);
}

async function assertPublicHost(host) {
  return new Promise((resolve, reject) => {
    dns.lookup(host, { all: true }, (err, addresses) => {
      if (err) return reject(metadataError(`DNS 해석 실패: ${host}`, 'TRACK_DNS_FAILED'));
      const blocked = addresses.find(item => isPrivateAddress(item.address));
      if (blocked) return reject(metadataError(`내부 IP 차단: ${host}`, 'TRACK_PRIVATE_HOST'));
      resolve();
    });
  });
}

function hostAllowed(hostname, allowedHosts) {
  return allowedHosts.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
}

async function safeAxiosGet(url, options = {}) {
  const { allowedHosts, ...rest } = options;
  const parsed = new URL(url);

  if (allowedHosts && !hostAllowed(parsed.hostname, allowedHosts)) {
    throw metadataError(`허용되지 않은 호스트: ${parsed.hostname}`, 'TRACK_HOST_NOT_ALLOWED');
  }

  await assertPublicHost(parsed.hostname);

  return axios.get(url, {
    maxContentLength: 2_000_000,
    maxBodyLength: 2_000_000,
    maxRedirects: 5,
    ...rest,
    beforeRedirect: options => {
      if (allowedHosts && !hostAllowed(options.hostname, allowedHosts)) {
        throw metadataError(`허용되지 않은 리다이렉트: ${options.hostname}`, 'TRACK_REDIRECT_NOT_ALLOWED');
      }
    },
  });
}

function detectPlatform(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) return PLATFORM.YOUTUBE;
    if (hostname === 'soundcloud.com' || hostname.endsWith('.soundcloud.com') || hostname === 'soundcloud.app.goo.gl') return PLATFORM.SOUNDCLOUD;
    if (hostname === 'spotify.com' || hostname.endsWith('.spotify.com') || hostname === 'spotify.link') return PLATFORM.SPOTIFY;
  } catch {}
  return null;
}

function extractYoutubeId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') return parsed.pathname.slice(1).split('/')[0] || null;
    if (parsed.hostname === 'youtube.com' || parsed.hostname.endsWith('.youtube.com')) {
      if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/')[2] || null;
      return parsed.searchParams.get('v');
    }
  } catch {}
  return null;
}

function normalizeSoundCloudUrl(url) {
  try {
    const parsed = new URL(url);
    return `https://soundcloud.com${parsed.pathname.replace(/\/$/, '')}`;
  } catch {}
  return null;
}

function normalizeSpotifyUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`;
  } catch {}
  return null;
}

async function getYoutubeMetadata(rawUrl) {
  const videoId = extractYoutubeId(rawUrl);
  if (!videoId) throw metadataError('유효한 YouTube URL이 아닙니다', 'TRACK_INVALID_YOUTUBE_URL');

  try {
    const { data } = await axios.get('https://www.youtube.com/oembed', {
      params: { url: `https://www.youtube.com/watch?v=${videoId}`, format: 'json' },
      timeout: 10000,
    });

    return {
      platform: PLATFORM.YOUTUBE,
      videoId,
      title: data.title,
      channelTitle: data.author_name,
      thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    };
  } catch {
    throw metadataError('영상 정보를 가져올 수 없습니다 (임베드 비활성화 또는 잘못된 URL)', 'TRACK_YOUTUBE_FETCH_FAILED');
  }
}

async function resolveSoundCloudUrl(rawUrl) {
  let trackUrl = normalizeSoundCloudUrl(rawUrl);
  if (!trackUrl) throw metadataError('유효한 SoundCloud URL이 아닙니다', 'TRACK_INVALID_SOUNDCLOUD_URL');

  try {
    const parsed = new URL(rawUrl);
    const isShort = parsed.hostname === 'on.soundcloud.com' || parsed.hostname === 'soundcloud.app.goo.gl';
    if (isShort) {
      const response = await safeAxiosGet(rawUrl, {
        allowedHosts: SOUNDCLOUD_ALLOWED_HOSTS,
        timeout: 8000,
        headers: { 'User-Agent': USER_AGENT },
      });
      const resolved = response.request?.res?.responseUrl || response.request?._redirectable?._currentUrl;
      if (resolved) trackUrl = normalizeSoundCloudUrl(resolved) || trackUrl;
    }
  } catch (error) {
    logError({
      code: 'SOUNDCLOUD_SHORT_URL_FAILED',
      cause: (!error.response?.status || error.response.status >= 500) ? CAUSE.EXTERNAL : CAUSE.USER,
      route: 'GET /tracks/oembed',
      error,
    });
  }

  try {
    const parsed = new URL(trackUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) {
      throw metadataError('SoundCloud 트랙 URL이 아닙니다 (프로필/태그 페이지 등)', 'TRACK_INVALID_SOUNDCLOUD_TRACK');
    }
  } catch (error) {
    if (error.code?.startsWith('TRACK_')) throw error;
    throw metadataError('유효한 SoundCloud URL이 아닙니다', 'TRACK_INVALID_SOUNDCLOUD_URL');
  }

  return trackUrl;
}

async function getSoundCloudMetadata(rawUrl) {
  const trackUrl = await resolveSoundCloudUrl(rawUrl);

  try {
    const { data } = await axios.get('https://soundcloud.com/oembed', {
      params: { url: trackUrl, format: 'json' },
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      timeout: 10000,
    });

    return {
      platform: PLATFORM.SOUNDCLOUD,
      videoId: trackUrl,
      title: data.title,
      channelTitle: data.author_name,
      thumbnail: data.thumbnail_url || null,
    };
  } catch (error) {
    logError({
      code: 'SOUNDCLOUD_OEMBED_FAILED',
      cause: (!error.response?.status || error.response.status >= 500) ? CAUSE.EXTERNAL : CAUSE.USER,
      route: 'GET /tracks/oembed',
      error,
    });
  }

  try {
    const { data: html } = await safeAxiosGet(trackUrl, {
      allowedHosts: ['soundcloud.com'],
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      timeout: 10000,
    });

    const metaContent = (attribute, key) => {
      const forward = new RegExp(`<meta[^>]*${attribute}=["']${key}["'][^>]*content=["']([^"']+)["']`, 'i');
      const reverse = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*${attribute}=["']${key}["']`, 'i');
      return (html.match(forward) || html.match(reverse) || [])[1];
    };

    const ogTitle = metaContent('property', 'og:title') || metaContent('name', 'twitter:title');
    const ogImage = metaContent('property', 'og:image') || metaContent('name', 'twitter:image');
    if (!ogTitle) throw metadataError('트랙 정보를 가져올 수 없습니다 (페이지 형식 변경)', 'TRACK_SOUNDCLOUD_PARSE_FAILED');

    let title = ogTitle
      .replace(/\s*\|\s*Free Listening on SoundCloud\s*$/i, '')
      .replace(/\s*\|\s*SoundCloud\s*$/i, '');
    let artist = 'SoundCloud';
    const byMatch = title.match(/^(.+?)\s+by\s+(.+?)\s*$/i);
    if (byMatch) {
      title = byMatch[1].trim();
      artist = byMatch[2].trim();
    }

    return {
      platform: PLATFORM.SOUNDCLOUD,
      videoId: trackUrl,
      title,
      channelTitle: artist,
      thumbnail: ogImage || null,
    };
  } catch (error) {
    if (error.code?.startsWith('TRACK_')) throw error;
    const status = error.response?.status;
    let message = '트랙 정보를 가져올 수 없습니다';
    if (status === 404) message += ' (트랙이 비공개이거나 삭제됨)';
    else if (status === 403) message += ' (SoundCloud가 서버 IP를 차단)';
    else if (status === 429) message += ' (요청 한도 초과 — 잠시 후 재시도)';
    else if (status) message += ` (SoundCloud ${status})`;
    else message += ' (네트워크 오류)';
    throw metadataError(message, 'TRACK_SOUNDCLOUD_FETCH_FAILED');
  }
}

async function getSpotifyMetadata(rawUrl) {
  const trackUrl = normalizeSpotifyUrl(rawUrl);
  if (!trackUrl) throw metadataError('유효한 Spotify URL이 아닙니다', 'TRACK_INVALID_SPOTIFY_URL');

  try {
    const { data } = await axios.get('https://open.spotify.com/oembed', {
      params: { url: trackUrl },
      timeout: 10000,
    });

    let artist = 'Spotify';
    try {
      const page = await safeAxiosGet(trackUrl, {
        allowedHosts: SPOTIFY_ALLOWED_HOSTS,
        headers: { 'User-Agent': USER_AGENT },
        timeout: 5000,
      });
      const titleMatch = page.data.match(/<title>(.+?)<\/title>/);
      const byMatch = titleMatch?.[1]?.match(/by\s+(.+?)\s*\|\s*Spotify/);
      if (byMatch) artist = byMatch[1].trim();
    } catch {}

    return {
      platform: PLATFORM.SPOTIFY,
      videoId: trackUrl,
      title: data.title,
      channelTitle: artist,
      thumbnail: data.thumbnail_url || null,
    };
  } catch {
    throw metadataError('트랙 정보를 가져올 수 없습니다 (비공개 또는 잘못된 Spotify URL)', 'TRACK_SPOTIFY_FETCH_FAILED');
  }
}

async function getTrackMetadata(rawUrl) {
  const url = String(rawUrl || '').trim();
  const platform = detectPlatform(url);
  if (!platform) {
    throw metadataError('YouTube, SoundCloud, Spotify URL을 입력해주세요', 'TRACK_UNSUPPORTED_PLATFORM');
  }

  if (platform === PLATFORM.YOUTUBE) return getYoutubeMetadata(url);
  if (platform === PLATFORM.SOUNDCLOUD) return getSoundCloudMetadata(url);
  if (platform === PLATFORM.SPOTIFY) return getSpotifyMetadata(url);

  throw metadataError('지원하지 않는 플랫폼입니다', 'TRACK_UNSUPPORTED_PLATFORM');
}

module.exports = {
  detectPlatform,
  getTrackMetadata,
};
