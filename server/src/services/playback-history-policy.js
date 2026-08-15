const { MEANINGFUL_PLAYBACK_SECONDS } = require('../constants/limits');

function shouldStorePlayback({ durationSeconds, endReason }) {
  return endReason === 'ended' || durationSeconds >= MEANINGFUL_PLAYBACK_SECONDS;
}

module.exports = { shouldStorePlayback };
