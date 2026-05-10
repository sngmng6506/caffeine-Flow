const router = require('express').Router();
const axios  = require('axios');

function detectPlatform(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be' || u.hostname.includes('youtube.com')) return 'youtube';
    if (u.hostname.includes('soundcloud.com')) return 'soundcloud';
    if (u.hostname.includes('spotify.com') || u.hostname === 'spotify.link') return 'spotify';
  } catch {}
  return null;
}

function extractYoutubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
  } catch {}
  return null;
}

function normalizeSoundCloudUrl(url) {
  try {
    const u = new URL(url);
    return `https://soundcloud.com${u.pathname.replace(/\/$/, '')}`;
  } catch {}
  return null;
}

// 쿼리스트링/fragment 제거 — 같은 트랙이 ?si=xxx 같은 추적 파라미터로 다른 ID로 저장되는 문제 방지
function normalizeSpotifyUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
  } catch {}
  return url;
}

// GET /api/v1/tracks/oembed?url=...
// YouTube / SoundCloud 통합 메타데이터 조회 (재생 아님)
router.get('/oembed', async (req, res) => {
  const rawUrl  = (req.query.url || '').trim();
  const platform = detectPlatform(rawUrl);

  if (!platform) {
    return res.status(400).json({ error: 'YouTube, SoundCloud, Spotify URL을 입력해주세요' });
  }

  if (platform === 'youtube') {
    const videoId = extractYoutubeId(rawUrl);
    if (!videoId) return res.status(400).json({ error: '유효한 YouTube URL이 아닙니다' });
    try {
      const { data } = await axios.get('https://www.youtube.com/oembed', {
        params: { url: `https://www.youtube.com/watch?v=${videoId}`, format: 'json' },
      });
      return res.json({
        platform,
        videoId,
        title:        data.title,
        channelTitle: data.author_name,
        thumbnail:    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      });
    } catch {
      return res.status(400).json({ error: '영상 정보를 가져올 수 없습니다 (임베드 비활성화 또는 잘못된 URL)' });
    }
  }

  if (platform === 'soundcloud') {
    let trackUrl = normalizeSoundCloudUrl(rawUrl);
    if (!trackUrl) return res.status(400).json({ error: '유효한 SoundCloud URL이 아닙니다' });

    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

    // on.soundcloud.com / soundcloud.app.goo.gl 단축 URL → GET으로 리다이렉트 추적
    try {
      const u = new URL(rawUrl);
      const isShort = u.hostname === 'on.soundcloud.com' || u.hostname.endsWith('soundcloud.app.goo.gl');
      if (isShort) {
        const resp = await axios.get(rawUrl, {
          maxRedirects: 5,
          timeout: 8000,
          headers: { 'User-Agent': UA },
        });
        const resolved = resp.request?.res?.responseUrl || resp.request?._redirectable?._currentUrl;
        if (resolved) trackUrl = normalizeSoundCloudUrl(resolved) || trackUrl;
      }
    } catch (e) {
      console.error('[oembed soundcloud] short URL resolve failed:', e.message);
    }

    // 트랙 URL인지 검증 (프로필/태그 URL 거르기)
    try {
      const tu = new URL(trackUrl);
      const parts = tu.pathname.split('/').filter(Boolean);
      // 트랙: /user/track-slug, 셋: /user/sets/set-slug
      if (parts.length < 2) {
        return res.status(400).json({ error: 'SoundCloud 트랙 URL이 아닙니다 (프로필/태그 페이지 등)' });
      }
    } catch {}

    // 1차: oembed API (빠르고 깨끗함)
    try {
      const { data } = await axios.get('https://soundcloud.com/oembed', {
        params: { url: trackUrl, format: 'json' },
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        timeout: 10000,
      });
      return res.json({
        platform,
        videoId:      trackUrl,
        title:        data.title,
        channelTitle: data.author_name,
        thumbnail:    data.thumbnail_url || null,
      });
    } catch (e) {
      console.error('[oembed soundcloud] failed:', e.response?.status, e.message, '— falling back to page scrape');
    }

    // 2차: 트랙 페이지 HTML의 Open Graph / Twitter 메타태그 파싱
    // (oembed는 Railway IP 차단 가능 — 공개 페이지는 더 관대함)
    try {
      const { data: html } = await axios.get(trackUrl, {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        timeout: 10000,
      });
      const matchAttr = (re) => (html.match(re) || [])[1];
      const ogTitle = matchAttr(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)
        || matchAttr(/<meta\s+name=["']twitter:title["']\s+content=["']([^"']+)["']/i);
      const ogImage = matchAttr(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
        || matchAttr(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);

      if (!ogTitle) {
        return res.status(400).json({ error: '트랙 정보를 가져올 수 없습니다 (페이지 형식 변경)' });
      }

      // SoundCloud의 og:title은 보통 "Track Name by Artist" 또는 "Track Name | SoundCloud"
      let title  = ogTitle.replace(/\s*\|\s*Free Listening on SoundCloud\s*$/i, '').replace(/\s*\|\s*SoundCloud\s*$/i, '');
      let artist = 'SoundCloud';
      const byMatch = title.match(/^(.+?)\s+by\s+(.+?)\s*$/i);
      if (byMatch) {
        title  = byMatch[1].trim();
        artist = byMatch[2].trim();
      }

      return res.json({
        platform,
        videoId:      trackUrl,
        title,
        channelTitle: artist,
        thumbnail:    ogImage || null,
      });
    } catch (e) {
      const status = e.response?.status;
      console.error('[scrape soundcloud] failed:', trackUrl, '| status:', status, '| msg:', e.message);
      let msg = '트랙 정보를 가져올 수 없습니다';
      if (status === 404) msg += ' (트랙이 비공개이거나 삭제됨)';
      else if (status === 403) msg += ' (SoundCloud가 서버 IP를 차단)';
      else if (status === 429) msg += ' (요청 한도 초과 — 잠시 후 재시도)';
      else if (status)         msg += ` (SoundCloud ${status})`;
      else                     msg += ' (네트워크 오류)';
      return res.status(400).json({ error: msg });
    }
  }

  if (platform === 'spotify') {
    const trackUrl = normalizeSpotifyUrl(rawUrl);
    try {
      const { data } = await axios.get('https://open.spotify.com/oembed', {
        params: { url: trackUrl },
      });
      // oEmbed에 아티스트명이 없으므로 트랙 페이지 <title>에서 추출
      let artist = 'Spotify';
      try {
        const page = await axios.get(trackUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          maxRedirects: 5,
          timeout: 5000,
        });
        const m = page.data.match(/<title>(.+?)<\/title>/);
        if (m) {
          // 패턴: "곡명 - song and lyrics by 아티스트 | Spotify"
          const byMatch = m[1].match(/by\s+(.+?)\s*\|\s*Spotify/);
          if (byMatch) artist = byMatch[1].trim();
        }
      } catch {}
      return res.json({
        platform,
        videoId:      trackUrl,
        title:        data.title,
        channelTitle: artist,
        thumbnail:    data.thumbnail_url || null,
      });
    } catch {
      return res.status(400).json({ error: '트랙 정보를 가져올 수 없습니다 (비공개 또는 잘못된 Spotify URL)' });
    }
  }
});

module.exports = router;
