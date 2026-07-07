import { io } from 'socket.io-client';

const SERVER = import.meta.env.VITE_SERVER_URL || '';

let socket = null;

export function getSocket(slug) {
  if (!socket) {
    socket = io(`${SERVER}/cafe`, {
      query: { slug, role: 'owner' },
      auth:  { token: localStorage.getItem('token') },
    });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
