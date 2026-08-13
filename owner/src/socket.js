import { io } from 'socket.io-client';
import { getPlaybackSessionId } from './pages/dashboard/playbackSession.mjs';

const SERVER = import.meta.env.VITE_SERVER_URL || '';

let socket = null;
let lastFilterAlertAt = 0;

function getElectronPlaybackSessionId() {
  if (typeof window.electronAPI?.playRec !== 'function') return null;
  return getPlaybackSessionId();
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
    const playbackSessionId = getElectronPlaybackSessionId();
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
