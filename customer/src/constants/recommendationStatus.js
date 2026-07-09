export const REC_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  PLAYING: 'playing',
  PLAYED: 'played',
  SKIPPED: 'skipped',
  REJECTED: 'rejected',
});

export const ACTIVE_STATUSES = Object.freeze([
  REC_STATUS.PENDING,
  REC_STATUS.ACCEPTED,
  REC_STATUS.PLAYING,
]);

export const HISTORY_STATUSES = Object.freeze([
  REC_STATUS.PLAYED,
  REC_STATUS.SKIPPED,
]);

export const CANCELLABLE_STATUSES = Object.freeze([
  REC_STATUS.PENDING,
  REC_STATUS.ACCEPTED,
]);

export const REC_STATUS_LABELS = Object.freeze({
  [REC_STATUS.PENDING]: '대기',
  [REC_STATUS.ACCEPTED]: '수락',
  [REC_STATUS.PLAYING]: '재생 중',
  [REC_STATUS.PLAYED]: '완료',
  [REC_STATUS.REJECTED]: '거절',
  [REC_STATUS.SKIPPED]: '스킵',
});

export const REC_STATUS_COLORS = Object.freeze({
  [REC_STATUS.PENDING]: '#888',
  [REC_STATUS.ACCEPTED]: '#4caf50',
  [REC_STATUS.PLAYING]: '#2196f3',
  [REC_STATUS.PLAYED]: '#9e9e9e',
  [REC_STATUS.REJECTED]: '#f44336',
  [REC_STATUS.SKIPPED]: '#ff9800',
});
