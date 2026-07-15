const path      = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express   = require('express');
require('express-async-errors');
const rateLimit = require('express-rate-limit');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');

const { APP_URL } = require('./src/config');
const statsService = require('./src/services/stats.service');
const { GLOBAL_API_RATE_LIMIT } = require('./src/constants/limits');

// app 생성을 server.js(리슨·소켓)와 분리 — supertest가 포트 없이
// app만 import해 통합 테스트를 돌릴 수 있게 한다.
const app = express();

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

app.set('trust proxy', 1); // Railway 등 리버스 프록시 뒤에서 실제 IP 인식
// 보안 헤더 — CSP는 inline script가 많은 SPA·SoundCloud iframe 호환 위해 미설정. 그 외 표준 헤더만.
// COOP는 helmet 기본값(same-origin)이면 Google 로그인 팝업의 opener가 끊겨
// credential postMessage 전달이 실패한다(팝업 흰 화면). GIS 공식 권고값인
// same-origin-allow-popups로 설정 — 우리가 연 팝업과의 연결만 허용.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));
app.use(cookieParser());
app.use(express.json({ limit: '64kb' })); // body 크기 상한 — DoS 방어
app.use(rateLimit(GLOBAL_API_RATE_LIMIT)); // 전체 API 분당 120회

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

// 운영자 콘솔 API — 사장님 JWT와 분리된 인증 경계(requireAdmin)를 쓴다.
app.use('/api/v1/admin',                         require('./src/routes/admin'));

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

// 운영자 콘솔 — 반드시 아래 손님 SPA catch-all(app.get('*'))보다 먼저 등록해야
// 한다. 순서가 바뀌면 /admin이 손님 index.html로 먹힌다.
//
// 파일을 server/public이 아니라 server/admin-ui에 두는 이유: customer 빌드가
// outDir: '../server/public' + emptyOutDir: true라 배포마다 public을 통째로
// 지운다. public 안에 두면 매 배포에서 사라진다.
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin-ui', 'index.html'));
});

// Customer SPA fallback — API 아닌 모든 경로에서 index.html 반환
app.get('*', (_req, res) => {
  res.sendFile(path.join(staticPath, 'index.html'));
});

// 전역 에러 핸들러
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다' });
});

module.exports = { app, corsOriginCheck };
