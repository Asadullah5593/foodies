import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminService } from '../services/api/adminService';
import Modal from './Modal';
import Button from './Button';
import SearchableSelect from './SearchableSelect';
import NoRidersForBrandNotice from './NoRidersForBrandNotice';

/** Compact reason for the option label; the full sentence is the tooltip. */
const REASON_LABELS: Record<string, string> = {
  user_inactive: 'account inactive',
  not_checked_in: 'not checked in',
  paused: 'on break',
  checked_in_elsewhere: 'at another branch',
  heartbeat_stale: 'app offline',
  location_unknown: 'no location',
  location_stale: 'location stale',
  outside_premises: 'outside premises',
  priority_locked: 'on a priority order',
  active_order_cap: 'at capacity',
};

function summariseReasons(reasons: string[], distanceM: number | null): string {
  const first = reasons[0];
  if (!first) return 'unavailable';
  const label = REASON_LABELS[first] ?? first.replace(/_/g, ' ');
  if (first === 'outside_premises' && distanceM != null) {
    return `${label} (${distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)}km` : `${distanceM}m`} away)`;
  }
  return label;
}

interface AssignRiderModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** "Assign rider", "Change rider", "Assign rider to group", … */
  title: string;
  /** Line under the title naming what is being assigned, e.g. "Order #001". */
  subject: string;
  /** Confirm button text — "Assign" or "Change". */
  confirmLabel: string;
  /** Order's brand; riders not linked to it are never offered. */
  brandId: number | null;
  brandName: string | null;
  /**
   * Order being assigned. Supplying it makes the list availability-aware: riders
   * who fail a dispatch check (not checked in, outside the branch premises, at
   * capacity) are shown greyed out with the reason instead of being offered and
   * then rejected on save.
   */
  orderId?: number | null;
  selectedRiderId: number | null;
  onSelectRider: (riderId: number | null) => void;
  onConfirm: () => void;
  isPending?: boolean;
}

/**
 * The one assign-rider modal, shared by Admin Orders and FOH Packing so the two
 * cannot drift apart. Owns the brand-scoped rider fetch: passing brandId is what
 * keeps the list to riders who can actually take the order (the backend rejects
 * the rest on save anyway).
 */
const AssignRiderModal: React.FC<AssignRiderModalProps> = ({
  isOpen,
  onClose,
  title,
  subject,
  confirmLabel,
  brandId,
  brandName,
  orderId = null,
  selectedRiderId,
  onSelectRider,
  onConfirm,
  isPending = false,
}) => {
  const { data: riders, isLoading } = useQuery({
    queryKey: ['assign-rider-riders', brandId, orderId],
    queryFn: () => adminService.getRiders(brandId ?? undefined, orderId ?? undefined),
    enabled: isOpen,
    // Presence and position go stale in seconds, so never serve a cached verdict.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Rating and phone stay in the label so both are searchable. Available riders
  // sort first — an admin should not have to hunt past unavailable ones.
  const riderOptions = useMemo(
    () =>
      (riders ?? [])
        .map((r) => {
          const blocked = r.is_eligible === false;
          return {
            value: String(r.id),
            label: [
              r.name,
              (r.rating_count ?? 0) > 0 && r.rating_average != null
                ? `${r.rating_average.toFixed(1)}/5 (${r.rating_count})`
                : null,
              r.phone,
              blocked ? `— ${summariseReasons(r.ineligible_reasons, r.distance_m)}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            disabled: blocked,
            title: blocked ? (r.ineligible_detail ?? undefined) : undefined,
          };
        })
        .sort((a, b) => Number(a.disabled) - Number(b.disabled)),
    [riders],
  );

  const hasRiders = riderOptions.length > 0;
  const availableCount = riderOptions.filter((o) => !o.disabled).length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">{subject}</p>
      {isLoading ? (
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">Loading riders…</p>
      ) : hasRiders ? (
        <>
          {orderId != null && availableCount === 0 && (
            <p className="text-sm text-red-600 dark:text-red-400 mb-3">
              No rider is available for this order right now. A rider becomes available once
              they are checked in at this branch and inside the branch premises.
            </p>
          )}
        <SearchableSelect
          value={selectedRiderId != null ? String(selectedRiderId) : ''}
          onChange={(v) => onSelectRider(v ? Number(v) : null)}
          options={riderOptions}
          placeholder="Select a rider"
          searchPlaceholder="Search riders..."
          className="mb-4"
        />
        </>
      ) : (
        <NoRidersForBrandNotice brandName={brandName} onNavigate={onClose} />
      )}
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onClose}>
          {!hasRiders && !isLoading ? 'Close' : 'Cancel'}
        </Button>
        {/* Nothing to assign with no riders — the notice above is the only action. */}
        {(hasRiders || isLoading) && (
          <Button
            variant="primary"
            disabled={selectedRiderId == null || isPending}
            isLoading={isPending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        )}
      </div>
    </Modal>
  );
};

export default AssignRiderModal;
