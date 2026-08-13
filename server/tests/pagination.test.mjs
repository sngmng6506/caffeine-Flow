import { describe, expect, it } from 'vitest';
import pagination from '../src/utils/pagination.js';

const { parseBoundedInteger, parseLimit, parseOffset, parseTopSort } = pagination;

describe('페이지네이션 입력 검증', () => {
  it('offset 기본값과 정상 정수를 반환한다', () => {
    expect(parseOffset(undefined)).toEqual({ value: 0 });
    expect(parseOffset('25')).toEqual({ value: 25 });
  });

  it.each(['-1', '1.5', '1abc', ' 1', '10001'])('잘못된 offset %s를 거절한다', (value) => {
    expect(parseOffset(value).error).toContain('offset');
  });

  it('limit 기본값·상한을 적용한다', () => {
    expect(parseLimit(undefined, { defaultValue: 20, max: 50 })).toEqual({ value: 20 });
    expect(parseLimit('50', { defaultValue: 20, max: 50 })).toEqual({ value: 50 });
    expect(parseLimit('51', { defaultValue: 20, max: 50 }).error).toContain('limit');
  });

  it('범위가 있는 일반 정수 파라미터도 엄격히 검증한다', () => {
    expect(parseBoundedInteger('23', { name: 'hour', defaultValue: 0, min: 0, max: 23 })).toEqual({ value: 23 });
    expect(parseBoundedInteger('23시', { name: 'hour', defaultValue: 0, min: 0, max: 23 }).error).toContain('hour');
  });

  it('TOP 정렬 키를 allowlist로 제한한다', () => {
    expect(parseTopSort(undefined)).toEqual({ value: 'count' });
    expect(parseTopSort('votes')).toEqual({ value: 'votes' });
    expect(parseTopSort('count desc').error).toBeTruthy();
  });
});
