const AUDIO_FEATURE_SCHEMA_VERSION = 1;

const AUDIO_RIGHTS_BASES = Object.freeze([
  'owned', 'licensed', 'public_domain', 'other_authorized',
]);

const AUDIO_REVIEW_STATUS = Object.freeze({
  PENDING: 'pending',
  REVIEWED: 'reviewed',
});

module.exports = {
  AUDIO_FEATURE_SCHEMA_VERSION,
  AUDIO_RIGHTS_BASES,
  AUDIO_REVIEW_STATUS,
};
