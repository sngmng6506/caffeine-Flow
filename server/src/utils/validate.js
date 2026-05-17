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

module.exports = { validateString, validateInEnum, validateBool };
