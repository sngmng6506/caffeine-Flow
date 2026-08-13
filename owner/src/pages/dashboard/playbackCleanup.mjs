export async function finishCurrentPlayback({
  isLeader,
  recommendations,
  markPlayed,
  endPlayback,
}) {
  if (!isLeader) return [];

  const playing = recommendations.filter(rec => rec.status === 'playing');
  try {
    return await Promise.all(playing.map(rec => markPlayed(rec)));
  } finally {
    // HTTP 정리에 실패해도 로그아웃·종료 과정에서 실제 음원이 남지 않게 한다.
    endPlayback?.();
  }
}
