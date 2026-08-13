// 사용자 입력 검증 헬퍼 — DB 제약·500 에러에 의존하지 않고 라우트 진입 즉시 400으로 reject.
// 모든 함수는 { error } 또는 { value } 반환.

function validateString(value, { max, min = 1, allowNull = false, trim = true, name = 'field' } = {}) {
  if (value === undefined || value === null || value === '') {
    if (allowNull) return { value: null };
    return { error: `${name} 누락` };
  }
  if (typeof value !== 'string') return { error: `${name} 형식 오류` };
  const v = trim ? value.trim() : value;
  if (v.length < min) return { error: `${name} 비어 있을 수 없습니다` };
  if (max && v.length > max) return { error: `${name}는 ${max}자 이하` };
  return { value: v };
}

// UUID 형식 검증 — 잘못된 형식을 DB에 넣으면 Postgres가 22P02로 500을 던지므로,
// 라우트 경계에서 미리 걸러 404/400으로 응답하기 위한 헬퍼.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function validateInEnum(value, allowed, { name = 'field', defaultValue } = {}) {
  if (value === undefined && defaultValue !== undefined) return { value: defaultValue };
  if (!allowed.includes(value)) return { error: `${name} 유효하지 않음` };
  return { value };
}

function validateBool(value, { name = 'field' } = {}) {
  if (typeof value === 'boolean') return { value };
  if (value === 'true')  return { value: true };
  if (value === 'false') return { value: false };
  return { error: `${name} 형식 오류` };
}

function validateDateString(value, { name = 'date' } = {}) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: `${name}는 YYYY-MM-DD 형식이어야 합니다` };
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return { error: `${name}는 유효한 날짜여야 합니다` };
  }
  return { value };
}

function validateCoordinate(value, { min, max, allowNull = true, name = '좌표' } = {}) {
  if (value === undefined || value === null || value === '') {
    return allowNull ? { value: null } : { error: `${name} 누락` };
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return { error: `${name}는 ${min}~${max} 사이의 숫자여야 합니다` };
  }
  return { value };
}

// 추천곡 신청/등록 body 공통 검증 — public·owner 라우트에 복붙돼 있던
// 6필드 블록을 한 곳으로. 실패 시 { error }, 성공 시 { value: {...} }.
function validateRecommendationBody(body = {}) {
  const checks = [
    ['videoId',       validateString(body.videoId,       { max: 1000, name: 'videoId' })],
    ['title',         validateString(body.title,         { max: 500,  name: 'title' })],
    ['channelTitle',  validateString(body.channelTitle,  { max: 200,  allowNull: true, name: 'channelTitle' })],
    ['thumbnail',     validateString(body.thumbnail,     { max: 500,  allowNull: true, name: 'thumbnail' })],
    ['duration',      validateString(body.duration,      { max: 20,   allowNull: true, name: 'duration' })],
    ['requesterName', validateString(body.requesterName, { max: 50,   allowNull: true, name: 'requesterName' })],
  ];
  const value = {};
  for (const [key, result] of checks) {
    if (result.error) return { error: result.error };
    value[key] = result.value;
  }
  return { value };
}

module.exports = {
  validateString,
  validateInEnum,
  validateBool,
  validateDateString,
  validateCoordinate,
  validateRecommendationBody,
  isUuid,
};
