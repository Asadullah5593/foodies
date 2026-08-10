import { computeTenderTax, resolveGstRates } from './tax-pricing';

/**
 * Online transfer is deliberately two-faced, and both faces must hold:
 *
 *  - **Like a card** for money maths: the branch's card GST rate, and a tax
 *    basis of 'card' (which the FBR mapping turns into PAYMENT_MODE.CARD).
 *  - **Not a card** everywhere it is counted: its own `payment_method` on the
 *    payment row, so shifts, reports and filters show it separately, and it
 *    never lands in the till's expected cash.
 *
 * The tender split is where the first half is decided: the caller folds the
 * transfer amount into the `card` weight. These tests pin that, because getting
 * it wrong in either direction is silent — the totals still add up, they are
 * just taxed or reconciled against the wrong thing.
 */
describe('online transfer as a tender', () => {
    const rates = resolveGstRates(
        { gstRateCash: 0.15, gstRateCard: 0.05 },
        null,
    );

    it('is taxed at the CARD rate, not the cash rate', () => {
        const base = 1000;
        // What the POS sends for a pure online transfer: the amount rides the
        // card weight.
        const result = computeTenderTax(
            base,
            { cash: 0, card: 1 },
            rates.cash,
            rates.card,
        );
        expect(result.taxAmount).toBe(50); // 5%, not 150 at 15%
        expect(result.rateCard).toBe(0.05);
    });

    it('reports a basis of "card", which is what FBR receives', () => {
        const result = computeTenderTax(
            1000,
            { cash: 0, card: 1 },
            rates.cash,
            rates.card,
        );
        // fbr.service maps taxBasis 'card' → PAYMENT_MODE.CARD. A transfer is
        // fiscalised and reported as CARD, per the agreed behaviour.
        expect(result.basis).toBe('card');
    });

    it('charges the cash rate when nothing is tendered yet', () => {
        // Unchanged safety net: an unknown tender must never under-charge.
        const result = computeTenderTax(1000, null, rates.cash, rates.card);
        expect(result.taxAmount).toBe(150);
        expect(result.basis).toBe('cash');
    });

    it('taxes a transfer exactly as it would tax a card of the same value', () => {
        const asCard = computeTenderTax(
            777.77,
            { cash: 0, card: 777.77 },
            rates.cash,
            rates.card,
        );
        const asTransfer = computeTenderTax(
            777.77,
            // The POS sends the transfer amount in the card weight
            { cash: 0, card: 777.77 },
            rates.cash,
            rates.card,
        );
        expect(asTransfer).toEqual(asCard);
    });

    describe('the split the POS builds', () => {
        /** Mirrors OrderTaking's paymentSplit, including the fold. */
        const splitFor = (
            mode: 'cash' | 'card' | 'online_transfer',
        ): { cash: number; card: number } => {
            const raw =
                mode === 'card'
                    ? { cash_amount: 0, card_amount: 1 }
                    : mode === 'online_transfer'
                      ? { cash_amount: 0, card_amount: 0, online_transfer_amount: 1 }
                      : { cash_amount: 1, card_amount: 0 };
            return {
                cash: Number(raw.cash_amount) || 0,
                card:
                    (Number(raw.card_amount) || 0) +
                    (Number(
                        (raw as { online_transfer_amount?: number })
                            .online_transfer_amount,
                    ) || 0),
            };
        };

        it('sends a transfer as card weight, so the rate follows', () => {
            expect(splitFor('online_transfer')).toEqual({ cash: 0, card: 1 });
            expect(splitFor('card')).toEqual({ cash: 0, card: 1 });
            expect(splitFor('cash')).toEqual({ cash: 1, card: 0 });
        });

        it('gives a transfer the same tax as a card and less than cash', () => {
            const transfer = computeTenderTax(
                2000,
                splitFor('online_transfer'),
                rates.cash,
                rates.card,
            );
            const card = computeTenderTax(
                2000,
                splitFor('card'),
                rates.cash,
                rates.card,
            );
            const cash = computeTenderTax(
                2000,
                splitFor('cash'),
                rates.cash,
                rates.card,
            );
            expect(transfer.taxAmount).toBe(card.taxAmount);
            expect(transfer.taxAmount).toBeLessThan(cash.taxAmount);
        });
    });

    describe('bank-card offers', () => {
        /** Mirrors the fullCardPayment guard in orders.service. */
        const fullCardPayment = (split: {
            cash_amount?: number;
            card_amount?: number;
            online_transfer_amount?: number;
        }): boolean =>
            (Number(split.cash_amount) || 0) <= 0 &&
            (Number(split.online_transfer_amount) || 0) <= 0 &&
            (Number(split.card_amount) || 0) > 0;

        it('does not treat a transfer as a qualifying card tender', () => {
            // A card-linked discount is bank-funded and requires the whole bill
            // on that card. A transfer is digital but is not the card.
            expect(
                fullCardPayment({ cash_amount: 0, online_transfer_amount: 500 }),
            ).toBe(false);
        });

        it('still qualifies a genuine full-card bill', () => {
            expect(fullCardPayment({ cash_amount: 0, card_amount: 500 })).toBe(
                true,
            );
        });

        it('refuses a part-card, part-transfer bill', () => {
            // Not reachable from the POS today (transfer is standalone), but the
            // DTO permits it and this gives money away, so it is guarded.
            expect(
                fullCardPayment({
                    cash_amount: 0,
                    card_amount: 500,
                    online_transfer_amount: 500,
                }),
            ).toBe(false);
        });
    });
});
