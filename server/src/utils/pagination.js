const { MAX_PAGINATION_OFFSET } = require('../constants/limits');

function parseBoundedInteger(raw, {
  name,
  defaultValue,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
}) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: defaultValue };
  }

  if (Array.isArray(raw) || !/^(0|[1-9]\d*)$/.test(String(raw))) {
    return { error: `${name}는 ${min}~${max} 사이의 정수여야 합니다` };
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return { error: `${name}는 ${min}~${max} 사이의 정수여야 합니다` };
  }
  return { value };
}

function parseOffset(raw, { max = MAX_PAGINATION_OFFSET } = {}) {
  return parseBoundedInteger(raw, {
    name: 'offset',
    defaultValue: 0,
    min: 0,
    max,
  });
}

function parseLimit(raw, { defaultValue, max }) {
  return parseBoundedInteger(raw, {
    name: 'limit',
    defaultValue,
    min: 1,
    max,
  });
}

module.exports = { parseBoundedInteger, parseOffset, parseLimit };
