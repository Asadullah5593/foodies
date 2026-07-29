import React from 'react';

export type PillOption = {
  /** null = the "All items" pill. */
  id: number | null;
  label: string;
  count: number;
};

export type POSPillFiltersProps = {
  categoryPills: PillOption[];
  selectedCategoryId: number | null;
  onCategoryChange: (id: number | null) => void;
  /** Categories are only offered once a brand is picked (see below). */
  brandChosen: boolean;
};

/**
 * Category filters as wrapping pills: a till is touch-driven, so every category
 * stays one tap away, and they wrap rather than scroll so none hide off-screen.
 *
 * Nothing renders until a brand is chosen — with several brands on one branch
 * the combined category list is long and mixes brands, so brand is the first
 * cut. The row simply collapses, giving the height back to the menu grid.
 */
const Pill: React.FC<{
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}> = ({ label, count, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`inline-flex min-h-[30px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
      active
        ? 'border-foodies-primary bg-foodies-primary text-white'
        : 'border-[#E6E8EC] bg-white text-[#4B5563] hover:bg-[#F6F7F9] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
    }`}
  >
    {label}
    <span
      className={`rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums ${
        active
          ? 'bg-white/25 text-white'
          : 'bg-[#F1F2F5] text-[#98A0AC] dark:bg-slate-600 dark:text-slate-300'
      }`}
    >
      {count}
    </span>
  </button>
);

const POSPillFilters: React.FC<POSPillFiltersProps> = ({
  categoryPills,
  selectedCategoryId,
  onCategoryChange,
  brandChosen,
}) => {
  if (!brandChosen || categoryPills.length === 0) return null;

  return (
    <div className="flex-shrink-0 border-b border-foodies-border bg-foodies-surface px-5 py-2.5 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap gap-1.5">
        {categoryPills.map((p) => (
          <Pill
            key={p.id ?? 'all'}
            label={p.label}
            count={p.count}
            active={selectedCategoryId === p.id}
            onClick={() => onCategoryChange(p.id)}
          />
        ))}
      </div>
    </div>
  );
};

export default POSPillFilters;
