export const REC_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  PLAYING: 'playing',
  PLAYED: 'played',
  SKIPPED: 'skipped',
  REJECTED: 'rejected',
});

export const OWNER_ACTION_STATUS = Object.freeze({
  ACCEPTED: REC_STATUS.ACCEPTED,
  PLAYING: REC_STATUS.PLAYING,
  PLAYED: REC_STATUS.PLAYED,
  SKIPPED: REC_STATUS.SKIPPED,
});
