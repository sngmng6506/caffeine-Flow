// JWT role 클레임 값.
//
// 사장님 세션 토큰(utils/jwt.js issueToken)은 { cafeId, slug }만 담고 role을
// 넣지 않는다. 따라서 role === ADMIN_ROLE 검사만으로 운영자/사장님 경계가
// 분리된다 — 사장님 토큰으로 /api/v1/admin/*에 접근할 수 없다.
//
// 반대 방향(운영자 토큰으로 사장님 라우트 접근)은 slug/cafeId가 없어
// findBySlug(undefined) → 404, requireCafeOwner → 403으로 막힌다.
const ADMIN_ROLE = 'admin';

module.exports = { ADMIN_ROLE };
