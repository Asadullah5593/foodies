import React, { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MdBackspace, MdCheckCircle, MdLogin, MdLogout } from 'react-icons/md';
import { hrService, PunchResult, PunchType } from '../../services/api/hrService';
import { useAuth } from '../../contexts/AuthContext';
import { usePunchCamera } from './usePunchCamera';

/**
 * The attendance station — a tablet parked at the staff entrance, or a POS tab.
 *
 * Employee code + PIN, because most staff have no login at all. There is no
 * biometric device: this deters substitution and leaves an audit trail, it does
 * not prove identity (docs/HRM.md §11).
 *
 * Deliberately minimal: no employee list, no search. Showing who works here
 * would hand a stranger every valid employee code, and the server already
 * returns the same message whether the code or the PIN is wrong.
 */
const AttendanceStation: React.FC = () => {
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [stage, setStage] = useState<'code' | 'pin'>('code');
  const [result, setResult] = useState<PunchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Opt-in per station rather than read from the branch policy: the same policy
  // may cover a till with no webcam and a tablet that has one.
  const [photoEnabled, setPhotoEnabled] = useState(false);

  const branchId =
    (user as { branch_id?: number; allowed_branch_ids?: number[] } | null)
      ?.branch_id ??
    (user as { allowed_branch_ids?: number[] } | null)?.allowed_branch_ids?.[0] ??
    null;

  // Clear the panel after a few seconds so the next person never sees — or
  // taps a punch onto — the previous person's session.
  useEffect(() => {
    if (!result && !error) return;
    const timer = setTimeout(() => {
      setResult(null);
      setError(null);
      setCode('');
      setPin('');
      setStage('code');
    }, 4000);
    return () => clearTimeout(timer);
  }, [result, error]);

  // Photo capture is best-effort: a missing or blocked camera must never stop
  // someone clocking in. A photo-less punch is flagged in the exceptions report.
  const { videoRef, ready: cameraReady, error: cameraError, capture } =
    usePunchCamera(photoEnabled);

  const mutation = useMutation({
    mutationFn: async (punchType: PunchType) => {
      const photoUrl = punchType === 'in' ? await capture() : null;
      return hrService.punch({
        branch_id: branchId as number,
        punch_type: punchType,
        employee_code: code.trim(),
        pin,
        photo_url: photoUrl ?? undefined,
      });
    },
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response
          ?.data?.message ?? 'Could not record that punch';
      setError(Array.isArray(message) ? message[0] : String(message));
      setResult(null);
      setPin('');
      setStage('pin');
    },
  });

  const active = stage === 'code' ? code : pin;
  const setActive = (value: string) => (stage === 'code' ? setCode(value) : setPin(value));

  const press = (key: string) => {
    if (mutation.isPending) return;
    if (key === 'back') return setActive(active.slice(0, -1));
    if (key === 'clear') return setActive('');
    if (active.length >= 12) return;
    setActive(active + key);
  };

  const canPunch = code.trim().length > 0 && pin.length >= 4 && branchId != null;

  if (branchId == null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
        <p className="max-w-md text-center text-slate-200">
          This account is not tied to a branch, so it cannot run an attendance station.
          Ask an administrator to assign a branch.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 p-6 text-slate-100">
      <h1 className="mb-1 text-2xl font-semibold">Attendance</h1>
      <p className="mb-4 text-sm text-slate-400">
        Enter your employee code, then your PIN
      </p>

      <label className="mb-4 flex items-center gap-2 text-xs text-slate-400">
        <input
          type="checkbox"
          checked={photoEnabled}
          onChange={(e) => setPhotoEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-slate-600"
        />
        Take a photo on clock-in
      </label>

      {photoEnabled && (
        <div className="mb-4 w-full max-w-sm">
          {/* Muted + playsInline so autoplay is permitted on tablets. */}
          <video
            ref={videoRef}
            muted
            playsInline
            className="h-32 w-full rounded-lg bg-slate-800 object-cover"
          />
          {cameraError ? (
            <p className="mt-1 text-xs text-amber-400">{cameraError}</p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              {cameraReady ? 'Camera ready' : 'Starting camera…'}
            </p>
          )}
        </div>
      )}

      {result && (
        <div
          className="mb-6 flex w-full max-w-sm items-center gap-3 rounded-lg bg-green-600/20 px-4 py-3"
          role="status"
        >
          <MdCheckCircle className="text-2xl text-green-400" />
          <div>
            <p className="font-medium">
              {result.employee.full_name} —{' '}
              {result.punch_type === 'in' ? 'clocked in' : 'clocked out'}
              {result.duplicate && ' (already recorded)'}
            </p>
            <p className="text-xs text-slate-300">
              {new Date(result.punched_at).toLocaleTimeString()}
              {/* An orphan punch is saved but claimed by no shift.
                Saying so beats a silent success the employee
                will discover as an absence at month end. */}
              {result.orphan && ' · outside any rostered shift — see your manager'}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div
          className="mb-6 w-full max-w-sm rounded-lg bg-red-600/20 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="mb-4 w-full max-w-sm space-y-2">
        <button
          type="button"
          onClick={() => setStage('code')}
          className={`w-full rounded-lg border px-4 py-3 text-left ${
            stage === 'code' ? 'border-blue-400 bg-slate-800' : 'border-slate-700'
          }`}
        >
          <span className="block text-xs uppercase text-slate-400">Employee code</span>
          <span className="font-mono text-lg">{code || '—'}</span>
        </button>
        <button
          type="button"
          onClick={() => setStage('pin')}
          className={`w-full rounded-lg border px-4 py-3 text-left ${
            stage === 'pin' ? 'border-blue-400 bg-slate-800' : 'border-slate-700'
          }`}
        >
          <span className="block text-xs uppercase text-slate-400">PIN</span>
          <span className="font-mono text-lg">{'•'.repeat(pin.length) || '—'}</span>
        </button>
      </div>

      <div className="mb-5 grid w-full max-w-sm grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            className="rounded-lg bg-slate-800 py-4 text-xl font-medium hover:bg-slate-700"
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          onClick={() => press('clear')}
          className="rounded-lg bg-slate-800 py-4 text-sm hover:bg-slate-700"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => press('0')}
          className="rounded-lg bg-slate-800 py-4 text-xl font-medium hover:bg-slate-700"
        >
          0
        </button>
        <button
          type="button"
          onClick={() => press('back')}
          aria-label="Backspace"
          className="flex items-center justify-center rounded-lg bg-slate-800 py-4 hover:bg-slate-700"
        >
          <MdBackspace className="text-xl" />
        </button>
      </div>

      <div className="grid w-full max-w-sm grid-cols-2 gap-3">
        <button
          type="button"
          disabled={!canPunch || mutation.isPending}
          onClick={() => mutation.mutate('in')}
          className="flex items-center justify-center gap-2 rounded-lg bg-green-600 py-4 font-medium hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <MdLogin /> Clock in
        </button>
        <button
          type="button"
          disabled={!canPunch || mutation.isPending}
          onClick={() => mutation.mutate('out')}
          className="flex items-center justify-center gap-2 rounded-lg bg-slate-600 py-4 font-medium hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <MdLogout /> Clock out
        </button>
      </div>
    </div>
  );
};

export default AttendanceStation;
