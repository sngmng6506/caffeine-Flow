// 수집 소스. 워커가 이 값을 보고 어디서 곡 목록을 가져올지 정한다.
const DISCOVERY_SOURCES = Object.freeze(['apple_kr', 'soundcloud']);
const DISCOVERY_MAX_LIMIT = 50;
const DISCOVERY_LEASE_MINUTES = 20;
const DISCOVERY_MAX_ATTEMPTS = 3;

module.exports = {
  DISCOVERY_SOURCES, DISCOVERY_MAX_LIMIT, DISCOVERY_LEASE_MINUTES, DISCOVERY_MAX_ATTEMPTS,
};
