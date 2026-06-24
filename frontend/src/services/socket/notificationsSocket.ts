import { io, Socket } from 'socket.io-client';

/**
 * Staff notifications socket (namespace `/notifications`). Authenticates with the
 * logged-in user's JWT via the handshake `auth.token`; the backend joins the
 * socket to a per-user room and emits `notification:new` / `notification:resolved`.
 */
function getNotificationsNamespaceUrl() {
  const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001/api';
  const backendBase = apiBaseUrl.replace(/\/api\/?$/, '');
  return `${backendBase}/notifications`;
}

export function createNotificationsSocket(token: string): Socket {
  return io(getNotificationsNamespaceUrl(), {
    transports: ['websocket'],
    autoConnect: false,
    auth: { token },
  });
}
