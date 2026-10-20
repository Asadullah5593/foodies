import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MdInfoOutline } from 'react-icons/md';
import type { PushPerCustomer, PushRepeatRule, PushScheduleType, PushSettings } from '../../../types';
import { pushService } from '../../../services/api';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { cu } from '../customersUi';
import { describeRepeat, momentLabel, time12, WEEKDAY_SET, WEEKDAYS_SHORT, WEEKEND_SET } from './pushText';
import { wallClock, zonedToUtc, zoneLabel } from './pushTime';

export interface ScheduleValue {
  schedule_type: PushScheduleType;
  send_at: string | null;
  repeat: PushRepeatRule | null;
  per_customer: PushPerCustomer;
  per_customer_days: number | null;
}

type Mode = 'daily' | 'weekdays' | 'weekends' | 'custom' | 'monthly' | 'every_n_days';

const MODE_LABEL: Record<Mode, string> = {
  daily: 'Every day',
  weekdays: 'Weekdays (Mon–Fri)',
  weekends: 'Weekends (Sat–Sun)',
  custom: 'Chosen days of the week',
  monthly: 'Once a month',
  every_n_days: 'Every few days',
};

function modeOf(r: PushRepeatRule): Mode {
  if (r.frequency === 'daily') return 'daily';
  if (r.frequency === 'monthly') return 'monthly';
  if (r.frequency === 'every_n_days') return 'every_n_days';
  const d = [...(r.weekdays ?? [])].sort().join(',');
  if (d === [...WEEKDAY_SET].sort().join(',')) return 'weekdays';
  if (d === [...WEEKEND_SET].sort().join(',')) return 'weekends';
  return 'custom';
}

/** A fresh repeat: daily at 7 PM from today on the business clock. */
export function defaultRepeat(tz: string): PushRepeatRule {
  return { frequency: 'daily', time: '19:00', starts_on: wallClock(new Date(), tz).date, ends: 'never' };
}

interface Props {
  value: ScheduleValue;
  onChange: (v: ScheduleValue) => void;
  settings: PushSettings;
  runsCount?: number;
  skipDates?: string[];
}

const SchedulePicker: React.FC<Props> = ({ value, onChange, settings, runsCount = 0, skipDates = [] }) => {
  const tz = settings.timezone;
  const set = (patch: Partial<ScheduleValue>) => onChange({ ...value, ...patch });
  const repeat = value.repeat ?? defaultRepeat(tz);
  const setRepeat = (patch: Partial<PushRepeatRule>) => set({ repeat: { ...repeat, ...patch } });
  const once = value.send_at ? wallClock(new Date(value.send_at), tz) : wallClock(new Date(Date.now() + 3600_000), tz);

  const previewBody = useMemo(
    () => ({
      schedule_type: value.schedule_type,
      send_at: value.send_at,
      repeat: value.schedule_type === 'repeat' ? repeat : null,
      skip_dates: skipDates,
      runs_count: runsCount,
    }),
    [value.schedule_type, value.send_at, repeat, skipDates, runsCount],
  );
  const debounced = useDebouncedValue(JSON.stringify(previewBody), 400);
  const { data: preview, error } = useQuery({
    queryKey: ['push-schedule-preview', debounced],
    queryFn: () => pushService.previewSchedule(JSON.parse(debounced)),
    retry: false,
    placeholderData: (prev) => prev,
  });
  const previewError = (error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message;
  const held = preview?.occurrences.find((o) => o.held_until);

  const tabs: Array<{ key: PushScheduleType; label: string }> = [
    { key: 'now', label: 'Send now' },
    { key: 'once', label: 'At a date & time' },
    { key: 'repeat', label: 'Repeat' },
  ];

  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap rounded-xl bg-gray-100 p-1 dark:bg-slate-700" role="radiogroup" aria-label="When">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={value.schedule_type === t.key}
            onClick={() =>
              set({
                schedule_type: t.key,
                repeat: t.key === 'repeat' ? repeat : value.repeat,
                send_at: t.key === 'once' ? (value.send_at ?? zonedToUtc(once.date, once.time, tz).toISOString()) : value.send_at,
              })
            }
            className={`rounded-lg px-3.5 py-1.5 text-[13px] font-bold ${value.schedule_type === t.key ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-900 dark:text-slate-100' : 'text-gray-500 dark:text-slate-300'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {value.schedule_type === 'now' && (
        <p className={`text-[13px] ${cu.soft}`}>It goes out within a minute of you pressing Send.</p>
      )}

      {value.schedule_type === 'once' && (
        <div className="flex flex-wrap items-end gap-3">
          <label>
            <span className={cu.fieldLabel}>Date</span>
            <input
              type="date"
              className={cu.input}
              value={once.date}
              onChange={(e) => e.target.value && set({ send_at: zonedToUtc(e.target.value, once.time, tz).toISOString() })}
            />
          </label>
          <label>
            <span className={cu.fieldLabel}>Time</span>
            <input
              type="time"
              className={cu.input}
              value={once.time}
              onChange={(e) => e.target.value && set({ send_at: zonedToUtc(once.date, e.target.value, tz).toISOString() })}
            />
          </label>
          <span className={`pb-3 text-[12.5px] ${cu.muted}`}>{zoneLabel(tz)}</span>
        </div>
      )}

      {value.schedule_type === 'repeat' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className={cu.fieldLabel}>How often</span>
              <select
                className={cu.input}
                value={modeOf(repeat)}
                onChange={(e) => {
                  const m = e.target.value as Mode;
                  if (m === 'daily') setRepeat({ frequency: 'daily', weekdays: undefined });
                  else if (m === 'weekdays') setRepeat({ frequency: 'weekly', weekdays: WEEKDAY_SET });
                  else if (m === 'weekends') setRepeat({ frequency: 'weekly', weekdays: WEEKEND_SET });
                  else if (m === 'custom') setRepeat({ frequency: 'weekly', weekdays: [5] });
                  else if (m === 'monthly') setRepeat({ frequency: 'monthly', month_day: repeat.month_day ?? 1 });
                  else setRepeat({ frequency: 'every_n_days', interval_days: repeat.interval_days ?? 3 });
                }}
              >
                {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={cu.fieldLabel}>At ({zoneLabel(tz)})</span>
              <input type="time" className={cu.input} value={repeat.time} onChange={(e) => e.target.value && setRepeat({ time: e.target.value })} />
            </label>
          </div>

          {modeOf(repeat) === 'custom' && (
            <div>
              <span className={cu.fieldLabel}>On</span>
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                  const on = (repeat.weekdays ?? []).includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const next = on ? (repeat.weekdays ?? []).filter((x) => x !== d) : [...(repeat.weekdays ?? []), d];
                        setRepeat({ weekdays: next });
                      }}
                      className={`h-9 w-12 rounded-lg border text-[12.5px] font-bold ${on ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300' : 'border-gray-200 bg-white text-gray-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
                    >
                      {WEEKDAYS_SHORT[d]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {repeat.frequency === 'monthly' && (
            <label className="block max-w-[260px]">
              <span className={cu.fieldLabel}>On day</span>
              <select className={cu.input} value={String(repeat.month_day ?? 1)} onChange={(e) => setRepeat({ month_day: Number(e.target.value) })}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
                <option value={-1}>Last day of the month</option>
              </select>
              {(repeat.month_day ?? 1) > 28 && (
                <span className={`mt-1 block text-[11.5px] ${cu.muted}`}>In shorter months it goes on the last day.</span>
              )}
            </label>
          )}
          {repeat.frequency === 'every_n_days' && (
            <label className="block max-w-[260px]">
              <span className={cu.fieldLabel}>Every</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={2}
                  max={365}
                  className={`${cu.input} max-w-[110px]`}
                  value={repeat.interval_days ?? 3}
                  onChange={(e) => setRepeat({ interval_days: Number(e.target.value) })}
                />
                <span className={`text-[12.5px] ${cu.muted}`}>days</span>
              </div>
            </label>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className={cu.fieldLabel}>Starts on</span>
              <input type="date" className={cu.input} value={repeat.starts_on} onChange={(e) => e.target.value && setRepeat({ starts_on: e.target.value })} />
            </label>
            <div>
              <span className={cu.fieldLabel}>Ends</span>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className={`${cu.input} max-w-[150px]`}
                  value={repeat.ends}
                  onChange={(e) => {
                    const ends = e.target.value as PushRepeatRule['ends'];
                    setRepeat({
                      ends,
                      ends_on: ends === 'on' ? (repeat.ends_on ?? repeat.starts_on) : null,
                      max_runs: ends === 'after' ? (repeat.max_runs ?? 4) : null,
                    });
                  }}
                  aria-label="Ends"
                >
                  <option value="never">Never</option>
                  <option value="on">On a date</option>
                  <option value="after">After a number of sends</option>
                </select>
                {repeat.ends === 'on' && (
                  <input type="date" className={`${cu.input} max-w-[170px]`} value={repeat.ends_on ?? ''} min={repeat.starts_on} onChange={(e) => setRepeat({ ends_on: e.target.value })} aria-label="End date" />
                )}
                {repeat.ends === 'after' && (
                  <span className="flex items-center gap-2">
                    <input type="number" min={1} className={`${cu.input} max-w-[90px]`} value={repeat.max_runs ?? 4} onChange={(e) => setRepeat({ max_runs: Number(e.target.value) })} aria-label="Number of sends" />
                    <span className={`text-[12.5px] ${cu.muted}`}>sends</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div>
            <span className={cu.fieldLabel}>Each customer</span>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className={`${cu.input} max-w-[280px]`}
                value={value.per_customer}
                onChange={(e) => {
                  const pc = e.target.value as PushPerCustomer;
                  set({ per_customer: pc, per_customer_days: pc === 'days' ? (value.per_customer_days ?? 7) : null });
                }}
                aria-label="Each customer"
              >
                <option value="every">Gets every send</option>
                <option value="once">Gets it only once, ever</option>
                <option value="days">Gets it at most once every…</option>
              </select>
              {value.per_customer === 'days' && (
                <span className="flex items-center gap-2">
                  <input type="number" min={1} max={365} className={`${cu.input} max-w-[90px]`} value={value.per_customer_days ?? 7} onChange={(e) => set({ per_customer_days: Number(e.target.value) })} aria-label="Days" />
                  <span className={`text-[12.5px] ${cu.muted}`}>days</span>
                </span>
              )}
            </div>
            <p className={`mt-1 text-[11.5px] ${cu.muted}`}>
              The audience is worked out again at every send, so new customers are picked up. "Only once" turns a repeat into an automation —
              e.g. a welcome message to everyone who joined that day.
            </p>
          </div>

          <p className={`text-[13px] font-semibold ${cu.text}`}>{describeRepeat(repeat)}</p>
        </div>
      )}

      {/* What the server says will happen */}
      {previewError ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{previewError}</p>
      ) : preview && value.schedule_type !== 'now' ? (
        preview.ends === 'never_sends' ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            With these dates it would never send.
          </p>
        ) : (
          <div className={`text-[12.5px] ${cu.soft}`}>
            <span className="font-semibold">{value.schedule_type === 'repeat' ? 'Next sends: ' : 'Goes out: '}</span>
            {preview.occurrences.map((o) => momentLabel(o)).join(' · ')}
          </div>
        )
      ) : null}
      {settings.quiet_hours_enabled && (held || value.schedule_type === 'now') && (
        <p className={`flex items-start gap-1.5 text-[12px] ${held ? 'text-amber-700 dark:text-amber-400' : cu.muted}`}>
          <MdInfoOutline size={15} className="mt-px flex-none" />
          {held
            ? `${momentLabel(held)} falls in quiet hours (${time12(settings.quiet_start)}–${time12(settings.quiet_end)}) — it will go out at ${time12(settings.quiet_end)} instead.`
            : `Quiet hours are ${time12(settings.quiet_start)}–${time12(settings.quiet_end)}: anything sent then waits until they end.`}
        </p>
      )}
    </div>
  );
};

export default SchedulePicker;
