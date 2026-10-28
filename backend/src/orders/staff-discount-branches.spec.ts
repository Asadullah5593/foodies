import { OrdersService } from './orders.service';

/**
 * Quote and order both re-check a staff discount's branches: the till's list
 * is only what the cashier is shown. A preset with no branch picked (one saved
 * before branches were required) is refused everywhere, not read as "any".
 */
describe('authorizeStaffDiscount — branches', () => {
    const authorize = (eligibilityBranchIds: number[] | null) => {
        const svc = Object.create(
            OrdersService.prototype,
        ) as unknown as OrdersService;
        Object.assign(svc, {
            staffDiscountRepo: {
                findOne: jest.fn(() =>
                    Promise.resolve({
                        id: 5,
                        tenantId: 6,
                        isActive: true,
                        discountType: 'percentage',
                        value: 10,
                        maxDiscountAmount: null,
                        eligibilityBrandIds: null,
                        eligibilityBranchIds,
                    }),
                ),
            },
        });
        const fn = (
            svc as unknown as {
                authorizeStaffDiscount: (
                    id: number,
                    tenantId: number,
                    actor: unknown,
                    base: number,
                    branchId: number,
                    brandId: number | null,
                ) => Promise<unknown>;
            }
        ).authorizeStaffDiscount.bind(svc);
        const cashier = {
            permissions: ['staff-discounts:apply'],
            staffDiscountCeiling: { maxPercent: 100, maxAmount: null },
        };
        return (branchId: number) => fn(5, 6, cashier, 1000, branchId, 23);
    };

    it('grants it at a branch it names', async () => {
        await expect(authorize([10, 11])(11)).resolves.toMatchObject({
            id: 5,
        });
    });

    it('refuses it at a branch it does not name', async () => {
        await expect(authorize([10])(11)).rejects.toThrow(
            'That staff discount does not apply to this branch.',
        );
    });

    it('refuses a preset with no branch picked', async () => {
        await expect(authorize(null)(10)).rejects.toThrow(
            'does not apply to this branch',
        );
        await expect(authorize([])(10)).rejects.toThrow(
            'does not apply to this branch',
        );
    });
});
