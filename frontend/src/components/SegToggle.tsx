import React from 'react';
import { useViewport } from '../hooks/useViewport';

/**
 * Segmented On / Off control — the app's standard boolean toggle in the
 * discounts / offers admin (replaces bare checkboxes). On = green, Off = white.
 *
 * Below lg (phones, tablets) it is a real switch instead — a 46×26 track with a
 * knob, green when on, and the state spelled out beside it — because two tiny
 * "On | Off" segments are hard to read and tap on a phone. Desktop markup is
 * exactly what it always was.
 */
const SegToggle: React.FC<{
  on: boolean;
  onChange: (v: boolean) => void;
  ariaLabel?: string;
  size?: 'sm' | 'md';
}> = ({ on, onChange, ariaLabel, size = 'md' }) => {
  const { isDesktop } = useViewport();
  if (!isDesktop) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={ariaLabel}
        onClick={() => onChange(!on)}
        className="inline-flex min-h-[36px] flex-none select-none items-center gap-2 text-[12.5px] font-bold text-gray-500 dark:text-slate-400"
      >
        {on ? 'On' : 'Off'}
        <span
          aria-hidden
          className={`relative h-[26px] w-[46px] rounded-full transition-colors ${
            on ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
          }`}
        >
          <span
            className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-[left] ${
              on ? 'left-[23px]' : 'left-[3px]'
            }`}
          />
        </span>
      </button>
    );
  }
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[11px] max-lg:min-h-[36px] max-lg:px-3.5' : 'px-3 py-1 text-xs max-lg:min-h-[36px] max-lg:px-3.5';
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex flex-none select-none rounded-lg bg-gray-100 p-0.5"
    >
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`rounded-md font-semibold transition-colors ${pad} ${
          on ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        On
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`rounded-md font-semibold transition-colors ${pad} ${
          !on ? 'bg-white text-gray-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Off
      </button>
    </div>
  );
};

export default SegToggle;
