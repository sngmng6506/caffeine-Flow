const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 익스텐션 전용 WebSocket 서버 (/extension 경로)
const wss = new WebSocket.Server({ server, path: '/extension' });

// ── 환경 설정 ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const CAFE_TOKEN = process.env.CAFE_TOKEN || 'cafe-secret-2024';

// ── 상태 ───────────────────────────────────────────────────
let queue = [];
let isSystemOn = true;
let isPlaying = false;
let extensionWs = null;

// ── 미들웨어 ───────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── 토큰 검증 ─────────────────────────────────────────────
function validateToken(req, res, next) {
  const token = req.query.token || req.headers['x-cafe-token'];
  if (token !== CAFE_TOKEN) return res.status(403).json({ error: 'Invalid token' });
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

// ── API: oEmbed (무료, API 키 불필요) ─────────────────────
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
  } catch {
    res.status(400).json({ error: '영상 정보를 가져올 수 없습니다 (임베드 비활성화 or 잘못된 URL)' });
  }
});

// ── API: 큐 조회 ───────────────────────────────────────────
app.get('/api/queue', validateToken, (req, res) => {
  res.json({ queue, isSystemOn, isPlaying, extensionConnected: !!extensionWs });
});

// ── 익스텐션 WebSocket ────────────────────────────────────
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.get('token') !== CAFE_TOKEN) {
    ws.close(1008, 'Invalid token');
    return;
  }

  extensionWs = ws;
  console.log('[익스텐션] 연결됨');
  io.emit('extension_status', { connected: true });

  // 연결 즉시 대기 중인 곡 있으면 재생 시작
  if (queue.length > 0 && !isPlaying) playNext();

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'song_ended') {
        console.log(`[종료] ${queue[0]?.title}`);
        isPlaying = false;
        queue.shift();
        broadcastQueue();
        if (queue.length > 0) playNext();
      }
    } catch {}
  });

  ws.on('close', () => {
    extensionWs = null;
    isPlaying = false;
    console.log('[익스텐션] 연결 해제');
    io.emit('extension_status', { connected: false });
    broadcastQueue();
  });
});

// ── 다음 곡 재생 명령 ─────────────────────────────────────
function playNext() {
  if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) return;
  if (!queue.length) return;

  isPlaying = true;
  extensionWs.send(JSON.stringify({ type: 'play_song', song: queue[0] }));
  console.log(`[재생] ${queue[0].title}`);
  broadcastQueue();
}

function broadcastQueue() {
  io.emit('queue_update', {
    queue,
    isSystemOn,
    isPlaying,
    extensionConnected: !!extensionWs,
  });
}

// ── Socket.io (고객 & 관리자) ──────────────────────────────
io.on('connection', (socket) => {
  socket.emit('queue_update', {
    queue,
    isSystemOn,
    isPlaying,
    extensionConnected: !!extensionWs,
  });

  // 고객: 곡 신청
  socket.on('request_song', ({ token, song }) => {
    if (token !== CAFE_TOKEN || !isSystemOn) return;

    const item = { id: Date.now().toString(), ...song, requestedAt: new Date().toISOString() };
    queue.push(item);
    console.log(`[신청] ${song.title}`);

    // 재생 중이 아니면 즉시 재생
    if (!isPlaying) playNext();
    else broadcastQueue();
  });

  // 관리자: 스킵
  socket.on('admin_skip', ({ token }) => {
    if (token !== CAFE_TOKEN) return;

    if (extensionWs && isPlaying) {
      extensionWs.send(JSON.stringify({ type: 'stop_song' }));
    }
    isPlaying = false;
    const skipped = queue.shift();
    if (skipped) console.log(`[스킵] ${skipped.title}`);

    if (queue.length > 0) playNext();
    else broadcastQueue();
  });

  // 관리자: 특정 곡 삭제
  socket.on('admin_delete', ({ token, id }) => {
    if (token !== CAFE_TOKEN) return;

    // 현재 재생 중인 곡 삭제 시 스킵 처리
    if (queue[0]?.id === id && isPlaying) {
      extensionWs?.send(JSON.stringify({ type: 'stop_song' }));
      isPlaying = false;
      queue.shift();
      if (queue.length > 0) playNext();
      else broadcastQueue();
    } else {
      queue = queue.filter((item) => item.id !== id);
      broadcastQueue();
    }
    console.log(`[삭제] id=${id}`);
  });

  // 관리자: 시스템 ON/OFF
  socket.on('admin_toggle', ({ token }) => {
    if (token !== CAFE_TOKEN) return;
    isSystemOn = !isSystemOn;
    console.log(`[시스템] ${isSystemOn ? 'ON' : 'OFF'}`);
    broadcastQueue();
  });
});

server.listen(PORT, () => {
  console.log(`\n🎵 Caffeine Flow Server running on http://localhost:${PORT}`);
  console.log(`   Token: ${CAFE_TOKEN}`);
  console.log(`   Customer URL: http://localhost:${PORT}/customer.html?token=${CAFE_TOKEN}`);
  console.log(`   Admin URL:    http://localhost:${PORT}/admin.html?token=${CAFE_TOKEN}\n`);
});
