// 소비 프롬프트에 넣을 MAEST 스타일 선택 규칙. 실제 분석 결과의 점수 분포로
// 고정한다 — 1위가 압도적이면 하나, 상위권이 붙어 있으면 여럿이어야 한다.
import { describe, it, expect } from 'vitest';
import pkg from '../src/features/audio-analysis/runs.js';

const { selectPromptStyles } = pkg;

function raw(scores) {
  const classes = scores.map((_, i) => `Genre---Style ${i}`);
  return { classes, mean: scores };
}

describe('소비 프롬프트 스타일 선택', () => {
  it('1위가 압도적이면 하나만 넣는다', () => {
    // 실측: SEVENTEEN 곡은 K-pop 0.966, 2위 Ballad 0.10.
    const picked = selectPromptStyles(raw([0.966, 0.10, 0.04, 0.03]));

    expect(picked).toHaveLength(1);
    expect(picked[0].label).toBe('Genre---Style 0');
  });

  it('상위권이 붙어 있으면 여럿을 넣는다', () => {
    // 실측: 헤비메탈 곡은 0.41 / 0.38 / 0.31 / 0.18.
    const picked = selectPromptStyles(raw([0.405, 0.38, 0.31, 0.18, 0.17]));

    expect(picked.map((v) => v.score)).toEqual([0.405, 0.38, 0.31]);
  });

  it('점수 스케일이 낮아도 상대 기준으로 판단한다', () => {
    // 실측: 빅밴드 재즈는 1위가 0.334뿐이지만 2위와 격차가 크다.
    const picked = selectPromptStyles(raw([0.334, 0.16, 0.12, 0.07]));

    expect(picked).toHaveLength(1);
  });

  it('상한을 넘기지 않는다', () => {
    expect(selectPromptStyles(raw(Array(20).fill(0.3)))).toHaveLength(5);
  });

  it('경계값을 포함한다', () => {
    expect(selectPromptStyles(raw([0.4, 0.2, 0.19]))).toHaveLength(2);
  });

  it('계수와 상한을 조정할 수 있다', () => {
    const scores = raw([0.4, 0.38, 0.31, 0.18]);

    expect(selectPromptStyles(scores, 0.9)).toHaveLength(2);
    expect(selectPromptStyles(scores, 0.5, 2)).toHaveLength(2);
  });

  it('점수가 모두 0이면 아무것도 넣지 않는다', () => {
    expect(selectPromptStyles(raw([0, 0, 0]))).toEqual([]);
  });
});
