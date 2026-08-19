import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activityLogService } from '../../services/api/activityLogService';
import { useHasPermission } from '../../hooks/useHasPermission';

const CAPTURE_LEVELS = [
  {
    value: 'mutations+sensitive_reads',
    label: 'Changes + sensitive reads',
    hint: 'Recommended — every change, plus who opened screens holding customer data',
  },
  {
    value: 'mutations',
    label: 'Changes only',
    hint: 'Lighter. No record of who read what',
  },
  {
    value: 'all',
    label: 'Everything',
    hint: 'Very noisy. For short investigations only',
  },
  { value: 'off', label: 'Off', hint: 'Nothing is recorded' },
];

/**
 * One-line warning that capture is off.
 *
 * Renders for anyone who can READ the log, not just those who can change it:
 * "logging is off" is information the whole team needs, and the person who
 * switched it off is the last one who would mention it.
 */
export const CaptureStateBanner: React.FC = () => {
  const canView = useHasPermission([
    'activity-log:view',
    'activity-log:view:access',
    'activity-log:view:menu',
    'activity-log:view:offers',
    'activity-log:view:shifts',
    'activity-log:view:inventory',
    'activity-log:view:orders',
    'activity-log:view:auth',
    'activity-log:view:system',
  ]);
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
    <div className="mb-[18px] flex items-center gap-2.5 rounded-xl border border-[#F5C77E] bg-[#FFF8EC] px-4 py-2.5 text-[13px]">
      <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#E0932B] text-[11px] font-bold text-white">
        !
      </span>
      <span className="font-bold text-[#8A5A08]">Logging is OFF.</span>
      <span className="text-[#A3762B]">
        {data.env_disabled
          ? 'Disabled in the server environment — nothing is being recorded, including this gap.'
          : 'Capture level is set to off — nothing is being recorded, including this gap.'}
      </span>
    </div>
  );
};

/**
 * Capture settings as a **modal**, opened from a button in the page header.
 *
 * Deliberately not a panel on the page: these are set once and then left alone,
 * and anything permanently occupying the top of the screen competes with the
 * log itself — which is the thing people came to read.
 */
const ActivityLogSettingsPanel: React.FC = () => {
  const canConfigure = useHasPermission('activity-log:configure');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    capture_level: string;
    pii_mode: string;
    retention_months: number;
  } | null>(null);

  const { data } = useQuery({
    queryKey: ['activityLogSettings'],
    queryFn: () => activityLogService.settings(),
    enabled: canConfigure,
  });

  // Escape closes, like every other dialog in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const current = draft ?? {
    capture_level: data?.capture_level ?? 'mutations+sensitive_reads',
    pii_mode: data?.pii_mode ?? 'mask',
    retention_months: data?.retention_months ?? 13,
  };

  const save = useMutation({
    mutationFn: () => activityLogService.updateSettings({ ...current, password }),
    onSuccess: () => {
      setError(null);
      setPassword('');
      setDraft(null);
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['activityLogSettings'] });
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      setError(e?.response?.data?.message ?? 'Could not save settings.');
    },
  });

  if (!canConfigure) return null;

  const capturing = !(data?.env_disabled || data?.capture_level === 'off');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 whitespace-nowrap rounded-[11px] border-[1.5px] border-[#E2E5EA] bg-white px-[15px] py-[10px] text-[13px] font-semibold text-[#374151] transition hover:bg-[#F3F4F6]"
      >
        <span
          className={`h-2 w-2 flex-none rounded-full ${
            capturing ? 'bg-[#22C55E]' : 'bg-[#E0932B]'
          }`}
          aria-hidden
        />
        Capture settings
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Capture settings"
          >
            <div className="flex items-start justify-between border-b border-[#ECEDF0] px-5 py-4">
              <div>
                <h2 className="text-[17px] font-extrabold text-[#20242C]">
                  Capture settings
                </h2>
                <p className="mt-0.5 text-[12.5px] text-[#8A92A0]">
                  What gets recorded, and for how long
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-lg px-2.5 py-1 text-lg leading-none text-[#9AA1AD] hover:bg-[#F3F4F6]"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div>
                <label
                  htmlFor="al-capture"
                  className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]"
                >
                  What to capture
                </label>
                <select
                  id="al-capture"
                  aria-label="Capture level"
                  value={current.capture_level}
                  onChange={(e) =>
                    setDraft({ ...current, capture_level: e.target.value })
                  }
                  className="w-full rounded-[10px] border-[1.5px] border-[#E2E5EA] px-3 py-2.5 text-[13.5px]"
                >
                  {CAPTURE_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[12px] text-[#8A92A0]">
                  {CAPTURE_LEVELS.find((l) => l.value === current.capture_level)?.hint}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="al-pii"
                    className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]"
                  >
                    Customer contacts
                  </label>
                  <select
                    id="al-pii"
                    aria-label="PII mode"
                    value={current.pii_mode}
                    onChange={(e) => setDraft({ ...current, pii_mode: e.target.value })}
                    className="w-full rounded-[10px] border-[1.5px] border-[#E2E5EA] px-3 py-2.5 text-[13.5px]"
                  >
                    <option value="mask">Masked</option>
                    <option value="full">Stored in full</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="al-retention"
                    className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]"
                  >
                    Keep for (months)
                  </label>
                  <input
                    id="al-retention"
                    type="number"
                    aria-label="Retention months"
                    min={3}
                    max={24}
                    value={current.retention_months}
                    onChange={(e) =>
                      setDraft({
                        ...current,
                        retention_months: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-[10px] border-[1.5px] border-[#E2E5EA] px-3 py-2.5 text-[13.5px]"
                  />
                </div>
              </div>
              <p className="-mt-1 text-[12px] text-[#8A92A0]">
                Older months are archived to write-once storage, verified, then removed
                from the database. They stay readable as downloadable files.
              </p>

              <div className="rounded-xl bg-[#FBFBFC] p-3.5">
                <label
                  htmlFor="al-password"
                  className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]"
                >
                  Re-enter your password
                </label>
                <input
                  id="al-password"
                  type="password"
                  aria-label="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your account password"
                  className="w-full rounded-[10px] border-[1.5px] border-[#E2E5EA] px-3 py-2.5 text-[13.5px]"
                />
                <p className="mt-1.5 text-[12px] text-[#8A92A0]">
                  This change is written to the log before it takes effect, with your
                  name on it.
                </p>
              </div>

              {error && <div className="text-[13px] text-[#DC2A2A]">{error}</div>}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#ECEDF0] px-5 py-3.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white px-4 py-2 text-[13px] font-semibold text-[#374151] hover:bg-[#F3F4F6]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!password || save.isPending}
                onClick={() => save.mutate()}
                className="rounded-[10px] bg-[#DC2A2A] px-4 py-2 text-[13px] font-bold text-white transition hover:bg-[#C21F1F] disabled:cursor-not-allowed disabled:bg-[#D3D7DE]"
              >
                {save.isPending ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ActivityLogSettingsPanel;
