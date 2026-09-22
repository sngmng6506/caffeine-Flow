const axios = require('axios');
const dns = require('dns');
const net = require('net');
const { PLATFORM } = require('../constants/platforms');

const PRIVATE_IPV4_RE = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|0\.|255\.)/;
const YOUTUBE_ALLOWED_HOSTS = ['youtube.com', 'youtu.be'];
const SOUNDCLOUD_ALLOWED_HOSTS = ['soundcloud.com', 'on.soundcloud.com', 'soundcloud.app.goo.gl', 'goo.gl'];
const SPOTIFY_ALLOWED_HOSTS = ['open.spotify.com', 'spotify.com', 'spotify.link'];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// extra로 upstream 표식을 실어 보낸다. 손님 입력 탓과 플랫폼 장애를
// 구분하는 근거이며, 판단은 observability/error-taxonomy가 한다.
// 서버 IP 차단(403)·한도 초과(429)·서버 오류(5xx)·무응답은 우리가 알아야 할
// 신호다. 나머지 4xx는 손님이 고른 곡의 속성이라 알리지 않는다.
function isUpstreamTrackFailure(status) {
  return !status || status >= 500 || status === 403 || status === 429;
}

function metadataError(message, code = 'TRACK_METADATA_ERROR', extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return Object.assign(error, extra);
}

function isPrivateAddress(address) {
  if (!address) return true;
  if (net.isIPv6(address)) return true;
  return PRIVATE_IPV4_RE.test(address);
}

async function assertPublicHost(host) {
  return new Promise((resolve, reject) => {
    dns.lookup(host, { all: true }, (err, addresses) => {
      if (err) return reject(metadataError(`DNS 해석 실패: ${host}`, 'TRACK_DNS_FAILED', { upstream: true }));
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

// og 메타 태그 하나를 읽는다. 속성 순서가 뒤집힌 마크업도 받는다.
function metaContent(html, attribute, key) {
  const forward = new RegExp(`<meta[^>]*${attribute}=["']${key}["'][^>]*content=["']([^"']+)["']`, 'i');
  const reverse = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*${attribute}=["']${key}["']`, 'i');
  return (html.match(forward) || html.match(reverse) || [])[1];
}

// og 태그와 페이지 JSON은 각각 HTML 엔티티와 \uXXXX로 이스케이프돼 있다. 풀지
// 않으면 손님 화면에 "Tom &amp; Jerry"가 그대로 보인다.
const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
function decodeText(value) {
  if (!value) return value;
  let text = value;
  try {
    text = JSON.parse(`"${text.replace(/"/g, '\\"')}"`);
  } catch {
    // \uXXXX가 없으면 원문 그대로 쓴다
  }
  return text.replace(/&(#\d+|[a-z]+);/gi, (match, name) => {
    if (name[0] === '#') return String.fromCharCode(Number(name.slice(1)));
    return HTML_ENTITIES[name.toLowerCase()] ?? match;
  });
}

function detectPlatform(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) return PLATFORM.YOUTUBE;
    if (hostname === 'soundcloud.com' || hostname.endsWith('.soundcloud.com') || hostname === 'soundcloud.app.goo.gl') return PLATFORM.SOUNDCLOUD;
    if (hostname === 'spotify.com' || hostname.endsWith('.spotify.com') || hostname === 'spotify.link') return PLATFORM.SPOTIFY;
  } catch {
    // URL 형식이 아니면 지원 플랫폼이 아닌 것으로 본다
  }
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
  } catch {
    // 파싱 실패는 videoId 없음으로 처리한다
  }
  return null;
}

function normalizeSoundCloudUrl(url) {
  try {
    const parsed = new URL(url);
    return `https://soundcloud.com${parsed.pathname.replace(/\/$/, '')}`;
  } catch {
    // 정규화할 수 없는 입력은 호출부가 null로 판단한다
  }
  return null;
}

function normalizeSpotifyUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`;
  } catch {
    // 정규화할 수 없는 입력은 호출부가 null로 판단한다
  }
  return null;
}

// 퍼가기(embed)가 꺼진 영상은 YouTube oEmbed가 401을 낸다. 하지만 우리는 임베드로
// 틀지 않는다 — Electron이 youtube.com 워치 페이지를 그대로 연다
// (owner/electron/navigation-policy.js). 그래서 oEmbed가 거절한 영상도 실제로는
// 재생된다. 제목·채널만 워치 페이지에서 읽어 신청을 살린다. SoundCloud가 쓰는
// 경로와 같다.
//
// 검증 한계: 이 fallback이 실제 YouTube 응답에서 도는지는 확인하지 못했다
// (개발 환경에서 youtube.com 접근이 막혀 있다). 실패하면 oEmbed만 쓰던 이전과
// 동작이 같다 — 거절이다.
async function getYoutubeMetadataFromPage(videoId) {
  const { data: html } = await safeAxiosGet(`https://www.youtube.com/watch?v=${videoId}`, {
    allowedHosts: YOUTUBE_ALLOWED_HOSTS,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    timeout: 10000,
  });

  const title = metaContent(html, 'property', 'og:title') || metaContent(html, 'name', 'title');
  if (!title) {
    throw metadataError('영상 정보를 가져올 수 없습니다 (페이지 형식 변경)', 'TRACK_YOUTUBE_PARSE_FAILED', { upstream: true });
  }

  const channel = (html.match(/"ownerChannelName":"([^"]+)"/)
    || html.match(/<link[^>]+itemprop=["']name["'][^>]+content=["']([^"']+)["']/)
    || [])[1];

  return {
    platform: PLATFORM.YOUTUBE,
    videoId,
    title: decodeText(title),
    // 채널명을 못 읽어도 제목이 있으면 신청을 막지 않는다.
    channelTitle: decodeText(channel) || 'YouTube',
    thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
  };
}

// oEmbed 404는 없는 영상·비공개라 손님이 링크를 고쳐야 한다. 나머지는 퍼가기
// 설정이나 일시적 오류라 다시 시도할 여지가 있다. 내부 코드와 프롬프트는 싣지
// 않는다(Public Response Boundary).
function youtubeFailureMessage(oembedStatus) {
  if (oembedStatus === 404) return '영상 정보를 가져올 수 없습니다 (없는 영상이거나 비공개)';
  return '영상 정보를 가져올 수 없습니다 (잠시 후 다시 시도해 주세요)';
}

async function getYoutubeMetadata(rawUrl) {
  const videoId = extractYoutubeId(rawUrl);
  if (!videoId) throw metadataError('유효한 YouTube URL이 아닙니다', 'TRACK_INVALID_YOUTUBE_URL');

  let oembedStatus;
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
  } catch (error) {
    oembedStatus = error.response?.status;
  }

  try {
    return await getYoutubeMetadataFromPage(videoId);
  } catch (error) {
    if (error.code?.startsWith('TRACK_')) throw error;
    // 두 경로 중 하나라도 서버 IP 차단·한도 초과·5xx를 가리키면 우리가 알아야 할
    // 신호다. 없는 영상(404)처럼 양쪽이 손님 입력을 가리킬 때만 알리지 않는다.
    const pageStatus = error.response?.status;
    throw metadataError(
      youtubeFailureMessage(oembedStatus),
      'TRACK_YOUTUBE_FETCH_FAILED',
      {
        upstream: isUpstreamTrackFailure(oembedStatus) || isUpstreamTrackFailure(pageStatus),
        upstreamStatus: pageStatus ?? oembedStatus ?? null,
      },
    );
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
  } catch {
    // 단축 URL 해석에 실패해도 원본 URL로 계속 진행한다. 성공 경로가 남아
    // 있는 중간 실패라 여기서 알리면 정상 처리된 요청이 장애로 보고된다.
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
  } catch {
    // oEmbed가 실패하면 아래 HTML 파싱으로 넘어간다. 최종 실패만 라우트에서
    // 한 번 보고하므로 여기서는 알리지 않는다.
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

    const ogTitle = metaContent(html, 'property', 'og:title') || metaContent(html, 'name', 'twitter:title');
    const ogImage = metaContent(html, 'property', 'og:image') || metaContent(html, 'name', 'twitter:image');
    if (!ogTitle) throw metadataError('트랙 정보를 가져올 수 없습니다 (페이지 형식 변경)', 'TRACK_SOUNDCLOUD_PARSE_FAILED', { upstream: true });

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
      title: decodeText(title),
      channelTitle: decodeText(artist),
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
    // 404·410은 비공개·삭제된 곡이라 손님이 고를 수 있는 정상 범위다.
    // 403(서버 IP 차단)·429·5xx·네트워크 오류는 우리가 알아야 할 신호다.
    throw metadataError(message, 'TRACK_SOUNDCLOUD_FETCH_FAILED', {
      upstream: !(status === 404 || status === 410),
      upstreamStatus: status ?? null,
    });
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
    } catch {
      // 아티스트 추출은 부가 정보라 실패해도 트랙 정보는 그대로 반환한다
    }

    return {
      platform: PLATFORM.SPOTIFY,
      videoId: trackUrl,
      title: data.title,
      channelTitle: artist,
      thumbnail: data.thumbnail_url || null,
    };
  } catch (error) {
    // 401·404는 비공개·삭제된 트랙이고, 403·429는 서버 IP 차단·한도 초과다.
    const status = error.response?.status;
    throw metadataError(
      '트랙 정보를 가져올 수 없습니다 (비공개 또는 잘못된 Spotify URL)',
      'TRACK_SPOTIFY_FETCH_FAILED',
      { upstream: isUpstreamTrackFailure(status), upstreamStatus: status ?? null },
    );
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
