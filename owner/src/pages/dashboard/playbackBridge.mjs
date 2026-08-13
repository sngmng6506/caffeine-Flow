export async function requestElectronPlayback(electronAPI, videoId) {
  if (typeof electronAPI?.playRec !== 'function') {
    return { ok: false, error: 'Electron 재생 기능을 사용할 수 없습니다.' };
  }

  const result = await electronAPI.playRec(videoId);
  // 원격 owner SPA가 설치된 Electron보다 먼저 배포될 수 있다. 확인 응답
  // capability가 없는 기존 preload는 send 방식이므로 기존 동작을 유지한다.
  if (electronAPI.supportsPlayRecAck !== true) return { ok: true, legacy: true };
  if (result?.ok) return result;
  return { ok: false, error: result?.error || '신청곡 재생을 시작하지 못했습니다.' };
}
