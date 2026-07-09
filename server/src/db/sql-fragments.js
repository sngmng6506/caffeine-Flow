const { TIMEZONE } = require('../constants/time-policy');

// Spotify ?si=, YouTube &t= 등 추적 파라미터로 같은 곡이 여러 video_id로
// 저장된 과거 데이터 병합용 — '?' 앞부분을 정규 ID로 사용.
// knex.raw는 문자열 리터럴 안의 ?도 바인딩 자리로 해석하므로 chr(63)을 사용해
// placeholder가 생기지 않게 한다. SELECT와 GROUP BY 표현식이 완전히 같아야 함.
const CANONICAL_VIDEO_ID_SQL = `split_part(video_id, chr(63), 1)`;

function kstDatePartSql(part, column = 'requested_at') {
  if (!['hour', 'dow'].includes(part)) {
    throw new Error(`지원하지 않는 KST date_part: ${part}`);
  }
  return `date_part('${part}', ${column} AT TIME ZONE '${TIMEZONE}')::int`;
}

const KST_HOUR_SQL = kstDatePartSql('hour');
const KST_DOW_SQL = kstDatePartSql('dow');
const KST_VISIT_DATE_SQL = `(now() AT TIME ZONE '${TIMEZONE}')::date`;

module.exports = {
  CANONICAL_VIDEO_ID_SQL,
  KST_HOUR_SQL,
  KST_DOW_SQL,
  KST_VISIT_DATE_SQL,
  kstDatePartSql,
};
