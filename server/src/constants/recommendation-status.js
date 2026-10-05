const REC_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  PLAYING: 'playing',
  PLAYED: 'played',
  SKIPPED: 'skipped',
  REJECTED: 'rejected',
});

const ACTIVE_STATUSES = Object.freeze([
  REC_STATUS.PENDING,
  REC_STATUS.ACCEPTED,
  REC_STATUS.PLAYING,
]);

const TERMINAL_STATUSES = Object.freeze([
  REC_STATUS.PLAYED,
  REC_STATUS.SKIPPED,
  REC_STATUS.REJECTED,
]);

const OWNER_MUTABLE_STATUSES = Object.freeze([
  REC_STATUS.PENDING,
  REC_STATUS.ACCEPTED,
  REC_STATUS.REJECTED,
  REC_STATUS.PLAYING,
  REC_STATUS.PLAYED,
  REC_STATUS.SKIPPED,
]);

// 종료 상태(played/skipped/rejected)에서는 어떤 전이도 불가.
// pending↔accepted↔playing 사이는 사장님 드래그 UI가 양방향 이동을
// 허용하므로 자유 전이. (playing→accepted 되돌리기 등)
function isValidTransition(from, to) {
  if (from === to) return true;
  return !TERMINAL_STATUSES.includes(from);
}

module.exports = {
  REC_STATUS,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  OWNER_MUTABLE_STATUSES,
  isValidTransition,
};
