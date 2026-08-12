const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const { VALID_PLATFORMS } = require('../constants/platforms');
const { validateRecommendationBody } = require('../utils/validate');

const TOKEN_TYPE = 'track_metadata';
const TOKEN_TTL = '5m';

function normalizeTrack(metadata = {}) {
  const bodyCheck = validateRecommendationBody({ ...metadata, requesterName: null });
  if (bodyCheck.error) {
    throw Object.assign(new Error(bodyCheck.error), { status: 400 });
  }
  const { requesterName: _requesterName, ...validated } = bodyCheck.value;
  const track = { ...validated, platform: String(metadata.platform || '').trim() };

  if (!VALID_PLATFORMS.includes(track.platform)) {
    throw Object.assign(new Error('유효하지 않은 트랙 메타데이터입니다'), { status: 400 });
  }
  return track;
}

function issueTrackMetadataToken(metadata) {
  return jwt.sign({ type: TOKEN_TYPE, track: normalizeTrack(metadata) }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyTrackMetadataToken(token) {
  try {
    const payload = jwt.verify(String(token || ''), JWT_SECRET);
    if (payload.type !== TOKEN_TYPE) throw new Error('wrong token type');
    return normalizeTrack(payload.track);
  } catch {
    throw Object.assign(new Error('곡 정보가 만료되었거나 유효하지 않습니다. 링크를 다시 확인해주세요.'), {
      code: 'TRACK_METADATA_TOKEN_INVALID',
      status: 400,
    });
  }
}

module.exports = { issueTrackMetadataToken, verifyTrackMetadataToken };
