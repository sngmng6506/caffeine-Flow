import { describe, expect, it, vi } from 'vitest';
import { acknowledgePlaybackRecovery } from '../../owner/src/pages/dashboard/playbackRecovery.mjs';

function createSocket(callback) {
  const socket = {
    timeout: vi.fn(() => socket),
    emit: vi.fn((_event, ack) => callback(ack)),
  };
  return socket;
}

describe('owner playback recovery acknowledgment', () => {
  it('서버가 복구 완료를 확인한 경우에만 성공한다', async () => {
    const socket = createSocket(ack => ack(null, { ok: true }));
    await expect(acknowledgePlaybackRecovery(socket)).resolves.toBeUndefined();
    expect(socket.timeout).toHaveBeenCalledWith(5000);
    expect(socket.emit).toHaveBeenCalledWith('playback_recovery_complete', expect.any(Function));
  });

  it('응답 유실이나 서버 거절은 실패로 반환해 재시도를 허용한다', async () => {
    const timeoutSocket = createSocket(ack => ack(new Error('timeout')));
    await expect(acknowledgePlaybackRecovery(timeoutSocket)).rejects.toThrow('응답을 받지 못했습니다');

    const rejectedSocket = createSocket(ack => ack(null, { ok: false }));
    await expect(acknowledgePlaybackRecovery(rejectedSocket)).rejects.toThrow('서버에 반영하지 못했습니다');
  });
});
