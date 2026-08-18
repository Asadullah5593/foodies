import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdContentCopy } from 'react-icons/md';
import { hrService } from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';
import SearchableSelect from '../../../components/SearchableSelect';
import apiClient from '../../../utils/apiClient';

/**
 * Registered attendance devices.
 *
 * Each device carries its own token, which is why the station needs nobody
 * logged in. The token is readable here on purpose: setting up a replacement
 * tablet must not require re-registering, and it grants only one thing —
 * recording a punch at its own branch.
 */
const AttendanceStations: React.FC = () => {
  const queryClient = useQueryClient();
  const canManage = useHasPermission('attendance-stations:manage');
  const [branchId, setBranchId] = useState<number | ''>('');
  const [label, setLabel] = useState('');

  const { data: stations = [] } = useQuery({
    queryKey: ['hr-stations'],
    queryFn: () => hrService.listStations(),
    enabled: canManage,
  });

  const { data: branches = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['hr-branches'],
    queryFn: async () => {
      const { data } = await apiClient.get('/admin/branches');
      return data ?? [];
    },
    enabled: canManage,
  });

  const create = useMutation({
    mutationFn: () =>
      hrService.createStation({ branch_id: Number(branchId), label: label.trim() }),
    onSuccess: () => {
      toast.success('Device registered');
      setLabel('');
      queryClient.invalidateQueries({ queryKey: ['hr-stations'] });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not register the device';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  const revoke = useMutation({
    mutationFn: (id: number) => hrService.revokeStation(id),
    onSuccess: () => {
      toast.success('Device revoked — its token stops working immediately');
      queryClient.invalidateQueries({ queryKey: ['hr-stations'] });
    },
    onError: () => toast.error('Could not revoke the device'),
  });

  const setupLink = (token: string) =>
    `${window.location.origin}/attendance?token=${token}`;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error('Could not copy — select and copy manually');
    }
  };

  if (!canManage) return null;

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px]">
          <label className="mb-1 block text-xs uppercase text-gray-500">Branch</label>
          <SearchableSelect
            value={branchId === '' ? '' : String(branchId)}
            onChange={(v) => setBranchId(v === '' ? '' : Number(v))}
            options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            placeholder="Select a branch"
            searchPlaceholder="Search branches…"
          />
        </div>
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs uppercase text-gray-500">Label</label>
          <input
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
            placeholder="e.g. Staff entrance tablet"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={branchId === '' || label.trim().length < 2 || create.isPending}
          onClick={() => create.mutate()}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {create.isPending ? 'Registering…' : 'Register device'}
        </button>
      </div>

      {stations.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No devices registered yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                <th className="py-2 pr-4">Device</th>
                <th className="py-2 pr-4">Branch</th>
                <th className="py-2 pr-4">Last used</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {stations.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 pr-4 font-medium text-gray-900 dark:text-gray-100">
                    {s.label}
                  </td>
                  <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                    {s.branch?.name ?? s.branchId}
                  </td>
                  <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">
                    {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : 'never'}
                  </td>
                  <td className="py-2 pr-4">
                    {s.isActive ? (
                      <span className="text-green-600 dark:text-green-400">Active</span>
                    ) : (
                      <span className="text-gray-500">Revoked</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {s.isActive && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => copy(setupLink(s.token), 'Setup link')}
                          className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300"
                        >
                          <MdContentCopy /> Setup link
                        </button>
                        <button
                          type="button"
                          onClick={() => copy(s.token, 'Token')}
                          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300"
                        >
                          Copy token
                        </button>
                        <button
                          type="button"
                          onClick={() => revoke.mutate(s.id)}
                          className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400"
                        >
                          Revoke
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default AttendanceStations;
