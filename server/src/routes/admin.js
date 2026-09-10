// 운영자(플랫폼 어드민) 전용 라우트.
//
// 사장님 라우트(cafes.js)가 "내 카페 하나"만 보는 것과 달리, 여기는 전체
// 카페를 가로질러 본다. 목적:
//  (1) 광고 재고 판단 — 실제로 켜서 쓰는 카페와 그 도달(익명 브라우저 수)
//  (2) 사후 관리 — 가입만 하고 안 쓰는 계정·장난 카페 탐지 후 정지/삭제
//
// 인증은 사장님 JWT와 분리된 경계를 쓴다(middleware/auth.js requireAdmin).
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const db = require('../db/knex');
const statsService = require('../services/stats.service');
const musicFilter = require('../features/music-filter');
const { getTrackMetadata } = require('../services/track-metadata.service');
const { requireAdmin } = require('../middleware/auth');
const { sendTestAlert } = require('../observability');
const { issueAdminToken } = require('../utils/jwt');
const { kstTodayString, kstStartOfDay } = require('../utils/kst');
const { ADMIN_LOGIN_LIMIT, ADMIN_LOGIN_GLOBAL_LIMIT } = require('../constants/limits');
const { HEARTBEAT_ACTIVE_WINDOW_MS } = require('../constants/time-policy');
const { ADMIN_PASSWORD, OPENROUTER_API_KEY, OPENROUTER_BASE_URL } = require('../config');
const { isUuid, validateString } = require('../utils/validate');
const { parseOffset } = require('../utils/pagination');
const { FILTER_STATUS } = require('../constants/music-filter-status');
const { HUMAN_DECISIONS, HUMAN_REASON_CODES } = require('../constants/music-filter-review');
const { normalizeArtistKey, validateMusicAnnotation } = require('../features/music-labeling/annotation');
const labelingReview = require('../features/music-labeling/review.service');
const { LABELING_VIEWS } = labelingReview;

const MUSIC_FILTER_MODELS_CACHE_MS = 10 * 60 * 1000;
let musicFilterModelsCache = { at: 0, ids: null };


// 매장 상태 — 하트비트(last_heartbeat_at) 기준.
// never: 가입 후 한 번도 앱을 켠 적 없음 → 장난/방치 계정 후보
const CAFE_STATUS = Object.freeze({
  ACTIVE: 'active',   // 지금 켜져 있음
  TODAY: 'today',     // 오늘 썼지만 지금은 꺼짐
  DORMANT: 'dormant', // 과거엔 썼으나 오늘은 안 씀
  NEVER: 'never',     // 하트비트 없음
});

// NODE_ENV=test에서는 스킵 — 통합 테스트가 같은 IP에서 연속 로그인 시도를
// 보내므로 한도에 걸려 시나리오 검증이 불가능해짐 (_recommendations.shared.js와 동일 정책)
const skipInTest = () => process.env.NODE_ENV === 'test';

function adminLoginLimitHandler(limit) {
  return (req, res, _next, options) => {
    const resetAt = req.rateLimit?.resetTime?.getTime() || Date.now() + limit.windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    res.status(options.statusCode).json({
      error: `로그인 시도가 너무 많습니다. ${retryAfterSeconds}초 후 다시 시도하세요`,
      retry_after_seconds: retryAfterSeconds,
    });
  };
}

function createAdminLoginLimiter(limit, options = {}) {
  return rateLimit({
    ...limit,
    ...options,
    skip: skipInTest,
    skipSuccessfulRequests: true,
    handler: adminLoginLimitHandler(limit),
  });
}

// IP별 제한과 서비스 전체 제한을 함께 둔다. 비밀번호가 하나라 IP만 바꾸는
// 분산 대입도 가능하므로, 전역 제한은 정상 로그인량보다 넉넉한 별도 상한이다.
const globalLoginLimiter = createAdminLoginLimiter(ADMIN_LOGIN_GLOBAL_LIMIT, {
  keyGenerator: () => 'admin-login-global',
});
const loginLimiter = createAdminLoginLimiter(ADMIN_LOGIN_LIMIT);

// 길이가 달라도 조기 반환하지 않도록 해시를 비교 — 비밀번호 길이 유출 방지
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function cafeStatus(lastHeartbeatAt, now, todayStartMs) {
  if (!lastHeartbeatAt) return CAFE_STATUS.NEVER;
  const beat = new Date(lastHeartbeatAt).getTime();
  if (now - beat <= HEARTBEAT_ACTIVE_WINDOW_MS) return CAFE_STATUS.ACTIVE;
  if (beat >= todayStartMs) return CAFE_STATUS.TODAY;
  return CAFE_STATUS.DORMANT;
}

// POST /api/v1/admin/login  { password } → { token }
router.post('/login', globalLoginLimiter, loginLimiter, (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'ADMIN_PASSWORD 미설정 — 어드민 콘솔 비활성' });
  }
  const { password } = req.body || {};
  if (typeof password !== 'string' || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다' });
  }
  res.json({ token: issueAdminToken() });
});

// POST /api/v1/admin/music-filter/test
// 운영자 전용 lab에서 실제 저장 없이 서비스와 동일한 음악 필터를 실행한다.
router.post('/music-filter/test', requireAdmin, async (req, res) => {
  const urlCheck = validateString(req.body?.url, { max: 2000, name: '곡 URL' });
  if (urlCheck.error) return res.status(400).json({ error: urlCheck.error });

  const promptCheck = validateString(req.body?.prompt, {
    max: 1000,
    name: 'AI 필터 프롬프트',
  });
  if (promptCheck.error) return res.status(400).json({ error: promptCheck.error });

  const modelCheck = validateString(req.body?.model, { max: 120, allowNull: true, name: '모델' });
  if (modelCheck.error) return res.status(400).json({ error: modelCheck.error });

  let track;
  try {
    track = await getTrackMetadata(urlCheck.value);
  } catch (error) {
    return res.status(error.status || 400).json({
      error: error.message || '트랙 정보를 가져올 수 없습니다',
    });
  }

  const result = await musicFilter.evaluateTrack({
    context: { route: 'POST /admin/music-filter/test' },
    cafePrompt: promptCheck.value,
    track,
    model: modelCheck.value || undefined,
  });

  if (result.filterStatus === FILTER_STATUS.ERROR_REJECTED) {
    return res.status(503).json({
      error: 'OpenRouter가 곡을 판단하지 못했습니다. 잠시 후 다시 시도해주세요.',
      errorCode: result.errorCode,
    });
  }

  res.json({
    decision: result.action,
    confidence: result.confidence,
    reason: result.reason,
    model: result.model,
    track,
  });
});

// GET /api/v1/admin/music-filter/models
// OpenRouter 키의 제공자·개인정보 설정을 반영한 사용 가능 모델을 lab에 제공한다.
// 에러 알림 전송 확인. 실제 알림과 같은 경로를 타므로 웹훅이 서버에서
// 실제로 나가는지까지 확인된다. 전용 코드를 써서 진짜 장애의 쿨다운은
// 건드리지 않는다.
router.post('/alert-test', requireAdmin, async (_req, res) => {
  const result = await sendTestAlert();
  if (result.sent) return res.json({ ok: true, message: '테스트 알림을 보냈습니다. Discord 채널을 확인하세요.' });

  const reasons = {
    disabled: 'ALERT_WEBHOOK_URL이 설정되지 않았거나 이 프로세스가 변수 추가 전에 시작됐습니다.',
    cooldown: '최근 30분 안에 이미 테스트 알림을 보냈습니다. 잠시 후 다시 시도하세요.',
    delivery_failed: '웹훅으로 전송하지 못했습니다. URL이 유효한지 서버 로그를 확인하세요.',
  };
  res.status(409).json({ ok: false, reason: result.reason, message: reasons[result.reason] || '전송하지 못했습니다.' });
});

router.get('/music-filter/models', requireAdmin, async (_req, res) => {
  if (!OPENROUTER_API_KEY) {
    return res.status(503).json({ error: 'OPENROUTER_API_KEY가 설정되지 않았습니다', models: [] });
  }
  if (musicFilterModelsCache.ids && Date.now() - musicFilterModelsCache.at < MUSIC_FILTER_MODELS_CACHE_MS) {
    return res.json({ models: musicFilterModelsCache.ids });
  }

  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/models/user`, {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const ids = (data?.data || []).map((model) => model.id).filter(Boolean).sort();
    musicFilterModelsCache = { at: Date.now(), ids };
    res.json({ models: ids });
  } catch {
    res.status(502).json({ error: 'OpenRouter 모델 목록을 불러오지 못했습니다', models: [] });
  }
});

// GET /api/v1/admin/music-filter-reviews
// 카페 구분 없이 AI 처리 이력을 모아 운영자가 한 큐에서 골드 라벨을 기록하게 한다.
router.get('/music-filter-reviews', requireAdmin, async (req, res) => {
  const offset = parseOffset(req.query.offset);
  if (offset.error) return res.status(400).json({ error: offset.error });

  const view = req.query.view || 'unreviewed';
  if (!LABELING_VIEWS.includes(view)) {
    return res.status(400).json({ error: 'view는 unreviewed, reviewed 또는 all이어야 합니다' });
  }

  res.json(await labelingReview.fetchLabelingQueue({ view, offset: offset.value }));
});

// GET /api/v1/admin/music-filter-artist-labels?artist=...
// 현재 곡과 동일하다고 운영자가 확인한 아티스트의 다른 곡 라벨을 최대 3건 제공한다.
router.get('/music-filter-artist-labels', requireAdmin, async (req, res) => {
  const artistCheck = validateString(req.query.artist, { max: 200, name: '아티스트명' });
  if (artistCheck.error) return res.status(400).json({ error: artistCheck.error });
  const platformCheck = validateString(req.query.platform, { max: 20, allowNull: true, name: '플랫폼' });
  if (platformCheck.error) return res.status(400).json({ error: platformCheck.error });
  const trackKeyCheck = validateString(req.query.track_key, { max: 2000, allowNull: true, name: '곡 식별자' });
  if (trackKeyCheck.error) return res.status(400).json({ error: trackKeyCheck.error });
  if (Boolean(platformCheck.value) !== Boolean(trackKeyCheck.value)) {
    return res.status(400).json({ error: '플랫폼과 곡 식별자는 함께 전달해야 합니다' });
  }
  const labels = await labelingReview.fetchArtistLabels({
    artistKey: normalizeArtistKey(artistCheck.value),
    platform: platformCheck.value,
    trackKey: trackKeyCheck.value,
  });
  res.json({ artist_name: artistCheck.value, labels });
});

// GET /api/v1/admin/cafes → 전체 카페 + 상태 + 오늘 도달/신청
//
// 카페마다 통계를 각각 조회하면 N+1이 되므로 집계 2건을 따로 받아 메모리에서 병합한다.
// 날짜 경계는 KST 기준(utils/kst) — cafe_visits.visit_date와 동일한 하루를 봐야
// 어드민 수치와 사장님 통계가 어긋나지 않는다.
router.get('/cafes', requireAdmin, async (_req, res) => {
  const today = kstTodayString();
  const todayStart = kstStartOfDay(0);

  const cafes = await db('cafes')
    .select(
      'id', 'name', 'slug', 'owner_email', 'created_at', 'last_login_at',
      'last_heartbeat_at', 'is_suspended',
      'region', 'district', 'dong', 'latitude', 'longitude',
    )
    .orderBy('created_at', 'desc');

  // cafe_visits는 localStorage의 visitor_id 우선, 레거시 요청은 IP fallback으로
  // 하루 단위 중복이 제거된다. 계정·사람 수가 아니라 익명 브라우저 프로필 수다.
  const visits = await db('cafe_visits')
    .select('cafe_id')
    .count('id as unique_browsers')
    .where('visit_date', today)
    .groupBy('cafe_id');

  const requests = await db('recommendations')
    .select('cafe_id')
    .count('id as requests')
    .where('requested_at', '>=', todayStart)
    .groupBy('cafe_id');

  const visitMap = new Map(visits.map((v) => [v.cafe_id, Number(v.unique_browsers)]));
  const requestMap = new Map(requests.map((r) => [r.cafe_id, Number(r.requests)]));

  const now = Date.now();
  const todayStartMs = todayStart.getTime();

  res.json(cafes.map((c) => ({
    ...c,
    status: cafeStatus(c.last_heartbeat_at, now, todayStartMs),
    today_unique_browsers: visitMap.get(c.id) || 0,
    today_requests: requestMap.get(c.id) || 0,
  })));
});

// GET /api/v1/admin/cafes/:id/stats
// 사장님 화면에서 분리한 매장 통계를 기존 KST 집계 서비스로 조회한다.
router.get('/cafes/:id/stats', requireAdmin, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: '카페를 찾을 수 없습니다' });

  const cafe = await db('cafes').where({ id: req.params.id }).select('id', 'name').first();
  if (!cafe) return res.status(404).json({ error: '카페를 찾을 수 없습니다' });

  const todayDate = kstTodayString();
  const [totals, today, hourly, weekday, musicFilter] = await Promise.all([
    statsService.getStats(cafe.id),
    statsService.getDailyStats(cafe.id, todayDate),
    statsService.getHourlyPattern(cafe.id),
    statsService.getDayOfWeekPattern(cafe.id),
    statsService.getMusicFilterStats(cafe.id),
  ]);

  res.json({
    cafe,
    totals,
    today: {
      date: today.date,
      total: today.total,
      played: today.played,
      skipped: today.skipped,
    },
    hourly,
    weekday,
    musicFilter,
  });
});

// GET /api/v1/admin/cafes/:id/music-filter-audit
// 현재 설정, 설정 변경 이력, 판단 당시 프롬프트 스냅샷을 함께 제공한다.
// 배포 전 판단은 정확한 프롬프트를 알 수 없으므로 snapshot=null로 둔다.
router.get('/cafes/:id/music-filter-audit', requireAdmin, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: '카페를 찾을 수 없습니다' });
  const offset = parseOffset(req.query.offset);
  if (offset.error) return res.status(400).json({ error: offset.error });

  const cafe = await db('cafes')
    .where({ id: req.params.id })
    .select('id', 'name', 'music_filter_enabled', 'music_filter_prompt')
    .first();
  if (!cafe) return res.status(404).json({ error: '카페를 찾을 수 없습니다' });

  const audit = await labelingReview.fetchCafeAudit({ cafeId: cafe.id, offset: offset.value });

  res.json({
    cafe: { id: cafe.id, name: cafe.name },
    current: {
      enabled: cafe.music_filter_enabled,
      prompt: cafe.music_filter_prompt,
    },
    ...audit,
    offset: offset.value,
  });
});

// PUT /api/v1/admin/cafes/:id/music-filter-audit/:recommendationId/review
// AI 결과를 덮어쓰지 않고 운영자의 독립된 골드 라벨을 추천곡별로 upsert한다.
router.put('/cafes/:id/music-filter-audit/:recommendationId/review', requireAdmin, async (req, res) => {
  if (!isUuid(req.params.id) || !isUuid(req.params.recommendationId)) {
    return res.status(404).json({ error: 'AI 판단 이력을 찾을 수 없습니다' });
  }

  const { human_decision: humanDecision, human_reason_code: humanReasonCode } = req.body || {};
  const metadataSufficient = req.body?.metadata_sufficient;
  const audioAnalysisId = req.body?.audio_analysis_id ?? null;
  const audioAnalysisRevision = req.body?.audio_analysis_revision;
  if (audioAnalysisId && !Number.isSafeInteger(audioAnalysisRevision)) return res.status(400).json({ error: '분석 버전이 필요합니다' });
  if (!HUMAN_DECISIONS.includes(humanDecision)) {
    return res.status(400).json({ error: 'human_decision은 accept, reject 또는 undetermined여야 합니다' });
  }
  if (!HUMAN_REASON_CODES.includes(humanReasonCode)) {
    return res.status(400).json({ error: '유효한 human_reason_code가 필요합니다' });
  }
  if (metadataSufficient !== null && typeof metadataSufficient !== 'boolean') {
    return res.status(400).json({ error: 'metadata_sufficient는 boolean 또는 null이어야 합니다' });
  }
  if (audioAnalysisId !== null && !isUuid(audioAnalysisId)) {
    return res.status(400).json({ error: 'audio_analysis_id가 올바르지 않습니다' });
  }
  const annotationCheck = req.body?.track_annotation === undefined
    ? { value: null }
    : validateMusicAnnotation(req.body.track_annotation);
  if (annotationCheck.error) return res.status(400).json({ error: annotationCheck.error });

  const recommendation = await labelingReview.findReviewableRecommendation({
    cafeId: req.params.id,
    recommendationId: req.params.recommendationId,
  });
  if (!recommendation) return res.status(404).json({ error: 'AI 판단 이력을 찾을 수 없습니다' });
  if (audioAnalysisId) {
    const analysis = await labelingReview.findTrackAudioAnalysis({
      audioAnalysisId,
      platform: recommendation.platform,
      trackKey: recommendation.video_id,
    });
    if (!analysis) return res.status(404).json({ error: '오디오 분석 결과를 찾을 수 없습니다' });
  }

  try {
    const saved = await labelingReview.saveReview({
      recommendation,
      humanDecision,
      humanReasonCode,
      metadataSufficient,
      annotation: annotationCheck.value,
      audioAnalysisId,
      audioAnalysisRevision,
    });
    res.json(saved);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

// PUT /api/v1/admin/cafes/:id/suspend  { is_suspended: boolean }
// 정지는 되돌릴 수 있는 1차 조치 — 손님 접근만 차단하고 데이터는 보존한다.
router.put('/cafes/:id/suspend', requireAdmin, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: '카페를 찾을 수 없습니다' });
  const value = req.body?.is_suspended;
  if (typeof value !== 'boolean') {
    return res.status(400).json({ error: 'is_suspended는 boolean이어야 합니다' });
  }
  const [cafe] = await db('cafes')
    .where({ id: req.params.id })
    .update({ is_suspended: value })
    .returning(['id', 'slug', 'is_suspended']);
  if (!cafe) return res.status(404).json({ error: '카페를 찾을 수 없습니다' });
  res.json(cafe);
});

// DELETE /api/v1/admin/cafes/:id
// cafes의 onDelete('CASCADE')로 recommendations·votes·cafe_visits·daily_stats까지
// 함께 소멸한다. 되돌릴 수 없으므로 UI에서 카페명 확인 후에만 호출한다.
router.delete('/cafes/:id', requireAdmin, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: '카페를 찾을 수 없습니다' });
  const deleted = await db('cafes').where({ id: req.params.id }).del();
  if (!deleted) return res.status(404).json({ error: '카페를 찾을 수 없습니다' });
  res.json({ id: req.params.id, deleted: true });
});


// 곡 자동 라벨 검토는 매장 정책의 골드 판단을 요구하지 않는다.
const audioLabels = require('../features/audio-analysis/labels');
router.get('/audio-labels', requireAdmin, async (req, res) => {
  const view = req.query.view || 'unreviewed';
  const offset = Number(req.query.offset || 0);
  if (!['all', 'reviewed', 'unreviewed', 'ready'].includes(view) || !Number.isSafeInteger(offset) || offset < 0) {
    return res.status(400).json({ error: '목록 조건이 올바르지 않습니다' });
  }
  res.json(await audioLabels.list({ view, offset }));
});
router.put('/audio-labels/:id/review', requireAdmin, async (req, res) => {
  const fields = ['genre_tags', 'tempo_class', 'rhythmic_character', 'mood_tags', 'vocal_type', 'instrumentation_type', 'track_version'];
  if ((req.body?.artist_confirmed !== undefined && typeof req.body.artist_confirmed !== 'boolean') ||
      (req.body?.reviewed_fields !== undefined && (!Array.isArray(req.body.reviewed_fields) || req.body.reviewed_fields.length > fields.length || req.body.reviewed_fields.some((f) => !fields.includes(f))))) {
    return res.status(400).json({ error: '검토 범위가 올바르지 않습니다' });
  }
  if (!isUuid(req.params.id) || !Number.isSafeInteger(req.body?.annotation_revision) || req.body.annotation_revision < 0 ||
      (req.body.audio_analysis_id && (!isUuid(req.body.audio_analysis_id) || !Number.isSafeInteger(req.body.audio_analysis_revision)))) {
    return res.status(400).json({ error: '검토 대상 버전이 올바르지 않습니다' });
  }
  const annotation = req.body.track_annotation === undefined ? { value: null } : validateMusicAnnotation(req.body.track_annotation);
  if (annotation.error) return res.status(400).json({ error: annotation.error });
  try {
    res.json(await audioLabels.review(req.params.id, req.body, annotation.value));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});
// GET /api/v1/admin/audio-settings, PUT — 3단 Audio LLM 스위치
// 운영자가 Lab에서 끄고 켠다. 워커는 claim 응답으로 현재 값을 받는다.
router.get('/audio-settings', requireAdmin, async (_req, res) => {
  res.json(await require('../features/audio-analysis/settings').get());
});
router.put('/audio-settings', requireAdmin, async (req, res) => {
  if (typeof req.body?.audio_llm_enabled !== 'boolean') {
    return res.status(400).json({ error: 'audio_llm_enabled는 true 또는 false여야 합니다' });
  }
  res.json(await require('../features/audio-analysis/settings').update(req.body));
});

module.exports = router;
module.exports.CAFE_STATUS = CAFE_STATUS;

// 원본은 이력별 읽기만 제공한다. 사용자 검토로 수정하지 않는다.
router.get('/audio-labels/:id/runs', requireAdmin, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: '곡 식별자가 올바르지 않습니다' });
  try { res.json(await require('../features/audio-analysis/runs').history(req.params.id)); }
  catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); throw error; }
});
router.get('/audio-runs/:id', requireAdmin, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: '분석 식별자가 올바르지 않습니다' });
  const run = await db('music_audio_runs').where({ id: req.params.id }).select('id', 'platform', 'track_key', 'payload', 'created_at').first();
  if (!run) return res.status(404).json({ error: '분석을 찾을 수 없습니다' });
  res.json(run);
});

router.post('/audio-labels/:id/requeue', requireAdmin, async (req, res) => {
  if (!isUuid(req.params.id) || !Number.isSafeInteger(req.body?.generation)) return res.status(400).json({ error: '작업 버전이 필요합니다' });
  try { res.json(await require('../features/audio-analysis/jobs').requeue(req.params.id, req.body.generation)); }
  catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); throw error; }
});
router.post('/audio-labels/:id/renormalize', requireAdmin, async (req, res) => {
  if (!isUuid(req.params.id) || !isUuid(req.body?.analysis_id) || !Number.isSafeInteger(req.body?.analysis_revision) || !Number.isSafeInteger(req.body?.generation)) {
    return res.status(400).json({ error: '분석·작업 버전이 필요합니다' });
  }
  try { res.json(await require('../features/audio-analysis/renormalize').apply(req.params.id, req.body)); }
  catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); throw error; }
});
