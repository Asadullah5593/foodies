/**
 * The Orders page, narrowed to one customer's order history.
 *
 * `customer_id` is what filters (server-side, inside the viewer's own scope);
 * `customer_label` only names the customer in that page's banner. `narrow`
 * adds the Orders page's own filters — one brand, one branch, one status — so
 * "12 completed at Fireaway · Pine Avenue" opens exactly those 12.
 */
export function customerOrdersPath(
  c: { id: number; name?: string | null; phone: string },
  narrow: { brandId?: number | null; branchId?: number | null; status?: string } = {},
): string {
  const name = c.name?.trim();
  const sp = new URLSearchParams({
    customer_id: String(c.id),
    customer_label: name ? `${name} (${c.phone})` : c.phone,
  });
  if (narrow.brandId != null) sp.set('brand_id', String(narrow.brandId));
  if (narrow.branchId != null) sp.set('branch_id', String(narrow.branchId));
  if (narrow.status) sp.set('status', narrow.status);
  return `/admin/orders?${sp.toString()}`;
}
