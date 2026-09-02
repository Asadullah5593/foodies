import React, { useState } from 'react';
import { isEntityInactive } from '../../../utils/entityStatus';
import { getImageFullUrl } from '../../../utils/imageUrl';

export interface BrandTileOption {
  id: number;
  name: string;
  logo_url?: string | null;
  is_active?: boolean | null;
  isActive?: boolean | null;
  status?: string | null;
}

/** Initials for a brand with no logo: "Wok & Go" → "WG", "Loranzo" → "LZ". */
export function brandMonogram(name: string): string {
  const words = String(name ?? '')
    // Apostrophes vanish rather than splitting a word: "O'Briens Pizza" is two
    // words, not three, so its mark is OP and not OB.
    .replace(/['\u2019]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * The brands this till may sell, as a tab strip along the top of the menu.
 *
 * A cashier knows a brand by its mark long before they can read a name off a
 * dropdown, and on a touch screen a tab is one tap where the select was three.
 * Each tab carries how many items it holds for the order type in hand, so the
 * choice is made without opening anything.
 *
 * Behaviour is unchanged from the dropdown it replaced: All comes first and
 * stays selected until something else is picked.
 *
 * A brand with no logo shows its initials on the tile — the name is spelled out
 * beside it either way, so nothing is lost. The same fallback catches a logo
 * that fails to load, because from the till a dead URL and a missing upload
 * look identical and a broken image is worse than either.
 */
const BrandTiles: React.FC<{
  brands: BrandTileOption[];
  selectedBrandId: number | null;
  onBrandChange: (id: number | null) => void;
  /** Items per brand id for the order type in hand; total for the All tab. */
  itemCounts?: Record<number, number>;
  totalItemCount?: number;
  allLabel?: string;
}> = ({
  brands,
  selectedBrandId,
  onBrandChange,
  itemCounts = {},
  totalItemCount,
  allLabel = 'All brands',
}) => {
  const [failed, setFailed] = useState<Record<number, true>>({});
  const total =
    totalItemCount ??
    brands.reduce((sum, b) => sum + (itemCounts[b.id] ?? 0), 0);

  const tab = (
    key: string,
    active: boolean,
    inactive: boolean,
    tile: React.ReactNode,
    label: string,
    count: number,
    onClick: () => void,
    ariaLabel: string,
  ) => (
    <button
      key={key}
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      className={`flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-[13px] border-none px-3 py-4 transition ${
        active ? 'bg-[#FCEEEE]' : 'bg-transparent hover:bg-[#FAFAFB]'
      } ${inactive ? 'opacity-45 grayscale' : ''}`}
      style={{ borderBottom: `3px solid ${active ? '#DC2A2A' : 'transparent'}` }}
    >
      {tile}
      <span className="min-w-0 text-left">
        <span
          className="block truncate text-[14.5px] font-bold"
          style={{ color: active ? '#B5121B' : '#374151' }}
        >
          {label}
        </span>
        <span
          className="mt-0.5 block text-[12px]"
          style={{ color: active ? '#C2696C' : '#9AA1AD' }}
        >
          {count} items
        </span>
      </span>
    </button>
  );

  const allActive = selectedBrandId == null;

  return (
    <div
      role="group"
      aria-label="Brand"
      className="flex items-stretch border-b border-[#F1F2F5] bg-[#FCFCFD] dark:border-slate-700 dark:bg-slate-800"
    >
      {tab(
        '__all',
        allActive,
        false,
        <span
          className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-[13px]"
          style={{
            background: allActive ? '#DC2A2A' : '#EEF0F3',
            color: allActive ? '#fff' : '#8A92A0',
          }}
        >
          <svg width="25" height="25" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <rect x="2" y="2" width="5" height="5" rx="1" />
            <rect x="9" y="2" width="5" height="5" rx="1" />
            <rect x="2" y="9" width="5" height="5" rx="1" />
            <rect x="9" y="9" width="5" height="5" rx="1" />
          </svg>
        </span>,
        allLabel,
        total,
        () => onBrandChange(null),
        allLabel,
      )}
      {brands.map((b) => {
        const active = selectedBrandId === b.id;
        const inactive = isEntityInactive(b);
        const logo = failed[b.id] ? '' : getImageFullUrl(b.logo_url);
        return tab(
          String(b.id),
          active,
          inactive,
          <span
            className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-[13px] bg-white"
            style={{ border: `1px solid ${active ? '#F3D6D6' : '#ECEDF0'}` }}
          >
            {logo ? (
              <img
                src={logo}
                alt=""
                className="h-[38px] w-[38px] rounded-[10px] object-contain"
                onError={() => setFailed((f) => ({ ...f, [b.id]: true }))}
              />
            ) : (
              <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-[#B6BCC6] text-[14px] font-extrabold tracking-[-0.01em] text-white">
                {brandMonogram(b.name)}
              </span>
            )}
          </span>,
          b.name,
          itemCounts[b.id] ?? 0,
          () => onBrandChange(b.id),
          inactive ? `${b.name} (inactive)` : b.name,
        );
      })}
    </div>
  );
};

export default BrandTiles;
