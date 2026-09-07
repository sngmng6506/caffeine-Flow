// 손님(미인증) 전용 추천곡 라우트 조립점.
// 외부 마운트 경로와 하위 라우터 등록 순서를 한곳에서 확인할 수 있게 유지한다.
// 사장님 라우트는 recommendations.owner.js 참조.
const router = require('express').Router({ mergeParams: true });

router.use(require('./recommendations/queue.routes'));
router.use(require('./recommendations/history.routes'));
router.use(require('./recommendations/vote.routes'));
router.use(require('./recommendations/comment.routes'));

module.exports = router;
