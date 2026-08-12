const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const { ADMIN_ROLE } = require('../constants/roles');
const cafeService = require('../services/cafe.service');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    // 서명이 유효해도 사장님 세션 토큰만 통과시킨다. pending 토큰(가입 10분
    // 임시)이나 admin 토큰(role만 있음)은 cafeId가 없어 이후 라우트에서
    // undefined 바인딩 500을 유발 — 경계에서 401로 끊는다.
    if (!payload.cafeId || !payload.slug || payload.pending) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // slug는 재발급 후 다른 카페가 재사용할 수 있다. 서명과 slug claim만
    // 확인하면 옛 토큰이 새 소유자의 카페에 접근하므로, 불변 cafeId로 현재
    // 카페를 조회하고 토큰 발급 당시 slug가 아직 유효한지까지 확인한다.
    const cafe = await cafeService.findById(payload.cafeId);
    if (!cafe || cafe.slug !== payload.slug) {
      return res.status(401).json({ error: 'Stale token' });
    }
    req.owner = payload;
    req.cafe = cafe;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// 라우트 slug가 인증 시 DB에서 확인한 현재 카페와 일치하는지 확인
function requireCafeOwner(req, res, next) {
  if (!req.cafe || req.cafe.id !== req.owner.cafeId || req.cafe.slug !== req.params.slug) {
    return res.status(403).json({ error: 'Forbidden' });
  }
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
