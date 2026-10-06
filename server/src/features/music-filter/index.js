// 음악 필터 모듈의 입구. 모듈 밖(라우트·서비스)은 이 파일만 부른다.
//
// 여기에 적힌 것이 이 모듈이 바깥에 약속하는 전부다. 프롬프트 생성·LLM 호출·판정
// 정규화(prompt.builder, llm.client, decision.policy)와 track-analysis는 모듈 내부
// 사정이다. 바깥에서 새 기능이 필요하면 내부 파일을 직접 부르지 말고 여기에
// 추가한다 — feature-entry.test.mjs가 우회를 잡는다.
//
// 측정 스크립트(scripts/filter-stability.js)와 테스트는 필터를 부품별로 재는 것이
// 목적이라 내부 파일을 직접 부른다. 그 둘은 이 규칙의 대상이 아니다.
const service = require('./music-filter.service');
const publicGuide = require('./public-guide.service');
const publicGuideBudget = require('./public-guide-budget');

module.exports = {
  // 신청곡·테스트 곡 판정. 실패하면 거절이다(fail-closed).
  evaluateRecommendation: service.evaluateRecommendation,
  evaluateTrack: service.evaluateTrack,

  // 손님용 신청곡 안내
  generatePublicMusicGuide: publicGuide.generatePublicMusicGuide,
  normalizePublicGuide: publicGuide.normalizePublicGuide,
  PUBLIC_GUIDE_MAX_LENGTH: publicGuide.PUBLIC_GUIDE_MAX_LENGTH,

  // 안내 생성의 영속 일일 예산. 외부 호출 전에 reserve, 끝나면 release.
  publicGuideBudget: {
    reserve: publicGuideBudget.reserve,
    release: publicGuideBudget.release,
  },
};
