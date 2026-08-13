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

  it('Spotify takeover 중 BGM 변경을 거절하고 종료 뒤 정상 해제한다', async () => {
    vi.useFakeTimers();
    const { controller, loadedUrls } = createHarness();
    const bgm = 'https://open.spotify.com/playlist/bgm';
    const rec = 'https://open.spotify.com/track/recommendation';

    expect(controller.setBgmUrl(bgm)).toBe(true);
    expect(controller.isRecommendationActive()).toBe(false);
    await expect(controller.playRecommendation(rec)).resolves.toEqual({ ok: true });
    expect(controller.isRecommendationActive()).toBe(true);
    expect(controller.clearBgm()).toBe(false);
    expect(controller.setBgmUrl('https://open.spotify.com/playlist/other')).toBe(false);
    controller.endRecommendation();
    expect(controller.isRecommendationActive()).toBe(false);
    expect(controller.clearBgm()).toBe(true);

    expect(loadedUrls).toEqual([bgm, rec, bgm, 'https://www.google.com']);
  });
});
