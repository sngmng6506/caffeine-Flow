// 음향 분석을 실시간 필터 프롬프트에 연결한 경로. 분석은 판단을 돕는 재료이지
// 판단의 전제가 아니므로, 없거나 조회에 실패해도 필터가 멈추면 안 된다.
import { describe, it, expect } from 'vitest';
process.env.NODE_ENV = 'test';
const { buildMusicFilterMessages, promptAnalysis } =
  await import('../src/features/music-filter/prompt.builder.js');
const { shape } = await import('../src/features/music-filter/track-analysis.js');

const track = { platform: 'youtube', title: '곡', channelTitle: '아티스트', duration: '3:06' };
const analysis = {
  styles: [{ label: 'Jazz — Big Band', score: 0.742 }],
  calibrated: false, valence: 0.63, arousal: 0.81, bpm: 142.6,
  description: '재즈로 시작해 록으로 전환합니다.',
  mood: ['극적'], instruments: ['트럼펫'], vocal: ['남성 리드'],
};
const userText = (input) => buildMusicFilterMessages(input)[1].content;

describe('음악 필터에 들어가는 음향 분석', () => {
  it('분석이 없으면 제목·아티스트만으로 판단하라고 말한다', () => {
    const text = userText({ cafePrompt: '잔잔한 카페', track });
    expect(text).toContain('음향 분석 기록이 없다');
    expect(text).not.toContain('[음향 분석');
    expect(text).toContain('판단 기준:');
  });

  it('분석이 있으면 서술과 장르 후보를 함께 준다', () => {
    const text = userText({ cafePrompt: '잔잔한 카페', track, analysis });
    expect(text).toContain('재즈로 시작해 록으로 전환합니다.');
    expect(text).toContain('Jazz — Big Band');
    expect(text).toContain('트럼펫');
  });

  it('0~1 값은 숫자가 아니라 말로 준다', () => {
    // 척도를 모르는 모델에게 0.81을 주면 제멋대로 해석한다.
    const text = userText({ cafePrompt: '잔잔한 카페', track, analysis });
    expect(text).toContain('격렬함');
    expect(text).toContain('약 143 BPM');
    expect(text).not.toContain('0.81');
  });

  it('MAEST 점수는 프롬프트에 넣지 않는다', () => {
    // 보정되지 않은 상대값이라 숫자를 보여주면 곡끼리 비교하게 된다.
    const text = userText({ cafePrompt: '잔잔한 카페', track, analysis });
    expect(text).not.toContain('0.742');
    expect(text).toContain('보정되지 않은 상대값');
    expect(promptAnalysis(analysis).styles).toEqual(['Jazz — Big Band']);
  });

  it('사장님 매장 정책이 여전히 판단의 기준이다', () => {
    const text = userText({ cafePrompt: '조용한 북카페입니다', track, analysis });
    expect(text.indexOf('조용한 북카페입니다')).toBeLessThan(text.indexOf('[음향 분석'));
  });

  it('쓸 만한 내용이 하나도 없는 분석은 없는 것으로 본다', () => {
    expect(shape(null)).toBeNull();
    expect(shape({ features: {}, maest_summary: { prompt_styles: [] } })).toBeNull();
  });

  it('긴 서술은 잘라서 넣는다', () => {
    const long = { features: {}, maest_summary: {
      prompt_styles: [{ label: 'Pop', score: 0.5 }],
      audio_llm: { description: '가'.repeat(900), mood: [], instruments: [], vocal: [] },
    } };
    expect(shape(long).description.length).toBeLessThanOrEqual(601);
    expect(shape(long).description.endsWith('…')).toBe(true);
  });

  it('3단 서술이 없어도 MAEST만으로 분석을 만든다', () => {
    const maestOnly = shape({ features: { valence: 0.4, arousal: 0.2, bpm: 78 },
      maest_summary: { prompt_styles: [{ label: 'Ballad', score: 0.6 }], audio_llm: null } });
    expect(maestOnly.description).toBe('');
    const text = userText({ cafePrompt: '잔잔한 카페', track, analysis: maestOnly });
    expect(text).toContain('Ballad');
    expect(text).toContain('차분함');
  });
});
