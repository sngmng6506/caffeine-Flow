import { describe, it, expect } from 'vitest';
import { validateString, validateInEnum, validateBool, validateRecommendationBody } from '../src/utils/validate.js';

describe('validateString', () => {
  it('정상 문자열은 trim된 value 반환', () => {
    expect(validateString('  hello ', { max: 10 })).toEqual({ value: 'hello' });
  });
  it('누락 시 error, allowNull이면 null', () => {
    expect(validateString(undefined, { name: 'x' }).error).toContain('x');
    expect(validateString(undefined, { allowNull: true })).toEqual({ value: null });
    expect(validateString('', { allowNull: true })).toEqual({ value: null });
  });
  it('문자열 아닌 타입·max 초과 거부', () => {
    expect(validateString(123).error).toBeTruthy();
    expect(validateString({}).error).toBeTruthy();
    expect(validateString('a'.repeat(11), { max: 10 }).error).toBeTruthy();
  });
  it('공백만 있는 입력은 min 검증에 걸림', () => {
    expect(validateString('   ').error).toBeTruthy();
  });
});

describe('validateInEnum', () => {
  it('허용 목록 검증', () => {
    expect(validateInEnum('youtube', ['youtube', 'spotify'])).toEqual({ value: 'youtube' });
    expect(validateInEnum('naver', ['youtube', 'spotify']).error).toBeTruthy();
  });
  it('undefined + defaultValue', () => {
    expect(validateInEnum(undefined, ['a'], { defaultValue: 'a' })).toEqual({ value: 'a' });
  });
});

describe('validateBool', () => {
  it('boolean과 문자열 true/false 허용, 그 외 거부', () => {
    expect(validateBool(true)).toEqual({ value: true });
    expect(validateBool('false')).toEqual({ value: false });
    expect(validateBool(1).error).toBeTruthy();
    expect(validateBool('yes').error).toBeTruthy();
  });
});

describe('validateRecommendationBody', () => {
  const valid = { videoId: 'abc123', title: '노래 제목' };

  it('필수 필드만으로 통과, 선택 필드는 null', () => {
    const r = validateRecommendationBody(valid);
    expect(r.error).toBeUndefined();
    expect(r.value.videoId).toBe('abc123');
    expect(r.value.channelTitle).toBeNull();
    expect(r.value.requesterName).toBeNull();
  });
  it('videoId/title 누락 시 error', () => {
    expect(validateRecommendationBody({ title: 't' }).error).toBeTruthy();
    expect(validateRecommendationBody({ videoId: 'v' }).error).toBeTruthy();
    expect(validateRecommendationBody().error).toBeTruthy();
  });
  it('필드 길이 제한 적용', () => {
    expect(validateRecommendationBody({ ...valid, title: 'a'.repeat(501) }).error).toBeTruthy();
    expect(validateRecommendationBody({ ...valid, requesterName: 'a'.repeat(51) }).error).toBeTruthy();
  });
});
