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

/**
 * The brands this till may sell, as their own marks.
 *
 * A cashier knows a brand by its logo long before they can read a name off a
 * dropdown, and on a touch screen a row of marks is one tap where the select
 * was three. Behaviour is unchanged: All is first and selected until something
 * else is, and picking one filters the menu exactly as choosing it did.
 *
 * A brand with no logo shows its name instead — and so does one whose logo
 * fails to load, because from the till those look identical and a blank square
 * is worse than either.
 */
const BrandTiles: React.FC<{
  brands: BrandTileOption[];
  selectedBrandId: number | null;
  onBrandChange: (id: number | null) => void;
  allLabel?: string;
}> = ({ brands, selectedBrandId, onBrandChange, allLabel = 'All' }) => {
  // Logos that 404 or fail CORS; remembered so the name replaces them instead
  // of a broken-image glyph.
  const [failed, setFailed] = useState<Record<number, true>>({});

  const tileCls = (active: boolean, inactive: boolean) =>
    [
      'flex h-[42px] min-w-[42px] items-center justify-center rounded-lg border-[1.5px] px-2 transition',
      active
        ? 'border-foodies-primary bg-foodies-primary/10'
        : 'border-[#E2E5EA] bg-white hover:border-[#C9CED6] dark:border-slate-600 dark:bg-slate-800',
      inactive ? 'opacity-45 grayscale' : '',
    ]
      .filter(Boolean)
      .join(' ');

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Brand">
      <button
        type="button"
        aria-pressed={selectedBrandId == null}
        onClick={() => onBrandChange(null)}
        className={`${tileCls(selectedBrandId == null, false)} text-[13px] font-semibold text-foodies-textPrimary dark:text-slate-100`}
      >
        {allLabel}
      </button>
      {brands.map((b) => {
        const active = selectedBrandId === b.id;
        const inactive = isEntityInactive(b);
        // getImageFullUrl passes an S3 URL through and prefixes a disk-driver
        // path, which would otherwise never load. Empty means no logo.
        const logo = failed[b.id] ? '' : getImageFullUrl(b.logo_url);
        return (
          <button
            key={b.id}
            type="button"
            aria-pressed={active}
            // The name is the accessible label whether or not a logo is drawn,
            // so the control reads the same to a screen reader either way.
            aria-label={inactive ? `${b.name} (inactive)` : b.name}
            title={inactive ? `${b.name} (inactive)` : b.name}
            onClick={() => onBrandChange(b.id)}
            className={tileCls(active, inactive)}
          >
            {logo ? (
              <img
                src={logo}
                alt=""
                className="h-[30px] w-[30px] rounded object-contain"
                onError={() => setFailed((f) => ({ ...f, [b.id]: true }))}
              />
            ) : (
              <span className="max-w-[92px] truncate text-[13px] font-semibold text-foodies-textPrimary dark:text-slate-100">
                {b.name}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default BrandTiles;
