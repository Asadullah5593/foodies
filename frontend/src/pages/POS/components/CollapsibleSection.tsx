import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MdCheck, MdExpandMore } from 'react-icons/md';

const STORAGE_KEY = 'pos-panel-collapse';

export type SectionStatus = 'complete' | 'required-missing' | 'optional-empty';

export type CollapsibleSectionProps = {
  id: keyof Record<string, boolean>;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Status icon when collapsed: selected/satisfied, required but not selected, or optional and not selected */
  status?: SectionStatus;
  /** When false, collapse state is not persisted to localStorage (e.g. for modals) */
  persist?: boolean;
};

export function getStoredCollapseState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    }
  } catch {
    // ignore
  }
  return {};
}

export function setStoredCollapseState(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

const statusIcon: Record<SectionStatus, { icon: React.ReactNode; label: string; className: string }> = {
  complete: {
    icon: <MdCheck className="h-3.5 w-3.5" />,
    label: 'Selected',
    className: 'text-green-600 bg-green-100 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold',
  },
  'required-missing': {
    icon: '!',
    label: 'Required, not selected',
    className: 'text-amber-700 bg-amber-100 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold',
  },
  'optional-empty': {
    icon: '—',
    label: 'Optional, not selected',
    className: 'text-gray-500 bg-gray-100 rounded-full w-5 h-5 flex items-center justify-center text-xs',
  },
};

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  id,
  title,
  children,
  defaultOpen = true,
  status,
  persist = true,
}) => {
  const [open, setOpenState] = useState(defaultOpen);

  useEffect(() => {
    if (!persist) return;
    const stored = getStoredCollapseState();
    if (stored[id] !== undefined) setOpenState(stored[id]);
  }, [id, persist]);

  const toggle = () => {
    const next = !open;
    setOpenState(next);
    if (persist) {
      const stored = getStoredCollapseState();
      setStoredCollapseState({ ...stored, [id]: next });
    }
  };

  const statusInfo = status != null ? statusIcon[status] : null;

  return (
    <div className={`border-b border-foodies-border last:border-b-0 ${open ? 'border-l-2 border-l-foodies-primary pl-2 -ml-0.5 rounded-r' : ''}`}>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between py-2.5 text-left text-sm font-semibold text-foodies-textPrimary hover:bg-foodies-surfaceMuted/50 rounded-lg px-1 -mx-1 transition-colors gap-2"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 min-w-0">
          {statusInfo && (
            <span
              className={`flex-shrink-0 ${statusInfo.className}`}
              title={statusInfo.label}
              aria-label={statusInfo.label}
            >
              {statusInfo.icon}
            </span>
          )}
          <span className="truncate">{title}</span>
        </span>
        <motion.span
          className="text-foodies-primary inline-block flex-shrink-0"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: 'tween', duration: 0.2 }}
        >
          <MdExpandMore className="h-5 w-5" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'tween', duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="pb-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CollapsibleSection;
