async function requestBgmChange(electronAPI, method, ...args) {
  const handler = electronAPI?.[method];
  if (typeof handler !== 'function') return true;

  const result = await handler(...args);
  // 원격 owner SPA가 구버전 설치본보다 먼저 배포될 수 있다. ACK capability가
  // 없는 기존 preload는 send 후 undefined를 반환하므로 기존 성공으로 취급한다.
  return electronAPI.supportsBgmAck === true ? result === true : true;
}

export function requestSetBgmUrl(electronAPI, url) {
  return requestBgmChange(electronAPI, 'setBgmUrl', url);
}

export function requestClearBgm(electronAPI) {
  return requestBgmChange(electronAPI, 'clearBgm');
}
