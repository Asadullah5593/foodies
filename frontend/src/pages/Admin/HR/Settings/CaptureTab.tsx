import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdDelete, MdEdit } from 'react-icons/md';
import Loader from '../../../../components/Loader';
import Modal from '../../../../components/Modal';
import SearchableSelect from '../../../../components/SearchableSelect';
import { CapturePolicyRow, hrService } from '../../../../services/api/hrService';
import { useHasPermission } from '../../../../hooks/useHasPermission';
import {
  EmptyHint,
  ScopeFields,
  TableShell,
  Toggle,
  field,
  labelClass,
  mutationError,
  scopeLabel,
  useBranches,
} from './settingsShared';

const RESOURCE = 'capture-policies';

const METHODS = [
  { value: 'pin', label: 'Employee code + PIN' },
  { value: 'qr', label: 'QR employee card' },
  { value: 'photo', label: 'Photo (camera required)' },
  { value: 'attestation', label: 'Manager attestation' },
];

const methodLabel = (m: string) =>
  METHODS.find((x) => x.value === m)?.label ?? m;

const blank = () => ({
  id: undefined as number | undefined,
  branchId: '' as number | '',
  primaryMethod: 'pin',
  requirePhoto: false,
  allowManagerAttestation: true,
  duplicateWindowSeconds: 60,
  photoRetentionDays: 90,
});

type Form = ReturnType<typeof blank>;

/**
 * How attendance may be recorded, per branch with a tenant default.
 *
 * The branch row wins over the tenant one, and there can only be one of each —
 * two rows for the same scope would make "which applies" depend on insertion
 * order, so the server refuses the second.
 */
const CaptureTab: React.FC = () => {
  const queryClient = useQueryClient();
  const canManage = useHasPermission('hr-settings:manage');
  const [editing, setEditing] = useState<Form | null>(null);
  const { data: branches = [] } = useBranches();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-settings', RESOURCE],
    queryFn: () => hrService.settingsList<CapturePolicyRow>(RESOURCE, true),
  });

  const save = useMutation({
    mutationFn: (form: Form) =>
      hrService.settingsSave(RESOURCE, {
        id: form.id,
        branchId: form.branchId === '' ? null : Number(form.branchId),
        primaryMethod: form.primaryMethod,
        requirePhoto: form.requirePhoto,
        allowManagerAttestation: form.allowManagerAttestation,
        duplicateWindowSeconds: form.duplicateWindowSeconds,
        photoRetentionDays: form.photoRetentionDays,
      }),
    onSuccess: () => {
      toast.success('Capture policy saved');
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['hr-settings', RESOURCE] });
    },
    onError: mutationError('Could not save the policy'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => hrService.settingsRemove(RESOURCE, id),
    onSuccess: () => {
      toast.success('Branch policy removed — the tenant default applies again');
      queryClient.invalidateQueries({ queryKey: ['hr-settings', RESOURCE] });
    },
    onError: mutationError('Could not remove the policy'),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          What the attendance station asks for. A branch row overrides the tenant
          default.
        </p>
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing(blank())}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New policy
          </button>
        )}
      </div>

      {isLoading ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyHint>
          No policy configured — the station falls back to code + PIN with photos
          optional.
        </EmptyHint>
      ) : (
        <TableShell
          headers={[
            'Applies to',
            'Method',
            'Photo',
            'Attestation',
            'Duplicate window',
            'Photo retention',
            '',
          ]}
        >
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 text-gray-900 dark:text-gray-100">
                {scopeLabel(r.branchId, branches)}
              </td>
              <td className="px-3 py-2 text-gray-800 dark:text-gray-200">
                {methodLabel(r.primaryMethod)}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.requirePhoto ? 'Required' : 'Optional'}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.allowManagerAttestation ? 'Allowed' : 'Off'}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.duplicateWindowSeconds}s
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.photoRetentionDays} days
              </td>
              <td className="px-3 py-2 text-right">
                {canManage && (
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({
                          id: r.id,
                          branchId: r.branchId ?? '',
                          primaryMethod: r.primaryMethod,
                          requirePhoto: r.requirePhoto,
                          allowManagerAttestation: r.allowManagerAttestation,
                          duplicateWindowSeconds: r.duplicateWindowSeconds,
                          photoRetentionDays: r.photoRetentionDays,
                        })
                      }
                      className="rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700"
                      aria-label="Edit policy"
                    >
                      <MdEdit />
                    </button>
                    {r.branchId != null && (
                      <button
                        type="button"
                        onClick={() => remove.mutate(r.id)}
                        className="rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        aria-label="Remove branch policy"
                      >
                        <MdDelete />
                      </button>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      {editing && (
        <Modal
          isOpen
          onClose={() => setEditing(null)}
          title={editing.id ? 'Edit capture policy' : 'New capture policy'}
          size="large"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ScopeFields
              branchId={editing.branchId}
              onBranch={(v) => setEditing({ ...editing, branchId: v })}
            />

            <div>
              <label className={labelClass}>Primary method *</label>
              <SearchableSelect
                value={editing.primaryMethod}
                onChange={(v) => setEditing({ ...editing, primaryMethod: v })}
                options={METHODS}
                placeholder="How staff identify themselves"
                ariaLabel="Primary method"
              />
            </div>

            <div>
              <label className={labelClass}>Duplicate window (seconds)</label>
              <input
                type="number"
                min={0}
                className={field}
                value={editing.duplicateWindowSeconds}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    duplicateWindowSeconds: Number(e.target.value),
                  })
                }
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                A second punch inside this window is rejected as a double tap.
              </p>
            </div>

            <div>
              <label className={labelClass}>Photo retention (days)</label>
              <input
                type="number"
                min={1}
                className={field}
                value={editing.photoRetentionDays}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    photoRetentionDays: Number(e.target.value),
                  })
                }
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                The nightly job deletes punch photos past this age from storage,
                not just from the record.
              </p>
            </div>

            <div className="sm:col-span-2 space-y-3">
              <Toggle
                label="Require a photo with every punch"
                hint="Terminals without a working camera will not be able to record attendance."
                checked={editing.requirePhoto}
                onChange={(v) => setEditing({ ...editing, requirePhoto: v })}
              />
              <Toggle
                label="Allow manager attestation"
                hint="A manager can record attendance for someone who cannot punch. Attested days stay flagged."
                checked={editing.allowManagerAttestation}
                onChange={(v) =>
                  setEditing({ ...editing, allowManagerAttestation: v })
                }
              />
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate(editing)}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default CaptureTab;
