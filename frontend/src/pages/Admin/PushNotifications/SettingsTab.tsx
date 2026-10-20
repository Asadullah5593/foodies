import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import type { PushSettings } from '../../../types';
import { pushService } from '../../../services/api';
import SegToggle from '../../../components/SegToggle';
import { cu } from '../customersUi';
import { time12 } from './pushText';
import { zoneLabel } from './pushTime';

const ZONES = ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Europe/London', 'UTC'];

function errorText(e: unknown): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong';
}

/** The guard rails: time zone, quiet hours, per-customer limits, expiry, test phones. */
const SettingsTab: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['push-settings'], queryFn: pushService.settings });
  const [s, setS] = useState<(PushSettings & { phones_text: string }) | null>(null);
  useEffect(() => {
    if (data) setS({ ...data, phones_text: data.test_phones.join('\n') });
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      pushService.saveSettings({
        timezone: s!.timezone,
        quiet_hours_enabled: s!.quiet_hours_enabled,
        quiet_start: s!.quiet_start,
        quiet_end: s!.quiet_end,
        cap_per_day: s!.cap_per_day,
        cap_per_week: s!.cap_per_week,
        default_expiry_hours: s!.default_expiry_hours,
        skip_order_in_progress: s!.skip_order_in_progress,
        test_phones: s!.phones_text.split(/[\s,;]+/).filter(Boolean),
      }),
    onSuccess: (d) => {
      qc.setQueryData(['push-settings'], d);
      qc.invalidateQueries({ queryKey: ['push-meta'] });
      toast.success('Settings saved');
    },
    onError: (e) => toast.error(errorText(e)),
  });

  if (!s) return <p className="py-10 text-center text-gray-500">Loading…</p>;
  const set = (patch: Partial<typeof s>) => setS({ ...s, ...patch });
  const num = (v: string) => (v === '' ? null : Number(v));
  const section = `${cu.card} rounded-[16px] p-5`;

  return (
    <fieldset disabled={!canEdit} className="max-w-[860px] space-y-5">
      {!canEdit && <p className={`text-[13px] ${cu.muted}`}>You can see these settings; changing them needs the "push-notifications:settings" permission.</p>}

      <section className={section}>
        <h2 className={`mb-1 text-[15.5px] font-bold ${cu.strong}`}>Quiet hours</h2>
        <p className={`mb-3 text-[12.5px] ${cu.muted}`}>Nothing goes out in this window. A notification that comes due then waits until it ends.</p>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2">
            <SegToggle on={s.quiet_hours_enabled} onChange={(v) => set({ quiet_hours_enabled: v })} ariaLabel="Quiet hours on" />
          </div>
          <label>
            <span className={cu.fieldLabel}>From</span>
            <input type="time" className={cu.input} value={s.quiet_start} onChange={(e) => set({ quiet_start: e.target.value })} disabled={!s.quiet_hours_enabled} />
          </label>
          <label>
            <span className={cu.fieldLabel}>Until</span>
            <input type="time" className={cu.input} value={s.quiet_end} onChange={(e) => set({ quiet_end: e.target.value })} disabled={!s.quiet_hours_enabled} />
          </label>
          {s.quiet_hours_enabled && (
            <span className={`pb-3 text-[12.5px] ${cu.muted}`}>
              {time12(s.quiet_start)} – {time12(s.quiet_end)}, {zoneLabel(s.timezone)}
            </span>
          )}
        </div>
      </section>

      <section className={section}>
        <h2 className={`mb-1 text-[15.5px] font-bold ${cu.strong}`}>Limit per customer</h2>
        <p className={`mb-3 text-[12.5px] ${cu.muted}`}>
          The most promos one customer gets. People who get too many turn notifications off for good. Leave a box empty for no limit. Order-status updates
          never count.
        </p>
        <div className="flex flex-wrap gap-4">
          <label>
            <span className={cu.fieldLabel}>In any 24 hours</span>
            <input type="number" min={1} max={100} className={`${cu.input} max-w-[120px]`} value={s.cap_per_day ?? ''} onChange={(e) => set({ cap_per_day: num(e.target.value) })} placeholder="no limit" />
          </label>
          <label>
            <span className={cu.fieldLabel}>In any 7 days</span>
            <input type="number" min={1} max={100} className={`${cu.input} max-w-[120px]`} value={s.cap_per_week ?? ''} onChange={(e) => set({ cap_per_week: num(e.target.value) })} placeholder="no limit" />
          </label>
        </div>
      </section>

      <section className={section}>
        <h2 className={`mb-3 text-[15.5px] font-bold ${cu.strong}`}>Defaults for a new notification</h2>
        <div className="flex flex-wrap items-end gap-6">
          <label>
            <span className={cu.fieldLabel}>Expires after</span>
            <span className="flex items-center gap-2">
              <input type="number" min={1} max={672} className={`${cu.input} max-w-[110px]`} value={s.default_expiry_hours} onChange={(e) => set({ default_expiry_hours: Number(e.target.value) })} />
              <span className={`text-[12.5px] ${cu.muted}`}>hours</span>
            </span>
          </label>
          <div className="flex items-center gap-2 pb-2.5">
            <SegToggle on={s.skip_order_in_progress} onChange={(v) => set({ skip_order_in_progress: v })} ariaLabel="Leave out customers with an order in progress" />
            <span className={`text-[13px] ${cu.text}`}>Leave out customers with an order in progress</span>
          </div>
        </div>
      </section>

      <section className={section}>
        <h2 className={`mb-1 text-[15.5px] font-bold ${cu.strong}`}>Test phones</h2>
        <p className={`mb-3 text-[12.5px] ${cu.muted}`}>
          "Send test" goes to these numbers. Each must be a customer who has logged into the app on that phone — use your own.
        </p>
        <textarea className={`${cu.input} min-h-[90px] max-w-[360px] font-mono text-[12.5px]`} value={s.phones_text} onChange={(e) => set({ phones_text: e.target.value })} placeholder={'03001234567'} aria-label="Test phones" />
      </section>

      <section className={section}>
        <h2 className={`mb-1 text-[15.5px] font-bold ${cu.strong}`}>Time zone</h2>
        <p className={`mb-3 text-[12.5px] ${cu.muted}`}>Every schedule and the quiet hours are read on this clock.</p>
        <select className={`${cu.input} max-w-[280px]`} value={s.timezone} onChange={(e) => set({ timezone: e.target.value })} aria-label="Time zone">
          {[...new Set([s.timezone, ...ZONES])].map((z) => (
            <option key={z} value={z}>
              {zoneLabel(z)} ({z})
            </option>
          ))}
        </select>
      </section>

      {canEdit && (
        <div className="flex justify-end">
          <button type="button" className={cu.btnPrimary} onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}
    </fieldset>
  );
};

export default SettingsTab;
