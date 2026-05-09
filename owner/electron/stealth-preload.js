// 봇 탐지 우회 — Electron 노출 전역 변수 제거 및 navigator 패치
try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch (_) {}
try { delete window.process; } catch (_) {}
try { delete window.require; } catch (_) {}

// Chrome 런타임 객체 보강 (Electron에서 누락되는 경우 있음)
if (!window.chrome) window.chrome = {};
if (!window.chrome.runtime) window.chrome.runtime = {};
