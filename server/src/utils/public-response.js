// Public HTTP/Socket responses must be allowlists, never raw database rows.
// The database stores abuse-prevention identifiers and model diagnostics that
// are not part of the customer-facing API contract.
const PUBLIC_RECOMMENDATION_FIELDS = [
  'id',
  'video_id',
  'title',
  'channel_title',
  'thumbnail',
  'duration',
  'requester_name',
  'platform',
  'status',
  'vote_count',
  'requested_at',
  'played_at',
  'playing_started_at',
  'play_duration_seconds',
];

const OWNER_RECOMMENDATION_FIELDS = [
  ...PUBLIC_RECOMMENDATION_FIELDS,
  'filter_status',
  'filter_reason',
];

const RECOMMENDATION_COMMENT_FIELDS = [
  'id',
  'recommendation_id',
  'commenter_name',
  'body',
  'created_at',
];

const SONG_COMMENT_FIELDS = [
  'id',
  'commenter_name',
  'body',
  'created_at',
  'cafe_name',
];

function pick(source, fields) {
  if (!source) return source;
  return Object.fromEntries(fields
    .filter(field => source[field] !== undefined)
    .map(field => [field, source[field]]));
}

function publicRecommendation(row, { visitorId } = {}) {
  const result = pick(row, PUBLIC_RECOMMENDATION_FIELDS);
  if (visitorId !== undefined) {
    result.is_mine = Boolean(visitorId && row?.visitor_id && visitorId === row.visitor_id);
  }
  return result;
}

function ownerRecommendation(row) {
  return pick(row, OWNER_RECOMMENDATION_FIELDS);
}

function recommendationComment(row) {
  return pick(row, RECOMMENDATION_COMMENT_FIELDS);
}

function songComment(row) {
  const result = pick(row, SONG_COMMENT_FIELDS);
  if (Array.isArray(row?.replies)) result.replies = row.replies.map(songComment);
  return result;
}

module.exports = {
  publicRecommendation,
  ownerRecommendation,
  recommendationComment,
  songComment,
};
