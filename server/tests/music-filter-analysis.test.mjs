// 음향 분석을 실시간 필터 프롬프트에 연결한 경로. 분석은 판단을 돕는 재료이지
// 판단의 전제가 아니므로, 없거나 조회에 실패해도 필터가 멈추면 안 된다.
import { describe, it, expect } from 'vitest';
process.env.NODE_ENV = 'test';
const { buildMusicFilterMessages, promptAnalysis } =
  await import('../src/features/music-filter/prompt.builder.js');
const { shape } = await import('../src/features/music-filter/track-analysis.js');

const track = { platform: 'youtube', title: '곡', channelTitle: '아티스트', duration: '3:06' };
const analysis = {
  valence: 0.63, arousal: 0.81, bpm: 142.6,
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

  it('분석이 있으면 서술과 악기를 함께 준다', () => {
    const text = userText({ cafePrompt: '잔잔한 카페', track, analysis });
    expect(text).toContain('재즈로 시작해 록으로 전환합니다.');
    expect(text).toContain('트럼펫');
  });

  it('구간별 서술을 순서를 유지해 넣는다', () => {
    // 곡 전체를 한 문장으로 뭉갠 서술로는 "조용히 시작해 후렴에서 커진다"를 알 수
    // 없다. 매장 적합성에는 그 변화가 쓰인다. 3단이 들은 구간 순서를 유지해야
    // 사장님 정책의 "갑자기 시끄러워지는 곡"과 맞춰볼 수 있다.
    const text = userText({ cafePrompt: '잔잔한 카페',
      track,
      analysis: { ...analysis, structure: ['조용한 피아노 인트로', '드럼이 들어오며 커진다', '후렴이 반복된다'] } });
    expect(text).toContain('구간별');
    expect(text).toContain('1) 조용한 피아노 인트로');
    expect(text).toContain('3) 후렴이 반복된다');
  });

  it('구간별 서술이 없으면 그 줄을 렌더하지 않는다', () => {
    const text = userText({ cafePrompt: '잔잔한 카페', track, analysis });
    expect(text).not.toContain('구간별');
  });

  it('shape가 구간별 서술을 필터까지 전달한다', () => {
    // 저장은 되는데 소비처로 오지 않던 필드다. 배관이 끊기면 조용히 사라진다.
    const shaped = shape({
      features: {},
      analysis_summary: { audio_llm: { description: '서술', structure: ['1구간', '2구간'] } },
    });
    expect(shaped.structure).toEqual(['1구간', '2구간']);
  });

  it('V/A는 척도의 양 끝을 붙인 숫자로 준다', () => {
    // 보정된 값이라 숫자가 뜻을 갖는다. 밴드 이름으로 뭉치면 가까운 값의 차이가
    // 사라지고, 척도 없이 숫자만 주면 모델이 제멋대로 해석한다.
    const text = userText({ cafePrompt: '잔잔한 카페', track, analysis });
    expect(text).toContain('밝기: 0.63 (0.00 어두움 ~ 1.00 밝음)');
    expect(text).toContain('활력: 0.81 (0.00 차분함 ~ 1.00 격렬함)');
    expect(text).toContain('약 143 BPM');
  });

  it('V/A 중 없는 값의 줄은 렌더하지 않는다', () => {
    const text = userText({ cafePrompt: '잔잔한 카페',
      track,
      analysis: { ...analysis, valence: null } });
    expect(text).not.toContain('밝기:');
    expect(text).toContain('활력: 0.81');
  });

  it('장르 후보를 프롬프트에 넣지 않는다', () => {
    // 장르를 판단할 모델이 없다. 없는 장르를 지어내 넣지 않는다.
    const text = userText({ cafePrompt: '잔잔한 카페', track, analysis });
    expect(text).not.toContain('장르 후보');
    expect(promptAnalysis(analysis).styles).toBeUndefined();
  });

  it('사장님 매장 정책이 여전히 판단의 기준이다', () => {
    const text = userText({ cafePrompt: '조용한 북카페입니다', track, analysis });
    expect(text.indexOf('조용한 북카페입니다')).toBeLessThan(text.indexOf('[음향 분석'));
  });

  it('쓸 만한 내용이 하나도 없는 분석은 없는 것으로 본다', () => {
    expect(shape(null)).toBeNull();
    expect(shape({ features: {}, analysis_summary: {} })).toBeNull();
  });

  it('긴 서술은 잘라서 넣는다', () => {
    const long = { features: {}, analysis_summary: {
      audio_llm: { description: '가'.repeat(900), mood: [], instruments: [], vocal: [] },
    } };
    expect(shape(long).description.length).toBeLessThanOrEqual(601);
    expect(shape(long).description.endsWith('…')).toBe(true);
  });

  it('3단 서술이 없어도 감정값만으로 분석을 만든다', () => {
    // 장르를 판단할 모델이 없으므로 서술이 빠지면 남는 객관 신호는 V/A뿐이다.
    const emotionOnly = shape({ features: { valence: 0.4, arousal: 0.2, bpm: 78 },
      analysis_summary: { audio_llm: null } });
    expect(emotionOnly.description).toBe('');
    const text = userText({ cafePrompt: '잔잔한 카페', track, analysis: emotionOnly });
    expect(text).toContain('0.20');
    expect(text).toContain('78');
  });
});
