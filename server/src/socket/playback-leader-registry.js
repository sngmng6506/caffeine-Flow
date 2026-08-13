function createPlaybackLeaderRegistry({ graceMs, onRoleChange }) {
  const candidates = new Map(); // slug -> Map<socketId, sessionId>
  const leaders = new Map(); // slug -> { socketId, sessionId, timer }

  function candidateMap(slug) {
    if (!candidates.has(slug)) candidates.set(slug, new Map());
    return candidates.get(slug);
  }

  function notify(slug) {
    const leaderSocketId = leaders.get(slug)?.socketId || null;
    for (const socketId of candidateMap(slug).keys()) {
      onRoleChange(socketId, socketId === leaderSocketId);
    }
  }

  function elect(slug) {
    const existing = leaders.get(slug);
    if (existing?.socketId) return existing.socketId;

    const first = candidateMap(slug).entries().next().value;
    if (!first) {
      if (!existing?.timer) leaders.delete(slug);
      return null;
    }

    const [socketId, sessionId] = first;
    if (existing?.timer) clearTimeout(existing.timer);
    leaders.set(slug, { socketId, sessionId, timer: null, needsRecovery: true });
    notify(slug);
    return socketId;
  }

  function add(slug, socketId, sessionId) {
    candidateMap(slug).set(socketId, sessionId);
    const leader = leaders.get(slug);

    // 일시적 네트워크 단절 뒤 같은 Electron 세션이 돌아오면 기존 lease를
    // 되찾는다. 다른 앱으로 성급히 넘겨 두 플레이어가 겹치는 것을 막는다.
    if (leader && !leader.socketId && leader.sessionId === sessionId) {
      if (leader.timer) clearTimeout(leader.timer);
      leaders.set(slug, {
        socketId,
        sessionId,
        timer: null,
        needsRecovery: leader.needsRecovery,
      });
      notify(slug);
      return true;
    }

    if (!leader) elect(slug);
    else notify(slug);
    return isLeader(slug, socketId);
  }

  function remove(slug, socketId) {
    const map = candidateMap(slug);
    const removedSessionId = map.get(socketId);
    map.delete(socketId);

    const leader = leaders.get(slug);
    if (!leader || leader.socketId !== socketId) {
      if (map.size === 0) candidates.delete(slug);
      return;
    }

    const sameSession = [...map.entries()].find(([, sessionId]) => sessionId === removedSessionId);
    if (sameSession) {
      leaders.set(slug, {
        socketId: sameSession[0],
        sessionId: sameSession[1],
        timer: null,
        needsRecovery: leader.needsRecovery,
      });
      notify(slug);
      return;
    }

    const lease = {
      socketId: null,
      sessionId: removedSessionId,
      timer: null,
      needsRecovery: leader.needsRecovery,
    };
    lease.timer = setTimeout(() => {
      if (leaders.get(slug) !== lease) return;
      leaders.delete(slug);
      elect(slug);
      if (candidateMap(slug).size === 0) candidates.delete(slug);
    }, graceMs);
    leaders.set(slug, lease);
    notify(slug);
  }

  function isLeader(slug, socketId) {
    return leaders.get(slug)?.socketId === socketId;
  }

  function needsRecovery(slug, socketId) {
    const leader = leaders.get(slug);
    return Boolean(leader && leader.socketId === socketId && leader.needsRecovery);
  }

  function completeRecovery(slug, socketId) {
    const leader = leaders.get(slug);
    if (!leader || leader.socketId !== socketId || !leader.needsRecovery) return false;
    leader.needsRecovery = false;
    return true;
  }

  function clear() {
    for (const leader of leaders.values()) {
      if (leader.timer) clearTimeout(leader.timer);
    }
    leaders.clear();
    candidates.clear();
  }

  return { add, remove, isLeader, needsRecovery, completeRecovery, clear };
}

module.exports = { createPlaybackLeaderRegistry };
