export const DEFAULT_MUSIC_FILTER_PROMPT =
  '조용한 작업 카페입니다. 잔잔한 재즈, 로파이, 어쿠스틱, 부드러운 팝은 허용하고, 욕설이 많은 곡, 클럽 음악, 과하게 시끄러운 힙합/EDM은 거절해주세요.';

export const MUSIC_FILTER_STRICTNESS = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
});

export const DEFAULT_MUSIC_FILTER_STRICTNESS = MUSIC_FILTER_STRICTNESS.MEDIUM;

export const MUSIC_FILTER_STRICTNESS_OPTIONS = Object.freeze([
  { id: MUSIC_FILTER_STRICTNESS.LOW, label: '느슨하게' },
  { id: MUSIC_FILTER_STRICTNESS.MEDIUM, label: '보통' },
  { id: MUSIC_FILTER_STRICTNESS.HIGH, label: '엄격' },
]);
