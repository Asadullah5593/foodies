import React from 'react';

/**
 * How the signed-in user may act on an offer, as decided by the backend.
 *  - 'full'      : every brand it serves is theirs — edit and delete freely.
 *  - 'detach'    : it also serves brands they don't own — they may only remove
 *                  their own brand from it.
 *  - 'read_only' : visible for context only.
 */
export type ManageScope = 'full' | 'detach' | 'read_only';

export interface BrandScoped {
  /** Brands the offer actually serves; null/absent = every brand. */
  effective_brand_ids?: number[] | null;
  manage_scope?: ManageScope;
}

/**
 * Badge naming the brands an offer serves. Renders nothing for a single-brand
 * offer when the viewer only has that brand — the label would be noise.
 */
export const BrandScopeBadge: React.FC<{
  effectiveBrandIds?: number[] | null;
  brandNameById: Map<number, string>;
  /** null when the viewer is unrestricted (owner/GM). */
  allowedBrandIds?: number[] | null;
}> = ({ effectiveBrandIds, brandNameById, allowedBrandIds }) => {
  const ids = Array.isArray(effectiveBrandIds) ? effectiveBrandIds : null;

  if (ids == null) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300"
        title="This offer applies to every brand."
      >
        All brands
      </span>
    );
  }

  const isOnlyMyBrand =
    Array.isArray(allowedBrandIds) &&
    ids.length === 1 &&
    allowedBrandIds.includes(ids[0]);
  if (isOnlyMyBrand) return null;

  const names = ids.map((id) => brandNameById.get(id) ?? `Brand ${id}`);
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300"
      title={`Applies to: ${names.join(', ')}`}
    >
      {names.length <= 2 ? names.join(' · ') : `${names.length} brands`}
    </span>
  );
};

/**
 * Explains why Edit/Delete are unavailable. Shown only when the offer reaches
 * beyond the viewer's brands, so they know the offer is real and shared rather
 * than thinking the page is broken.
 */
export const BrandScopeNotice: React.FC<{ manageScope?: ManageScope; noun?: string }> = ({
  manageScope,
  noun = 'offer',
}) => {
  if (manageScope !== 'detach' && manageScope !== 'read_only') return null;
  return (
    <p className="text-[12px] text-gray-500 dark:text-slate-400">
      {manageScope === 'detach'
        ? `This ${noun} also serves other brands, so it is managed by the owner. You can remove your brand from it.`
        : `This ${noun} belongs to another brand.`}
    </p>
  );
};

export const canEdit = (manageScope?: ManageScope) =>
  manageScope == null || manageScope === 'full';

export const canDelete = canEdit;

/** Detach is the brand admin's stand-in for delete on a shared offer. */
export const canDetach = (manageScope?: ManageScope) => manageScope === 'detach';

/** Label for the destructive action, which is a detach on a shared offer. */
export const removeLabel = (manageScope?: ManageScope) =>
  canDetach(manageScope) ? 'Remove my brand' : 'Delete';

/**
 * confirmDialog options for the destructive action. A detach is reversible and
 * leaves the offer running for other brands, so it must not borrow delete's
 * "cannot be undone" warning.
 */
export const removeDialog = (
  manageScope: ManageScope | undefined,
  noun: string,
  name: string,
) =>
  canDetach(manageScope)
    ? {
        title: `Remove your brand from "${name}"?`,
        text: `The ${noun} stays active for the other brands it serves.`,
        confirmText: 'Remove my brand',
      }
    : {
        title: `Delete ${noun} "${name}"?`,
        text: 'This action cannot be undone.',
        confirmText: 'Delete',
      };
