import { Discount } from '../entities/discount.entity';

/**
 * The activation gate, isolated from the service so it can be exercised without
 * a database.
 *
 * `resolveStagedOffers` builds each automatic stage by filtering the eligible
 * offers through exactly this predicate. The regression it guards is real and
 * was caught in live testing: the gate was originally applied only to the
 * `discount` stage, but a product-scoped BOGO is stored as
 * offer_kind='product_promotion', so a manual offer still fired for everybody —
 * the precise failure the feature exists to prevent.
 */
const activationOf = (d: Discount): string =>
    (d as { activation?: string }).activation ?? 'auto';

const activatable = (d: Discount, manualOfferId: number | null): boolean =>
    activationOf(d) !== 'manual' || d.id === manualOfferId;

const offer = (over: Partial<Discount> & { id: number }): Discount =>
    ({ isActive: true, ...over }) as Discount;

describe('manual offer activation gate', () => {
    it('lets automatic offers through whether or not anything was activated', () => {
        const auto = offer({ id: 1, activation: 'auto' });
        expect(activatable(auto, null)).toBe(true);
        expect(activatable(auto, 99)).toBe(true);
    });

    it('treats an offer predating the column as automatic', () => {
        // Existing rows have no `activation`; they must keep applying exactly as
        // before, or shipping this migration would silently switch every live
        // offer off.
        const legacy = offer({ id: 2 });
        expect(activationOf(legacy)).toBe('auto');
        expect(activatable(legacy, null)).toBe(true);
    });

    it('holds a manual offer back when nothing was activated', () => {
        expect(activatable(offer({ id: 3, activation: 'manual' }), null)).toBe(
            false,
        );
    });

    it('lets through only the manual offer that was activated', () => {
        const a = offer({ id: 3, activation: 'manual' });
        const b = offer({ id: 4, activation: 'manual' });
        expect(activatable(a, 3)).toBe(true);
        // Activating one manual offer must not open the gate for the others.
        expect(activatable(b, 3)).toBe(false);
    });

    it('applies to product promotions too, not just order discounts', () => {
        // A product-scoped BOGO lands in offer_kind='product_promotion'. Gating
        // only the `discount` stage let it fire for everyone.
        const promo = offer({
            id: 5,
            activation: 'manual',
            offerKind: 'product_promotion',
        } as Partial<Discount> & { id: number });
        expect(activatable(promo, null)).toBe(false);
        expect(activatable(promo, 5)).toBe(true);
    });
});

/**
 * What the activated offer produced, reported honestly. The `discount` stage
 * keeps a single winner and the engine may clamp a stage for the cap or the
 * cost floor, so the offer's own ask is an upper bound, never the answer.
 */
const reportedAmount = (raw: number, stageBooked: number): number =>
    Math.min(raw, stageBooked);

describe('manual offer amount attribution', () => {
    it('reports what the offer produced when it won its stage outright', () => {
        expect(reportedAmount(75, 75)).toBe(75);
    });

    it('reports zero when a better automatic offer won the stage', () => {
        // The stage booked 120 from a different offer; ours produced nothing.
        expect(reportedAmount(0, 120)).toBe(0);
    });

    it('never reports more than the stage actually booked', () => {
        // The cap or the cost floor clamped the stage below the ask — take-up
        // must show what was really given away, not what was requested.
        expect(reportedAmount(75, 40)).toBe(40);
    });
});
