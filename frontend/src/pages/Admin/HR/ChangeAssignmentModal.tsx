import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Modal from '../../../components/Modal';
import apiClient from '../../../utils/apiClient';
import { useQuery } from '@tanstack/react-query';
import {
  ChangeAssignmentPayload,
  Designation,
  EmployeeAssignmentRow,
  hrService,
} from '../../../services/api/hrService';
import SearchableSelect from '../../../components/SearchableSelect';

interface Props {
  employeeId: number;
  current: EmployeeAssignmentRow;
  designations: Designation[];
  onClose: () => void;
}

const REASONS: Array<{ value: ChangeAssignmentPayload['change_reason']; label: string }> = [
  { value: 'promotion', label: 'Promotion' },
  { value: 'demotion', label: 'Demotion' },
  { value: 'transfer_branch', label: 'Branch transfer' },
  { value: 'transfer_brand', label: 'Brand transfer' },
  { value: 'designation_change', label: 'Designation change' },
  { value: 'confirmation', label: 'Confirmation after probation' },
];

const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Promote, demote, transfer or confirm.
 *
 * This never edits the current assignment — the server closes it the day before
 * `effective_from` and opens a new row, which is what keeps employment history
 * intact. The UI mirrors that: the current values are shown as the starting
 * point, and anything left unchanged simply carries over.
 */
const ChangeAssignmentModal: React.FC<Props> = ({
  employeeId,
  current,
  designations,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<ChangeAssignmentPayload['change_reason']>('promotion');
  const [effectiveFrom, setEffectiveFrom] = useState(tomorrow());
  const [branchId, setBranchId] = useState<number>(current.branch.id);
  const [brandId, setBrandId] = useState<number | ''>(current.brand?.id ?? '');
  const [designationId, setDesignationId] = useState<number>(current.designation?.id ?? 0);
  const [note, setNote] = useState('');

  const { data: branches = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['hr-branches'],
    queryFn: async () => {
      const { data } = await apiClient.get('/admin/branches');
      return data ?? [];
    },
  });

  const { data: brands = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['hr-brands'],
    queryFn: async () => {
      const { data } = await apiClient.get('/admin/brands');
      return data ?? [];
    },
  });

  const currentLevel = current.designation?.level ?? 0;
  const targetLevel = useMemo(
    () => designations.find((d) => d.id === designationId)?.level ?? currentLevel,
    [designations, designationId, currentLevel],
  );

  // Mirrors the server rule so the user is told before submitting rather than
  // after a 400. The server still enforces it — this is convenience, not a gate.
  const promotionGoesNowhere = reason === 'promotion' && targetLevel <= currentLevel;

  const mutation = useMutation({
    mutationFn: () =>
      hrService.changeAssignment(employeeId, {
        change_reason: reason,
        effective_from: effectiveFrom,
        branch_id: branchId,
        brand_id: brandId === '' ? null : Number(brandId),
        designation_id: designationId || undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Assignment updated');
      queryClient.invalidateQueries({ queryKey: ['hr-employee', employeeId] });
      queryClient.invalidateQueries({ queryKey: ['hr-employees'] });
      onClose();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not update the assignment';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';
  const label = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

  return (
    <Modal isOpen onClose={onClose} title="Promote / transfer" size="xlarge">
      <p className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
        The current assignment is closed the day before the effective date and a new one opens.
        Nothing is overwritten, so the employment history stays intact.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={label}>Reason *</label>
          <SearchableSelect
            value={reason}
            onChange={(v) => setReason(v as ChangeAssignmentPayload['change_reason'])}
            options={REASONS.map((r) => ({ value: r.value, label: r.label }))}
          />
        </div>

        <div>
          <label className={label}>Effective from *</label>
          <input
            type="date"
            className={field}
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </div>

        <div>
          <label className={label}>Designation</label>
          {/* A promotion can only move up, so offering lower titles just
              produces an error the user has to read. Demotions show only lower
              ones for the same reason. */}
          <SearchableSelect
            value={String(designationId)}
            onChange={(v) => setDesignationId(Number(v))}
            options={designations
              .filter((d) => {
                if (reason === 'promotion') return d.level > currentLevel;
                if (reason === 'demotion') return d.level < currentLevel;
                return true;
              })
              .map((d) => ({
                value: String(d.id),
                label: `${d.name} (level ${d.level})`,
              }))}
            placeholder={
              reason === 'promotion'
                ? 'Select a more senior designation'
                : 'Select a designation'
            }
            searchPlaceholder="Search designations…"
          />
          {promotionGoesNowhere && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              A promotion must move up the ladder. Level {targetLevel} is not senior to the current
              level {currentLevel}.
            </p>
          )}
        </div>

        <div>
          <label className={label}>Branch</label>
          <SearchableSelect
            value={String(branchId)}
            onChange={(v) => setBranchId(Number(v))}
            options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            searchPlaceholder="Search branches…"
          />
        </div>

        <div>
          <label className={label}>Brand</label>
          <SearchableSelect
            value={brandId === '' ? '' : String(brandId)}
            onChange={(v) => setBrandId(v === '' ? '' : Number(v))}
            options={[
              { value: '', label: 'Shared — not tied to a brand' },
              ...brands.map((b) => ({ value: String(b.id), label: b.name })),
            ]}
            searchPlaceholder="Search brands…"
          />
        </div>

        <div className="sm:col-span-2">
          <label className={label}>Note</label>
          <textarea
            className={field}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Shown on the employee's timeline"
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={mutation.isPending || promotionGoesNowhere || !effectiveFrom}
          onClick={() => mutation.mutate()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? 'Saving…' : 'Apply change'}
        </button>
      </div>
    </Modal>
  );
};

export default ChangeAssignmentModal;
