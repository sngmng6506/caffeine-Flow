const router = require('express').Router();
const { getTrackMetadata } = require('../services/track-metadata.service');
const { issueTrackMetadataToken } = require('../services/track-metadata-token.service');

// GET /api/v1/tracks/oembed?url=...
// YouTube / SoundCloud / Spotify 통합 메타데이터 조회 (재생 아님)
router.get('/oembed', async (req, res) => {
  try {
    const metadata = await getTrackMetadata(req.query.url);
    res.json({ ...metadata, metadataToken: issueTrackMetadataToken(metadata) });
  } catch (error) {
    console.error('[track-metadata] 조회 실패:', error.code || error.message);
    res.status(error.status || 400).json({ error: error.message || '트랙 정보를 가져올 수 없습니다' });
  }
});

module.exports = router;
