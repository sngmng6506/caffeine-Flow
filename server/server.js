const path      = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express   = require('express');
require('express-async-errors');
const http      = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const { networkInterfaces } = require('os');

const { PORT, APP_URL } = require('./src/config');
const initSocket = require('./src/socket');
const statsService = require('./src/services/stats.service');

const app    = express();
const server = http.createServer(app);

// 허용 origin: APP_URL + 개발용 localhost. 빈 origin(파일·앱 내장 브라우저)도 허용 —
// Electron BrowserView·일부 모바일 WebView가 빈 origin으로 옴.
function buildAllowedOrigins() {
  const set = new Set();
  if (APP_URL) {
    set.add(APP_URL.replace(/\/$/, ''));
  }
  // 개발 편의: Vite 기본 포트들 허용
  set.add('http://localhost:5173');
  set.add('http://localhost:5174');
  return set;
}
const ALLOWED_ORIGINS = buildAllowedOrigins();

function corsOriginCheck(origin, cb) {
  if (!origin) return cb(null, true);
  if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
  cb(new Error(`Origin not allowed: ${origin}`));
}

const io = new Server(server, {
  cors: { origin: corsOriginCheck, credentials: false },
});

// io를 라우트에서 참조할 수 있도록 등록
app.set('io', io);

app.set('trust proxy', 1); // Railway 등 리버스 프록시 뒤에서 실제 IP 인식
// 보안 헤더 — CSP는 inline script가 많은 SPA·SoundCloud iframe 호환 위해 미설정. 그 외 표준 헤더만.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cookieParser());
app.use(express.json({ limit: '64kb' })); // body 크기 상한 — DoS 방어
app.use(rateLimit({ windowMs: 60_000, max: 120 })); // 전체 API 분당 120회

// 손님 앱 정적 파일 서빙
const staticPath = path.join(__dirname, 'public');
app.use(express.static(staticPath));

// Routes
app.use('/api/v1/auth',                         require('./src/routes/auth'));
app.use('/api/v1/cafes',                         require('./src/routes/cafes'));
// Owner-only recommendation routes must be mounted before the public
// router so authenticated handlers (/owner, PUT /:id, DELETE /:id) win
// the path match before public routes get a chance.
app.use('/api/v1/cafes/:slug/recommendations',   require('./src/routes/recommendations.owner'));
app.use('/api/v1/cafes/:slug/recommendations',   require('./src/routes/recommendations'));
app.use('/api/v1/tracks',                        require('./src/routes/tracks'));
app.use('/api/v1/cafes/:slug/songs/:videoId/comments', require('./src/routes/song_comments'));
app.use('/api/v1/songs/:videoId/comments',             require('./src/routes/song_comments'));

// GET /api/v1/top10  (전체 카페 통합 TOP10, 인증 불필요)
app.get('/api/v1/top10', async (req, res) => {
  const offset = parseInt(req.query.offset) || 0;
  res.json(await statsService.getGlobalTop10(offset));
});

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', version: 'v2' }));

// Owner SPA fallback
app.get('/owner/*', (_req, res) => {
  res.sendFile(path.join(staticPath, 'owner/index.html'));
});
app.get('/owner', (_req, res) => res.redirect('/owner/'));

// Customer SPA fallback — API 아닌 모든 경로에서 index.html 반환
app.get('*', (_req, res) => {
  res.sendFile(path.join(staticPath, 'index.html'));
});

// 전역 에러 핸들러
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다' });
});

initSocket(io);

server.listen(PORT, async () => {
  const nets = networkInterfaces();
  let localIp = 'localhost';
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) { localIp = net.address; break; }
    }
  }

  app.set('baseUrl', `http://${localIp}:${PORT}`);
  console.log(`\nCaffeine Flow v2 on http://${localIp}:${PORT}\n`);
});
