// === Electron 봇 탐지 우회 (puppeteer-extra-plugin-stealth 기반) ===
// SoundCloud / Spotify 등이 임베디드 브라우저로 판단해 로그인 차단하는 것 우회

// 1. navigator.webdriver 흔적 제거
try {
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });
} catch (_) {}

// 2. Node 흔적 제거
try { delete window.process; }  catch (_) {}
try { delete window.require; }  catch (_) {}
try { delete window.module; }   catch (_) {}
try { delete window.global; }   catch (_) {}
try { delete window.Buffer; }   catch (_) {}
try { delete window.__dirname; } catch (_) {}
try { delete window.__filename; } catch (_) {}

// 3. window.chrome 풀 모킹 (Electron은 비어있어 봇 감지 트리거)
const realChrome = {
  app: {
    isInstalled: false,
    InstallState:  { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState:  { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    getDetails: () => null,
    getIsInstalled: () => false,
  },
  runtime: {
    OnInstalledReason:        { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
    OnRestartRequiredReason:  { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
    PlatformArch:             { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
    PlatformNaclArch:         { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
    PlatformOs:               { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
    RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
    connect:    () => {},
    sendMessage:() => {},
    onMessage:  { addListener: () => {}, removeListener: () => {} },
  },
  csi:       () => ({ onloadT: Date.now(), pageT: 0, startE: Date.now(), tran: 15 }),
  loadTimes: () => ({
    commitLoadTime:               Date.now() / 1000,
    connectionInfo:               'h2',
    finishDocumentLoadTime:       0,
    finishLoadTime:               0,
    firstPaintAfterLoadTime:      0,
    firstPaintTime:               0,
    navigationType:               'Other',
    npnNegotiatedProtocol:        'h2',
    requestTime:                  Date.now() / 1000,
    startLoadTime:                Date.now() / 1000,
    wasAlternateProtocolAvailable: false,
    wasFetchedViaSpdy:            true,
    wasNpnNegotiated:             true,
  }),
};
try {
  Object.defineProperty(window, 'chrome', { value: realChrome, configurable: true, writable: false });
} catch (_) {
  if (!window.chrome) window.chrome = realChrome;
}

// 4. self === top 강제 (embed 감지 차단)
try {
  Object.defineProperty(window, 'self', { get: () => window });
  Object.defineProperty(window, 'top',  { get: () => window });
} catch (_) {}

// 5. plugins / mimeTypes — Chrome 기본값 흉내
try {
  const fakePlugin = (name, filename, description) => ({
    name, filename, description, length: 1,
    item:       () => null,
    namedItem:  () => null,
    refresh:    () => {},
  });
  const plugins = [
    fakePlugin('PDF Viewer',                  'internal-pdf-viewer', 'Portable Document Format'),
    fakePlugin('Chrome PDF Viewer',           'internal-pdf-viewer', 'Portable Document Format'),
    fakePlugin('Chromium PDF Viewer',         'internal-pdf-viewer', 'Portable Document Format'),
    fakePlugin('Microsoft Edge PDF Viewer',   'internal-pdf-viewer', 'Portable Document Format'),
    fakePlugin('WebKit built-in PDF',         'internal-pdf-viewer', 'Portable Document Format'),
  ];
  Object.defineProperty(navigator, 'plugins', { get: () => plugins, configurable: true });
  Object.defineProperty(navigator, 'mimeTypes', {
    get: () => [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: plugins[0] },
      { type: 'text/pdf',        suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: plugins[0] },
    ],
    configurable: true,
  });
} catch (_) {}

// 6. navigator.languages 보강
try {
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'], configurable: true });
  }
} catch (_) {}

// 7. permissions.query — Notification denied 흔적 제거
try {
  const origQuery = window.navigator.permissions && window.navigator.permissions.query;
  if (origQuery) {
    window.navigator.permissions.query = (params) =>
      params && params.name === 'notifications'
        ? Promise.resolve({ state: (window.Notification && Notification.permission) || 'default' })
        : origQuery.call(window.navigator.permissions, params);
  }
} catch (_) {}

// 8. Notification.permission 'default' 강제 (Electron이 'denied' 반환하는 경우)
try {
  if (window.Notification && Notification.permission === 'denied') {
    Object.defineProperty(Notification, 'permission', { get: () => 'default' });
  }
} catch (_) {}

// 9. WebGL vendor/renderer 스푸핑 (Google SwiftShader 노출 차단)
try {
  const spoofed = (parameter, fallback) => {
    if (parameter === 37445 /* UNMASKED_VENDOR_WEBGL */)   return 'Intel Inc.';
    if (parameter === 37446 /* UNMASKED_RENDERER_WEBGL */) return 'Intel(R) Iris(R) Plus Graphics';
    return fallback();
  };
  const orig1 = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (p) { return spoofed(p, () => orig1.call(this, p)); };
  if (typeof WebGL2RenderingContext !== 'undefined') {
    const orig2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (p) { return spoofed(p, () => orig2.call(this, p)); };
  }
} catch (_) {}

// 10. iframe.contentWindow.chrome 동기화 (iframe 내부에서 chrome 객체 누락 감지 차단)
try {
  const origCreateElement = document.createElement;
  document.createElement = function (tagName, ...args) {
    const el = origCreateElement.call(this, tagName, ...args);
    if (String(tagName).toLowerCase() === 'iframe') {
      el.addEventListener('load', () => {
        try {
          if (el.contentWindow && !el.contentWindow.chrome) el.contentWindow.chrome = window.chrome;
        } catch (_) {}
      });
    }
    return el;
  };
} catch (_) {}

// 11. toString prototype 변조 흔적 제거 (defineProperty 흔적 감춤)
try {
  const origToString = Function.prototype.toString;
  Function.prototype.toString = function () {
    if (this === navigator.webdriver?.constructor) return 'function get webdriver() { [native code] }';
    return origToString.call(this);
  };
} catch (_) {}

// 12. Canvas fingerprint 랜덤화 (DataDome 등 캔버스 fingerprint 차단)
try {
  const noise = () => Math.floor(Math.random() * 3) - 1;
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...args) {
    try {
      const ctx = this.getContext('2d');
      if (ctx && this.width > 0 && this.height > 0) {
        const data = ctx.getImageData(0, 0, this.width, this.height);
        for (let i = 0; i < data.data.length; i += 4) {
          data.data[i]     = Math.max(0, Math.min(255, data.data[i]     + noise()));
          data.data[i + 1] = Math.max(0, Math.min(255, data.data[i + 1] + noise()));
          data.data[i + 2] = Math.max(0, Math.min(255, data.data[i + 2] + noise()));
        }
        ctx.putImageData(data, 0, 0);
      }
    } catch (_) {}
    return origToDataURL.apply(this, args);
  };
  const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (...args) {
    const data = origGetImageData.apply(this, args);
    try {
      for (let i = 0; i < data.data.length; i += 4) {
        data.data[i]     = Math.max(0, Math.min(255, data.data[i]     + noise()));
        data.data[i + 1] = Math.max(0, Math.min(255, data.data[i + 1] + noise()));
        data.data[i + 2] = Math.max(0, Math.min(255, data.data[i + 2] + noise()));
      }
    } catch (_) {}
    return data;
  };
} catch (_) {}

// 13. AudioContext fingerprint 노이즈 (sub-perceptible 변동)
try {
  const origGetChannelData = AudioBuffer.prototype.getChannelData;
  AudioBuffer.prototype.getChannelData = function (...args) {
    const data = origGetChannelData.apply(this, args);
    try {
      for (let i = 0; i < data.length; i += 100) data[i] += (Math.random() - 0.5) * 1e-10;
    } catch (_) {}
    return data;
  };
} catch (_) {}

// 14. hardwareConcurrency / deviceMemory 일반적 값으로 정규화
try {
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
  Object.defineProperty(navigator, 'deviceMemory',        { get: () => 8, configurable: true });
} catch (_) {}
