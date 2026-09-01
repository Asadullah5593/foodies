/**
 * Reading the active/inactive state of a brand, branch, category, menu item,
 * deal, add-on, modifier or variant.
 *
 * The API is not consistent about how it says "active": brands send both
 * `is_active` and `status: 'active' | 'inactive'`, most others send `is_active`,
 * a few serialize the entity property `isActive` straight through. Anything
 * that says nothing is treated as ACTIVE — an option must never be marked
 * Inactive because a field was missing, since that would libel a live record on
 * every screen it appears.
 */
export interface EntityStatusFields {
  is_active?: boolean | null;
  isActive?: boolean | null;
  status?: string | null;
}

/**
 * What the helpers accept. Deliberately loose: these values are API payloads
 * that carry the status field at runtime, while the local TypeScript type at a
 * call site is often narrowed to just `{ id, name }`. Requiring the declared
 * type to admit the field would mean widening a dozen unrelated local
 * interfaces; reading it defensively is the smaller, safer change.
 */
export type StatusReadable = unknown;

const read = (e: StatusReadable): EntityStatusFields =>
  (e && typeof e === 'object' ? e : {}) as EntityStatusFields;

/** True unless the record explicitly says it is inactive. */
export function isEntityActive(input: StatusReadable): boolean {
  const entity = read(input);
  if (typeof entity.is_active === 'boolean') return entity.is_active;
  if (typeof entity.isActive === 'boolean') return entity.isActive;
  if (typeof entity.status === 'string') return entity.status.toLowerCase() !== 'inactive';
  return true;
}

/** Convenience inverse — reads better at call sites that build option lists. */
export function isEntityInactive(entity: StatusReadable): boolean {
  return !isEntityActive(entity);
}

/**
 * Label for a NATIVE <option>, which cannot hold markup — so the status has to
 * live in the text itself. Everywhere a badge can be rendered, use one instead.
 */
export function labelWithStatus(label: string, entity: StatusReadable): string {
  return isEntityActive(entity) ? label : `${label} (Inactive)`;
}

/**
 * Drop inactive records from a list offered on a SELLING surface (POS, kiosk,
 * kitchen, customer display), where an inactive record should not be offered at
 * all rather than merely marked.
 *
 * The currently-selected value is always kept: hiding what a cashier already
 * chose would silently change the order under them mid-transaction.
 */
export function withoutInactive<T>(
  list: T[] | null | undefined,
  isSelected?: (item: T) => boolean,
): T[] {
  return (list ?? []).filter(
    (item) => isEntityActive(item) || (isSelected?.(item) ?? false),
  );
}
