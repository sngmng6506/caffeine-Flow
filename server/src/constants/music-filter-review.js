const HUMAN_DECISION = Object.freeze({
  ACCEPT: 'accept',
  REJECT: 'reject',
});

const HUMAN_REASON_CODE = Object.freeze({
  POLICY_MATCH: 'policy_match',
  POLICY_MISMATCH: 'policy_mismatch',
  UNSAFE_CONTENT: 'unsafe_content',
  METADATA_INSUFFICIENT: 'metadata_insufficient',
  OTHER: 'other',
});

const HUMAN_DECISIONS = Object.freeze(Object.values(HUMAN_DECISION));
const HUMAN_REASON_CODES = Object.freeze(Object.values(HUMAN_REASON_CODE));

module.exports = {
  HUMAN_DECISION,
  HUMAN_REASON_CODE,
  HUMAN_DECISIONS,
  HUMAN_REASON_CODES,
};
