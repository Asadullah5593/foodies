import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminService } from '../services/api/adminService';
import Modal from './Modal';
import Button from './Button';
import SearchableSelect from './SearchableSelect';
import NoRidersForBrandNotice from './NoRidersForBrandNotice';

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
  selectedRiderId,
  onSelectRider,
  onConfirm,
  isPending = false,
}) => {
  const { data: riders, isLoading } = useQuery({
    queryKey: ['assign-rider-riders', brandId],
    queryFn: () => adminService.getRiders(brandId ?? undefined),
    enabled: isOpen,
  });

  // Rating and phone stay in the label so both are searchable.
  const riderOptions = useMemo(
    () =>
      (riders ?? []).map((r) => ({
        value: String(r.id),
        label: [
          r.name,
          (r.rating_count ?? 0) > 0 && r.rating_average != null
            ? `${r.rating_average.toFixed(1)}/5 (${r.rating_count})`
            : null,
          r.phone,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
    [riders],
  );

  const hasRiders = riderOptions.length > 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">{subject}</p>
      {isLoading ? (
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">Loading riders…</p>
      ) : hasRiders ? (
        <SearchableSelect
          value={selectedRiderId != null ? String(selectedRiderId) : ''}
          onChange={(v) => onSelectRider(v ? Number(v) : null)}
          options={riderOptions}
          placeholder="Select a rider"
          searchPlaceholder="Search riders..."
          className="mb-4"
        />
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
