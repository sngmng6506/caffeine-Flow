const router = require('express').Router();
const { getTrackMetadata } = require('../services/track-metadata.service');
const { issueTrackMetadataToken } = require('../services/track-metadata-token.service');
const { logError, trackErrorCause } = require('../observability');

// GET /api/v1/tracks/oembed?url=...
// YouTube / SoundCloud / Spotify 통합 메타데이터 조회 (재생 아님)
router.get('/oembed', async (req, res) => {
  try {
    const metadata = await getTrackMetadata(req.query.url);
    res.json({ ...metadata, metadataToken: issueTrackMetadataToken(metadata) });
  } catch (error) {
    // 잘못된 링크·비공개 곡은 손님 입력 탓이라 알리지 않는다. 판단 근거는
    // error-taxonomy의 trackErrorCause가 단일 기준으로 관리한다.
    logError({
      code: error.code || 'TRACK_METADATA_FAILED',
      cause: trackErrorCause(error),
      route: 'GET /tracks/oembed',
      error,
    });
    res.status(error.status || 400).json({ error: error.message || '트랙 정보를 가져올 수 없습니다' });
  }
});

module.exports = router;
