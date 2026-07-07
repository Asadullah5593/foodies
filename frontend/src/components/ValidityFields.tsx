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

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">
            Valid from{requireDates && <span className="text-red-500 ml-0.5">*</span>}
          </span>
          <input
            type="date"
            required={requireDates}
            value={value.valid_from}
            onChange={(e) => set({ valid_from: e.target.value })}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">
            Valid until{requireDates && <span className="text-red-500 ml-0.5">*</span>}
          </span>
          <input
            type="date"
            required={requireDates}
            value={value.valid_until}
            onChange={(e) => set({ valid_until: e.target.value })}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
        </label>
      </div>

      {!datesOnly && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm text-gray-700">Valid time from</span>
              <input
                type="time"
                value={value.valid_time_start}
                onChange={(e) => set({ valid_time_start: e.target.value })}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </label>
            <label className="block">
              <span className="text-sm text-gray-700">Valid time until</span>
              <input
                type="time"
                value={value.valid_time_end}
                onChange={(e) => set({ valid_time_end: e.target.value })}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </label>
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">
              Valid days (empty = every day)
            </label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d, i) => {
                const on = value.valid_days_of_week.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={`px-3 py-1.5 rounded-lg border text-sm ${on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 hover:bg-gray-50'}`}
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
