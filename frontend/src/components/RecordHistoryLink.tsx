import React from 'react';
import { Link } from 'react-router-dom';
import { useHasPermission } from '../hooks/useHasPermission';

/**
 * Which per-module read permission covers this record. Holding the umbrella
 * `activity-log:view` satisfies any of them.
 */
export type HistoryModule =
  | 'access'
  | 'menu'
  | 'offers'
  | 'shifts'
  | 'inventory'
  | 'orders'
  | 'auth'
  | 'system';

interface RecordHistoryLinkProps {
  /** Gates the link on `activity-log:view:<module>`. */
  module: HistoryModule;
  /** Must match the entity_type the backend records (e.g. 'menu_item', 'role'). */
  entityType: string;
  entityId: number | string;
  /** Shown in the Activity Log header so the reader knows what they opened. */
  label?: string;
  className?: string;
  children?: React.ReactNode;
}

/**
 * "History" affordance on a record page.
 *
 * It is a LINK into the Activity Log, not a second history UI. The Activity Log
 * keeps its filters in the URL, so a deep link is the whole feature — one screen
 * to maintain, and it improves automatically as that screen does.
 *
 * **Renders nothing without `activity-log:view`.** That is deliberate and it is
 * only half the protection: hiding a link is cosmetic, and the endpoint behind
 * it enforces the same permission server-side. This just avoids showing people a
 * door they cannot open.
 */
const RecordHistoryLink: React.FC<RecordHistoryLinkProps> = ({
  module,
  entityType,
  entityId,
  label,
  className = '',
  children,
}) => {
  // Any-of: the umbrella, or the narrow grant for this module. Hiding the link
  // is cosmetic — the endpoint filters rows by the same permission server-side.
  const canView = useHasPermission([
    'activity-log:view',
    `activity-log:view:${module}`,
  ]);
  if (!canView) return null;

  const params = new URLSearchParams({
    entity_type: entityType,
    entity_id: String(entityId),
  });
  if (label) params.set('entity_label', label);

  return (
    <Link
      to={`/admin/activity-logs?${params.toString()}`}
      title={`Who changed ${label ?? 'this record'}, and what it was before`}
      className={
        className ||
        'inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50'
      }
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.5V8l2.5 1.5" />
      </svg>
      {children ?? 'History'}
    </Link>
  );
};

export default RecordHistoryLink;
