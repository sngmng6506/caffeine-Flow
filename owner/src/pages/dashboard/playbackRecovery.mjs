const RECOVERY_ACK_TIMEOUT_MS = 5000;

export function acknowledgePlaybackRecovery(socket) {
  return new Promise((resolve, reject) => {
    socket.timeout(RECOVERY_ACK_TIMEOUT_MS).emit(
      'playback_recovery_complete',
      (error, response) => {
        if (error) {
          reject(new Error('재생 복구 완료 응답을 받지 못했습니다.'));
          return;
        }
        if (response?.ok !== true) {
          reject(new Error('재생 복구 완료를 서버에 반영하지 못했습니다.'));
          return;
        }
        resolve();
      }
    );
  });
}
