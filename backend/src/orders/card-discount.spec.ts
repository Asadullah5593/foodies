import { OrdersService } from './orders.service';

/**
 * The card-linked-discount gate in resolveAutoDiscount: a discount with requires_card=true only
 * applies when the WHOLE bill is paid by an eligible bank card (fullCardPayment) and the selected
 * card is in eligible_bank_card_ids. Non-card discounts are unaffected. Drives the private resolver
 * via Object.create with a mocked discountRepo (the discount has no time window, so branch lookup
 * is skipped).
 */
describe('resolveAutoDiscount — card-linked discount gate', () => {
    const cardDiscount = {
        id: 1,
        name: 'HBL 10% off',
        code: null,
        requiresCode: false,
        isActive: true,
        type: 'percentage',
        value: 10,
        applicationScope: 'whole_order',
        applicationScopeIds: [],
        minOrderAmount: null,
        maxDiscountAmount: null,
        posOnly: false,
        eligibilityBranchIds: null,
        eligibilityBrandIds: null,
        validFrom: null,
        validUntil: null,
        validTimeStart: null,
        validTimeEnd: null,
        validDaysOfWeek: null,
        buyQuantity: null,
        getQuantity: null,
        getDiscountPercent: null,
        bogoMatchSameGroup: false,
        requiresCard: true,
        eligibleBankCardIds: [5],
    };

    const makeService = (discounts: unknown[]) => {
        const svc = Object.create(OrdersService.prototype);
        svc.discountResultEmpty = {
            discountAmount: 0,
            discountCode: null,
            discountId: null,
            scope: 'whole_order',
            scopeIds: [],
            discountableAmount: 0,
            eligibilityBrandIds: null,
        };
        svc.discountRepo = { find: jest.fn(async () => discounts) };
        svc.branchRepo = {
            findOne: jest.fn(async () => ({ timezone: 'Asia/Karachi' })),
        };
        return svc as {
            resolveAutoDiscount: (
                tenantId: number,
                subtotal: number,
                source: string,
                branchId: number,
                brandId: number | null,
                lineDetails: unknown[],
                fullCardPayment: boolean,
                bankCardId: number | null,
            ) => Promise<{ discountAmount: number }>;
        };
    };

    const lines = [
        { menuItemId: 1, categoryId: 1, itemSubtotal: 1000, quantity: 1 },
    ];
    const run = (fullCard: boolean, bankCardId: number | null) =>
        makeService([cardDiscount]).resolveAutoDiscount(
            1,
            1000,
            'pos',
            10,
            100,
            lines,
            fullCard,
            bankCardId,
        );

    it('applies when the whole bill is paid by an eligible card', async () => {
        const res = await run(true, 5);
        expect(res.discountAmount).toBe(100); // 10% of 1000
    });

    it('does NOT apply on a split/cash bill (not full card)', async () => {
        expect((await run(false, 5)).discountAmount).toBe(0);
    });

    it('does NOT apply for an ineligible card', async () => {
        expect((await run(true, 6)).discountAmount).toBe(0);
    });

    it('does NOT apply when no card is selected', async () => {
        expect((await run(true, null)).discountAmount).toBe(0);
    });

    it('a non-card discount still applies regardless of tender', async () => {
        const svc = Object.create(OrdersService.prototype);
        svc.discountResultEmpty = {
            discountAmount: 0,
            discountCode: null,
            discountId: null,
            scope: 'whole_order',
            scopeIds: [],
            discountableAmount: 0,
            eligibilityBrandIds: null,
        };
        svc.discountRepo = {
            find: jest.fn(async () => [
                {
                    ...cardDiscount,
                    requiresCard: false,
                    eligibleBankCardIds: null,
                },
            ]),
        };
        svc.branchRepo = {
            findOne: jest.fn(async () => ({ timezone: 'Asia/Karachi' })),
        };
        const res = await (
            svc as {
                resolveAutoDiscount: (
                    ...a: unknown[]
                ) => Promise<{ discountAmount: number }>;
            }
        ).resolveAutoDiscount(1, 1000, 'pos', 10, 100, lines, false, null);
        expect(res.discountAmount).toBe(100);
    });
});
