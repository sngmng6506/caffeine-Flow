// 곡 키 정규화.
//
// 좋아요가 곡 단위이므로 화면과 서버가 같은 규칙으로 곡을 묶어야 한다.
// 한쪽만 바뀌면 화면에서는 눌린 것으로 보이는데 서버는 다른 곡으로 세는
// 어긋남이 생긴다. 서버의 canonicalizeVideoId와 같은 규칙이다.
//
// 계약: docs/AI_CHANGE_GUARDRAILS.md#anonymous-visitor-identity-contract
import { describe, it, expect } from 'vitest';
import { trackKeyOf } from './trackKey';

describe('trackKeyOf', () => {
  it('추적 파라미터가 붙은 같은 곡을 하나로 묶는다', () => {
    expect(trackKeyOf('abc?si=xyz')).toBe(trackKeyOf('abc'));
  });

  it('파라미터가 없으면 그대로 쓴다', () => {
    expect(trackKeyOf('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('첫 물음표만 자른다', () => {
    expect(trackKeyOf('abc?a=1?b=2')).toBe('abc');
  });

  it('전체 URL도 쿼리스트링만 떼고 경로는 남긴다', () => {
    expect(trackKeyOf('https://soundcloud.com/a/b?utm=1')).toBe('https://soundcloud.com/a/b');
  });

  it('빈 값은 빈 문자열이다', () => {
    for (const empty of ['', null, undefined]) expect(trackKeyOf(empty)).toBe('');
  });
});
