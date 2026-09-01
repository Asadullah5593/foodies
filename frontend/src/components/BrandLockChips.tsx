import React from 'react';
import { isEntityInactive } from '../utils/entityStatus';

export interface BrandLockOption {
  id: number;
  name: string;
  is_active?: boolean | null;
  isActive?: boolean | null;
  status?: string | null;
}

/**
 * Which brands a branch assignment locks someone to. An empty selection means
 * "all brands" — the same thing the single brand column meant by null — so the
 * All chip is not a brand, it is the absence of a lock, and picking it clears
 * the rest.
 *
 * Chips rather than a dropdown because this sits in a table cell next to the
 * role picker, a branch carries only a handful of brands, and the whole point
 * is seeing both selected brands at once without opening anything.
 */
const BrandLockChips: React.FC<{
  brands: BrandLockOption[];
  value: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
  allLabel?: string;
}> = ({ brands, value, onChange, disabled = false, allLabel = 'All brands' }) => {
  const selected = new Set(value);
  const chip = (active: boolean) =>
    [
      'rounded-full border px-2.5 py-1 text-xs font-semibold transition',
      disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      active
        ? 'border-blue-500 bg-blue-500 text-white'
        : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400',
    ].join(' ');

  const toggle = (id: number) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next].sort((a, b) => a - b));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-pressed={selected.size === 0}
        disabled={disabled}
        onClick={() => !disabled && onChange([])}
        className={chip(selected.size === 0)}
      >
        {allLabel}
      </button>
      {brands.map((b) => (
        <button
          key={b.id}
          type="button"
          aria-pressed={selected.has(b.id)}
          disabled={disabled}
          onClick={() => toggle(b.id)}
          className={chip(selected.has(b.id))}
        >
          {b.name}
          {isEntityInactive(b) && <span className="ml-1 font-normal opacity-75">(Inactive)</span>}
        </button>
      ))}
    </div>
  );
};

export default BrandLockChips;
