import { io, Socket } from 'socket.io-client';

type JoinPayload = {
  orderId: number;
  phone: string;
};

type TrackJoinedPayload = {
  orderId: number;
  latest: {
    latitude: number | null;
    longitude: number | null;
    recorded_at: string | null;
  } | null;
};

type LocationUpdatePayload = {
  orderId: number;
  latitude: number;
  longitude: number;
  recorded_at: string;
};

type TrackErrorPayload = {
  code: string;
  message: string;
};

export type RiderTrackingSocket = Socket<
  {
    'track:joined': (payload: TrackJoinedPayload) => void;
    'location:update': (payload: LocationUpdatePayload) => void;
    'track:error': (payload: TrackErrorPayload) => void;
  },
  {
    'track:join': (payload: JoinPayload) => void;
  }
>;

function getTrackingNamespaceUrl() {
  const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001/api';
  const backendBase = apiBaseUrl.replace(/\/api\/?$/, '');
  return `${backendBase}/tracking`;
}

export function createRiderTrackingSocket() {
  return io(getTrackingNamespaceUrl(), {
    transports: ['websocket'],
    autoConnect: false,
  }) as RiderTrackingSocket;
}

export function emitTrackJoin(
  socket: RiderTrackingSocket,
  payload: JoinPayload,
) {
  socket.emit('track:join', payload);
}
