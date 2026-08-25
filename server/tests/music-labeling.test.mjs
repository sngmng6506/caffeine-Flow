import { describe, expect, it } from 'vitest';
import {
  normalizeArtistKey,
  validateMusicAnnotation,
} from '../src/features/music-labeling/annotation.js';

const validAnnotation = {
  artist_name: '  검정치마 - Topic  ',
  track_version: 'original',
  tempo_class: 'moderate',
  mood_tags: ['peaceful', 'nostalgic'],
  instrumentation_type: 'hybrid',
  rhythmic_character: 'steady',
  vocal_type: 'singing',
  genre_tags: ['rock_metal'],
  note: '늦은 저녁에 어울리는 차분한 질감',
  usage_scope: 'operational',
};

describe('음악 수동 라벨 검증', () => {
  it('아티스트명을 정규화하고 정형 라벨을 저장 형태로 만든다', () => {
    expect(normalizeArtistKey('검정치마 - Topic')).toBe('검정치마');
    expect(validateMusicAnnotation(validAnnotation)).toEqual({
      value: expect.objectContaining({
        artist_name: '검정치마 - Topic',
        artist_key: '검정치마',
        mood_tags: ['peaceful', 'nostalgic'],
        genre_tags: ['rock_metal'],
        schema_version: 1,
      }),
    });
  });

  it('주요 분위기는 최대 두 개만 허용한다', () => {
    expect(validateMusicAnnotation({
      ...validAnnotation,
      mood_tags: ['peaceful', 'nostalgic', 'tender'],
    }).error).toBeTruthy();
  });

  it('판단 어려움은 다른 선택과 함께 저장하지 않는다', () => {
    expect(validateMusicAnnotation({
      ...validAnnotation,
      mood_tags: ['unknown', 'peaceful'],
    }).error).toBeTruthy();
  });

  it('중복 태그와 허용되지 않은 선택값을 거절한다', () => {
    expect(validateMusicAnnotation({
      ...validAnnotation,
      genre_tags: ['jazz', 'jazz'],
    }).error).toBeTruthy();
    expect(validateMusicAnnotation({
      ...validAnnotation,
      vocal_type: 'singing_and_rap',
    }).error).toBeTruthy();
  });
});
