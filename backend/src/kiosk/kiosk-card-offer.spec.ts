import { KioskService } from './kiosk.service';

/**
 * The kiosk prices against the money actually being collected, never a
 * client-declared split. That is what stops "claim the card price, hand over
 * cash" — and it is why a kiosk cart finalized on a card gets the same total the
 * counter would have charged, instead of full price.
 */
describe('KioskService — tender drives card offers', () => {
    const svc = Object.create(KioskService.prototype) as KioskService;
    const splitOf = (payments: unknown) =>
        (
            svc as unknown as {
                paymentSplitOf: (p: unknown) => {
                    cash_amount: number;
                    card_amount: number;
                };
            }
        ).paymentSplitOf(payments);
    const quoteInput = (payload: unknown, payments?: unknown) =>
        (
            svc as unknown as {
                quoteInput: (
                    p: unknown,
                    pay?: unknown,
                ) => Record<string, unknown>;
            }
        ).quoteInput(payload, payments);

    const cart = {
        branch_id: 10,
        order_type: 'dine_in',
        items: [{ menu_item_id: 3097, quantity: 2 }],
    };

    describe('paymentSplitOf', () => {
        it('reads a full card tender as all-card', () => {
            expect(splitOf([{ method: 'card', amount: 1258.2 }])).toEqual({
                cash_amount: 0,
                card_amount: 1258.2,
            });
        });

        it('reads a full cash tender as all-cash', () => {
            expect(splitOf([{ method: 'cash', amount: 1398 }])).toEqual({
                cash_amount: 1398,
                card_amount: 0,
            });
        });

        it('sums a mixed tender so it can never read as full-card', () => {
            const split = splitOf([
                { method: 'cash', amount: 500 },
                { method: 'card', amount: 898 },
            ]);
            expect(split).toEqual({ cash_amount: 500, card_amount: 898 });
            // The engine's rule: cash > 0 means no card offer.
            expect(split.cash_amount > 0).toBe(true);
        });

        it('treats no payments as no tender', () => {
            expect(splitOf(undefined)).toEqual({
                cash_amount: 0,
                card_amount: 0,
            });
        });
    });

    describe('quoteInput', () => {
        it('prices a card offer only when a card tender backs it', () => {
            const input = quoteInput({ ...cart, bank_card_id: 4 }, [
                { method: 'card', amount: 1258.2 },
            ]);
            expect(input.bank_card_id).toBe(4);
            expect(input.payment_split).toEqual({
                cash_amount: 0,
                card_amount: 1258.2,
            });
        });

        it('cannot grant the card price to a cash tender', () => {
            // Cashier names a card but takes cash: the split says cash, so the
            // engine drops the offer and the collected-amount check then rejects
            // anything less than the full price.
            const input = quoteInput({ ...cart, bank_card_id: 4 }, [
                { method: 'cash', amount: 1258.2 },
            ]);
            expect(
                (input.payment_split as { cash_amount: number }).cash_amount,
            ).toBeGreaterThan(0);
        });

        it('sends no tender at submit time, when no card is known yet', () => {
            // The customer has not paid; the kiosk must show the undiscounted total.
            const input = quoteInput(cart);
            expect(input.payment_split).toBeUndefined();
            expect(input.bank_card_id).toBeNull();
        });

        it('carries the cart through unchanged', () => {
            const input = quoteInput({ ...cart, discount_code: 'SAVE10' });
            expect(input.branch_id).toBe(10);
            expect(input.order_type).toBe('dine_in');
            expect(input.discount_code).toBe('SAVE10');
            expect(input.items).toEqual(cart.items);
        });
    });
});
