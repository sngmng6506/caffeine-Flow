const router = require('express').Router({ mergeParams: true });
const recService = require('../../services/recommendation.service');
const {
  broadcast,
  broadcastRecommendation,
  getClientIp,
  safeVisitorId,
  makeDualLimiter,
} = require('../_recommendations.shared');
const { VOTE_LIMIT } = require('../../constants/limits');
const { publicRecommendation } = require('../../utils/public-response');
const { findCafeForMutation, sendServiceError, validateRecommendationId } = require('./shared');

const voteLimiters = makeDualLimiter({
  ...VOTE_LIMIT,
  message: '잠시 후 다시 시도해주세요 (투표 한도 초과)',
});

function songVotePayload(result) {
  return { track_key: result.trackKey, vote_count: result.voteCount };
}

function broadcastSongVote(req, slug, result) {
  broadcast(req, slug, 'song_vote', songVotePayload(result));
  for (const rec of result.recommendations) broadcastRecommendation(req, slug, { action: 'vote', rec });
}

router.param('id', validateRecommendationId);

router.post('/songs/:trackKey/vote', voteLimiters, async (req, res) => {
  const cafe = await findCafeForMutation(req, res);
  if (!cafe) return;
  try {
    const result = await recService.voteSong(cafe.id, req.params.trackKey, getClientIp(req), safeVisitorId(req));
    broadcastSongVote(req, req.params.slug, result);
    res.json(songVotePayload(result));
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: '이미 투표했습니다' });
    if (sendServiceError(res, error)) return;
    throw error;
  }
});

router.delete('/songs/:trackKey/vote', voteLimiters, async (req, res) => {
  const cafe = await findCafeForMutation(req, res);
  if (!cafe) return;
  try {
    const result = await recService.unvoteSong(cafe.id, req.params.trackKey, getClientIp(req), safeVisitorId(req));
    broadcastSongVote(req, req.params.slug, result);
    res.json(songVotePayload(result));
  } catch (error) {
    if (sendServiceError(res, error)) return;
    throw error;
  }
});

router.post('/:id/vote', voteLimiters, async (req, res) => {
  const cafe = await findCafeForMutation(req, res);
  if (!cafe) return;
  const ip = getClientIp(req);
  const visitorId = safeVisitorId(req);
  try {
    const rec = await recService.vote(cafe.id, req.params.id, ip, visitorId);
    broadcastRecommendation(req, req.params.slug, { action: 'vote', rec });
    res.json(publicRecommendation(rec, { visitorId }));
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: '이미 투표했습니다' });
    if (sendServiceError(res, error)) return;
    throw error;
  }
});

router.delete('/:id/vote', voteLimiters, async (req, res) => {
  const cafe = await findCafeForMutation(req, res);
  if (!cafe) return;
  const visitorId = safeVisitorId(req);
  try {
    const rec = await recService.unvote(cafe.id, req.params.id, getClientIp(req), visitorId);
    broadcastRecommendation(req, req.params.slug, { action: 'vote', rec });
    res.json(publicRecommendation(rec, { visitorId }));
  } catch (error) {
    if (sendServiceError(res, error)) return;
    throw error;
  }
});

module.exports = router;
