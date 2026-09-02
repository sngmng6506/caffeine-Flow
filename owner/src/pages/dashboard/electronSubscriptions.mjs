// Electron 이벤트 구독을 한 번에 걸고 한 번에 푼다.
//
// 훅에서 채널마다 removeX 변수를 만들고 cleanup에서 다시 8줄로 해제하던 것을
// 대체한다. 채널을 추가할 때 구독은 했는데 해제를 빠뜨리는 실수를 구조적으로
// 막는 것이 목적이다 — renderer reload가 잦은 화면이라 누수가 곧 중복 이벤트다.
//
// 구버전 설치본에는 없는 채널이 있으므로(owner UI는 Railway에서 최신을 불러와
// preload보다 앞설 수 있다) 없는 채널은 조용히 건너뛴다.

/**
 * @param {object|undefined} electronAPI  window.electronAPI
 * @param {Record<string, Function>} handlers  { onVideoEnded: fn, ... }
 * @returns {() => void} 모든 구독을 해제하는 함수
 */
export function subscribeElectron(electronAPI, handlers) {
  const removers = [];
  for (const [channel, handler] of Object.entries(handlers)) {
    if (typeof handler !== 'function') continue;
    const subscribe = electronAPI?.[channel];
    if (typeof subscribe !== 'function') continue;
    const remove = subscribe(handler);
    if (typeof remove === 'function') removers.push(remove);
  }
  return () => {
    while (removers.length) removers.pop()();
  };
}
