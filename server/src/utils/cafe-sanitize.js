// 사장님에게 본인 카페 정보를 응답할 때 허용하는 필드 목록.
// password_hash 같은 과거 컬럼이나 내부 PK가 무심코 새는 것을 막기 위해
// 명시적 화이트리스트로 직렬화한다.
const PUBLIC_CAFE_FIELDS = [
  'id',
  'name',
  'slug',
  'owner_email',
  'is_accepting',
  'notice',
  'allowed_platforms',
  'address',
  'road_address',
  'region',
  'district',
  'latitude',
  'longitude',
  'marketing_agreed',
  'created_at',
  'last_login_at',
];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/**
 * DB 레코드 → 사장님 본인용 응답 형태.
 * @param {object} cafe knex가 반환한 cafes 행
 * @returns {object}
 */
function safeCafe(cafe) {
  const base = pick(cafe, PUBLIC_CAFE_FIELDS);
  // provider 필드는 OAuth 출처 표시용 — google_id/naver_id 자체는 노출하지 않음
  base.provider = cafe.google_id ? 'google' : (cafe.naver_id ? 'naver' : null);
  return base;
}

module.exports = { safeCafe, PUBLIC_CAFE_FIELDS };
