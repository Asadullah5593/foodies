/**
 * The Orders page, narrowed to one customer's whole order history.
 *
 * `customer_id` is what filters (server-side, inside the viewer's own scope);
 * `customer_label` only names the customer in that page's banner.
 */
export function customerOrdersPath(c: { id: number; name?: string | null; phone: string }): string {
  const name = c.name?.trim();
  const sp = new URLSearchParams({
    customer_id: String(c.id),
    customer_label: name ? `${name} (${c.phone})` : c.phone,
  });
  return `/admin/orders?${sp.toString()}`;
}
