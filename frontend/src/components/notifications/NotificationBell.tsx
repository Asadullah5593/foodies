import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MdOutlineNotificationsNone } from 'react-icons/md';
import { useNotificationsStore } from '../../stores/notificationsStore';
import { notificationsService } from '../../services/api/notificationsService';
import type { ClientNotification } from '../../stores/notificationsStore';

/**
 * Header bell showing admin-surface notifications (inventory, HR) with an unread
 * badge and a dropdown. Order notifications are intentionally excluded — those
 * surface on the POS/till screen as the actionable stack.
 */
const NotificationBell: React.FC = () => {
  const items = useNotificationsStore((s) => s.items);
  const markReadLocal = useNotificationsStore((s) => s.markRead);
  const markAllReadLocal = useNotificationsStore((s) => s.markAllRead);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Surface, not category: inventory and HR alerts both render here, and gating
  // on category would silently hide every new bell category added later.
  const bellItems = useMemo(
    () => items.filter((i) => i.surface === 'admin_bell' && i.status === 'open'),
    [items],
  );
  const unread = bellItems.filter((i) => !i.readAt).length;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const onItemClick = (n: ClientNotification) => {
    if (!n.readAt) {
      markReadLocal(n.id);
      notificationsService.markRead(n.id).catch(() => undefined);
    }
    // Newer alert types carry their own destination; inventory keeps its
    // historical behaviour so nothing that worked before changes.
    const link = typeof n.data?.link === 'string' ? (n.data.link as string) : null;
    const branchId = (n.data?.branchId as number | undefined) ?? n.branchId;
    if (link) {
      navigate(link);
    } else {
      navigate(
        branchId
          ? `/admin/inventory/on-hand?branch_id=${branchId}`
          : '/admin/inventory/on-hand',
      );
    }
    setOpen(false);
  };

  const onMarkAll = () => {
    markAllReadLocal();
    notificationsService.markAllRead().catch(() => undefined);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        aria-label="Notifications"
        title="Notifications"
      >
        <MdOutlineNotificationsNone className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Inventory alerts
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={onMarkAll}
                className="text-xs font-medium text-red-600 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {bellItems.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">
                No alerts
              </div>
            ) : (
              bellItems.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onItemClick(n)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-100 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors ${
                    n.readAt ? 'opacity-70' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.readAt && (
                      <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {n.body}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
