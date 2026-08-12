// 외부 WebContents 기본값. stealth preload는 플랫폼 main world 보정 때문에
// contextIsolation만 예외이며, 두 정책 모두 Node integration과 sandbox 경계는 같다.
const ISOLATED_EXTERNAL_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
});

const STEALTH_EXTERNAL_WEB_PREFERENCES = Object.freeze({
  contextIsolation: false,
  nodeIntegration: false,
  sandbox: true,
});

module.exports = {
  ISOLATED_EXTERNAL_WEB_PREFERENCES,
  STEALTH_EXTERNAL_WEB_PREFERENCES,
};
