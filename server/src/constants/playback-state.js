const PLAYBACK_STATE = Object.freeze({
  PLAYING: 'playing',
  PAUSED: 'paused',
  BUFFERING: 'buffering',
  UNKNOWN: 'unknown',
});

const PLAYBACK_STATES = Object.freeze(Object.values(PLAYBACK_STATE));

module.exports = { PLAYBACK_STATE, PLAYBACK_STATES };
