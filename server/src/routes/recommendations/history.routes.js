const router = require('express').Router({ mergeParams: true });
const cafeService = require('../../services/cafe.service');
const recService = require('../../services/recommendation.service');
const statsService = require('../../services/stats.service');
const { parseOffset, parseTopSort } = require('../../utils/pagination');
const { publicRecommendation } = require('../../utils/public-response');

router.get('/history', async (req, res) => {
  const cafe = await cafeService.findActiveBySlug(req.params.slug);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });
  const offset = parseOffset(req.query.offset);
  if (offset.error) return res.status(400).json({ error: offset.error });
  const page = await recService.getRecentHistory(cafe.id, offset.value);
  res.json({ ...page, items: page.items.map(publicRecommendation) });
});

router.get('/top10', async (req, res) => {
  const cafe = await cafeService.findActiveBySlug(req.params.slug);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });
  const offset = parseOffset(req.query.offset);
  if (offset.error) return res.status(400).json({ error: offset.error });
  const sort = parseTopSort(req.query.sort);
  if (sort.error) return res.status(400).json({ error: sort.error });
  res.json(await statsService.getCafeTop10(cafe.id, offset.value, sort.value));
});

module.exports = router;
