/** Pure helpers for comparing PO ordered quantities vs GRN ledger receipts (base units). */

export function areAllPoLinesFullyReceived(
    orderedByItem: ReadonlyMap<number, number>,
    receivedByItem: ReadonlyMap<number, number>,
): boolean {
    if (orderedByItem.size === 0) return false;
    for (const [itemId, orderedQtyBase] of orderedByItem) {
        const receivedQtyBase = receivedByItem.get(itemId) ?? 0;
        if (receivedQtyBase + 1e-9 < orderedQtyBase) return false;
    }
    return true;
}

export function hasAnyPostedGrnReceiptAgainstPo(
    orderedByItem: ReadonlyMap<number, number>,
    receivedByItem: ReadonlyMap<number, number>,
): boolean {
    for (const itemId of orderedByItem.keys()) {
        if ((receivedByItem.get(itemId) ?? 0) > 0) return true;
    }
    return false;
}

/** Next PO status from ordered vs received totals (posted GRNs only, via receivedByItem). */
export function nextPurchaseOrderReceiptStatus(
    orderedByItem: ReadonlyMap<number, number>,
    receivedByItem: ReadonlyMap<number, number>,
): 'created' | 'partially_received' | 'closed' {
    if (orderedByItem.size === 0) return 'created';
    if (areAllPoLinesFullyReceived(orderedByItem, receivedByItem)) {
        return 'closed';
    }
    if (hasAnyPostedGrnReceiptAgainstPo(orderedByItem, receivedByItem)) {
        return 'partially_received';
    }
    return 'created';
}
