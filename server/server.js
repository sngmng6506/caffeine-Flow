require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express   = require('express');
require('express-async-errors');
const http      = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');

const { PORT } = require('./src/config');
const initSocket = require('./src/socket');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// io를 라우트에서 참조할 수 있도록 등록
app.set('io', io);

app.use(express.json());
app.use(rateLimit({ windowMs: 60_000, max: 120 })); // 전체 API 분당 120회

// 손님 앱 정적 파일 서빙
const staticPath = require('path').join(__dirname, 'public');
app.use(express.static(staticPath));

// Routes
app.use('/api/v1/auth',                         require('./src/routes/auth'));
app.use('/api/v1/cafes',                         require('./src/routes/cafes'));
app.use('/api/v1/cafes/:slug/recommendations',   require('./src/routes/recommendations'));
app.use('/api/v1/youtube',                       require('./src/routes/youtube'));
app.use('/api/v1/tracks',                        require('./src/routes/tracks'));
app.use('/api/v1/cafes/:slug/songs/:videoId/comments', require('./src/routes/song_comments'));
app.use('/api/v1/songs/:videoId/comments',             require('./src/routes/song_comments'));

// GET /api/v1/top10  (전체 카페 통합 TOP10, 인증 불필요)
app.get('/api/v1/top10', async (req, res) => {
  const offset = parseInt(req.query.offset) || 0;
  res.json(await require('./src/services/stats.service').getGlobalTop10(offset));
});

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', version: 'v2' }));

// SPA fallback — API 아닌 모든 경로에서 index.html 반환
app.get('*', (_req, res) => {
  res.sendFile(require('path').join(staticPath, 'index.html'));
});

// 전역 에러 핸들러
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다' });
});

initSocket(io);

server.listen(PORT, async () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let localIp = 'localhost';
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) { localIp = net.address; break; }
    }
  }

  app.set('baseUrl', `http://${localIp}:${PORT}`);
  console.log(`\nCaffeine Flow v2 on http://${localIp}:${PORT}\n`);

  try {
    const qrcode = require('qrcode');
    const db     = require('./src/db/knex');
    const cafes  = await db('cafes').select('name', 'slug');

    if (cafes.length === 0) {
      console.log('등록된 카페가 없습니다.\n');
    } else {
      for (const cafe of cafes) {
        const url = `http://${localIp}:${PORT}/${cafe.slug}`;
        console.log(`[ ${cafe.name} ]  ${url}`);
        const qr = await qrcode.toString(url, { type: 'terminal', small: true });
        console.log(qr);
      }
    }
  } catch {}
});
