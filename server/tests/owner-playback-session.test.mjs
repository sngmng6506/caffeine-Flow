import { describe, expect, it } from 'vitest';
import {
  getPlaybackSessionId,
  hasRecoveredPlaybackSession,
  markPlaybackSessionRecovered,
  needsPlaybackStateReset,
  resetPlaybackSession,
} from '../../owner/src/pages/dashboard/playbackSession.mjs';

function createStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

describe('owner playback session lifecycle', () => {
  it('복구 완료된 Electron 실행 세션은 서버 registry 재시작 때 DB를 다시 초기화하지 않는다', () => {
    const storage = createStorage();
    expect(getPlaybackSessionId(storage, () => 'session-a')).toBe('session-a');
    markPlaybackSessionRecovered('cafe', storage);

    expect(hasRecoveredPlaybackSession('cafe', storage)).toBe(true);
    expect(needsPlaybackStateReset('cafe', true, { storage })).toBe(false);
    expect(needsPlaybackStateReset('cafe', true, { storage, playbackActive: true })).toBe(false);
    expect(needsPlaybackStateReset('cafe', true, { storage, playbackActive: false })).toBe(true);
  });

  it('로그아웃은 session ID를 폐기해 다음 로그인에서 고아 playing 복구를 허용한다', () => {
    const storage = createStorage();
    getPlaybackSessionId(storage, () => 'session-a');
    markPlaybackSessionRecovered('cafe', storage);
    resetPlaybackSession('cafe', storage);

    expect(getPlaybackSessionId(storage, () => 'session-b')).toBe('session-b');
    expect(hasRecoveredPlaybackSession('cafe', storage)).toBe(false);
    expect(needsPlaybackStateReset('cafe', true, { storage, playbackActive: false })).toBe(true);
    expect(needsPlaybackStateReset('cafe', true, { storage, playbackActive: true })).toBe(false);
  });
});
