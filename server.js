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

// ── YouTube URL에서 videoId 추출 ──────────────────────────
function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
  } catch {}
  return null;
}

// ── API: oEmbed로 YouTube 영상 정보 조회 (무료, API 키 불필요) ──
app.get('/api/oembed', validateToken, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: '유효한 YouTube URL이 아닙니다' });

  try {
    const response = await axios.get('https://www.youtube.com/oembed', {
      params: { url: `https://www.youtube.com/watch?v=${videoId}`, format: 'json' },
    });

    res.json({
      videoId,
      title: response.data.title,
      channelTitle: response.data.author_name,
      thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    });
  } catch (err) {
    res.status(400).json({ error: '영상 정보를 가져올 수 없습니다 (임베드 비활성화 or 잘못된 URL)' });
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
