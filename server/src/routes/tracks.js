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
    const trackUrl = normalizeSoundCloudUrl(rawUrl);
    if (!trackUrl) return res.status(400).json({ error: '유효한 SoundCloud URL이 아닙니다' });
    try {
      const { data } = await axios.get('https://soundcloud.com/oembed', {
        params: { url: trackUrl, format: 'json' },
      });
      return res.json({
        platform,
        videoId:      trackUrl,           // SoundCloud는 track URL을 ID로 사용
        title:        data.title,
        channelTitle: data.author_name,
        thumbnail:    data.thumbnail_url || null,
      });
    } catch {
      return res.status(400).json({ error: '트랙 정보를 가져올 수 없습니다 (비공개 또는 잘못된 URL)' });
    }
  }

  if (platform === 'spotify') {
    try {
      const { data } = await axios.get('https://open.spotify.com/oembed', {
        params: { url: rawUrl },
      });
      return res.json({
        platform,
        videoId:      rawUrl,
        title:        data.title,
        channelTitle: data.provider_name || 'Spotify',
        thumbnail:    data.thumbnail_url || null,
      });
    } catch {
      return res.status(400).json({ error: '트랙 정보를 가져올 수 없습니다 (비공개 또는 잘못된 Spotify URL)' });
    }
  }
});

module.exports = router;
