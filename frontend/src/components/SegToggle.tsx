import React from 'react';

/**
 * Segmented On / Off control — the app's standard boolean toggle in the
 * discounts / offers admin (replaces bare checkboxes). On = green, Off = white.
 */
const SegToggle: React.FC<{
  on: boolean;
  onChange: (v: boolean) => void;
  ariaLabel?: string;
  size?: 'sm' | 'md';
}> = ({ on, onChange, ariaLabel, size = 'md' }) => {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1 text-xs';
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
