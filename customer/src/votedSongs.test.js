// 손님 투표 기록.
//
// 서버는 visitor ID로 중복 투표를 막지만 화면의 "투표함" 표시는 이 로컬
// 기록이 판단한다. slug별로 분리되지 않으면 다른 매장에서 이미 투표한 것처럼
// 보이고, 예외가 새어 나가면 투표 버튼 자체가 렌더링되지 않는다.
//
// 계약: docs/AI_CHANGE_GUARDRAILS.md#anonymous-visitor-identity-contract
import { describe, it, expect, beforeEach } from 'vitest';
import { hasVoted, markVoted, removeVote } from './votedSongs';

beforeEach(() => localStorage.clear());

describe('votedSongs', () => {
  it('기록하지 않은 곡은 투표하지 않은 것이다', () => {
    expect(hasVoted('cafe', 'rec-1')).toBe(false);
  });

  it('기록한 곡을 기억한다', () => {
    markVoted('cafe', 'rec-1');
    expect(hasVoted('cafe', 'rec-1')).toBe(true);
  });

  it('매장별로 분리해 저장한다', () => {
    markVoted('cafe-a', 'rec-1');
    expect(hasVoted('cafe-b', 'rec-1')).toBe(false);
  });

  it('같은 곡을 여러 번 기록해도 한 번만 쌓는다', () => {
    markVoted('cafe', 'rec-1');
    markVoted('cafe', 'rec-1');
    expect(JSON.parse(localStorage.getItem('cf_voted_cafe'))).toEqual(['rec-1']);
  });

  it('투표를 취소하면 해당 곡만 지운다', () => {
    markVoted('cafe', 'rec-1');
    markVoted('cafe', 'rec-2');
    removeVote('cafe', 'rec-1');
    expect(hasVoted('cafe', 'rec-1')).toBe(false);
    expect(hasVoted('cafe', 'rec-2')).toBe(true);
  });

  it('저장값이 깨져 있어도 화면을 죽이지 않는다', () => {
    localStorage.setItem('cf_voted_cafe', '{not json');
    expect(hasVoted('cafe', 'rec-1')).toBe(false);
    expect(() => markVoted('cafe', 'rec-1')).not.toThrow();
    expect(() => removeVote('cafe', 'rec-1')).not.toThrow();
  });
});
