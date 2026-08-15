import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import autoUpdateModule from '../../owner/electron/auto-update.js';
import ownerPackage from '../../owner/package.json' with { type: 'json' };

const { createAutoUpdateManager } = autoUpdateModule;

function createDependencies() {
  const listeners = new Map();
  const handlers = new Map();
  const updater = new EventEmitter();
  updater.checkForUpdates = vi.fn(async () => undefined);
  updater.quitAndInstall = vi.fn();
  const safeSend = vi.fn();
  const trustedSender = { id: 'owner' };
  const manager = createAutoUpdateManager({
    ipcMain: {
      on: (channel, listener) => listeners.set(channel, listener),
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    isDev: false,
    safeSend,
    isTrustedSender: sender => sender === trustedSender,
    updater,
  });
  manager.registerIpcHandlers();
  return { manager, updater, safeSend, trustedSender, listeners, handlers };
}

describe('Electron 자동 업데이트 상태 복구', () => {
  it('릴리스 설치 파일명을 latest.yml의 안전한 경로와 동일하게 고정한다', () => {
    expect(ownerPackage.build.artifactName).toBe('Caffeine-Flow-Setup-${version}.${ext}');
  });

  it('renderer 구독 전에 다운로드가 끝나도 현재 상태를 다시 조회한다', async () => {
    const deps = createDependencies();
    deps.manager.start();
    deps.updater.emit('update-downloaded', { version: '2.5.27' });

    const status = await deps.handlers.get('get-update-status')({ sender: deps.trustedSender });

    expect(status).toMatchObject({ state: 'downloaded', version: '2.5.27' });
    expect(status.revision).toBeGreaterThan(0);
    expect(deps.safeSend).toHaveBeenCalledWith('update-status', expect.objectContaining({ state: 'downloaded' }));
    expect(deps.safeSend).toHaveBeenCalledWith('update-downloaded', '2.5.27');
  });

  it('업데이트 발견과 오류 상태를 renderer에 전달하고 재확인을 허용한다', async () => {
    const deps = createDependencies();
    deps.manager.start();
    deps.updater.emit('update-available', { version: '2.5.27' });
    expect(deps.manager.getStatus()).toMatchObject({ state: 'available', version: '2.5.27' });

    deps.updater.emit('error', new Error('network'));
    expect(deps.manager.getStatus()).toMatchObject({ state: 'error', version: null });

    await vi.waitFor(() => expect(deps.updater.checkForUpdates).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await deps.handlers.get('check-for-updates')({ sender: deps.trustedSender });
    expect(deps.updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('앱을 켜 둔 상태에서도 10분마다 새 릴리스를 다시 확인한다', async () => {
    vi.useFakeTimers();
    const deps = createDependencies();
    deps.manager.start();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(deps.updater.checkForUpdates).toHaveBeenCalledTimes(2);
    deps.manager.stop();
    vi.useRealTimers();
  });

  it('신뢰하지 않는 renderer의 조회·재확인·설치 요청을 거절한다', async () => {
    const deps = createDependencies();
    const untrusted = { id: 'external' };

    expect(await deps.handlers.get('get-update-status')({ sender: untrusted }))
      .toEqual({ state: 'unavailable', version: null, revision: 0 });
    await deps.handlers.get('check-for-updates')({ sender: untrusted });
    deps.listeners.get('restart-app')({ sender: untrusted });

    expect(deps.updater.checkForUpdates).not.toHaveBeenCalled();
    expect(deps.updater.quitAndInstall).not.toHaveBeenCalled();
  });
});
