// recommendations.public.js와 recommendations.owner.js가 공유하는 유틸.
const MAX_QUEUE_SIZE = 30;

function broadcast(req, slug, event, data) {
  req.app.get('io')?.of('/cafe').to(slug).emit(event, data);
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
}

module.exports = { MAX_QUEUE_SIZE, broadcast, getClientIp };
