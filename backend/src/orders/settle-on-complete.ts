/**
 * Completing a till order that was never (fully) paid.
 *
 * POS and call-centre checkout is two calls — create the order, then tender it
 * — so a dropped connection between them leaves a real, fiscalised order with
 * no payment row. Kiosk carts are tendered at finalize the same way. Such an
 * order must not be completed silently: completion is when shift cash counts
 * it, so an unpaid one simply vanishes from the till maths. Instead the
 * completer is asked which method the money came in by, and it is recorded
 * through the same PaymentsService.processPayment the checkout uses.
 *
 * Consumer app / web orders are out of scope: the app's cash is recorded as a
 * 'cod' tender on completion, and the web pays through the gateway.
 */
export const PAY_AT_PLACEMENT_SOURCES = ['pos', 'call_centre', 'kiosk'];

export type SettleMethod = 'cash' | 'card' | 'online_transfer';

export const requiresPaymentToComplete = (
    source: string | null | undefined,
): boolean => PAY_AT_PLACEMENT_SOURCES.includes(String(source ?? ''));

/**
 * The tenders an unpaid order may be settled by. GST was fixed at placement
 * from the tender the till chose (cash at the cash rate; card and online
 * transfer at the card rate) and the invoice was fiscalised with it, so the
 * settling tender has to match: a cash-taxed order is settled in cash, a
 * card-taxed one by card or online transfer. A split bill, or an order with no
 * recorded basis, could be either.
 */
export function settleMethodsForTaxBasis(
    basis: string | null | undefined,
): SettleMethod[] {
    if (basis === 'cash') return ['cash'];
    if (basis === 'card') return ['card', 'online_transfer'];
    return ['cash', 'card', 'online_transfer'];
}
