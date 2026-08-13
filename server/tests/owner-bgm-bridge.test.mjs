import { describe, expect, it, vi } from 'vitest';
import { requestClearBgm, requestSetBgmUrl } from '../../owner/src/pages/dashboard/bgmBridge.mjs';

describe('owner BGM acknowledgment bridge', () => {
  it('신청곡 전환과 겹쳐 Electron이 거절한 BGM 변경을 실패로 전달한다', async () => {
    const electronAPI = {
      supportsBgmAck: true,
      setBgmUrl: vi.fn(async () => false),
      clearBgm: vi.fn(async () => false),
    };

    await expect(requestSetBgmUrl(electronAPI, 'https://youtu.be/bgm')).resolves.toBe(false);
    await expect(requestClearBgm(electronAPI)).resolves.toBe(false);
  });

  it('ACK capability가 없는 구버전 preload의 send 계약은 호환한다', async () => {
    const electronAPI = { setBgmUrl: vi.fn(), clearBgm: vi.fn() };

    await expect(requestSetBgmUrl(electronAPI, 'https://youtu.be/bgm')).resolves.toBe(true);
    await expect(requestClearBgm(electronAPI)).resolves.toBe(true);
  });
});
