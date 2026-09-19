import { io } from 'socket.io-client';
import { getPlaybackSessionId } from './pages/dashboard/playbackSession.mjs';

const SERVER = import.meta.env.VITE_SERVER_URL || '';

let socket = null;
// 연결에 실린 재생 세션 ID. 소켓을 다시 만들어야 하는지 판단하는 데만 쓴다.
let socketSessionId = null;
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
  const playbackSessionId = getElectronPlaybackSessionId();

  // 세션 ID는 연결 query에 실려 handshake 때 한 번만 서버에 전달된다. preload
  // 브리지가 renderer보다 늦게 붙으면 ID 없이 만들어진 소켓이 캐시되고, 서버는
  // 그런 소켓을 재생 후보로 등록하지 않는다(socket/index.js). 재연결해도 같은
  // query를 다시 보내므로 스스로 회복하지 못하고 영영 follower로 남는다 —
  // 로그아웃으로 싱글턴이 지워져야 풀렸다. ID가 생겼으면 다시 만든다.
  //
  // 반대 방향(ID가 사라짐)에는 끊지 않는다. 멀쩡히 도는 연결을 버릴 이유가 없다.
  if (socket && !socketSessionId && playbackSessionId) disconnectSocket();

  if (!socket) {
    socketSessionId = playbackSessionId;
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
  socketSessionId = null;
}
