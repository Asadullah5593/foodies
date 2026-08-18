import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  MdBackspace,
  MdCheckCircle,
  MdErrorOutline,
  MdLogin,
  MdLogout,
} from 'react-icons/md';
import {
  stationService,
  StationPunchResult,
  PunchType,
} from '../../services/api/stationService';
import { usePunchCamera } from './usePunchCamera';

const TOKEN_KEY = 'attendance_station_token';

/**
 * The attendance station — a tablet at the staff entrance, or a POS terminal.
 *
 * Runs with NOBODY logged in. Staff have no user accounts, and requiring a
 * manager to stay signed in all day leaves an authenticated admin session on a
 * shared screen. The device is identified by its own token; the employee still
 * proves themselves with their code + PIN.
 *
 * There is no biometric device: the photo deters substitution and leaves an
 * audit trail, it does not prove identity (docs/HRM.md §11).
 *
 * Deliberately minimal — no employee list, no search. Showing who works here
 * would hand a stranger every valid employee code.
 */
const AttendanceStation: React.FC = () => {
  const [token, setToken] = useState<string | null>(() => {
    // A URL token lets an admin set a device up by opening one link.
    const fromUrl = new URLSearchParams(window.location.search).get('token');
    if (fromUrl) {
      localStorage.setItem(TOKEN_KEY, fromUrl);
      window.history.replaceState({}, '', window.location.pathname);
      return fromUrl;
    }
    return localStorage.getItem(TOKEN_KEY);
  });
  const [tokenInput, setTokenInput] = useState('');

  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [result, setResult] = useState<StationPunchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photoOverride, setPhotoOverride] = useState<boolean | null>(null);

  const [mode, setMode] = useState<'pin' | 'card'>('pin');
  const [scan, setScan] = useState('');
  const codeRef = useRef<HTMLInputElement | null>(null);
  const pinRef = useRef<HTMLInputElement | null>(null);
  const scanRef = useRef<HTMLInputElement | null>(null);

  const context = useQuery({
    queryKey: ['station-context', token],
    queryFn: () => stationService.context(token as string),
    enabled: !!token,
    retry: false,
  });

  // The branch policy decides whether a photo is taken; the tick is only an
  // override for a device whose camera the policy does not know about.
  const photoRequired = context.data?.policy.require_photo === true;
  // The branch's configured method decides which panel opens first; both stay
  // reachable, since a card can be forgotten and a PIN can be.
  useEffect(() => {
    if (context.data?.policy.primary_method === 'qr_card') setMode('card');
  }, [context.data?.policy.primary_method]);
  const photoEnabled = photoOverride ?? photoRequired;

  const { videoRef, status: cameraStatus, error: cameraError, capture } =
    usePunchCamera(photoEnabled, token);
  // What happened to the LAST photo. Shown beside the punch result, because a
  // missing photo is otherwise invisible until somebody audits the register.
  const [photoNote, setPhotoNote] = useState<string | null>(null);

  /** Put the caret back where this mode expects it. */
  const refocus = () => {
    if (mode === 'card') scanRef.current?.focus();
    else pinRef.current?.focus();
  };

  const mutation = useMutation({
    mutationFn: async (args: { punchType: PunchType; qrToken?: string }) => {
      const shot =
        args.punchType === 'in'
          ? await capture()
          : { url: null as string | null, reason: null as string | null };
      setPhotoNote(
        args.punchType !== 'in'
          ? null
          : shot.url
            ? 'Photo saved'
            : photoEnabled
              ? `No photo — ${shot.reason ?? 'unknown reason'}`
              : null,
      );
      const photoUrl = shot.url;
      return stationService.punch(token as string, {
        punch_type: args.punchType,
        // A scanned card replaces code + PIN entirely.
        ...(args.qrToken
          ? { qr_token: args.qrToken }
          : { employee_code: code.trim(), pin }),
        photo_url: photoUrl ?? undefined,
      });
    },
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      setCode('');
      setPin('');
      setScan('');
      refocus();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response
          ?.data?.message ?? 'Could not record that punch';
      setError(Array.isArray(message) ? message[0] : String(message));
      setResult(null);
      setPin('');
      setScan('');
      refocus();
    },
  });

  // A SUCCESS clears itself so the next person never sees — or taps a punch
  // onto — the previous person's result. A FAILURE stays until it is dismissed
  // or the next attempt replaces it: an error that vanishes on a timer is
  // indistinguishable from nothing having happened, which is exactly how a
  // rejected PIN came to look like a dead screen.
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => {
      setResult(null);
      setPhotoNote(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [result]);

  // The scan field holds focus by default: a card reader is a keyboard, and it
  // types wherever the caret is. Anyone without a card just clicks the code box.
  useEffect(() => {
    if (!token || !context.isSuccess) return;
    if (mode === 'card') scanRef.current?.focus();
    else codeRef.current?.focus();
  }, [token, context.isSuccess, mode]);

  const canPunch = code.trim().length > 0 && pin.length >= 4;

  /** On-screen keypad, for touch devices. Typing works regardless. */
  const press = (key: string) => {
    if (mutation.isPending) return;
    const isPinFocused = document.activeElement === pinRef.current;
    const target = isPinFocused ? pinRef : codeRef;
    const setter = isPinFocused ? setPin : setCode;
    const current = isPinFocused ? pin : code;
    if (error) setError(null);
    if (key === 'back') setter(current.slice(0, -1));
    else if (key === 'clear') setter('');
    else if (current.length < 12) setter(current + key);
    target.current?.focus();
  };

  const submitScan = (punchType: PunchType) => {
    const value = scan.trim();
    if (value.length < 8 || mutation.isPending) return;
    mutation.mutate({ punchType, qrToken: value });
  };

  const inputCls =
    'w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-center font-mono text-xl tracking-widest text-slate-100 focus:border-blue-400 focus:outline-none';

  // ---- device not registered yet -----------------------------------------

  if (!token || context.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 p-6 text-slate-100">
        <h1 className="text-xl font-semibold">Set up this device</h1>
        <p className="max-w-md text-center text-sm text-slate-400">
          {context.isError
            ? 'This device token is not recognised — it may have been revoked. Paste a new one.'
            : 'Paste the station token from Admin → HR → Attendance, or open the setup link on this device.'}
        </p>
        <input
          className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm"
          placeholder="Station token"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value.trim())}
        />
        <button
          type="button"
          disabled={tokenInput.length < 8}
          onClick={() => {
            localStorage.setItem(TOKEN_KEY, tokenInput);
            setToken(tokenInput);
          }}
          className="rounded-lg bg-blue-600 px-5 py-3 font-medium hover:bg-blue-700 disabled:opacity-40"
        >
          Register device
        </button>
      </div>
    );
  }

  if (context.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-300">
        Checking device…
      </div>
    );
  }

  // ---- the station -------------------------------------------------------

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 p-6 text-slate-100">
      <h1 className="text-2xl font-semibold">Attendance</h1>
      <p className="mb-1 text-sm text-slate-400">
        {context.data?.branch.name ?? 'Branch'} · {context.data?.station.label}
      </p>
      <p className="mb-5 text-sm text-slate-500">
        {mode === 'card'
          ? 'Scan your card to clock in or out'
          : 'Type your employee code and PIN, then clock in or out'}
      </p>

      {result && (
        <div
          className="mb-5 flex w-full max-w-sm items-center gap-3 rounded-lg bg-green-600/20 px-4 py-3"
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
              {result.orphan && ' · outside any rostered shift — see your manager'}
            </p>
            {photoNote && (
              <p
                className={`text-xs ${
                  photoNote === 'Photo saved' ? 'text-slate-400' : 'text-amber-300'
                }`}
              >
                {photoNote}
              </p>
            )}
          </div>
        </div>
      )}

      {error && (
        <button
          type="button"
          className="mb-5 flex w-full max-w-sm items-start gap-3 rounded-lg bg-red-600 px-4 py-3 text-left text-white shadow-lg"
          aria-live="assertive"
          onClick={() => {
            setError(null);
            refocus();
          }}
        >
          <MdErrorOutline className="mt-0.5 shrink-0 text-2xl" />
          <span>
            <span className="block font-semibold">{error}</span>
            <span className="block text-xs text-red-100">Tap to dismiss and try again</span>
          </span>
        </button>
      )}

      {photoEnabled && (
        <div className="mb-4 w-full max-w-sm">
          <video
            ref={videoRef}
            muted
            playsInline
            // Large enough to see who is standing there: the whole point of the
            // photo is that a substitution is visible.
            className="aspect-[4/3] w-full rounded-lg bg-slate-800 object-cover"
          />
          <p className="mt-1 text-xs text-slate-500">
            {cameraError ??
              (cameraStatus === 'capturing'
                ? 'Taking photo…'
                : cameraStatus === 'uploading'
                  ? 'Saving photo…'
                  : cameraStatus === 'ready'
                    ? 'Camera ready'
                    : 'Starting camera…')}
          </p>
        </div>
      )}

      {/* Two distinct ways in, one at a time. Showing both at once made it
          ambiguous which fields mattered and which button applied to what. */}
      <div className="mb-4 flex w-full max-w-sm rounded-lg bg-slate-800 p-1">
        {(['pin', 'card'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-md py-2 text-sm font-medium ${
              mode === m ? 'bg-blue-600 text-white' : 'text-slate-300'
            }`}
          >
            {m === 'pin' ? 'Code + PIN' : 'Scan card'}
          </button>
        ))}
      </div>

      {mode === 'card' ? (
        <div className="w-full max-w-sm">
          <label
            htmlFor="station-scan"
            className="mb-1 block text-xs uppercase text-slate-400"
          >
            Scan your card
          </label>
          {/* A reader is a keyboard that ends with Enter, so the field simply
              submits on Enter — no driver, no integration. A card carries
              identity only, so the buttons choose in or out. */}
          <input
            id="station-scan"
            ref={scanRef}
            className={inputCls}
            placeholder="Waiting for scan…"
            value={scan}
            autoComplete="off"
            onChange={(e) => {
              if (error) setError(null);
              setScan(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              submitScan('in');
            }}
          />
          <p className="mt-2 text-xs text-slate-500">
            Scanning clocks you in. To clock out, scan then press Clock out.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={scan.trim().length < 8 || mutation.isPending}
              onClick={() => submitScan('in')}
              className="flex items-center justify-center gap-2 rounded-lg bg-green-600 py-4 font-medium hover:bg-green-700 disabled:opacity-40"
            >
              <MdLogin /> Clock in
            </button>
            <button
              type="button"
              disabled={scan.trim().length < 8 || mutation.isPending}
              onClick={() => submitScan('out')}
              className="flex items-center justify-center gap-2 rounded-lg bg-slate-600 py-4 font-medium hover:bg-slate-700 disabled:opacity-40"
            >
              <MdLogout /> Clock out
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Real inputs, so a keyboard, a scanner and the keypad all work. */}
          <form
            className="mb-4 w-full max-w-sm space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (canPunch && !mutation.isPending) {
                mutation.mutate({ punchType: 'in' });
              }
            }}
          >
            <div>
              <label
                htmlFor="station-code"
                className="mb-1 block text-xs uppercase text-slate-400"
              >
                Employee code
              </label>
              <input
                id="station-code"
                ref={codeRef}
                className={inputCls}
                value={code}
                autoComplete="off"
                onChange={(e) => {
                  if (error) setError(null);
                  setCode(e.target.value);
                }}
                onKeyDown={(e) => {
                  // Enter moves on rather than submitting half a form.
                  if (e.key === 'Enter' && pin.length < 4) {
                    e.preventDefault();
                    pinRef.current?.focus();
                  }
                }}
              />
            </div>
            <div>
              <label
                htmlFor="station-pin"
                className="mb-1 block text-xs uppercase text-slate-400"
              >
                PIN
              </label>
              <input
                id="station-pin"
                ref={pinRef}
                type="password"
                inputMode="numeric"
                maxLength={8}
                className={inputCls}
                value={pin}
                autoComplete="off"
                onChange={(e) => {
                  if (error) setError(null);
                  setPin(e.target.value.replace(/\D/g, ''));
                }}
              />
            </div>
            <button type="submit" className="hidden" aria-hidden />
          </form>

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
              onClick={() => mutation.mutate({ punchType: 'in' })}
              className="flex items-center justify-center gap-2 rounded-lg bg-green-600 py-4 font-medium hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <MdLogin /> Clock in
            </button>
            <button
              type="button"
              disabled={!canPunch || mutation.isPending}
              onClick={() => mutation.mutate({ punchType: 'out' })}
              className="flex items-center justify-center gap-2 rounded-lg bg-slate-600 py-4 font-medium hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <MdLogout /> Clock out
            </button>
          </div>
        </>
      )}

      <label className="mt-5 flex items-center gap-2 text-xs text-slate-500">
        <input
          type="checkbox"
          checked={photoEnabled}
          disabled={photoRequired}
          onChange={(e) => setPhotoOverride(e.target.checked)}
          className="h-4 w-4 rounded border-slate-600"
        />
        Take a photo on clock-in
        {photoRequired && ' (required at this branch)'}
      </label>
    </div>
  );
};

export default AttendanceStation;
