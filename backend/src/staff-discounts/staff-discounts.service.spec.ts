import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { StaffDiscountsService } from './staff-discounts.service';
import { StaffDiscount } from '../entities/staff-discount.entity';
import { Brand } from '../entities/brand.entity';

/**
 * A staff discount names the branches it shows at. Nothing picked is never
 * read as "every branch": the form refuses it, and a preset saved before the
 * rule (null) is offered nowhere until someone picks its branches.
 */
describe('StaffDiscountsService — branches', () => {
    const TENANT = 6;
    /** Branches 10 and 11 belong to tenant 6 (through its brands); 99 does not. */
    const TENANT_BRANCHES = [10, 11];

    const make = (rows: Partial<StaffDiscount>[] = []) => {
        const saved: StaffDiscount[] = [];
        const repo = {
            create: (x: Partial<StaffDiscount>) => ({ ...x }) as StaffDiscount,
            save: jest.fn((x: StaffDiscount) => {
                saved.push(x);
                return Promise.resolve({ id: 1, ...x });
            }),
            find: jest.fn(() => Promise.resolve(rows as StaffDiscount[])),
            findOne: jest.fn(() =>
                Promise.resolve((rows[0] as StaffDiscount) ?? null),
            ),
        } as unknown as Repository<StaffDiscount>;
        const brandRepo = {
            find: jest.fn(() => Promise.resolve([{ id: 23 }])),
            query: jest.fn(() =>
                Promise.resolve(
                    TENANT_BRANCHES.map((id) => ({ branch_id: id })),
                ),
            ),
        } as unknown as Repository<Brand>;
        return { svc: new StaffDiscountsService(repo, brandRepo), saved };
    };

    const dto = {
        name: '10% – Long wait',
        discount_type: 'percentage' as const,
        value: 10,
    };

    it('refuses a new button with no branch picked', async () => {
        const { svc, saved } = make();
        await expect(
            svc.create(TENANT, { ...dto, eligibility_branch_ids: [] }),
        ).rejects.toThrow('Pick at least one branch for this button.');
        await expect(svc.create(TENANT, dto)).rejects.toThrow(
            BadRequestException,
        );
        expect(saved).toHaveLength(0);
    });

    it('saves the branches picked, once each', async () => {
        const { svc, saved } = make();
        const res = await svc.create(TENANT, {
            ...dto,
            eligibility_branch_ids: [11, 10, 11],
        });
        expect(saved[0].eligibilityBranchIds).toEqual([11, 10]);
        expect(res.eligibility_branch_ids).toEqual([11, 10]);
    });

    it("refuses another tenant's branch", async () => {
        const { svc, saved } = make();
        await expect(
            svc.create(TENANT, { ...dto, eligibility_branch_ids: [10, 99] }),
        ).rejects.toThrow('One or more branches do not belong to this tenant');
        expect(saved).toHaveLength(0);
    });

    it('makes an edit of a preset saved without branches pick them', async () => {
        const legacy = {
            id: 4,
            tenantId: TENANT,
            name: 'Staff meal',
            discountType: 'percentage' as const,
            value: 20,
            maxDiscountAmount: null,
            eligibilityBrandIds: null,
            eligibilityBranchIds: null,
            sortOrder: 0,
            isActive: true,
        };
        const { svc } = make([legacy]);
        await expect(
            svc.update(4, TENANT, { is_active: false }),
        ).rejects.toThrow('Pick at least one branch for this button.');
        const res = await svc.update(4, TENANT, {
            eligibility_branch_ids: [10],
        });
        expect(res.eligibility_branch_ids).toEqual([10]);
    });

    describe('the till', () => {
        const ceiling = { maxPercent: 100, maxAmount: null };
        const row = (id: number, branchIds: number[] | null) => ({
            id,
            tenantId: TENANT,
            name: `Preset ${id}`,
            discountType: 'percentage' as const,
            value: 10,
            maxDiscountAmount: null,
            eligibilityBrandIds: null,
            eligibilityBranchIds: branchIds,
            sortOrder: id,
            isActive: true,
        });

        it('offers a button only at the branches it names', async () => {
            const { svc } = make([row(1, [10]), row(2, [11]), row(3, null)]);
            const at10 = await svc.findForTill(TENANT, ceiling, {
                branchId: 10,
            });
            expect(at10.map((p) => p.id)).toEqual([1]);
        });

        it('never offers a preset with no branch, even with no branch given', async () => {
            const { svc } = make([row(1, [10]), row(3, null), row(4, [])]);
            const res = await svc.findForTill(TENANT, ceiling, {});
            expect(res.map((p) => p.id)).toEqual([1]);
        });
    });
});
