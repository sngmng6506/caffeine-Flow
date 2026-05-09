// 봇 탐지 우회 — Electron 노출 전역 변수 제거 및 navigator 패치
try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch (_) {}
try { delete window.process; } catch (_) {}
try { delete window.require; } catch (_) {}

// Chrome 런타임 객체 보강 (Electron에서 누락되는 경우 있음)
if (!window.chrome) window.chrome = {};
if (!window.chrome.runtime) window.chrome.runtime = {};

// Spotify 플레이어 초기화 — 임베디드 브라우저 감지 우회
// window.self !== window.top 이면 embed로 판단해 기능 제한하는 코드 대응
try {
  Object.defineProperty(window, 'self', { get: () => window });
  Object.defineProperty(window, 'top',  { get: () => window });
} catch (_) {}

// plugins 배열 보강 (빈 배열이면 헤드리스 브라우저로 감지)
try {
  if (navigator.plugins.length === 0) {
    Object.defineProperty(navigator, 'plugins', {
      get: () => [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }],
    });
  }
} catch (_) {}
