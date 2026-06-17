import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { motion } from 'framer-motion';
import { MdOutlineDeliveryDining } from 'react-icons/md';
import Button from '../../components/Button';
import { riderService } from '../../services/api/riderService';
import RiderDutyBar from './RiderDutyBar';

const ATTENDANCE_STATUS_POLL_MS = 10000;
const HEARTBEAT_RESEND_MS = 30000;
const HEARTBEAT_MIN_INTERVAL_MS = 10000;

type LocationShareState =
  | 'idle'
  | 'starting'
  | 'sharing'
  | 'needs_permission'
  | 'unsupported'
  | 'error';

const RiderLayout: React.FC = () => {
  const { logout, user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [_menuOpen, _setMenuOpen] = useState(false);
  const [locationShareState, setLocationShareState] = useState<LocationShareState>('idle');
  const [locationError, setLocationError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const resendTimerRef = useRef<number | null>(null);
  const lastSentAtRef = useRef(0);
  const latestCoordsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const sendingRef = useRef(false);

  const { data: attendanceStatus } = useQuery({
    queryKey: ['rider-attendance-status'],
    queryFn: () => riderService.getAttendanceStatus(),
    enabled: !!user?.id,
    refetchInterval: ATTENDANCE_STATUS_POLL_MS,
  });

  const handleLogout = async () => {
    queryClient.clear();
    await logout();
    navigate('/login');
  };

  useEffect(() => {
    if (!attendanceStatus?.is_checked_in) {
      if ('geolocation' in navigator && watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (resendTimerRef.current != null) {
        window.clearInterval(resendTimerRef.current);
        resendTimerRef.current = null;
      }
      latestCoordsRef.current = null;
      lastSentAtRef.current = 0;
      setLocationShareState('idle');
      setLocationError(null);
      return;
    }

    if (!('geolocation' in navigator)) {
      setLocationShareState('unsupported');
      setLocationError('This browser does not support live location.');
      return;
    }

    const sendHeartbeat = async (
      coords: { latitude: number; longitude: number },
      force = false
    ) => {
      const now = Date.now();
      if (!force && now - lastSentAtRef.current < HEARTBEAT_MIN_INTERVAL_MS) {
        return;
      }
      if (sendingRef.current) {
        return;
      }

      sendingRef.current = true;
      try {
        const updatedStatus = await riderService.sendAttendanceHeartbeat(coords);
        lastSentAtRef.current = now;
        queryClient.setQueryData(['rider-attendance-status'], updatedStatus);
        setLocationShareState('sharing');
        setLocationError(null);
      } catch (error: any) {
        const message =
          error?.response?.data?.message ||
          error?.message ||
          'Unable to send live location';
        setLocationShareState('error');
        setLocationError(message);
      } finally {
        sendingRef.current = false;
      }
    };

    const handlePosition: PositionCallback = (position) => {
      const coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      latestCoordsRef.current = coords;
      void sendHeartbeat(coords);
    };

    const handlePositionError: PositionErrorCallback = (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        setLocationShareState('needs_permission');
        setLocationError(
          window.isSecureContext
            ? 'Allow browser location access so dispatch can see your live position.'
            : 'Location access requires HTTPS or localhost in this browser.'
        );
        return;
      }
      setLocationShareState('error');
      setLocationError(error.message || 'Unable to read current location.');
    };

    setLocationShareState('starting');
    setLocationError(null);

    watchIdRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      handlePositionError,
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 15000,
      }
    );

    resendTimerRef.current = window.setInterval(() => {
      if (latestCoordsRef.current) {
        void sendHeartbeat(latestCoordsRef.current, true);
        return;
      }
      navigator.geolocation.getCurrentPosition(handlePosition, handlePositionError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      });
    }, HEARTBEAT_RESEND_MS);

    return () => {
      if ('geolocation' in navigator && watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (resendTimerRef.current != null) {
        window.clearInterval(resendTimerRef.current);
        resendTimerRef.current = null;
      }
    };
  }, [attendanceStatus?.is_checked_in, queryClient]);

  const liveLocationLabel = useMemo(() => {
    if (!attendanceStatus?.is_checked_in) {
      return {
        badgeClass:
          'bg-slate-100 text-slate-700 dark:bg-slate-700/80 dark:text-slate-200',
        text: 'Not checked in',
      };
    }
    switch (locationShareState) {
      case 'sharing':
        return {
          badgeClass:
            'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200',
          text: 'Live location sharing',
        };
      case 'starting':
        return {
          badgeClass:
            'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200',
          text: 'Requesting location',
        };
      case 'needs_permission':
      case 'unsupported':
      case 'error':
        return {
          badgeClass:
            'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200',
          text: 'Location unavailable',
        };
      default:
        return {
          badgeClass:
            'bg-slate-100 text-slate-700 dark:bg-slate-700/80 dark:text-slate-200',
          text: 'Waiting for check-in',
        };
    }
  }, [attendanceStatus?.is_checked_in, locationShareState]);

  const coordinateText =
    attendanceStatus?.last_latitude != null && attendanceStatus?.last_longitude != null
      ? `${attendanceStatus.last_latitude.toFixed(5)}, ${attendanceStatus.last_longitude.toFixed(5)}`
      : 'No GPS fix yet';

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-900">
      <nav className="bg-white dark:bg-slate-800 shadow border-b border-gray-200 dark:border-slate-700 sticky top-0 z-40">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">
            <Link
              to="/rider"
              className="text-lg font-bold text-gray-800 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              <MdOutlineDeliveryDining className="inline h-5 w-5 mr-1 align-text-bottom" /> Rider
            </Link>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleTheme}
                className="p-2 rounded-lg text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
                aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              >
                {theme === 'dark' ? (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
              <div className="hidden lg:flex flex-col items-end">
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-medium ${liveLocationLabel.badgeClass}`}
                >
                  {liveLocationLabel.text}
                </span>
                <span className="text-[11px] text-gray-500 dark:text-slate-400 mt-1 max-w-[18rem] truncate">
                  {attendanceStatus?.is_checked_in
                    ? `${attendanceStatus.branch_name ?? 'Checked in'} · ${coordinateText}`
                    : 'Check in first to publish live rider location'}
                </span>
              </div>
              <span className="text-sm font-medium text-gray-700 dark:text-slate-200 hidden sm:inline">{user?.name}</span>
              <Button type="button" variant="gradient" size="small" onClick={handleLogout}>
                Logout
              </Button>
            </div>
          </div>
          {attendanceStatus?.is_checked_in && (locationError || locationShareState !== 'sharing') ? (
            <div className="pb-3">
              <p className="text-xs text-gray-600 dark:text-slate-300">
                {locationError ??
                  'Waiting for a GPS fix so dispatch can use your live location for auto-assignment.'}
              </p>
            </div>
          ) : null}
        </div>
      </nav>
      <main>
        <div className="w-full px-4 sm:px-6 lg:px-8 pt-4 max-w-5xl mx-auto">
          <RiderDutyBar />
        </div>
        <motion.div
          initial={false}
          animate={{ opacity: 1 }}
          className="min-h-0"
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
};

export default RiderLayout;
