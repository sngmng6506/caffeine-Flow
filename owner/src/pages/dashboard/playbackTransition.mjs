const PLAYBACK_TRANSITION_BUSY = 'PLAYBACK_TRANSITION_BUSY';

export function createPlaybackTransitionCoordinator() {
  let active = false;

  return async function runPlaybackTransition(task) {
    if (active) {
      const error = new Error('다른 곡의 재생 전환이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
      error.code = PLAYBACK_TRANSITION_BUSY;
      throw error;
    }

    active = true;
    try {
      return await task();
    } finally {
      active = false;
    }
  };
}

export const runPlaybackTransition = createPlaybackTransitionCoordinator();
export { PLAYBACK_TRANSITION_BUSY };
