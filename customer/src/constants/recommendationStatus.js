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
  [REC_STATUS.PENDING]: '확인 중',
  [REC_STATUS.ACCEPTED]: '대기 중',
  [REC_STATUS.PLAYING]: '재생 중',
  [REC_STATUS.PLAYED]: '재생 완료',
  [REC_STATUS.REJECTED]: '신청 불가',
  [REC_STATUS.SKIPPED]: '건너뜀',
});

export const REC_STATUS_COLORS = Object.freeze({
  [REC_STATUS.PENDING]: 'var(--cf-status-pending)',
  [REC_STATUS.ACCEPTED]: 'var(--cf-status-accepted)',
  [REC_STATUS.PLAYING]: 'var(--cf-status-playing)',
  [REC_STATUS.PLAYED]: 'var(--cf-status-played)',
  [REC_STATUS.REJECTED]: 'var(--cf-status-rejected)',
  [REC_STATUS.SKIPPED]: 'var(--cf-status-skipped)',
});
