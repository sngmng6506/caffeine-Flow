const { TIMEZONE } = require('../constants/time-policy');

// 곡 키(utils/track-key의 trackKeyOf)의 SQL판 — video_id의 '?' 앞부분.
// knex.raw는 문자열 리터럴 안의 ?도 바인딩 자리로 해석하므로 chr(63)을 사용해
// placeholder가 생기지 않게 한다. SELECT와 GROUP BY 표현식이 완전히 같아야 함.
const TRACK_KEY_SQL = `split_part(video_id, chr(63), 1)`;

function kstDatePartSql(part, column = 'requested_at') {
  if (!['hour', 'dow'].includes(part)) {
    throw new Error(`지원하지 않는 KST date_part: ${part}`);
  }
  return `date_part('${part}', ${column} AT TIME ZONE '${TIMEZONE}')::int`;
}

const KST_HOUR_SQL = kstDatePartSql('hour');
const KST_DOW_SQL = kstDatePartSql('dow');
const KST_VISIT_DATE_SQL = `(now() AT TIME ZONE '${TIMEZONE}')::date`;
const HISTORY_SORT_AT_SQL = 'COALESCE(played_at, requested_at)';

module.exports = {
  TRACK_KEY_SQL,
  KST_HOUR_SQL,
  KST_DOW_SQL,
  KST_VISIT_DATE_SQL,
  HISTORY_SORT_AT_SQL,
  kstDatePartSql,
};
