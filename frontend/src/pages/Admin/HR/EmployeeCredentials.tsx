import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdBadge, MdPassword } from 'react-icons/md';
import { hrService } from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';

interface Props {
  employeeId: number;
  hasPin: boolean;
}

/**
 * Attendance credentials: the PIN the employee types at the station, and the
 * optional QR card.
 *
 * The QR token is shown ONCE after issuing, because no read endpoint exposes it
 * — printing it is the only reason it is ever visible.
 */
const EmployeeCredentials: React.FC<Props> = ({ employeeId, hasPin }) => {
  const queryClient = useQueryClient();
  const canReset = useHasPermission('employee-pin:reset');
  const [pin, setPin] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const onError = (fallback: string) => (err: unknown) => {
    const message =
      (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
        ?.message ?? fallback;
    toast.error(Array.isArray(message) ? message[0] : message);
  };

  const setPinMutation = useMutation({
    mutationFn: () => hrService.setPin(employeeId, pin),
    onSuccess: () => {
      toast.success('PIN set — tell the employee in person, it cannot be read back');
      setPin('');
      queryClient.invalidateQueries({ queryKey: ['hr-employee', employeeId] });
    },
    onError: onError('Could not set the PIN'),
  });

  const issueQr = useMutation({
    mutationFn: () => hrService.issueQrCard(employeeId),
    onSuccess: (result) => {
      setIssuedToken(result.qr_token);
      toast.success('Card issued — print it now, the token is not shown again');
    },
    onError: onError('Could not issue the card'),
  });

  const revokeQr = useMutation({
    mutationFn: () => hrService.revokeQrCard(employeeId),
    onSuccess: () => {
      setIssuedToken(null);
      toast.success('Card revoked');
    },
    onError: onError('Could not revoke the card'),
  });

  if (!canReset) return null;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <MdPassword /> Attendance PIN
          <span className="text-xs font-normal text-gray-500">
            {hasPin ? '(set)' : '(not set)'}
          </span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            maxLength={8}
            className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
            placeholder="4–8 digits"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
          <button
            type="button"
            disabled={!/^\d{4,8}$/.test(pin) || setPinMutation.isPending}
            onClick={() => setPinMutation.mutate()}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {hasPin ? 'Reset PIN' : 'Set PIN'}
          </button>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <MdBadge /> QR card
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={issueQr.isPending}
            onClick={() => issueQr.mutate()}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
          >
            Issue / reissue
          </button>
          <button
            type="button"
            disabled={revokeQr.isPending}
            onClick={() => revokeQr.mutate()}
            className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            Revoke
          </button>
        </div>
        {issuedToken && (
          <div className="mt-3 rounded-md bg-amber-50 p-3 dark:bg-amber-900/20">
            <p className="mb-1 text-xs font-medium text-amber-900 dark:text-amber-300">
              Print this now — it is not retrievable.
            </p>
            <code className="block break-all rounded bg-white px-2 py-1 text-xs dark:bg-slate-900">
              {issuedToken}
            </code>
          </div>
        )}
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Reissuing replaces the previous token, which is how a lost card is revoked.
        </p>
      </div>
    </div>
  );
};

export default EmployeeCredentials;
