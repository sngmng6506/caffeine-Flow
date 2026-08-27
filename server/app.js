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
const { logError, isDbConnectionError, CAUSE } = require('./src/observability');
const { parseOffset, parseTopSort } = require('./src/utils/pagination');

// app 생성을 server.js(리슨·소켓)와 분리 — supertest가 포트 없이
// app만 import해 통합 테스트를 돌릴 수 있게 한다.
const app = express();

function buildAllowedOrigins({ appUrl = APP_URL, nodeEnv = process.env.NODE_ENV } = {}) {
  const set = new Set();
  if (appUrl) {
    set.add(appUrl.replace(/\/$/, ''));
  }
  if (nodeEnv !== 'production') {
    set.add('http://localhost:5173');
    set.add('http://localhost:5174');
  }
  return set;
}
const ALLOWED_ORIGINS = buildAllowedOrigins();

function corsOriginCheck(origin, cb) {
  // CORS Origin은 브라우저의 cross-origin 경계이지 인증 수단이 아니다.
  // same-origin GET/HEAD(예: Socket.IO 초기 long-polling)는 Origin 헤더가
  // 없을 수 있으므로 헤더 부재 자체를 거절하지 않는다.
  if (origin === undefined || origin === null || origin === '') {
    return cb(null, true);
  }
  // file://, data: 등 opaque origin은 명시적으로 허용하지 않는다.
  if (origin === 'null') return cb(new Error('Opaque origin not allowed'));
  if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
  cb(new Error(`Origin not allowed: ${origin}`));
}

// 배포 SPA가 실제로 사용하는 외부 리소스만 허용한다.
// - Google Identity Services: 사장님 Google 로그인
// - Kakao postcode: 카페 지역 입력
// - unpkg Leaflet: 운영자 지도(SRI로 버전·무결성 고정)
// 외부 음악 페이지는 별도 Electron BrowserView에서 열리므로 이 CSP에 추가하지 않는다.
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  connectSrc: ["'self'", 'wss:', 'https://accounts.google.com/gsi/'],
  fontSrc: ["'self'", 'data:'],
  formAction: ["'self'"],
  frameAncestors: ["'self'"],
  frameSrc: [
    'https://accounts.google.com/gsi/',
    'https://postcode.map.kakao.com',
  ],
  imgSrc: ["'self'", 'data:', 'https:'],
  mediaSrc: ["'self'", 'https:'],
  objectSrc: ["'none'"],
  scriptSrc: [
    "'self'",
    'https://accounts.google.com/gsi/client',
    'https://t1.kakaocdn.net',
    'https://unpkg.com',
  ],
  scriptSrcAttr: ["'none'"],
  styleSrc: [
    "'self'",
    "'unsafe-inline'", // React inline style과 Leaflet DOM style에 필요. inline script는 허용하지 않는다.
    'https://accounts.google.com/gsi/style',
    'https://unpkg.com',
  ],
};

app.set('trust proxy', 1); // Railway 등 리버스 프록시 뒤에서 실제 IP 인식
// COOP는 Google 로그인 팝업의 opener/postMessage 연결을 위해
// same-origin-allow-popups를 유지한다. COEP는 외부 로그인/지도 리소스와의 호환 때문에 끈다.
// CSP 자체는 비활성화하지 않고 위 allowlist로 제한한다.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: CSP_DIRECTIVES,
  },
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
  const offset = parseOffset(req.query.offset);
  if (offset.error) return res.status(400).json({ error: offset.error });
  const sort = parseTopSort(req.query.sort);
  if (sort.error) return res.status(400).json({ error: sort.error });
  res.json(await statsService.getGlobalTop10(offset.value, sort.value));
});

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', version: 'v2' }));

// 존재하지 않는 API를 손님 SPA의 HTML로 돌려주면 클라이언트가 JSON parse
// 오류로 실패 원인을 잃는다. 모든 API 404는 일관된 JSON 계약으로 종료한다.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Owner SPA fallback
app.get('/owner/*', (_req, res) => {
  res.sendFile(path.join(staticPath, 'owner/index.html'));
});
app.get('/owner', (_req, res) => res.redirect('/owner/'));

// 운영자 콘솔 정적 자산. admin index의 inline script/style을 없애 CSP에서
// script-src 'unsafe-inline'을 열지 않도록 별도 경로로 제공한다.
const adminUiPath = path.join(__dirname, '../admin');
app.use('/admin-assets', express.static(adminUiPath, { index: false }));

// 운영자 콘솔 — 반드시 아래 손님 SPA catch-all(app.get('*'))보다 먼저 등록해야
// 한다. 순서가 바뀌면 /admin이 손님 index.html로 먹힌다.
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(adminUiPath, 'index.html'));
});

// 음악 필터 테스트 lab — 서버 같은-오리진에서 서빙해 운영자 콘솔의 관리자 토큰을
// 재사용하고 /api/v1/admin/music-filter/test를 CORS 없이 호출한다. index.html에
// inline script/style을 두지 않아 CSP script-src를 열지 않는다. catch-all보다 먼저 둔다.
const filterLabPath = path.join(__dirname, '../music-filter-lab');
app.use('/filter-lab', express.static(filterLabPath, { index: 'index.html' }));

// 운영자 전용 통합 라벨링 화면. API 인증은 관리자 JWT로 별도 검증한다.
const labelingLabPath = path.join(__dirname, '../music-labeling-lab');
app.use('/labeling-lab', express.static(labelingLabPath, { index: 'index.html' }));

// Customer SPA fallback — API 아닌 모든 경로에서 index.html 반환
app.get('*', (_req, res) => {
  res.sendFile(path.join(staticPath, 'index.html'));
});

// 전역 에러 핸들러 — 여기까지 온 에러는 우리가 예상하지 못한 것이다.
// DB 연결 실패는 서비스 전체가 멈춘 상태라 일반 500과 섞지 않고 승격한다.
app.use((err, req, res, _next) => {
  logError({
    code: isDbConnectionError(err) ? 'DB_CONNECTION_FAILED' : 'INTERNAL_ERROR',
    cause: CAUSE.PLATFORM,
    cafe: req.cafe ? { id: req.cafe.id, slug: req.cafe.slug } : null,
    route: `${req.method} ${req.route?.path || req.path}`,
    error: err,
  });
  res.status(500).json({ error: '서버 오류가 발생했습니다' });
});

module.exports = { app, buildAllowedOrigins, corsOriginCheck, CSP_DIRECTIVES };
