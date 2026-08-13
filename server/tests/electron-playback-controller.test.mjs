import { afterEach, describe, expect, it, vi } from 'vitest';
import controllerModule from '../../owner/electron/playback-controller.js';

const { createPlaybackController } = controllerModule;

afterEach(() => vi.useRealTimers());

function createHarness() {
  const loadedUrls = [];
  const webContents = {
    isDestroyed: () => false,
    getURL: () => loadedUrls.at(-1) || '',
    loadURL: vi.fn(async url => { loadedUrls.push(url); }),
    once: vi.fn(),
    executeJavaScript: vi.fn(async () => ({ title: 'BGM', trackId: 'bgm-id' })),
    setAudioMuted: vi.fn(),
  };
  const bgmView = { webContents };
  const windowManager = {
    getBgmView: () => bgmView,
    getRecView: () => null,
    createBgmView: () => bgmView,
    createRecView: vi.fn(),
    attachBgmPanel: vi.fn(),
    attachRecView: vi.fn(),
    detachAll: vi.fn(),
    destroyRecView: vi.fn(),
    isPanelVisible: () => true,
    isFromMainRenderer: () => true,
    safeSend: vi.fn(),
  };
  const controller = createPlaybackController({
    ipcMain: { on: vi.fn(), handle: vi.fn() },
    windowManager,
    isQuitting: () => false,
  });
  return { controller, loadedUrls };
}

describe('Electron playback controller acknowledgment', () => {
  it('허용하지 않는 URL은 실패 확인을 반환한다', async () => {
    const { controller } = createHarness();
    await expect(controller.playRecommendation('https://evil.example/track'))
      .resolves.toMatchObject({ ok: false });
  });

  it('BGM 해제 뒤 Spotify takeover 종료가 이전 BGM을 되살리지 않는다', async () => {
    vi.useFakeTimers();
    const { controller, loadedUrls } = createHarness();
    const bgm = 'https://open.spotify.com/playlist/bgm';
    const rec = 'https://open.spotify.com/track/recommendation';

    controller.setBgmUrl(bgm);
    await expect(controller.playRecommendation(rec)).resolves.toEqual({ ok: true });
    controller.clearBgm();
    controller.endRecommendation();

    expect(loadedUrls).toEqual([bgm, rec, 'https://www.google.com']);
  });
});
