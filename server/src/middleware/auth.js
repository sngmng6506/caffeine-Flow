const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const { ADMIN_ROLE } = require('../constants/roles');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.owner = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// 라우트에서 slug 파라미터와 JWT의 slug가 일치하는지 확인
function requireCafeOwner(req, res, next) {
  if (req.owner.slug !== req.params.slug) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// 운영자(플랫폼 어드민) 전용. 전체 카페 데이터에 접근하므로 사장님 인증과
// 반드시 분리된 경계를 쓴다 — 사장님 토큰은 role 클레임이 없어 여기서 403.
function requireAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    if (payload.role !== ADMIN_ROLE) return res.status(403).json({ error: 'Forbidden' });
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { requireAuth, requireCafeOwner, requireAdmin };
