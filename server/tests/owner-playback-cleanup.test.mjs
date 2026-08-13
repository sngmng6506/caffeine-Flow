import { describe, expect, it, vi } from 'vitest';
import { finishCurrentPlayback } from '../../owner/src/pages/dashboard/playbackCleanup.mjs';

describe('owner playback cleanup', () => {
  it('로그아웃 전에 리더의 playing을 played로 저장하고 실제 플레이어를 종료한다', async () => {
    const markPlayed = vi.fn(async rec => ({ ...rec, status: 'played' }));
    const endPlayback = vi.fn();
    const updated = await finishCurrentPlayback({
      isLeader: true,
      recommendations: [{ id: 'rec-a', status: 'playing' }, { id: 'rec-b', status: 'accepted' }],
      markPlayed,
      endPlayback,
    });

    expect(markPlayed).toHaveBeenCalledWith({ id: 'rec-a', status: 'playing' });
    expect(updated).toEqual([{ id: 'rec-a', status: 'played' }]);
    expect(endPlayback).toHaveBeenCalledOnce();
  });

  it('DB 종료 요청이 실패해도 실제 플레이어는 종료한다', async () => {
    const endPlayback = vi.fn();
    await expect(finishCurrentPlayback({
      isLeader: true,
      recommendations: [{ id: 'rec-a', status: 'playing' }],
      markPlayed: async () => { throw new Error('network failed'); },
      endPlayback,
    })).rejects.toThrow('network failed');
    expect(endPlayback).toHaveBeenCalledOnce();
  });
});
