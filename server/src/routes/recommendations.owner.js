// 사장님 전용 추천곡 라우트.
// 인증 미들웨어는 핸들러별로 명시한다. router.use(requireAuth)를 쓰면
// 라우터에 매칭되지 않는 path까지도 미들웨어가 실행되어 401을 반환해
// public 라우터로 fall-through가 막힘. 명시적 부착이 약간 장황하지만
// 라우팅 의도가 한눈에 보이고 path 충돌 위험이 없다.
const router = require('express').Router({ mergeParams: true });
const { requireAuth, requireCafeOwner } = require('../middleware/auth');
const cafeService = require('../services/cafe.service');
const recService  = require('../services/recommendation.service');
const { broadcast, getClientIp } = require('./_recommendations.shared');
const { validateRecommendationBody } = require('../utils/validate');
const { REC_STATUS, ACTIVE_STATUSES, OWNER_MUTABLE_STATUSES } = require('../constants/recommendation-status');

const ownerOnly = [requireAuth, requireCafeOwner];

// POST /api/v1/cafes/:slug/recommendations/owner  (사장님: 직접 추가)
router.post('/owner', ownerOnly, async (req, res) => {
  const cafe = await cafeService.findBySlug(req.params.slug);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });

  const body = req.body || {};
  const bodyCheck = validateRecommendationBody(body);
  if (bodyCheck.error) return res.status(400).json({ error: bodyCheck.error });
  const { videoId, title, channelTitle, thumbnail, duration } = bodyCheck.value;

  const duplicate = await recService.findActiveByVideoId(cafe.id, videoId);
  if (duplicate) return res.status(409).json({ error: '이미 대기 중인 곡입니다' });

  const recStatus = ACTIVE_STATUSES.includes(body.status) ? body.status : REC_STATUS.PENDING;

  if (recStatus === REC_STATUS.PLAYING) {
    const cleared = await recService.clearPlaying(cafe.id, null);
    for (const r of cleared) {
      broadcast(req, req.params.slug, 'recommendations_update', { action: 'update', rec: r });
    }
  }

  let rec;
  try {
    rec = await recService.add(cafe.id, {
      videoId,
      title,
      channelTitle,
      thumbnail,
      duration,
      requesterIp: getClientIp(req),
      requesterName: null,
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '이미 대기 중인 곡입니다' });
    throw err;
  }
  const updated = recStatus !== REC_STATUS.PENDING ? await recService.updateStatus(rec.id, recStatus) : rec;

  broadcast(req, req.params.slug, 'recommendations_update', { action: 'add', rec: updated });
  res.status(201).json(updated);
});

// PUT /api/v1/cafes/:slug/recommendations/:id  (사장님: 상태 변경)
router.put('/:id', ownerOnly, async (req, res) => {
  const { status } = req.body;
  if (!OWNER_MUTABLE_STATUSES.includes(status)) return res.status(400).json({ error: '유효하지 않은 status' });

  // playing으로 바꿀 때 기존 playing 곡을 서버 단에서 played로 처리
  if (status === REC_STATUS.PLAYING) {
    const cleared = await recService.clearPlaying(req.owner.cafeId, req.params.id);
    for (const r of cleared) {
      broadcast(req, req.params.slug, 'recommendations_update', { action: 'update', rec: r });
    }
  }

  let rec;
  try {
    rec = await recService.updateStatus(req.params.id, status);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  broadcast(req, req.params.slug, 'recommendations_update', { action: 'update', rec });
  res.json(rec);
});

// DELETE /api/v1/cafes/:slug/recommendations/:id  (사장님)
router.delete('/:id', ownerOnly, async (req, res) => {
  await recService.remove(req.params.id);
  broadcast(req, req.params.slug, 'recommendations_update', { action: 'delete', id: req.params.id });
  res.json({ ok: true });
});

module.exports = router;
