// 손님 좋아요 기록.
//
// 서버는 (카페, 곡, 방문자)당 한 표만 받는다. 화면의 눌림 표시도 같은 단위여야
// 하므로 신청곡 ID가 아니라 곡 키로 저장한다 — 같은 곡이 큐·최근 재생·TOP에
// 서로 다른 행으로 있어도 눌림 상태는 하나다. slug별로 분리되지 않으면 다른
// 매장에서 이미 눌린 것처럼 보이고, 예외가 새어 나가면 버튼이 렌더링되지 않는다.
//
// 계약: docs/AI_CHANGE_GUARDRAILS.md#anonymous-visitor-identity-contract
import { describe, it, expect, beforeEach } from 'vitest';
import { hasVoted, markVoted, removeVote } from './votedSongs';

beforeEach(() => localStorage.clear());

describe('votedSongs', () => {
  it('기록하지 않은 곡은 투표하지 않은 것이다', () => {
    expect(hasVoted('cafe', 'track-1')).toBe(false);
  });

  it('기록한 곡을 기억한다', () => {
    markVoted('cafe', 'track-1');
    expect(hasVoted('cafe', 'track-1')).toBe(true);
  });

  it('매장별로 분리해 저장한다', () => {
    markVoted('cafe-a', 'track-1');
    expect(hasVoted('cafe-b', 'track-1')).toBe(false);
  });

  it('같은 곡을 여러 번 기록해도 한 번만 쌓는다', () => {
    markVoted('cafe', 'track-1');
    markVoted('cafe', 'track-1');
    expect(JSON.parse(localStorage.getItem('cf_voted_song_cafe'))).toEqual(['track-1']);
  });

  it('빈 곡 키는 저장하지도 눌린 것으로 보지도 않는다', () => {
    markVoted('cafe', '');
    expect(hasVoted('cafe', '')).toBe(false);
    expect(localStorage.getItem('cf_voted_song_cafe')).toBeNull();
  });

  it('저장값이 배열이 아니어도 무시한다', () => {
    localStorage.setItem('cf_voted_song_cafe', '{"not":"array"}');
    expect(hasVoted('cafe', 'track-1')).toBe(false);
  });

  it('투표를 취소하면 해당 곡만 지운다', () => {
    markVoted('cafe', 'track-1');
    markVoted('cafe', 'track-2');
    removeVote('cafe', 'track-1');
    expect(hasVoted('cafe', 'track-1')).toBe(false);
    expect(hasVoted('cafe', 'track-2')).toBe(true);
  });

  it('저장값이 깨져 있어도 화면을 죽이지 않는다', () => {
    localStorage.setItem('cf_voted_song_cafe', '{not json');
    expect(hasVoted('cafe', 'track-1')).toBe(false);
    expect(() => markVoted('cafe', 'track-1')).not.toThrow();
    expect(() => removeVote('cafe', 'track-1')).not.toThrow();
  });
});
