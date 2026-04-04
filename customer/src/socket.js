import { io } from 'socket.io-client';

let socket = null;

export function getSocket(slug) {
  if (!socket) {
    socket = io('/cafe', { query: { slug } });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
