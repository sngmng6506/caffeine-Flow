import { describe, it, expect } from 'vitest';
import {
  ONE_MINUTE_MS,
  GLOBAL_API_RATE_LIMIT,
  QUEUE_MAX_SIZE,
  VISITOR_ID_MAX_LENGTH,
  RECOMMENDATION_REQUEST_LIMIT,
  VOTE_LIMIT,
  COMMENT_LIMIT,
  ADMIN_LOGIN_LIMIT,
} from '../src/constants/limits.js';

describe('운영 한도 정책 상수', () => {
  it('전역 API rate limit은 분당 120회다', () => {
    expect(GLOBAL_API_RATE_LIMIT).toEqual({ windowMs: ONE_MINUTE_MS, max: 120 });
  });

  it('추천곡 큐 최대 active 개수는 30곡이다', () => {
    expect(QUEUE_MAX_SIZE).toBe(30);
  });

  it('visitor id 헤더 최대 길이는 64자다', () => {
    expect(VISITOR_ID_MAX_LENGTH).toBe(64);
  });

  it('신청 rate limit은 visitor 3회/min, IP 10회/min이다', () => {
    expect(RECOMMENDATION_REQUEST_LIMIT).toEqual({
      windowMs: ONE_MINUTE_MS,
      visitorMax: 3,
      ipMax: 10,
    });
  });

  it('투표 rate limit은 visitor 15회/min, IP 40회/min이다', () => {
    expect(VOTE_LIMIT).toEqual({
      windowMs: ONE_MINUTE_MS,
      visitorMax: 15,
      ipMax: 40,
    });
  });

  it('댓글 rate limit은 visitor 5회/min, IP 15회/min이다', () => {
    expect(COMMENT_LIMIT).toEqual({
      windowMs: ONE_MINUTE_MS,
      visitorMax: 5,
      ipMax: 15,
    });
  });

  it('운영자 로그인은 15분 동안 10회로 제한한다', () => {
    expect(ADMIN_LOGIN_LIMIT).toEqual({ windowMs: 15 * ONE_MINUTE_MS, max: 10 });
  });
});
