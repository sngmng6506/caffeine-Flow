const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const cafeService = require('../services/cafe.service');
const statsService = require('../services/stats.service');
const playbackHistoryService = require('../services/playback-history.service');
const musicFilter = require('../features/music-filter');
const { getTrackMetadata } = require('../services/track-metadata.service');
const { safeCafe } = require('../utils/cafe-sanitize');
const { issueToken } = require('../utils/jwt');
const { APP_URL } = require('../config');
const { validateString, validateBool, validateInEnum, validateDateString, validateCoordinate, isUuid } = require('../utils/validate');
const db = require('../db/knex');
const { kstStartOfDateString, kstEndOfDateString, kstTodayString } = require('../utils/kst');
const { VALID_PLATFORMS, formatAllowedPlatforms } = require('../constants/platforms');
const { TERMINAL_STATUSES } = require('../constants/recommendation-status');
const { FILTER_STATUS } = require('../constants/music-filter-status');
const { HISTORY_SORT_AT_SQL } = require('../db/sql-fragments');
const { parseBoundedInteger, parseOffset } = require('../utils/pagination');
const { ownerRecommendation } = require('../utils/public-response');
const { getQrImage } = require('../services/qr-image.service');

const MANUAL_PLAYBACK_END_REASONS = ['ended', 'changed'];

// GET /api/v1/cafes/me
router.get('/me', requireAuth, async (req, res) => {
  const cafe = req.cafe;
  const initialSlug = await cafeService.findInitialSlug(cafe.id) || cafe.slug;
  const baseUrl = APP_URL || req.app.get('baseUrl') || `${req.protocol}://${req.get('host')}`;
  res.json({
    ...safeCafe(cafe),
    initial_slug: initialSlug,
    customer_url: `${baseUrl}/${cafe.slug}`,
  });
});

// GET /api/v1/cafes/me/qr-code
// renderer가 외부 QR 서버를 직접 fetch하면 CSP/CORS에 막힐 수 있어,
// 인증된 내 카페 주소만 고정된 QR 이미지 서비스로 전달한다.
router.get('/me/qr-code', requireAuth, async (req, res) => {
  const baseUrl = APP_URL || req.app.get('baseUrl') || `${req.protocol}://${req.get('host')}`;
  try {
    const { image, contentType } = await getQrImage(`${baseUrl}/${req.cafe.slug}`);
    res.set({
      'Cache-Control': 'no-store',
      'Content-Type': contentType,
      'Content-Disposition': 'attachment; filename="caffeine-flow-qr.jpg"',
    });
    res.send(image);
  } catch {
    res.status(502).json({ error: 'QR 이미지를 만들지 못했어요. 다시 시도해 주세요.' });
  }
});

// PUT /api/v1/cafes/me
router.put('/me', requireAuth, async (req, res) => {
  const nameCheck = validateString(req.body?.name, { max: 100, name: '카페명' });
  if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });
  const cafe = await cafeService.update(req.owner.cafeId, { name: nameCheck.value });
  req.app.get('io')?.of('/cafe').to(cafe.slug).emit('cafe_updated', { cafe_name: cafe.name });
  res.json(safeCafe(cafe));
});

// PUT /api/v1/cafes/me/slug  (QR 코드 재등록/재발급)
//   body 없음 또는 {}         → 무작위 새 slug 자동 발급
//   body { slug: '커스텀값' } → 사전 제작된 QR(아크릴 등) 코드로 지정
// slug가 바뀌면 기존 로그인 세션의 JWT가 옛 slug를 담고 있어 무효가
// 되므로, 새 토큰을 응답에 포함해 클라이언트가 즉시 교체하도록 한다.
// 남용 방지를 위해 분당 5회로 제한한다(정상 사용에서 자주 바꿀 일이 없음).
const slugChangeLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyGenerator: (req) => req.owner.cafeId,
  message: { error: '잠시 후 다시 시도해주세요' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.put('/me/slug', requireAuth, slugChangeLimiter, async (req, res) => {
  const raw = req.body?.slug;
  let newSlug;
  if (raw == null || raw === '') {
    newSlug = await cafeService.uniqueSlug();
  } else {
    if (!cafeService.isValidSlugFormat(raw))
      return res.status(400).json({ error: 'QR 코드는 영문 소문자·숫자 4~20자여야 합니다' });
    newSlug = raw;
  }

  let cafe;
  const oldSlug = req.owner.slug;
  try {
    cafe = await cafeService.changeSlug(req.owner.cafeId, newSlug);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  // 옛 slug room에 연결돼 있던 손님들에게 이동을 알린다. 통보를 못 받으면
  // 다음 신청 때 404를 맞고서야 알게 되므로, 즉시 새 주소로 안내한다.
  req.app.get('io')?.of('/cafe').to(oldSlug).emit('cafe_moved', { movedTo: cafe.slug });

  const initialSlug = await cafeService.findInitialSlug(cafe.id) || cafe.slug;
  const baseUrl = APP_URL || req.app.get('baseUrl') || `${req.protocol}://${req.get('host')}`;
  res.json({
    ...safeCafe(cafe),
    initial_slug: initialSlug,
    customer_url: `${baseUrl}/${cafe.slug}`,
    token: issueToken(cafe), // 새 slug가 담긴 세션 토큰으로 즉시 교체 필요
  });
});

// PUT /api/v1/cafes/me/notice
router.put('/me/notice', requireAuth, async (req, res) => {
  const noticeCheck = validateString(req.body?.notice, { max: 500, allowNull: true, name: '공지' });
  if (noticeCheck.error) return res.status(400).json({ error: noticeCheck.error });
  const cafe = await cafeService.update(req.owner.cafeId, { notice: noticeCheck.value });
  req.app.get('io')?.of('/cafe').to(cafe.slug).emit('notice_updated', { notice: cafe.notice });
  res.json({ notice: cafe.notice });
});

// PUT /api/v1/cafes/me/platforms  (허용 플랫폼 설정)
router.put('/me/platforms', requireAuth, async (req, res) => {
  const { allowed_platforms } = req.body || {};
  if (!Array.isArray(allowed_platforms) || allowed_platforms.length === 0) {
    return res.status(400).json({ error: '최소 1개 플랫폼을 선택해주세요' });
  }
  const filtered = allowed_platforms.filter(platform => VALID_PLATFORMS.includes(platform));
  if (filtered.length === 0) return res.status(400).json({ error: '유효한 플랫폼이 없습니다' });

  const cafe = await cafeService.update(req.owner.cafeId, {
    allowed_platforms: formatAllowedPlatforms(filtered),
  });
  req.app.get('io')?.of('/cafe').to(cafe.slug).emit('platforms_updated', {
    allowed_platforms: filtered,
  });
  res.json({ allowed_platforms: filtered });
});

// PUT /api/v1/cafes/me/music-filter  (AI 음악 필터 설정)
router.put('/me/music-filter', requireAuth, async (req, res) => {
  const enabledCheck = validateBool(req.body?.enabled, { name: 'enabled' });
  if (enabledCheck.error) return res.status(400).json({ error: enabledCheck.error });

  const promptCheck = validateString(req.body?.prompt, {
    max: 1000,
    allowNull: true,
    name: 'AI 필터 프롬프트',
  });
  if (promptCheck.error) return res.status(400).json({ error: promptCheck.error });

  if (enabledCheck.value && !promptCheck.value) {
    return res.status(400).json({ error: 'AI 필터를 켜려면 매장 분위기 설명을 입력해주세요' });
  }

  const cafe = await cafeService.updateMusicFilterSettings(req.owner.cafeId, {
    enabled: enabledCheck.value,
    prompt: promptCheck.value,
  });

  res.json({
    music_filter_enabled: cafe.music_filter_enabled,
    music_filter_prompt: cafe.music_filter_prompt,
  });
});

// POST /api/v1/cafes/me/music-filter/test  (현재 화면 설정으로 실제 저장 없이 테스트)
router.post('/me/music-filter/test', requireAuth, async (req, res) => {
  const urlCheck = validateString(req.body?.url, { max: 2000, name: '곡 URL' });
  if (urlCheck.error) return res.status(400).json({ error: urlCheck.error });

  const promptCheck = validateString(req.body?.prompt, {
    max: 1000,
    name: 'AI 필터 프롬프트',
  });
  if (promptCheck.error) return res.status(400).json({ error: promptCheck.error });

  let track;
  try {
    track = await getTrackMetadata(urlCheck.value);
  } catch (error) {
    return res.status(error.status || 400).json({
      error: error.message || '트랙 정보를 가져올 수 없습니다',
    });
  }

  const result = await musicFilter.evaluateTrack({
    cafePrompt: promptCheck.value,
    track,
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

// PUT /api/v1/cafes/me/address  (주소 변경)
router.put('/me/address', requireAuth, async (req, res) => {
  const { address, roadAddress, region, district, latitude, longitude } = req.body || {};
  const addressCheck = validateString(address, { max: 255, allowNull: true, name: '지번 주소' });
  if (addressCheck.error) return res.status(400).json({ error: addressCheck.error });
  const roadAddressCheck = validateString(roadAddress, { max: 255, allowNull: true, name: '도로명 주소' });
  if (roadAddressCheck.error) return res.status(400).json({ error: roadAddressCheck.error });
  if (!addressCheck.value && !roadAddressCheck.value) return res.status(400).json({ error: '주소를 입력해주세요' });
  const regionCheck = validateString(region, { max: 50, allowNull: true, name: '시/도' });
  if (regionCheck.error) return res.status(400).json({ error: regionCheck.error });
  const districtCheck = validateString(district, { max: 50, allowNull: true, name: '시/군/구' });
  if (districtCheck.error) return res.status(400).json({ error: districtCheck.error });
  const latitudeCheck = validateCoordinate(latitude, { min: -90, max: 90, name: '위도' });
  if (latitudeCheck.error) return res.status(400).json({ error: latitudeCheck.error });
  const longitudeCheck = validateCoordinate(longitude, { min: -180, max: 180, name: '경도' });
  if (longitudeCheck.error) return res.status(400).json({ error: longitudeCheck.error });
  const cafe = await cafeService.update(req.owner.cafeId, {
    address: addressCheck.value,
    road_address: roadAddressCheck.value,
    region: regionCheck.value,
    district: districtCheck.value,
    latitude: latitudeCheck.value,
    longitude: longitudeCheck.value,
  });
  res.json({
    address: cafe.address,
    road_address: cafe.road_address,
    region: cafe.region,
    district: cafe.district,
    latitude: cafe.latitude,
    longitude: cafe.longitude,
  });
});

// PUT /api/v1/cafes/me/status  (신청 ON/OFF 토글)
router.put('/me/status', requireAuth, async (req, res) => {
  const check = validateBool(req.body?.is_accepting, { name: 'is_accepting' });
  if (check.error) return res.status(400).json({ error: check.error });
  const cafe = await cafeService.update(req.owner.cafeId, { is_accepting: check.value });
  req.app.get('io')?.of('/cafe').to(cafe.slug).emit('system_toggled', {
    is_accepting: cafe.is_accepting,
  });
  res.json({ is_accepting: cafe.is_accepting });
});

// GET /api/v1/cafes/me/history?offset=0&date=YYYY-MM-DD
router.get('/me/history', requireAuth, async (req, res) => {
  const offset = parseOffset(req.query.offset);
  if (offset.error) return res.status(400).json({ error: offset.error });
  const limit = 20;
  let recommendationQuery = db('recommendations')
    .where({ cafe_id: req.owner.cafeId })
    .whereIn('status', TERMINAL_STATUSES)
    .orderByRaw(`${HISTORY_SORT_AT_SQL} DESC`)
    .orderBy('requested_at', 'desc')
    .orderBy('id', 'desc');
  let manualQuery = db('playback_history')
    .where({ cafe_id: req.owner.cafeId })
    .orderBy('ended_at', 'desc')
    .orderBy('id', 'desc');

  if (req.query.date) {
    const dateCheck = validateDateString(req.query.date);
    if (dateCheck.error) return res.status(400).json({ error: dateCheck.error });
    // KST 경계 사용 — UTC 자정 기준이면 KST 09:00~다음날 08:59가 잡혀
    // 통계 탭(KST 기준)과 이력 날짜 필터가 서로 다른 하루를 보게 됨
    const start = kstStartOfDateString(req.query.date);
    const end = kstEndOfDateString(req.query.date);
    recommendationQuery = recommendationQuery.whereRaw(`${HISTORY_SORT_AT_SQL} BETWEEN ? AND ?`, [start, end]);
    manualQuery = manualQuery.whereBetween('ended_at', [start, end]);
  }

  const fetchLimit = offset.value + limit + 1;
  const [recommendations, manualRows] = await Promise.all([
    recommendationQuery.limit(fetchLimit),
    manualQuery.limit(fetchLimit),
  ]);
  const items = [
    ...recommendations.map(ownerRecommendation),
    ...manualRows.map(row => ownerRecommendation(playbackHistoryService.toHistoryItem(row))),
  ].sort((left, right) => {
    const leftAt = new Date(left.played_at || left.requested_at).getTime();
    const rightAt = new Date(right.played_at || right.requested_at).getTime();
    if (leftAt !== rightAt) return rightAt - leftAt;
    return String(right.id).localeCompare(String(left.id));
  });
  res.json({
    items: items.slice(offset.value, offset.value + limit),
    hasMore: items.length > offset.value + limit,
  });
});

// POST /api/v1/cafes/me/playback-history
// 브라우저에서 직접 선택한 곡은 신청곡과 분리한다. 정상 종료 또는 1분 이상
// 재생된 경우에만 이력으로 남기며, 짧은 탐색 재생은 댓글 키 병합만 수행한다.
router.post('/me/playback-history', requireAuth, async (req, res) => {
  const body = req.body || {};
  if (!isUuid(body.sessionId)) return res.status(400).json({ error: 'sessionId 형식 오류' });

  const checks = {
    commentKey: validateString(body.commentKey, { max: 1000, name: 'commentKey' }),
    videoId: validateString(body.videoId, { max: 1000, allowNull: true, name: 'videoId' }),
    title: validateString(body.title, { max: 200, name: 'title' }),
    artist: validateString(body.artist, { max: 200, allowNull: true, name: 'artist' }),
    thumbnail: validateString(body.thumbnail, { max: 2048, allowNull: true, name: 'thumbnail' }),
    platform: validateInEnum(body.platform, VALID_PLATFORMS, { name: 'platform' }),
    endReason: validateInEnum(body.endReason, MANUAL_PLAYBACK_END_REASONS, { name: 'endReason' }),
  };
  for (const result of Object.values(checks)) {
    if (result.error) return res.status(400).json({ error: result.error });
  }
  if (!Number.isInteger(body.durationSeconds) || body.durationSeconds < 0 || body.durationSeconds > 86400) {
    return res.status(400).json({ error: 'durationSeconds는 0~86400 사이의 정수여야 합니다.' });
  }

  const result = await playbackHistoryService.finalize(req.owner.cafeId, {
    sessionId: body.sessionId,
    commentKey: checks.commentKey.value,
    videoId: checks.videoId.value,
    title: checks.title.value,
    artist: checks.artist.value,
    thumbnail: checks.thumbnail.value,
    platform: checks.platform.value,
    endReason: checks.endReason.value,
    durationSeconds: body.durationSeconds,
  });
  res.json(result);
});

// GET /api/v1/cafes/me/stats
router.get('/me/stats', requireAuth, async (req, res) => {
  res.json(await statsService.getStats(req.owner.cafeId));
});

// GET /api/v1/cafes/me/stats/music-filter  (최근 7일 AI 필터 현황)
router.get('/me/stats/music-filter', requireAuth, async (req, res) => {
  res.json(await statsService.getMusicFilterStats(req.owner.cafeId));
});

// GET /api/v1/cafes/me/stats/daily?date=YYYY-MM-DD
router.get('/me/stats/daily', requireAuth, async (req, res) => {
  const date = req.query.date || kstTodayString();
  const dateCheck = validateDateString(date);
  if (dateCheck.error) return res.status(400).json({ error: dateCheck.error });
  res.json(await statsService.getDailyStats(req.owner.cafeId, date));
});

// GET /api/v1/cafes/me/stats/hourly  (최근 30일 시간대별 패턴)
router.get('/me/stats/hourly', requireAuth, async (req, res) => {
  res.json(await statsService.getHourlyPattern(req.owner.cafeId));
});

// GET /api/v1/cafes/me/stats/weekday  (최근 30일 요일별 패턴)
router.get('/me/stats/weekday', requireAuth, async (req, res) => {
  res.json(await statsService.getDayOfWeekPattern(req.owner.cafeId));
});

// GET /api/v1/cafes/me/stats/hourly-songs?hour=0&offset=0  (해당 시간대 신청곡, 최근 30일)
router.get('/me/stats/hourly-songs', requireAuth, async (req, res) => {
  const hour = parseBoundedInteger(req.query.hour, { name: 'hour', defaultValue: null, min: 0, max: 23 });
  if (hour.error || hour.value === null) return res.status(400).json({ error: 'hour는 0~23 사이의 정수여야 합니다' });
  const offset = parseOffset(req.query.offset);
  if (offset.error) return res.status(400).json({ error: offset.error });
  res.json(await statsService.getSongsByHour(req.owner.cafeId, hour.value, offset.value));
});

// GET /api/v1/cafes/me/stats/weekday-songs?day=0&offset=0  (해당 요일 신청곡, 최근 30일)
router.get('/me/stats/weekday-songs', requireAuth, async (req, res) => {
  const day = parseBoundedInteger(req.query.day, { name: 'day', defaultValue: null, min: 0, max: 6 });
  if (day.error || day.value === null) return res.status(400).json({ error: 'day는 0~6 사이의 정수여야 합니다' });
  const offset = parseOffset(req.query.offset);
  if (offset.error) return res.status(400).json({ error: offset.error });
  res.json(await statsService.getSongsByWeekday(req.owner.cafeId, day.value, offset.value));
});

module.exports = router;
