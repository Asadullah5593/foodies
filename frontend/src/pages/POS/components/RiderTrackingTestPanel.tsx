import React from 'react';
import toast from 'react-hot-toast';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import apiClient from '../../../utils/apiClient';
import {
  createRiderTrackingSocket,
  emitTrackJoin,
  RiderTrackingSocket,
} from '../../../services/socket/riderTrackingSocket';

type LocationState = {
  latitude: number | null;
  longitude: number | null;
  recorded_at: string | null;
};

const EMPTY_LOCATION: LocationState = {
  latitude: null,
  longitude: null,
  recorded_at: null,
};

const RiderTrackingTestPanel: React.FC = () => {
  const [orderId, setOrderId] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [connectionState, setConnectionState] = React.useState<
    'disconnected' | 'connecting' | 'connected'
  >('disconnected');
  const [latest, setLatest] = React.useState<LocationState>(EMPTY_LOCATION);
  const [logs, setLogs] = React.useState<string[]>([]);
  const socketRef = React.useRef<RiderTrackingSocket | null>(null);

  const appendLog = React.useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [`${timestamp} - ${message}`, ...prev].slice(0, 20));
  }, []);

  const disconnectSocket = React.useCallback(() => {
    if (!socketRef.current) return;
    socketRef.current.removeAllListeners();
    socketRef.current.disconnect();
    socketRef.current = null;
    setConnectionState('disconnected');
  }, []);

  React.useEffect(() => {
    return () => disconnectSocket();
  }, [disconnectSocket]);

  const startTracking = () => {
    const parsedOrderId = Number(orderId);
    const normalizedPhone = phone.trim();

    if (!Number.isInteger(parsedOrderId) || parsedOrderId <= 0) {
      toast.error('Enter a valid order id');
      return;
    }
    if (!normalizedPhone) {
      toast.error('Enter customer phone');
      return;
    }

    disconnectSocket();
    setLatest(EMPTY_LOCATION);
    setConnectionState('connecting');

    const socket = createRiderTrackingSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionState('connected');
      appendLog('Socket connected');
      emitTrackJoin(socket, { orderId: parsedOrderId, phone: normalizedPhone });
      appendLog(`Sent track:join for order ${parsedOrderId}`);
    });

    socket.on('disconnect', (reason) => {
      setConnectionState('disconnected');
      appendLog(`Socket disconnected (${reason})`);
    });

    socket.on('connect_error', (err) => {
      setConnectionState('disconnected');
      appendLog(`Connection error: ${err.message}`);
    });

    socket.on('track:joined', (payload) => {
      setLatest(payload.latest ?? EMPTY_LOCATION);
      appendLog(
        payload.latest
          ? 'Received track:joined with latest point'
          : 'Joined tracking room (no points yet)',
      );
    });

    socket.on('location:update', (payload) => {
      setLatest({
        latitude: payload.latitude,
        longitude: payload.longitude,
        recorded_at: payload.recorded_at,
      });
      appendLog(
        `location:update lat=${payload.latitude}, lng=${payload.longitude}`,
      );
    });

    socket.on('track:error', (payload) => {
      appendLog(`track:error ${payload.code} - ${payload.message}`);
      toast.error(payload.message || 'Tracking subscribe failed');
    });

    socket.connect();
  };

  const fetchLatestFallback = async () => {
    const parsedOrderId = Number(orderId);
    const normalizedPhone = phone.trim();
    if (!Number.isInteger(parsedOrderId) || parsedOrderId <= 0 || !normalizedPhone) {
      toast.error('Provide order id and phone first');
      return;
    }

    try {
      const response = await apiClient.get<{
        latitude: number | null;
        longitude: number | null;
        recorded_at: string | null;
      }>(`/public/consumer/orders/${parsedOrderId}/rider-location`, {
        params: { phone: normalizedPhone },
      });
      setLatest(response.data);
      appendLog('Fetched fallback latest location from HTTP endpoint');
    } catch (error: any) {
      appendLog(
        `Fallback fetch failed: ${error?.response?.data?.message || error?.message || 'unknown error'}`,
      );
      toast.error('Failed to fetch fallback location');
    }
  };

  return (
    <Card className="mb-4 border-dashed border-blue-300 dark:border-blue-700 dark:bg-slate-800">
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foodies-textPrimary dark:text-slate-100">
            Rider Tracking Test (Socket)
          </h3>
          <p className="text-xs text-foodies-textSecondary dark:text-slate-400 mt-1">
            POS testing utility for joining `track:join`, receiving `location:update`, and validating HTTP fallback.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input
            type="number"
            min={1}
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="Order ID"
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg text-sm"
          />
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Customer phone (03XXXXXXXXX)"
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg text-sm md:col-span-2"
          />
          <div className="text-xs px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200">
            Socket: {connectionState}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="small" onClick={startTracking}>
            Start tracking
          </Button>
          <Button
            size="small"
            variant="outline"
            onClick={disconnectSocket}
            disabled={connectionState === 'disconnected'}
          >
            Disconnect
          </Button>
          <Button size="small" variant="outline" onClick={fetchLatestFallback}>
            Fetch latest fallback
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-foodies-border dark:border-slate-700 p-3">
            <p className="text-xs text-foodies-textSecondary dark:text-slate-400 mb-1">
              Latest location
            </p>
            <p className="text-foodies-textPrimary dark:text-slate-100">
              Lat: {latest.latitude ?? 'N/A'} | Lng: {latest.longitude ?? 'N/A'}
            </p>
            <p className="text-xs text-foodies-textSecondary dark:text-slate-400 mt-1">
              At: {latest.recorded_at ?? 'N/A'}
            </p>
          </div>
          <div className="rounded-lg border border-foodies-border dark:border-slate-700 p-3 max-h-28 overflow-y-auto">
            <p className="text-xs text-foodies-textSecondary dark:text-slate-400 mb-1">
              Event log
            </p>
            {logs.length === 0 ? (
              <p className="text-foodies-textSecondary dark:text-slate-400">
                No events yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {logs.map((line, idx) => (
                  <li key={`${line}-${idx}`} className="text-xs text-foodies-textPrimary dark:text-slate-100">
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};

export default RiderTrackingTestPanel;
