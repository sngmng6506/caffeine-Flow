const FILTER_STATUS = Object.freeze({
  SKIPPED: 'skipped',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  ERROR_REJECTED: 'error_rejected',
});

const FILTER_ACTION = Object.freeze({
  ACCEPT: 'accept',
  REJECT: 'reject',
});

const FILTER_REJECT_STATUSES = Object.freeze([
  FILTER_STATUS.REJECTED,
  FILTER_STATUS.ERROR_REJECTED,
]);

const FILTER_PROCESSED_STATUSES = Object.freeze([
  FILTER_STATUS.ACCEPTED,
  FILTER_STATUS.REJECTED,
  FILTER_STATUS.ERROR_REJECTED,
]);

module.exports = {
  FILTER_STATUS,
  FILTER_ACTION,
  FILTER_REJECT_STATUSES,
  FILTER_PROCESSED_STATUSES,
};
