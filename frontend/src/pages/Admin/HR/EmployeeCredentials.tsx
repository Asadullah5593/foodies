import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { QRCodeCanvas } from 'qrcode.react';
import { MdBadge, MdInfoOutline, MdPassword } from 'react-icons/md';
import { hrService } from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';

interface Props {
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  hasPin: boolean;
  qrToken: string | null;
}

/**
 * Attendance credentials.
 *
 * The two are deliberately different:
 *
 *  - The **QR token** is readable and reprintable. It is a device credential;
 *    HR has to be able to print a replacement card, and a lost card is revoked
 *    by reissuing rather than by the token being secret from HR.
 *  - The **PIN** is bcrypt-hashed like a password and genuinely cannot be shown
 *    back — not a policy choice we can toggle. If someone forgets theirs, set a
 *    new one; whoever types it knows it.
 */
const EmployeeCredentials: React.FC<Props> = ({
  employeeId,
  employeeName,
  employeeCode,
  hasPin,
  qrToken,
}) => {
  const queryClient = useQueryClient();
  const canReset = useHasPermission('employee-pin:reset');
  const [pin, setPin] = useState('');
  const [lastSetPin, setLastSetPin] = useState<string | null>(null);

  const onError = (fallback: string) => (err: unknown) => {
    const message =
      (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
        ?.message ?? fallback;
    toast.error(Array.isArray(message) ? message[0] : message);
  };

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['hr-employee', employeeId] });

  const setPinMutation = useMutation({
    mutationFn: () => hrService.setPin(employeeId, pin),
    onSuccess: () => {
      // Echo it back once so it can be written down or told to the employee —
      // after this page is left it is unrecoverable.
      setLastSetPin(pin);
      setPin('');
      toast.success('PIN set');
      refresh();
    },
    onError: onError('Could not set the PIN'),
  });

  const issueQr = useMutation({
    mutationFn: () => hrService.issueQrCard(employeeId),
    onSuccess: () => {
      toast.success('Card issued');
      refresh();
    },
    onError: onError('Could not issue the card'),
  });

  const revokeQr = useMutation({
    mutationFn: () => hrService.revokeQrCard(employeeId),
    onSuccess: () => {
      toast.success('Card revoked');
      refresh();
    },
    onError: onError('Could not revoke the card'),
  });

  const printCard = () => {
    const canvas = document.getElementById(
      `qr-${employeeId}`,
    ) as HTMLCanvasElement | null;
    const dataUrl = canvas?.toDataURL('image/png');
    const w = window.open('', '_blank', 'width=420,height=560');
    if (!w) return;
    w.document.write(
      `<html><head><title>${employeeCode}</title></head><body style="font-family:sans-serif;text-align:center;padding:24px">
       <h2 style="margin:0 0 4px">${employeeName}</h2>
       <p style="margin:0 0 16px;color:#555">${employeeCode}</p>
       ${dataUrl ? `<img src="${dataUrl}" style="width:220px;height:220px" />` : ''}
       <p style="margin-top:16px;font-size:12px;color:#777">Scan at the attendance station</p>
       </body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  };

  if (!canReset) return null;

  return (
    <div className="space-y-5">
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
        {lastSetPin && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-300">
            New PIN is <strong className="font-mono text-sm">{lastSetPin}</strong> — note it
            now, it cannot be shown again.
          </p>
        )}
        <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <MdInfoOutline className="mt-0.5 shrink-0" />
          <span>
            An existing PIN cannot be displayed — it is hashed the same way login
            passwords are. If it is forgotten, set a new one.
          </span>
        </p>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <MdBadge /> QR card
        </div>

        {qrToken ? (
          <div className="flex flex-wrap items-start gap-4">
            <div className="rounded-md bg-white p-2">
              <QRCodeCanvas id={`qr-${employeeId}`} value={qrToken} size={128} />
            </div>
            <div className="min-w-0 flex-1">
              <code className="block break-all rounded bg-gray-100 px-2 py-1 text-xs dark:bg-slate-800">
                {qrToken}
              </code>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={printCard}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Print card
                </button>
                <button
                  type="button"
                  disabled={issueQr.isPending}
                  onClick={() => issueQr.mutate()}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
                >
                  Reissue
                </button>
                <button
                  type="button"
                  disabled={revokeQr.isPending}
                  onClick={() => revokeQr.mutate()}
                  className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  Revoke
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Reissuing replaces this token, which is how a lost card is revoked.
              </p>
            </div>
          </div>
        ) : (
          <div>
            <button
              type="button"
              disabled={issueQr.isPending}
              onClick={() => issueQr.mutate()}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
            >
              {issueQr.isPending ? 'Issuing…' : 'Issue a card'}
            </button>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Optional. Staff can clock in with their code and PIN alone.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmployeeCredentials;
