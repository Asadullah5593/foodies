import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activityLogService } from '../../services/api/activityLogService';
import { useHasPermission } from '../../hooks/useHasPermission';

const CAPTURE_LEVELS = [
  { value: 'mutations+sensitive_reads', label: 'Changes + sensitive reads', hint: 'Recommended' },
  { value: 'mutations', label: 'Changes only', hint: 'No record of who read what' },
  { value: 'all', label: 'Everything', hint: 'Very noisy; short investigations only' },
  { value: 'off', label: 'Off', hint: 'Nothing is recorded' },
];

/**
 * Capture controls, and the banner that makes a disabled log impossible to hide.
 *
 * The banner renders for anyone who can read the log, not just those who can
 * change it: "logging is off" is information the whole team needs, and the
 * person who turned it off is the last one who would mention it.
 */
export const CaptureStateBanner: React.FC = () => {
  const canView = useHasPermission('activity-log:view');
  const { data } = useQuery({
    queryKey: ['activityLogSettings'],
    queryFn: () => activityLogService.settings(),
    enabled: canView,
    staleTime: 60_000,
  });

  if (!data) return null;
  const off = data.env_disabled || data.capture_level === 'off';
  if (!off) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <span className="mt-0.5 text-lg leading-none">⚠</span>
      <div className="text-sm text-amber-900">
        <div className="font-semibold">Activity logging is currently OFF.</div>
        <div className="mt-0.5 text-amber-800">
          {data.env_disabled
            ? 'Disabled in the server environment (ACTIVITY_LOG_ENABLED). Nothing is being recorded — including this gap.'
            : `Capture level was set to "off"${data.updated_at ? ` on ${new Date(data.updated_at).toLocaleString('en-GB')}` : ''}. Nothing is being recorded.`}
        </div>
      </div>
    </div>
  );
};

const ActivityLogSettingsPanel: React.FC = () => {
  const canConfigure = useHasPermission('activity-log:configure');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data } = useQuery({
    queryKey: ['activityLogSettings'],
    queryFn: () => activityLogService.settings(),
    enabled: canConfigure,
  });
  const [draft, setDraft] = useState<{
    capture_level: string;
    pii_mode: string;
    retention_months: number;
  } | null>(null);

  const current = draft ?? {
    capture_level: data?.capture_level ?? 'mutations+sensitive_reads',
    pii_mode: data?.pii_mode ?? 'mask',
    retention_months: data?.retention_months ?? 13,
  };

  const save = useMutation({
    mutationFn: () =>
      activityLogService.updateSettings({ ...current, password }),
    onSuccess: () => {
      setSaved(true);
      setError(null);
      setPassword('');
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['activityLogSettings'] });
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      setError(e?.response?.data?.message ?? 'Could not save settings.');
    },
  });

  if (!canConfigure) return null;

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-gray-700">
          Capture settings
          <span className="ml-2 font-normal text-gray-400">
            {CAPTURE_LEVELS.find((l) => l.value === data?.capture_level)?.label ?? '—'}
            {data?.pii_mode === 'full' ? ' · PII stored in full' : ' · PII masked'}
          </span>
        </span>
        <span className="text-gray-400">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-gray-100 px-4 py-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              What to capture
            </label>
            <select
              aria-label="Capture level"
              value={current.capture_level}
              onChange={(e) => setDraft({ ...current, capture_level: e.target.value })}
              className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {CAPTURE_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label} — {l.hint}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Customer contact details
            </label>
            <select
              aria-label="PII mode"
              value={current.pii_mode}
              onChange={(e) => setDraft({ ...current, pii_mode: e.target.value })}
              className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="mask">Masked — keep that it changed, not the value</option>
              <option value="full">Stored in full</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Keep history for (months)
            </label>
            <input
              type="number"
              aria-label="Retention months"
              min={3}
              max={24}
              value={current.retention_months}
              onChange={(e) =>
                setDraft({ ...current, retention_months: Number(e.target.value) })
              }
              className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Older months are archived to write-once storage, verified, then removed
              from the database. They stay readable as downloadable files.
            </p>
          </div>

          <div className="rounded-lg bg-gray-50 p-3">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Re-enter your password to save
            </label>
            <input
              type="password"
              aria-label="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Your account password"
            />
            <p className="mt-1 text-xs text-gray-500">
              Changing what is recorded is logged before it takes effect, with your name
              on it.
            </p>
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}
          {saved && <div className="text-sm text-emerald-700">Settings saved.</div>}

          <button
            type="button"
            disabled={!password || save.isPending}
            onClick={() => save.mutate()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {save.isPending ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}
    </div>
  );
};

export default ActivityLogSettingsPanel;
