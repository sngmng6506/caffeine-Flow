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

// Routes
app.use('/api/v1/auth',                         require('./src/routes/auth'));
app.use('/api/v1/cafes',                         require('./src/routes/cafes'));
app.use('/api/v1/cafes/:slug/recommendations',   require('./src/routes/recommendations'));
app.use('/api/v1/youtube',                       require('./src/routes/youtube'));

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', version: 'v2' }));

// 전역 에러 핸들러
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다' });
});

initSocket(io);

server.listen(PORT, () => {
  console.log(`Caffeine Flow v2 on http://localhost:${PORT}`);
});
