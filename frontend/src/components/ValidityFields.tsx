import React from 'react';

export interface ValidityValue {
  valid_from: string;
  valid_until: string;
  valid_time_start: string;
  valid_time_end: string;
  valid_days_of_week: number[];
}

export const emptyValidity: ValidityValue = {
  valid_from: '',
  valid_until: '',
  valid_time_start: '',
  valid_time_end: '',
  valid_days_of_week: [],
};

interface Props {
  value: ValidityValue;
  onChange: (v: ValidityValue) => void;
  /** Require the date range (used for coupons). */
  requireDates?: boolean;
  /** Hide the recurring time-of-day + day-of-week controls (e.g. campaigns). */
  datesOnly?: boolean;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Shared validity block: date range + recurring time-of-day + days-of-week. */
const ValidityFields: React.FC<Props> = ({
  value,
  onChange,
  requireDates,
  datesOnly,
}) => {
  const set = (patch: Partial<ValidityValue>) => onChange({ ...value, ...patch });
  const toggleDay = (i: number) =>
    set({
      valid_days_of_week: value.valid_days_of_week.includes(i)
        ? value.valid_days_of_week.filter((x) => x !== i)
        : [...value.valid_days_of_week, i].sort((a, b) => a - b),
    });

  const inputCls =
    'mt-1 w-full rounded-[10px] border-[1.5px] border-gray-200 bg-white px-[13px] py-[11px] text-sm text-gray-800 outline-none transition-colors focus:border-red-500 focus:ring-2 focus:ring-red-500/10';
  const labelCls = 'text-[12px] font-semibold text-gray-500';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className={labelCls}>
            Valid from{requireDates && <span className="text-red-500 ml-0.5">*</span>}
          </span>
          <input
            type="date"
            required={requireDates}
            value={value.valid_from}
            onChange={(e) => set({ valid_from: e.target.value })}
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className={labelCls}>
            Valid until{requireDates && <span className="text-red-500 ml-0.5">*</span>}
          </span>
          <input
            type="date"
            required={requireDates}
            value={value.valid_until}
            onChange={(e) => set({ valid_until: e.target.value })}
            className={inputCls}
          />
        </label>
      </div>

      {!datesOnly && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className={labelCls}>Valid time from</span>
              <input
                type="time"
                value={value.valid_time_start}
                onChange={(e) => set({ valid_time_start: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className={labelCls}>Valid time until</span>
              <input
                type="time"
                value={value.valid_time_end}
                onChange={(e) => set({ valid_time_end: e.target.value })}
                className={inputCls}
              />
            </label>
          </div>
          <div>
            <label className="mb-2 block text-[13px] font-semibold text-gray-700">
              Valid days <span className="font-normal text-gray-400">— empty = every day</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d, i) => {
                const on = value.valid_days_of_week.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={`min-w-[52px] rounded-[10px] border-[1.5px] px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                      on ? 'border-red-600 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ValidityFields;
