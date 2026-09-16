import React from 'react';
import { MdSearch } from 'react-icons/md';
import TypeaheadDropdown from '../../../components/TypeaheadDropdown';
import type { TypeaheadOption } from '../../../hooks/useTypeaheadSuggestions';

type OpenShift = { id: number; shift_number?: string } | null;
type Branch = { id: number; name: string; code: string };

export type POSTopBarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  searchSuggestions?: TypeaheadOption[];
  searchSuggestionsOpen?: boolean;
  setSearchSuggestionsOpen?: (open: boolean) => void;
  searchSuggestionsActiveIndex?: number;
  setSearchSuggestionsActiveIndex?: (idx: number) => void;
  onPickSearchSuggestion?: (label: string) => void;
  searchInputRef?: React.RefObject<HTMLInputElement>;
  openShift: OpenShift;
  branchId: number | null;
  effectiveBranchId: number | null;
  posBranches: Branch[] | undefined;
  onBranchChange: (id: number | null) => void;
};

const selectCls =
  'max-w-[220px] flex-none cursor-pointer rounded-lg border border-[#E2E5EA] bg-white px-2.5 py-1.5 text-[12px] text-[#374151] outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200';

/**
 * POS header strip: what you are selling from (brand, branch) on the left,
 * what you are looking for and which shift is running on the right. The shift
 * number sits next to the open badge so a cashier can quote it (or match it to
 * a printed X/Z report) without opening the Shifts screen. Navigation back to
 * orders lives in the app navbar, not here.
 */
const POSTopBar: React.FC<POSTopBarProps> = ({
  search,
  onSearchChange,
  searchSuggestions,
  searchSuggestionsOpen,
  setSearchSuggestionsOpen,
  searchSuggestionsActiveIndex,
  setSearchSuggestionsActiveIndex,
  onPickSearchSuggestion,
  searchInputRef,
  openShift,
  branchId,
  effectiveBranchId,
  posBranches,
  onBranchChange,
}) => {
  const shiftLabel = openShift ? (openShift.shift_number ?? `#${openShift.id}`) : null;

  return (
    <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F2F5] bg-foodies-surface px-5 py-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center gap-2">

        <select
          value={effectiveBranchId != null ? String(effectiveBranchId) : ''}
          onChange={(e) => onBranchChange(e.target.value === '' ? null : Number(e.target.value))}
          aria-label="Branch"
          className={selectCls}
        >
          <option value="">Select branch</option>
          {(posBranches ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.code})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <div className="flex w-[250px] max-w-full items-center gap-[9px] rounded-[11px] border-[1.5px] border-[#EEEFF2] bg-[#F6F7F9] px-[13px] dark:border-slate-600 dark:bg-slate-700">
            <MdSearch className="h-4 w-4 flex-none text-[#9AA1AD]" />
            <input
              ref={searchInputRef}
              type="search"
              placeholder="Search menu…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (!searchSuggestions?.length) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSearchSuggestionsActiveIndex?.(
                    Math.min((searchSuggestionsActiveIndex ?? 0) + 1, searchSuggestions.length - 1),
                  );
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSearchSuggestionsActiveIndex?.(
                    Math.max((searchSuggestionsActiveIndex ?? 0) - 1, 0),
                  );
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const opt = searchSuggestions[searchSuggestionsActiveIndex ?? 0];
                  if (opt?.label) onPickSearchSuggestion?.(opt.label);
                  setSearchSuggestionsOpen?.(false);
                } else if (e.key === 'Escape') {
                  setSearchSuggestionsOpen?.(false);
                }
              }}
              className="flex-1 border-none bg-transparent py-2.5 text-[13.5px] text-[#1F2430] outline-none placeholder:text-[#A9AFB9] dark:text-slate-100"
            />
          </div>
          <TypeaheadDropdown
            open={Boolean(searchSuggestionsOpen) && (search?.trim()?.length ?? 0) >= 2}
            suggestions={searchSuggestions ?? []}
            activeIndex={searchSuggestionsActiveIndex ?? 0}
            onHoverIndex={(idx) => setSearchSuggestionsActiveIndex?.(idx)}
            onSelect={(opt) => {
              onPickSearchSuggestion?.(opt.label);
              setSearchSuggestionsOpen?.(false);
            }}
            onClose={() => setSearchSuggestionsOpen?.(false)}
          />
        </div>

        {branchId && openShift && (
          <>
            <span
              className="whitespace-nowrap rounded-full border border-[#E2E5EA] bg-[#F6F7F9] px-3 py-1.5 font-mono text-[11.5px] font-bold text-[#5A6473] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300"
              title="Current shift number"
            >
              {shiftLabel}
            </span>
            <span className="whitespace-nowrap rounded-full border border-[#CDEBD6] bg-[#EAF7EE] px-3 py-1.5 text-[11.5px] font-bold text-[#16A34A] dark:border-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
              Shift open
            </span>
          </>
        )}
      </div>
    </div>
  );
};

export default POSTopBar;
