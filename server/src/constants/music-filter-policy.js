const MUSIC_FILTER_STRICTNESS = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
});

const VALID_MUSIC_FILTER_STRICTNESS = Object.freeze(Object.values(MUSIC_FILTER_STRICTNESS));

const DEFAULT_MUSIC_FILTER_STRICTNESS = MUSIC_FILTER_STRICTNESS.MEDIUM;

const MUSIC_FILTER_STRICTNESS_GUIDES = Object.freeze({
  [MUSIC_FILTER_STRICTNESS.LOW]: '느슨하게: 명확히 매장 분위기를 해치는 곡만 거절합니다.',
  [MUSIC_FILTER_STRICTNESS.MEDIUM]: '보통: 매장 분위기와 잘 맞지 않는 곡은 거절합니다.',
  [MUSIC_FILTER_STRICTNESS.HIGH]: '엄격하게: 매장 분위기와 조금이라도 충돌할 가능성이 크면 거절합니다.',
});

module.exports = {
  MUSIC_FILTER_STRICTNESS,
  VALID_MUSIC_FILTER_STRICTNESS,
  DEFAULT_MUSIC_FILTER_STRICTNESS,
  MUSIC_FILTER_STRICTNESS_GUIDES,
};
