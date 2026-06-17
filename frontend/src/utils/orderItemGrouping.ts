/**
 * Shared grouping for order line items, so the customer invoice, admin order
 * view, kitchen display (KDS) and FOH packing all show the SAME hierarchy:
 * deal components are grouped under the deal's name; standalone items each
 * stand on their own. Within a deal, lines are ordered by their slot index.
 *
 * Order of first appearance is preserved across groups.
 */

export type DealGroupableLine = {
  deal_id?: number | null;
  deal_slot_index?: number | null;
  deal_name?: string | null;
};

export type OrderItemGroup<T> = {
  /** null = standalone item (single line); otherwise the deal's menu_item id. */
  dealId: number | null;
  /** The deal's display name (falls back handled by callers). */
  dealName: string | null;
  lines: T[];
};

export function groupOrderItems<T extends DealGroupableLine>(
  items: T[] | undefined | null,
): OrderItemGroup<T>[] {
  const groups: OrderItemGroup<T>[] = [];
  const dealIndex = new Map<number, number>();

  for (const line of items ?? []) {
    const dealId = line.deal_id ?? null;
    if (dealId == null) {
      groups.push({ dealId: null, dealName: null, lines: [line] });
      continue;
    }
    let idx = dealIndex.get(dealId);
    if (idx == null) {
      idx = groups.length;
      dealIndex.set(dealId, idx);
      groups.push({ dealId, dealName: line.deal_name ?? null, lines: [] });
    }
    if (!groups[idx].dealName && line.deal_name) {
      groups[idx].dealName = line.deal_name;
    }
    groups[idx].lines.push(line);
  }

  for (const g of groups) {
    if (g.dealId != null) {
      g.lines.sort(
        (a, b) => (a.deal_slot_index ?? 0) - (b.deal_slot_index ?? 0),
      );
    }
  }
  return groups;
}
