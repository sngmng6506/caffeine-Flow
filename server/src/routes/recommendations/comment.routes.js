const router = require('express').Router({ mergeParams: true });
const recService = require('../../services/recommendation.service');
const {
  broadcast,
  getClientIp,
  makeDualLimiter,
} = require('../_recommendations.shared');
const { validateString } = require('../../utils/validate');
const { COMMENT_LIMIT } = require('../../constants/limits');
const { recommendationComment } = require('../../utils/public-response');
const { findCafeForMutation, sendServiceError, validateRecommendationId } = require('./shared');

const commentLimiters = makeDualLimiter({
  ...COMMENT_LIMIT,
  message: '잠시 후 다시 댓글을 남겨주세요 (1분에 5개 제한)',
});

router.param('id', validateRecommendationId);

router.post('/:id/comments', commentLimiters, async (req, res) => {
  const cafe = await findCafeForMutation(req, res);
  if (!cafe) return;
  const bodyCheck = validateString(req.body?.body, { max: 200, name: 'body' });
  if (bodyCheck.error) return res.status(400).json({ error: bodyCheck.error });
  const nameCheck = validateString(req.body?.commenterName, { max: 50, allowNull: true, name: 'commenterName' });
  if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });
  try {
    const comment = await recService.addComment(cafe.id, req.params.id, {
      commenterIp: getClientIp(req),
      commenterName: nameCheck.value,
      body: bodyCheck.value,
    });
    const safeComment = recommendationComment(comment);
    broadcast(req, req.params.slug, 'comment_added', { recommendationId: req.params.id, comment: safeComment });
    res.status(201).json(safeComment);
  } catch (error) {
    if (sendServiceError(res, error)) return;
    throw error;
  }
});

module.exports = router;
