// 자동 음향 분석 모듈의 입구. 모듈 밖(라우트·서비스)은 이 파일만 부른다.
//
// 여기에 적힌 함수가 이 모듈이 바깥에 약속하는 전부다. 적히지 않은 함수와 파일
// (normalization, suspicion, discovery-window, runs.summary 등)은 모듈 내부
// 사정이라 바깥 호출부를 찾지 않고 고쳐도 된다. 바깥에서 새 함수가 필요하면
// 내부 파일을 직접 부르지 말고 여기에 추가한다 — audio-analysis-entry.test.mjs가
// 우회를 잡는다.
const service = require('./service');
const result = require('./result');
const jobs = require('./jobs');
const runs = require('./runs');
const discovery = require('./discovery');
const labels = require('./labels');
const settings = require('./settings');

module.exports = {
  // 워커가 제출한 결과
  validateAudioAnalysisResult: result.validateAudioAnalysisResult,
  saveResult: service.saveResult,

  // 분석 작업 큐. enqueue는 신청곡 저장과 같은 트랜잭션에서 부른다.
  jobs: {
    enqueue: jobs.enqueue,
    claim: jobs.claim,
    complete: jobs.complete,
    fail: jobs.fail,
    resume: jobs.resume,
    requeue: jobs.requeue,
    requeueRejected: jobs.requeueRejected,
  },

  // 분석 원본 이력
  runs: {
    validateRun: runs.validateRun,
    history: runs.history,
  },

  // 최신곡 수집
  discovery: {
    request: discovery.request,
    claim: discovery.claim,
    complete: discovery.complete,
    fail: discovery.fail,
    recent: discovery.recent,
  },

  // 운영자 라벨 검토
  labels: {
    list: labels.list,
    review: labels.review,
  },

  // 3단(Audio LLM) 실행 설정
  settings: {
    get: settings.get,
    update: settings.update,
    revisions: settings.revisions,
  },
};
