// 운영자(플랫폼 어드민) 전용 라우트.
//
// 사장님 라우트(cafes.js)가 "내 카페 하나"만 보는 것과 달리, 여기는 전체
// 카페를 가로질러 본다. 목적:
//  (1) 광고 재고 판단 — 실제로 켜서 쓰는 카페와 그 도달(순수 방문자)
//  (2) 사후 관리 — 가입만 하고 안 쓰는 계정·장난 카페 탐지 후 정지/삭제
//
// 인증은 사장님 JWT와 분리된 경계를 쓴다(middleware/auth.js requireAdmin).
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const db = require('../db/knex');
const { requireAdmin } = require('../middleware/auth');
const { issueAdminToken } = require('../utils/jwt');
const { kstTodayString, kstStartOfDay } = require('../utils/kst');
const { ADMIN_LOGIN_LIMIT } = require('../constants/limits');
const { HEARTBEAT_ACTIVE_WINDOW_MS } = require('../constants/time-policy');
const { ADMIN_PASSWORD } = require('../config');

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

const loginLimiter = rateLimit({
  ...ADMIN_LOGIN_LIMIT,
  message: { error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요' },
  skip: skipInTest,
});

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
router.post('/login', loginLimiter, (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'ADMIN_PASSWORD 미설정 — 어드민 콘솔 비활성' });
  }
  const { password } = req.body || {};
  if (typeof password !== 'string' || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다' });
  }
  res.json({ token: issueAdminToken() });
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

  // cafe_visits는 (cafe_id, visitor_ip, visit_date) UNIQUE라 이미 하루 단위 중복이 제거됨.
  // 광고주에게 제시할 도달은 "중복 뺀 실제 방문자"이므로 visitor_ip 기준 distinct.
  const visits = await db('cafe_visits')
    .select('cafe_id')
    .countDistinct('visitor_ip as unique_visitors')
    .where('visit_date', today)
    .groupBy('cafe_id');

  const requests = await db('recommendations')
    .select('cafe_id')
    .count('id as requests')
    .where('requested_at', '>=', todayStart)
    .groupBy('cafe_id');

  const visitMap = new Map(visits.map((v) => [v.cafe_id, Number(v.unique_visitors)]));
  const requestMap = new Map(requests.map((r) => [r.cafe_id, Number(r.requests)]));

  const now = Date.now();
  const todayStartMs = todayStart.getTime();

  res.json(cafes.map((c) => ({
    ...c,
    status: cafeStatus(c.last_heartbeat_at, now, todayStartMs),
    today_unique_visitors: visitMap.get(c.id) || 0,
    today_requests: requestMap.get(c.id) || 0,
  })));
});

// PUT /api/v1/admin/cafes/:id/suspend  { is_suspended: boolean }
// 정지는 되돌릴 수 있는 1차 조치 — 손님 접근만 차단하고 데이터는 보존한다.
router.put('/cafes/:id/suspend', requireAdmin, async (req, res) => {
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
  const deleted = await db('cafes').where({ id: req.params.id }).del();
  if (!deleted) return res.status(404).json({ error: '카페를 찾을 수 없습니다' });
  res.json({ id: req.params.id, deleted: true });
});

module.exports = router;
module.exports.CAFE_STATUS = CAFE_STATUS;
