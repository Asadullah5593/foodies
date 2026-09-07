import { Repository } from 'typeorm';
import { ShiftsService } from './shifts.service';
import { Shift } from '../entities/shift.entity';
import { Order } from '../entities/order.entity';
import { Payment } from '../entities/payment.entity';

/**
 * Which branches the POS may sell at.
 *
 * Shifts are per (branch, brand), but this lookup used to discard brandId
 * entirely, so ANY brand's open shift advertised the branch as sellable. A
 * cashier locked to a brand with no open shift was let into the branch and only
 * discovered the refusal when the order POST rejected it — which is what the
 * client saw as "one shift is open and it lets you create orders".
 *
 * A legacy NULL-brand shift authorizes nothing (findOpenByBranchAndBrand can
 * never match one), so it must not advertise a branch either.
 */
describe('ShiftsService — findBranchIdsWithOpenShift is brand-aware', () => {
    const openShifts = [
        { branchId: 10, brandId: 25 }, // Fireaway at Pine Avenue
        { branchId: 10, brandId: 28 }, // Wok & Go at Pine Avenue
        { branchId: 22, brandId: 28 }, // Wok & Go at Johar Town
        { branchId: 30, brandId: null }, // legacy pre-brand shift
    ] as Shift[];

    const makeService = (shifts: Shift[] = openShifts) => {
        const stub = {} as unknown;
        const shiftRepo = {
            find: jest.fn().mockResolvedValue(shifts),
        } as unknown as Repository<Shift>;
        return new ShiftsService(
            shiftRepo,
            stub as Repository<Order>,
            stub as Repository<Payment>,
        );
    };

    const branchesFor = (allowedBrandIds: number[] | null) =>
        makeService().findBranchIdsWithOpenShift(allowedBrandIds);

    it('gives an unrestricted caller every branch with a real open shift', async () => {
        await expect(branchesFor(null)).resolves.toEqual([10, 22]);
    });

    it('gives a brand-locked caller only the branches where THEIR brand is open', async () => {
        // Fireaway is open at Pine Avenue only — Johar Town has just Wok & Go.
        await expect(branchesFor([25])).resolves.toEqual([10]);
    });

    it('returns nothing when the caller’s brand has no open shift anywhere', async () => {
        // The regression: branch 10 has two open shifts, neither is brand 29,
        // and the till used to be offered the branch regardless.
        await expect(branchesFor([29])).resolves.toEqual([]);
    });

    it('unions the branches of a caller locked to several brands', async () => {
        await expect(branchesFor([25, 28])).resolves.toEqual([10, 22]);
    });

    it('ignores a legacy NULL-brand shift — it can authorize no sale', async () => {
        const branches = await branchesFor(null);
        expect(branches).not.toContain(30);
    });

    it('returns nothing for an empty brand lock rather than everything', async () => {
        // An empty array means "no brand at all"; treating it as unrestricted
        // would open every branch to a caller allowed none.
        await expect(branchesFor([])).resolves.toEqual([]);
    });
});
