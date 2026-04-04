const router = require('express').Router();
const axios  = require('axios');
const { YOUTUBE_API_KEY } = require('../config');

function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
  } catch {}
  return null;
}

function formatDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '';
  const h   = m[1] ? `${m[1]}:` : '';
  const min = (m[2] || '0').padStart(h ? 2 : 1, '0');
  const sec = (m[3] || '0').padStart(2, '0');
  return `${h}${min}:${sec}`;
}

// GET /api/v1/youtube/oembed?url=...
router.get('/oembed', async (req, res) => {
  const videoId = extractVideoId(req.query.url || '');
  if (!videoId) return res.status(400).json({ error: '유효한 YouTube URL이 아닙니다' });

  try {
    const { data } = await axios.get('https://www.youtube.com/oembed', {
      params: { url: `https://www.youtube.com/watch?v=${videoId}`, format: 'json' },
    });

    if (YOUTUBE_API_KEY) {
      const { data: vData } = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: { part: 'contentDetails', id: videoId, key: YOUTUBE_API_KEY },
      });
      const dur = vData.items?.[0]?.contentDetails?.duration;
      if (!dur || dur === 'P0D')
        return res.status(400).json({ error: '라이브 영상은 신청할 수 없습니다' });
    }

    res.json({
      videoId,
      title:        data.title,
      channelTitle: data.author_name,
      thumbnail:    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    });
  } catch {
    res.status(400).json({ error: '영상 정보를 가져올 수 없습니다 (임베드 비활성화 or 잘못된 URL)' });
  }
});

// GET /api/v1/youtube/search?q=...
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '검색어를 입력하세요' });
  if (!YOUTUBE_API_KEY) return res.status(500).json({ error: 'YOUTUBE_API_KEY가 설정되지 않았습니다' });

  try {
    const { data } = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: { part: 'snippet', q, type: 'video', maxResults: 20, key: YOUTUBE_API_KEY,
        ...(req.query.pageToken ? { pageToken: req.query.pageToken } : {}) },
    });

    const videoIds = data.items.map(i => i.id.videoId).join(',');
    const { data: details } = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: { part: 'contentDetails,statistics', id: videoIds, key: YOUTUBE_API_KEY },
    });

    const detailMap = Object.fromEntries(details.items.map(v => [v.id, v]));

    res.json({
      nextPageToken: data.nextPageToken || null,
      items: data.items
        .filter(item => {
          const d = detailMap[item.id.videoId];
          return d && d.contentDetails.duration !== 'P0D';
        })
        .map(item => {
          const d = detailMap[item.id.videoId];
          return {
            videoId:      item.id.videoId,
            title:        item.snippet.title,
            channelTitle: item.snippet.channelTitle,
            thumbnail:    item.snippet.thumbnails?.medium?.url || `https://img.youtube.com/vi/${item.id.videoId}/mqdefault.jpg`,
            duration:     formatDuration(d.contentDetails.duration),
            views:        parseInt(d.statistics.viewCount || '0', 10),
          };
        }),
    });
  } catch (err) {
    const msg = err.response?.data?.error?.message || '검색에 실패했습니다';
    res.status(500).json({ error: msg });
  }
});

module.exports = router;
