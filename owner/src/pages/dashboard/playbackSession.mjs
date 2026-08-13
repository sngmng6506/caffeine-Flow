const PLAYBACK_SESSION_KEY = 'cf_playback_session_id';
const PLAYBACK_RECOVERY_PREFIX = 'cf_playback_recovered:';

function recoveryKey(slug) {
  return `${PLAYBACK_RECOVERY_PREFIX}${slug}`;
}

export function getPlaybackSessionId(storage = sessionStorage, createId = () => crypto.randomUUID()) {
  let id = storage.getItem(PLAYBACK_SESSION_KEY);
  if (!id) {
    id = createId();
    storage.setItem(PLAYBACK_SESSION_KEY, id);
  }
  return id;
}

export function markPlaybackSessionRecovered(slug, storage = sessionStorage) {
  storage.setItem(recoveryKey(slug), getPlaybackSessionId(storage));
}

export function hasRecoveredPlaybackSession(slug, storage = sessionStorage) {
  const id = storage.getItem(PLAYBACK_SESSION_KEY);
  return Boolean(id && storage.getItem(recoveryKey(slug)) === id);
}

export function needsPlaybackStateReset(
  slug,
  shouldRecover,
  { storage = sessionStorage, playbackActive = null } = {}
) {
  if (shouldRecover !== true) return false;
  // 새 Electron은 메인 프로세스의 실제 재생 모드를 최우선으로 사용한다.
  // 구버전 preload는 이 값을 제공하지 않으므로 완료 세션 marker로 호환한다.
  if (playbackActive === true) return false;
  if (playbackActive === false) return true;
  return !hasRecoveredPlaybackSession(slug, storage);
}

export function resetPlaybackSession(slug, storage = sessionStorage) {
  storage.removeItem(PLAYBACK_SESSION_KEY);
  if (slug) storage.removeItem(recoveryKey(slug));
}
