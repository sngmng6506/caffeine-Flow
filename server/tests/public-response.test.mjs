import { describe, expect, it } from 'vitest';
import serializers from '../src/utils/public-response.js';

const {
  publicRecommendation,
  ownerRecommendation,
  recommendationComment,
  songComment,
} = serializers;

const rawRecommendation = {
  id: 'rec-id',
  video_id: 'video-id',
  title: '곡',
  status: 'pending',
  vote_count: 0,
  visitor_id: 'private-visitor',
  requester_ip: '203.0.113.1',
  filter_status: 'accepted',
  filter_reason: '매장 정책과 일치',
  filter_confidence: 0.99,
  filter_model: 'private-model',
  filter_error_code: 'private-error',
};

describe('공개 응답 allowlist', () => {
  it('손님 추천곡 응답은 소유 여부만 계산하고 식별자·AI 내부 정보를 제외한다', () => {
    const result = publicRecommendation(rawRecommendation, { visitorId: 'private-visitor' });
    expect(result.is_mine).toBe(true);
    expect(result).not.toHaveProperty('visitor_id');
    expect(result).not.toHaveProperty('requester_ip');
    expect(result).not.toHaveProperty('filter_status');
    expect(result).not.toHaveProperty('filter_model');
  });

  it('사장님 추천곡 응답도 IP·visitor·모델 진단을 제외한다', () => {
    const result = ownerRecommendation(rawRecommendation);
    expect(result).toMatchObject({ filter_status: 'accepted', filter_reason: '매장 정책과 일치' });
    expect(result).not.toHaveProperty('visitor_id');
    expect(result).not.toHaveProperty('requester_ip');
    expect(result).not.toHaveProperty('filter_confidence');
    expect(result).not.toHaveProperty('filter_model');
    expect(result).not.toHaveProperty('filter_error_code');
  });

  it('신청곡·곡 댓글과 중첩 답글에서 익명 식별자를 제거한다', () => {
    const rawComment = {
      id: 'comment-id',
      video_id: 'video-id',
      body: '댓글',
      visitor_id: 'private-visitor',
      commenter_ip: '203.0.113.2',
    };
    expect(recommendationComment(rawComment)).not.toHaveProperty('commenter_ip');
    const result = songComment({ ...rawComment, replies: [{ ...rawComment, id: 'reply-id' }] });
    expect(result).not.toHaveProperty('visitor_id');
    expect(result.replies[0]).not.toHaveProperty('commenter_ip');
  });
});
