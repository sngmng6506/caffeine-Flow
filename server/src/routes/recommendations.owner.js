// 사장님 전용 추천곡 라우트.
// 인증 미들웨어는 핸들러별로 명시한다. router.use(requireAuth)를 쓰면
// 라우터에 매칭되지 않는 path까지도 미들웨어가 실행되어 401을 반환해
// public 라우터로 fall-through가 막힘. 명시적 부착이 약간 장황하지만
// 라우팅 의도가 한눈에 보이고 path 충돌 위험이 없다.
const router = require('express').Router({ mergeParams: true });
const { requireAuth, requireCafeOwner } = require('../middleware/auth');
const recService  = require('../services/recommendation.service');
const { broadcast, getClientIp } = require('./_recommendations.shared');
const { validateInEnum, validateRecommendationBody } = require('../utils/validate');
const { REC_STATUS, ACTIVE_STATUSES, OWNER_MUTABLE_STATUSES } = require('../constants/recommendation-status');
const { PLATFORM, VALID_PLATFORMS } = require('../constants/platforms');

const ownerOnly = [requireAuth, requireCafeOwner];

router.post('/owner', ownerOnly, async (req, res) => {
  const cafe = req.cafe;

  const body = req.body || {};
  const bodyCheck = validateRecommendationBody(body);
  if (bodyCheck.error) return res.status(400).json({ error: bodyCheck.error });
  const platformCheck = validateInEnum(body.platform || PLATFORM.YOUTUBE, VALID_PLATFORMS, { name: 'platform' });
  if (platformCheck.error) return res.status(400).json({ error: platformCheck.error });
  const { videoId, title, channelTitle, thumbnail, duration } = bodyCheck.value;
  const platform = platformCheck.value;

  const duplicate = await recService.findActiveByVideoId(cafe.id, videoId);
  if (duplicate) return res.status(409).json({ error: '이미 대기 중인 곡입니다' });

  const recStatus = ACTIVE_STATUSES.includes(body.status) ? body.status : REC_STATUS.PENDING;

  let rec;
  try {
    rec = await recService.add(cafe.id, {
      videoId, title, channelTitle, thumbnail, duration,
      requesterIp: getClientIp(req), requesterName: null, platform,
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '이미 대기 중인 곡입니다' });
    throw err;
  }
  let updated = rec;
  if (recStatus === REC_STATUS.PLAYING) {
    const result = await recService.setPlaying(cafe.id, rec.id);
    for (const cleared of result.cleared) {
      broadcast(req, req.params.slug, 'recommendations_update', { action: 'update', rec: cleared });
    }
    updated = result.rec;
  } else if (recStatus !== REC_STATUS.PENDING) {
    updated = await recService.updateStatus(cafe.id, rec.id, recStatus);
  }

  broadcast(req, req.params.slug, 'recommendations_update', { action: 'add', rec: updated });
  res.status(201).json(updated);
});

router.put('/:id', ownerOnly, async (req, res) => {
  const { status } = req.body;
  if (!OWNER_MUTABLE_STATUSES.includes(status)) return res.status(400).json({ error: '유효하지 않은 status' });

  // clearPlaying 같은 선행 부수효과보다 먼저 target의 cafe scope를 검증한다.
  // 그렇지 않으면 다른 카페 ID + status=playing 요청만으로 내 카페의 현재
  // playing 곡을 played로 바꾸는 교차-tenant 부수효과가 생길 수 있다.
  const target = await recService.findByIdForCafe(req.owner.cafeId, req.params.id);
  if (!target) return res.status(404).json({ error: '추천곡을 찾을 수 없습니다' });

  let rec;
  try {
    if (status === REC_STATUS.PLAYING) {
      const result = await recService.setPlaying(req.owner.cafeId, req.params.id);
      for (const cleared of result.cleared) {
        broadcast(req, req.params.slug, 'recommendations_update', { action: 'update', rec: cleared });
      }
      rec = result.rec;
    } else {
      rec = await recService.updateStatus(req.owner.cafeId, req.params.id, status);
    }
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  broadcast(req, req.params.slug, 'recommendations_update', { action: 'update', rec });
  res.json(rec);
});

router.delete('/:id', ownerOnly, async (req, res) => {
  const deleted = await recService.remove(req.owner.cafeId, req.params.id);
  if (!deleted) return res.status(404).json({ error: '추천곡을 찾을 수 없습니다' });
  broadcast(req, req.params.slug, 'recommendations_update', { action: 'delete', id: req.params.id });
  res.json({ ok: true });
});

module.exports = router;
