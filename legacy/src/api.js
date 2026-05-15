const express   = require('express');
const axios      = require('axios');
const rateLimit  = require('express-rate-limit');
const { CAFE_TOKEN, YOUTUBE_API_KEY } = require('./config');
const state      = require('./state');
const { getHistory, getStats, getStatsByDate } = require('./history');

const router = express.Router();

// IP당 1분에 60요청 제한 (검색 + oEmbed + 큐 확인 등)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});

router.use(limiter);

function validateToken(req, res, next) {
  const token = req.query.token || req.headers['x-cafe-token'];
  if (token !== CAFE_TOKEN) return res.status(403).json({ error: 'Invalid token' });
  next();
}

function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
  } catch {}
  return null;
}

// YouTube oEmbed (무료, API 키 불필요)
router.get('/oembed', validateToken, async (req, res) => {
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
      if (!dur || dur === 'P0D') {
        return res.status(400).json({ error: '라이브 영상은 신청할 수 없습니다' });
      }
    }

    res.json({
      videoId,
      title:        data.title,
      channelTitle: data.author_name,
      thumbnail:    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    });
  } catch (err) {
    if (err.response?.status === 400) throw err;
    res.status(400).json({ error: '영상 정보를 가져올 수 없습니다 (임베드 비활성화 or 잘못된 URL)' });
  }
});

// YouTube 검색 (YouTube Data API v3)
router.get('/search', validateToken, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '검색어를 입력하세요' });
  if (!YOUTUBE_API_KEY) return res.status(500).json({ error: 'YOUTUBE_API_KEY가 설정되지 않았습니다' });

  const pageToken = req.query.pageToken || undefined;

  try {
    const { data } = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q,
        type: 'video',
        maxResults: 20,
        key: YOUTUBE_API_KEY,
        ...(pageToken ? { pageToken } : {}),
      },
    });

    const videoIds = data.items.map((item) => item.id.videoId).join(',');

    const { data: details } = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part: 'contentDetails,statistics',
        id: videoIds,
        key: YOUTUBE_API_KEY,
      },
    });

    const detailMap = {};
    for (const v of details.items) {
      detailMap[v.id] = v;
    }

    res.json({
      nextPageToken: data.nextPageToken || null,
      items: data.items
        .filter((item) => {
          const detail = detailMap[item.id.videoId];
          if (!detail) return false;
          const dur = detail.contentDetails.duration;
          return dur && dur !== 'P0D';
        })
        .map((item) => {
          const detail = detailMap[item.id.videoId];
          return {
            videoId:      item.id.videoId,
            title:        item.snippet.title,
            channelTitle: item.snippet.channelTitle,
            thumbnail:    item.snippet.thumbnails?.medium?.url || `https://img.youtube.com/vi/${item.id.videoId}/mqdefault.jpg`,
            duration:     formatDuration(detail.contentDetails.duration),
            views:        parseInt(detail.statistics.viewCount || '0', 10),
          };
        }),
    });
  } catch (err) {
    console.error('[search]', err.message);
    const msg = err.response?.data?.error?.message || '검색에 실패했습니다';
    res.status(500).json({ error: msg });
  }
});

function formatDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '';
  const h = m[1] ? `${m[1]}:` : '';
  const min = (m[2] || '0').padStart(h ? 2 : 1, '0');
  const sec = (m[3] || '0').padStart(2, '0');
  return `${h}${min}:${sec}`;
}

// 현재 큐 상태
router.get('/queue', validateToken, (req, res) => {
  res.json({
    queue:      state.queue,
    isSystemOn: state.isSystemOn,
    isPlaying:  state.isPlaying,
  });
});

// 신청 이력 (최근 N개)
router.get('/history', validateToken, (req, res) => {
  res.json(getHistory(parseInt(req.query.limit) || 50));
});

// 통계
router.get('/stats', validateToken, (req, res) => {
  res.json(getStats());
});

// 날짜별 통계 (시간대 + 곡 목록)
router.get('/stats/date', validateToken, (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  res.json(getStatsByDate(date));
});

module.exports = router;
