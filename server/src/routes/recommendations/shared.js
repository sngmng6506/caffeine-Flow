const cafeService = require('../../services/cafe.service');
const { isUuid } = require('../../utils/validate');

async function findCafeForMutation(req, res) {
  const cafe = await cafeService.findActiveBySlug(req.params.slug);
  if (!cafe) {
    res.status(404).json({ error: 'Cafe not found' });
    return null;
  }
  return cafe;
}

function sendServiceError(res, error) {
  if (!error.status) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

function validateRecommendationId(_req, res, next, id) {
  if (!isUuid(id)) return res.status(400).json({ error: '추천곡 ID 형식 오류' });
  next();
}

module.exports = {
  findCafeForMutation,
  sendServiceError,
  validateRecommendationId,
};
