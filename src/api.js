const express = require('express');
const axios   = require('axios');
const { CAFE_TOKEN } = require('./config');
const state   = require('./state');
const { getHistory, getStats } = require('./history');

const router = express.Router();

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

// 현재 큐 상태
router.get('/queue', validateToken, (req, res) => {
  res.json({
    queue:             state.queue,
    isSystemOn:        state.isSystemOn,
    isPlaying:         state.isPlaying,
    extensionConnected: !!state.extensionWs,
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

module.exports = router;
