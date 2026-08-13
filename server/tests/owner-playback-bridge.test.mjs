import { describe, expect, it, vi } from 'vitest';
import { requestElectronPlayback } from '../../owner/src/pages/dashboard/playbackBridge.mjs';

describe('owner Electron playback bridge compatibility', () => {
  it('새 preload의 실패 확인을 그대로 반환한다', async () => {
    const result = await requestElectronPlayback({
      supportsPlayRecAck: true,
      playRec: vi.fn().mockResolvedValue({ ok: false, error: 'navigation failed' }),
    }, 'track');
    expect(result).toEqual({ ok: false, error: 'navigation failed' });
  });

  it('확인 capability가 없는 기존 preload는 배포 호환성을 유지한다', async () => {
    const result = await requestElectronPlayback({ playRec: vi.fn() }, 'track');
    expect(result).toEqual({ ok: true, legacy: true });
  });
});
