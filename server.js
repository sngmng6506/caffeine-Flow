const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ── 환경 설정 ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const CAFE_TOKEN = process.env.CAFE_TOKEN || 'cafe-secret-2024';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'YOUR_YOUTUBE_API_KEY';

// ── 상태 ───────────────────────────────────────────────────
let queue = [];       // { id, title, thumbnail, channelTitle, videoId, requestedAt }
let isSystemOn = true;

// ── 미들웨어 ───────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── 토큰 검증 미들웨어 ────────────────────────────────────
function validateToken(req, res, next) {
  const token = req.query.token || req.headers['x-cafe-token'];
  if (token !== CAFE_TOKEN) {
    return res.status(403).json({ error: 'Invalid token' });
  }
  next();
}

// ── API: YouTube 검색 (서버가 프록시 역할 → API 키 노출 방지) ──
app.get('/api/search', validateToken, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        key: YOUTUBE_API_KEY,
        q,
        part: 'snippet',
        type: 'video',
        maxResults: 8,
        videoCategoryId: '10', // Music
      },
    });

    const results = response.data.items.map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium.url,
    }));

    res.json(results);
  } catch (err) {
    console.error('YouTube API error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ── API: 현재 큐 조회 ──────────────────────────────────────
app.get('/api/queue', validateToken, (req, res) => {
  res.json({ queue, isSystemOn });
});

// ── Socket.io ──────────────────────────────────────────────
io.on('connection', (socket) => {
  // 연결 즉시 현재 상태 전송
  socket.emit('queue_update', { queue, isSystemOn });

  // 고객: 곡 신청
  socket.on('request_song', ({ token, song }) => {
    if (token !== CAFE_TOKEN) return;
    if (!isSystemOn) return;

    const item = {
      id: Date.now().toString(),
      ...song,
      requestedAt: new Date().toISOString(),
    };

    queue.push(item);
    io.emit('queue_update', { queue, isSystemOn });
    console.log(`[요청] ${song.title}`);
  });

  // 관리자: 큐 앞 항목 제거 (재생 완료 or 스킵)
  socket.on('admin_skip', ({ token }) => {
    if (token !== CAFE_TOKEN) return;
    const skipped = queue.shift();
    io.emit('queue_update', { queue, isSystemOn });
    if (skipped) console.log(`[스킵] ${skipped.title}`);
  });

  // 관리자: 특정 항목 삭제
  socket.on('admin_delete', ({ token, id }) => {
    if (token !== CAFE_TOKEN) return;
    queue = queue.filter((item) => item.id !== id);
    io.emit('queue_update', { queue, isSystemOn });
    console.log(`[삭제] id=${id}`);
  });

  // 관리자: 시스템 ON/OFF
  socket.on('admin_toggle', ({ token }) => {
    if (token !== CAFE_TOKEN) return;
    isSystemOn = !isSystemOn;
    io.emit('queue_update', { queue, isSystemOn });
    console.log(`[시스템] ${isSystemOn ? 'ON' : 'OFF'}`);
  });
});

server.listen(PORT, () => {
  console.log(`\n🎵 Cafe Music Server running on http://localhost:${PORT}`);
  console.log(`   Token: ${CAFE_TOKEN}`);
  console.log(`   Customer QR URL: http://localhost:${PORT}/customer.html?token=${CAFE_TOKEN}`);
  console.log(`   Admin URL:       http://localhost:${PORT}/admin.html?token=${CAFE_TOKEN}\n`);
});
