import { describe, expect, it } from 'vitest';
import {
  createPlaybackTransitionCoordinator,
  PLAYBACK_TRANSITION_BUSY,
} from '../../owner/src/pages/dashboard/playbackTransition.mjs';

describe('owner playback transition coordinator', () => {
  it('동시에 들어온 두 번째 재생 전환을 거절한다', async () => {
    const run = createPlaybackTransitionCoordinator();
    let release;
    const first = run(() => new Promise(resolve => { release = resolve; }));

    const second = run(async () => 'second');
    await expect(second).rejects.toMatchObject({ code: PLAYBACK_TRANSITION_BUSY });

    release('first');
    await expect(first).resolves.toBe('first');
    await expect(run(async () => 'third')).resolves.toBe('third');
  });

  it('전환 실패 뒤 잠금을 반드시 해제한다', async () => {
    const run = createPlaybackTransitionCoordinator();
    await expect(run(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    await expect(run(async () => 'recovered')).resolves.toBe('recovered');
  });
});
