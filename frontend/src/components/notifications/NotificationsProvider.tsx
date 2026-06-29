import React, { useCallback, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { useAuth } from '../../contexts/AuthContext';
import { createNotificationsSocket } from '../../services/socket/notificationsSocket';
import { notificationsService } from '../../services/api/notificationsService';
import {
  useNotificationsStore,
  type ClientNotification,
} from '../../stores/notificationsStore';
import OrderNotificationStack from './OrderNotificationStack';

/** Alert chime served from the public/ folder (root URL). */
const ALERT_SOUND_URL = '/sounds/success.mp3';

/**
 * Mounts the staff notifications socket while authenticated, hydrates the store
 * with a catch-up fetch, and drives the alert sound — a chime on each new order
 * notification plus a repeat every few seconds while any unresolved order alert
 * is open (until accepted/rejected). Audio is unlocked on first user gesture to
 * satisfy browser autoplay policy; a mute toggle (store) silences it.
 */
const NotificationsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { isAuthenticated } = useAuth();
  const setAll = useNotificationsStore((s) => s.setAll);
  const upsert = useNotificationsStore((s) => s.upsert);
  const remove = useNotificationsStore((s) => s.remove);
  const clear = useNotificationsStore((s) => s.clear);
  const muted = useNotificationsStore((s) => s.muted);
  const items = useNotificationsStore((s) => s.items);

  const socketRef = useRef<Socket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const unlockedRef = useRef(false);

  // Whether an unresolved, sound-enabled order alert is currently open.
  const hasOpenOrderSound = items.some(
    (i) => i.category === 'order' && i.status === 'open' && i.soundEnabled,
  );
  // Kept current for the (mount-only) unlock listener to read.
  const pendingRef = useRef(false);
  pendingRef.current = hasOpenOrderSound && !muted;

  const playChime = useCallback(() => {
    if (mutedRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;
    try {
      audio.currentTime = 0;
      void audio.play().catch(() => undefined);
    } catch {
      /* ignore */
    }
  }, []);
  const playChimeRef = useRef(playChime);
  playChimeRef.current = playChime;

  // Preload the chime and unlock playback on the first user interaction
  // (browser autoplay policy blocks programmatic audio until the freshly-loaded
  // document has a user gesture — e.g. right after a page refresh). On that first
  // gesture, if an alert is already pending, play it immediately; otherwise prime
  // the element silently so the repeating loop can play thereafter.
  useEffect(() => {
    const audio = new Audio(ALERT_SOUND_URL);
    audio.preload = 'auto';
    audioRef.current = audio;
    const unlock = () => {
      if (pendingRef.current) {
        unlockedRef.current = true;
        audio.currentTime = 0;
        void audio.play().catch(() => undefined);
        return;
      }
      if (unlockedRef.current) return;
      audio
        .play()
        .then(() => {
          unlockedRef.current = true;
          audio.pause();
          audio.currentTime = 0;
        })
        .catch(() => undefined);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      audioRef.current = null;
    };
  }, []);

  // Socket lifecycle + catch-up hydrate.
  useEffect(() => {
    if (!isAuthenticated) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    let active = true;
    const socket = createNotificationsSocket(token);
    socketRef.current = socket;

    notificationsService
      .getOpen()
      .then((list) => {
        if (active) setAll(list);
      })
      .catch(() => undefined);

    socket.on('notification:new', (n: ClientNotification) => {
      upsert(n);
      if (n.category === 'order' && n.soundEnabled) playChimeRef.current();
    });
    socket.on('notification:resolved', (p: { id: number }) => remove(p.id));

    socket.connect();
    return () => {
      active = false;
      socket.off();
      socket.disconnect();
      socketRef.current = null;
      clear();
    };
  }, [isAuthenticated, setAll, upsert, remove, clear]);

  // Repeat the chime while an unresolved, sound-enabled order alert is open.
  // Plays once immediately on arming (e.g. just after the refresh catch-up
  // hydrates the store) — that play is allowed only if audio is already
  // unlocked; otherwise the first user gesture resumes it (see unlock above).
  useEffect(() => {
    if (!hasOpenOrderSound || muted) return;
    playChimeRef.current();
    const interval = setInterval(() => playChimeRef.current(), 6000);
    return () => clearInterval(interval);
  }, [hasOpenOrderSound, muted]);

  return (
    <>
      {children}
      {/* Order alerts float over every screen for any targeted user. */}
      <OrderNotificationStack />
    </>
  );
};

export default NotificationsProvider;
