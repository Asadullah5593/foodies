import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { KioskService } from './kiosk.service';

/**
 * Which shift authorizes a kiosk finalize.
 *
 * Shifts are per (branch, brand), and ShiftsService.getCollectedAmounts matches
 * a shift's orders on `o.brandId = shift.brandId`. Gating on "any open shift at
 * this branch" therefore let Wok & Go's open shift authorize a Fireaway sale
 * whose cash then reconciled against NO shift at all — it never reached Wok &
 * Go's figures (wrong brand) and Fireaway had no open shift to hold it. The
 * money was in the drawer and invisible to both.
 */
describe('KioskService — finalize gates on the cart’s own brand', () => {
    const FIREAWAY = 25;
    const BRANCH = 10;

    const makeService = (
        row: { brandId: number | null; status?: string; tenantId?: number },
        openShift: { id: number } | null,
    ) => {
        const svc = Object.create(KioskService.prototype) as KioskService;
        const findOpenByBranchAndBrand = jest.fn().mockResolvedValue(openShift);
        const kioskRow = {
            id: 1,
            tenantId: 7,
            kioskCode: 'K-1',
            status: 'pending',
            brandId: row.brandId,
            finalizedOrderGroupId: null,
            payload: {},
            ...row,
        };
        const manager = {
            getRepository: () => ({
                createQueryBuilder: () => ({
                    setLock: () => ({
                        where: () => ({
                            orderBy: () => ({
                                getOne: () => Promise.resolve(kioskRow),
                            }),
                        }),
                    }),
                }),
            }),
        };
        Object.assign(svc, {
            dataSource: {
                transaction: (cb: (m: unknown) => Promise<unknown>) =>
                    cb(manager),
            },
            shiftsService: { findOpenByBranchAndBrand },
        });
        return { svc, findOpenByBranchAndBrand };
    };

    const finalize = (svc: KioskService) =>
        svc.finalize('K-1', BRANCH, 7, undefined, [], 99, null);

    it('refuses when only another brand’s shift is open at the branch', async () => {
        // Wok & Go is open here; this cart is Fireaway's. Before the fix the
        // branch-only lookup found Wok & Go's shift and let the sale through.
        const { svc, findOpenByBranchAndBrand } = makeService(
            { brandId: FIREAWAY },
            null,
        );
        await expect(finalize(svc)).rejects.toBeInstanceOf(ForbiddenException);
        expect(findOpenByBranchAndBrand).toHaveBeenCalledWith(BRANCH, FIREAWAY);
    });

    it('asks for the cart’s own brand, never "any shift at this branch"', async () => {
        const { svc, findOpenByBranchAndBrand } = makeService(
            { brandId: FIREAWAY },
            { id: 4 },
        );
        // Past the gate the real finalize needs the whole pricing stack, so the
        // call itself is what is pinned here — not what happens afterwards.
        await finalize(svc).catch(() => undefined);
        expect(findOpenByBranchAndBrand).toHaveBeenCalledWith(BRANCH, FIREAWAY);
        expect(
            (svc as unknown as Record<string, unknown>).findOpenByBranch,
        ).toBeUndefined();
    });

    it('refuses a cart with no brand instead of reconciling it nowhere', async () => {
        const { svc, findOpenByBranchAndBrand } = makeService(
            { brandId: null },
            { id: 4 },
        );
        await expect(finalize(svc)).rejects.toBeInstanceOf(BadRequestException);
        expect(findOpenByBranchAndBrand).not.toHaveBeenCalled();
    });
});
