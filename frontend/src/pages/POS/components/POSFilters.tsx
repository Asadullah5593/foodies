import React from 'react';
import SearchableSelect from '../../../components/SearchableSelect';
import type { OrderTypeOption } from './types';
import TypeaheadDropdown from '../../../components/TypeaheadDropdown';
import type { TypeaheadOption } from '../../../hooks/useTypeaheadSuggestions';

type Brand = { id: number; name: string };
type Branch = { id: number; name: string; code: string };
type OpenShift = { id: number; shift_number?: string } | null;

export type POSFiltersProps = {
  brands: Brand[];
  selectedBrandId: number | null;
  onBrandChange: (id: number | null) => void;
  categories: Array<{ id: number; name: string }>;
  selectedCategoryId: number | null;
  onCategoryChange: (id: number | null) => void;
  effectiveBranchId: number | null;
  posBranches: Branch[] | undefined;
  onBranchChange: (id: number | null) => void;
  openShift: OpenShift;
  branchId: number | null;
  search: string;
  onSearchChange: (value: string) => void;
  searchSuggestions?: TypeaheadOption[];
  searchSuggestionsOpen?: boolean;
  setSearchSuggestionsOpen?: (open: boolean) => void;
  searchSuggestionsActiveIndex?: number;
  setSearchSuggestionsActiveIndex?: (idx: number) => void;
  onPickSearchSuggestion?: (label: string) => void;
  /** Optional: show order type selector in the top bar */
  orderTypeOptions?: Array<{ value: OrderTypeOption; label: string }>;
  orderType?: OrderTypeOption;
  onOrderTypeChange?: (value: OrderTypeOption) => void;
  /** 'bar' = horizontal top bar (default), 'rail' = vertical left rail */
  variant?: 'bar' | 'rail';
  /** When false, search input is not rendered (e.g. for left rail; use search in center) */
  showSearch?: boolean;
  /** Optional ref to focus the search input (e.g. for keyboard shortcut) */
  searchInputRef?: React.RefObject<HTMLInputElement>;
};

const POSFilters: React.FC<POSFiltersProps> = ({
  brands,
  selectedBrandId,
  onBrandChange,
  categories,
  selectedCategoryId,
  onCategoryChange,
  effectiveBranchId,
  posBranches,
  onBranchChange,
  openShift,
  branchId,
  search,
  onSearchChange,
  searchSuggestions,
  searchSuggestionsOpen,
  setSearchSuggestionsOpen,
  searchSuggestionsActiveIndex,
  setSearchSuggestionsActiveIndex,
  onPickSearchSuggestion,
  orderTypeOptions,
  orderType,
  onOrderTypeChange,
  variant = 'bar',
  showSearch = true,
  searchInputRef,
}) => {
  const isRail = variant === 'rail';

  const filtersContent = (
    <>
      {orderTypeOptions && orderType && onOrderTypeChange && (
        <SearchableSelect
          label="Order type"
          value={orderType}
          onChange={(v) => onOrderTypeChange(v as OrderTypeOption)}
          options={orderTypeOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
          minWidth="min-w-[140px]"
        />
      )}
      {brands.length > 1 && (
        <SearchableSelect
          label="Brand"
          value={selectedBrandId != null ? String(selectedBrandId) : ''}
          onChange={(v) => onBrandChange(v === '' ? null : Number(v))}
          options={[
            { value: '', label: 'All brands' },
            ...brands.map((b) => ({ value: String(b.id), label: b.name })),
          ]}
          placeholder="All brands"
          minWidth="min-w-[120px]"
        />
      )}
      {categories.length > 0 && (
        <SearchableSelect
          label="Category"
          value={selectedCategoryId != null ? String(selectedCategoryId) : ''}
          onChange={(v) => onCategoryChange(v === '' ? null : Number(v))}
          options={[
            { value: '', label: 'All categories' },
            ...categories.map((c) => ({ value: String(c.id), label: c.name })),
          ]}
          placeholder="All categories"
          minWidth="min-w-[120px]"
        />
      )}
      <SearchableSelect
        label="Branch"
        value={effectiveBranchId != null ? String(effectiveBranchId) : ''}
        onChange={(v) => onBranchChange(v === '' ? null : Number(v))}
        options={(posBranches ?? []).map((b) => ({
          value: String(b.id),
          label: `${b.name} (${b.code})`,
        }))}
        placeholder="Select branch"
        minWidth="min-w-[140px]"
      />
      {branchId && openShift && (
        <span className="text-foodies-primary font-semibold text-xs uppercase tracking-wide">
          · Shift {openShift.shift_number ?? openShift.id} open
        </span>
      )}
      {showSearch && (
        <div className={isRail ? 'space-y-1' : 'relative'}>
          {isRail && <span className="text-foodies-textSecondary font-medium text-sm block">Search</span>}
          <div className="relative">
            <input
              ref={searchInputRef}
              type="search"
              placeholder="Search menu..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (!searchSuggestions?.length) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSearchSuggestionsActiveIndex?.(Math.min((searchSuggestionsActiveIndex ?? 0) + 1, searchSuggestions.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSearchSuggestionsActiveIndex?.(Math.max((searchSuggestionsActiveIndex ?? 0) - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const idx = searchSuggestionsActiveIndex ?? 0;
                  const opt = searchSuggestions[idx];
                  if (opt?.label) onPickSearchSuggestion?.(opt.label);
                  setSearchSuggestionsOpen?.(false);
                } else if (e.key === 'Escape') {
                  setSearchSuggestionsOpen?.(false);
                }
              }}
              className={isRail ? "pl-9 pr-3 py-2 text-sm border border-foodies-border rounded-lg bg-foodies-surfaceMuted text-foodies-textPrimary placeholder-foodies-textSecondary focus:ring-2 focus:ring-foodies-primary/50 focus:border-foodies-primary w-full" : "pl-9 pr-3 py-2 text-sm border border-foodies-border rounded-lg bg-foodies-surfaceMuted text-foodies-textPrimary placeholder-foodies-textSecondary focus:ring-2 focus:ring-foodies-primary/50 focus:border-foodies-primary focus:bg-foodies-surface min-w-[160px] max-w-[220px] transition-colors"}
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-foodies-textSecondary text-sm pointer-events-none">🔍</span>
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
        </div>
      )}
    </>
  );

  if (isRail) {
    return (
      <div className="p-4 space-y-4 overflow-y-auto">
        {filtersContent}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {filtersContent}
        </div>
      </div>
      <span className="text-foodies-textSecondary text-xs hidden sm:inline">Tap an item to add to order</span>
    </div>
  );
};

export default POSFilters;
