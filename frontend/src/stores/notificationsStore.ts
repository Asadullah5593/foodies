import { create } from 'zustand';

export interface NotificationAction {
  key: string;
  label: string;
  kind:
    | 'order.accept'
    | 'order.reject'
    | 'order.view'
    | 'inventory.view'
    | 'ack';
  style?: 'primary' | 'danger' | 'default';
  resolves: boolean;
}

export interface ClientNotification {
  id: number;
  type: string;
  category: 'order' | 'inventory' | string;
  surface: 'pos_stack' | 'admin_bell' | string;
  severity: string;
  resolutionMode: string;
  title: string;
  body: string | null;
  data: Record<string, any> | null;
  actions: NotificationAction[];
  soundEnabled: boolean;
  repeatSound: boolean;
  branchId: number | null;
  brandId: number | null;
  status: string;
  createdAt: string;
  readAt: string | null;
}

const MUTE_KEY = 'notifications_muted';

interface NotificationsState {
  items: ClientNotification[];
  muted: boolean;
  setAll: (items: ClientNotification[]) => void;
  upsert: (n: ClientNotification) => void;
  remove: (id: number) => void;
  markRead: (id: number) => void;
  markAllRead: () => void;
  setMuted: (muted: boolean) => void;
  clear: () => void;
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  items: [],
  muted:
    typeof localStorage !== 'undefined' &&
    localStorage.getItem(MUTE_KEY) === 'true',
  setAll: (items) => set({ items }),
  upsert: (n) =>
    set((s) => {
      const exists = s.items.some((i) => i.id === n.id);
      return {
        items: exists
          ? s.items.map((i) => (i.id === n.id ? n : i))
          : [n, ...s.items],
      };
    }),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  markRead: (id) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.id === id
          ? { ...i, readAt: i.readAt ?? new Date().toISOString() }
          : i,
      ),
    })),
  markAllRead: () =>
    set((s) => ({
      items: s.items.map((i) => ({
        ...i,
        readAt: i.readAt ?? new Date().toISOString(),
      })),
    })),
  setMuted: (muted) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MUTE_KEY, String(muted));
    }
    set({ muted });
  },
  clear: () => set({ items: [] }),
}));
