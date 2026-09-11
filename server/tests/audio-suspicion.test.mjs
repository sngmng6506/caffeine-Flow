import { describe, expect, it } from 'vitest';
import suspicion from '../src/features/audio-analysis/suspicion.js';

const { RULES, SUSPICION_SQL, reasons, score, DESCRIPTION_MIN_LENGTH } = suspicion;

const LONG = '가'.repeat(DESCRIPTION_MIN_LENGTH);

// 아무 신호도 없는 곡. 각 테스트가 필요한 것만 어긋뜨린다.
function clean(overrides = {}) {
  const { llm, annotation, ...row } = overrides;
  return {
    channel_title: '같은 아티스트',
    attempts: 1,
    track_annotation: { artist_name: '같은 아티스트', genre_tags: ['jazz'], ...annotation },
    audio_analysis: {
      maest_summary: {
        audio_llm: {
          description: LONG,
          instruments: ['피아노'],
          vocal: ['여성 보컬'],
          ...llm,
        },
      },
    },
    ...row,
  };
}

const codes = (row) => reasons(row).map((reason) => reason.code);

describe('검토 큐 의심 신호', () => {
  it('신호가 없는 곡은 사유도 점수도 없다', () => {
    expect(codes(clean())).toEqual([]);
    expect(score(clean())).toBe(0);
  });

  it('수집 이름과 저장 아티스트가 다르면 가장 무겁게 잡는다', () => {
    const row = clean({ annotation: { artist_name: '다른 아티스트' } });

    expect(codes(row)).toContain('artist_mismatch');
    // 다른 곡을 분석했을 수 있어 서술 전체가 무의미해진다. 단일 신호 중 가장 무겁다.
    const weights = RULES.map((rule) => rule.weight);
    expect(RULES.find((rule) => rule.code === 'artist_mismatch').weight).toBe(Math.max(...weights));
  });

  it('대소문자와 앞뒤 공백 차이는 다른 이름으로 보지 않는다', () => {
    const row = clean({ channel_title: '  IU  ', annotation: { artist_name: 'iu' } });

    expect(codes(row)).not.toContain('artist_mismatch');
  });

  it('한쪽 이름이 비어 있으면 불일치로 세지 않는다', () => {
    expect(codes(clean({ channel_title: '' }))).not.toContain('artist_mismatch');
    expect(codes(clean({ annotation: { artist_name: '' } }))).not.toContain('artist_mismatch');
  });

  it('짧은 서술과 못 짚은 악기·보컬을 잡는다', () => {
    const row = clean({ llm: { description: '조용한 곡', instruments: [], vocal: [] } });

    expect(codes(row)).toEqual(
      expect.arrayContaining(['thin_description', 'no_instruments', 'no_vocal']),
    );
  });

  it('장르를 정하지 못한 곡과 재시도한 곡을 잡는다', () => {
    expect(codes(clean({ annotation: { genre_tags: ['unknown'] } }))).toContain('unknown_genre');
    expect(codes(clean({ attempts: 3 }))).toContain('retried');
  });

  it('신호가 쌓이면 점수가 커진다', () => {
    const worst = clean({
      annotation: { artist_name: '다른 아티스트', genre_tags: ['unknown'] },
      llm: { description: '짧음', instruments: [], vocal: [] },
      attempts: 2,
    });

    expect(score(worst)).toBe(RULES.reduce((sum, rule) => sum + rule.weight, 0));
    expect(score(worst)).toBeGreaterThan(score(clean({ attempts: 2 })));
  });

  it('분석이나 라벨이 없는 행에서도 터지지 않는다', () => {
    for (const row of [{}, { track_annotation: null, audio_analysis: null }]) {
      expect(() => reasons(row)).not.toThrow();
    }
  });

  it('정렬 SQL이 모든 규칙에서 파생된다', () => {
    // 규칙을 늘리고 SQL을 따로 적으면 "왜 위로 왔는지"와 실제 순서가 어긋난다.
    for (const rule of RULES) {
      expect(SUSPICION_SQL).toContain(`THEN ${rule.weight}`);
    }
    expect(SUSPICION_SQL.match(/CASE WHEN/g)).toHaveLength(RULES.length);
  });

  it('MAEST 점수를 정렬 근거로 쓰지 않는다', () => {
    // runs.js가 밝혔듯 점수 스케일이 곡마다 달라 절대값 비교가 성립하지 않는다.
    expect(SUSPICION_SQL).not.toContain('prompt_styles');
    expect(SUSPICION_SQL).not.toContain('top_mean');
  });
});
