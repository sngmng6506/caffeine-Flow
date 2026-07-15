const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const { ADMIN_ROLE } = require('../constants/roles');

// 로그인 세션 토큰 (30일) — cafeId+slug를 담는다.
// slug가 바뀌면(QR 재등록) 이 토큰의 slug가 옛 값으로 남아 있게 되므로,
// slug 변경 시 반드시 이 함수로 새 토큰을 재발급해 클라이언트에 내려줘야 한다.
function issueToken(cafe) {
  return jwt.sign({ cafeId: cafe.id, slug: cafe.slug }, JWT_SECRET, { expiresIn: '30d' });
}

// 신규 가입 대기 토큰 (10분 유효)
function issuePendingToken(payload) {
  return jwt.sign({ ...payload, pending: true }, JWT_SECRET, { expiresIn: '10m' });
}

// 운영자 콘솔 토큰 (12시간) — 사장님 토큰과 같은 시크릿으로 서명하되
// role 클레임으로 경계를 나눈다(constants/roles.js 참조).
// 사장님 세션(30일)보다 짧게 두는 이유: 전체 카페 데이터에 접근하는
// 토큰이라 유출 시 노출 범위가 넓다.
function issueAdminToken() {
  return jwt.sign({ role: ADMIN_ROLE }, JWT_SECRET, { expiresIn: '12h' });
}

module.exports = { issueToken, issuePendingToken, issueAdminToken };
