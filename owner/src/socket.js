import { io } from 'socket.io-client';

const SERVER = import.meta.env.VITE_SERVER_URL || '';

let socket = null;
let lastFilterAlertAt = 0;

function getPlaybackSessionId() {
  if (typeof window.electronAPI?.playRec !== 'function') return null;
  const key = 'cf_playback_session_id';
  // renderer reload에는 유지되지만 Electron 앱을 완전히 다시 열면 새 ID가
  // 되도록 sessionStorage를 사용한다.
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

function handleMusicFilterError(payload = {}) {
  const now = Date.now();
  if (now - lastFilterAlertAt < 3000) return;
  lastFilterAlertAt = now;

  const title = payload.title ? `\n곡: ${payload.title}` : '';
  const reason = payload.reason ? `\n사유: ${payload.reason}` : '';
  window.dispatchEvent?.(new CustomEvent('music_filter_error', { detail: payload }));
  window.alert?.(`AI 음악 필터 오류로 손님 신청곡이 자동 거절되었습니다.${title}${reason}`);
}

export function getSocket(slug) {
  if (!socket) {
    const playbackSessionId = getPlaybackSessionId();
    socket = io(`${SERVER}/cafe`, {
      query: {
        slug,
        role: 'owner',
        ...(playbackSessionId ? { playbackSessionId } : {}),
      },
      auth:  { token: localStorage.getItem('token') },
    });
    socket.on('music_filter_error', handleMusicFilterError);
  }
  return socket;
}

export function disconnectSocket() {
  socket?.off('music_filter_error', handleMusicFilterError);
  socket?.disconnect();
  socket = null;
}
