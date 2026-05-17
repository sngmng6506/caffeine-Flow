// 사장님 전용 추천곡 라우트.
// 인증 미들웨어는 핸들러별로 명시한다. router.use(requireAuth)를 쓰면
// 라우터에 매칭되지 않는 path까지도 미들웨어가 실행되어 401을 반환해
// public 라우터로 fall-through가 막힘. 명시적 부착이 약간 장황하지만
// 라우팅 의도가 한눈에 보이고 path 충돌 위험이 없다.
const router = require('express').Router({ mergeParams: true });
const { requireAuth, requireCafeOwner } = require('../middleware/auth');
const cafeService = require('../services/cafe.service');
const recService  = require('../services/recommendation.service');
const { broadcast } = require('./_recommendations.shared');
const { validateString, validateInEnum } = require('../utils/validate');

const ownerOnly = [requireAuth, requireCafeOwner];

// POST /api/v1/cafes/:slug/recommendations/owner  (사장님: 직접 추가)
router.post('/owner', ownerOnly, async (req, res) => {
  const cafe = await cafeService.findBySlug(req.params.slug);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });

  const body = req.body || {};
  const videoIdCheck = validateString(body.videoId, { max: 1000, name: 'videoId' });
  if (videoIdCheck.error) return res.status(400).json({ error: videoIdCheck.error });
  const titleCheck = validateString(body.title, { max: 500, name: 'title' });
  if (titleCheck.error) return res.status(400).json({ error: titleCheck.error });
  const channelCheck = validateString(body.channelTitle, { max: 200, allowNull: true, name: 'channelTitle' });
  if (channelCheck.error) return res.status(400).json({ error: channelCheck.error });
  const thumbnailCheck = validateString(body.thumbnail, { max: 500, allowNull: true, name: 'thumbnail' });
  if (thumbnailCheck.error) return res.status(400).json({ error: thumbnailCheck.error });
  const durationCheck = validateString(body.duration, { max: 20, allowNull: true, name: 'duration' });
  if (durationCheck.error) return res.status(400).json({ error: durationCheck.error });
  const { value: videoId } = videoIdCheck;
  const { value: title } = titleCheck;
  const channelTitle = channelCheck.value;
  const thumbnail = thumbnailCheck.value;
  const duration = durationCheck.value;

  const duplicate = await recService.findActiveByVideoId(cafe.id, videoId);
  if (duplicate) return res.status(409).json({ error: '이미 대기 중인 곡입니다' });

  const validStatuses = ['pending', 'accepted', 'playing'];
  const recStatus = validStatuses.includes(body.status) ? body.status : 'pending';

  if (recStatus === 'playing') {
    const cleared = await recService.clearPlaying(cafe.id, null);
    for (const r of cleared) {
      broadcast(req, req.params.slug, 'recommendations_update', { action: 'update', rec: r });
    }
  }

  const rec = await recService.add(cafe.id, { videoId, title, channelTitle, thumbnail, duration, requesterIp: '127.0.0.1', requesterName: null });
  const updated = recStatus !== 'pending' ? await recService.updateStatus(rec.id, recStatus) : rec;

  broadcast(req, req.params.slug, 'recommendations_update', { action: 'add', rec: updated });
  res.status(201).json(updated);
});

// PUT /api/v1/cafes/:slug/recommendations/:id  (사장님: 상태 변경)
router.put('/:id', ownerOnly, async (req, res) => {
  const { status } = req.body;
  const valid = ['accepted', 'rejected', 'playing', 'played', 'skipped'];
  if (!valid.includes(status)) return res.status(400).json({ error: '유효하지 않은 status' });

  // playing으로 바꿀 때 기존 playing 곡을 서버 단에서 played로 처리
  if (status === 'playing') {
    const cleared = await recService.clearPlaying(req.owner.cafeId, req.params.id);
    for (const r of cleared) {
      broadcast(req, req.params.slug, 'recommendations_update', { action: 'update', rec: r });
    }
  }

  const rec = await recService.updateStatus(req.params.id, status);
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
