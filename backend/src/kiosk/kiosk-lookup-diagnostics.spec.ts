import { KioskService } from './kiosk.service';

/**
 * A cashier who types a code and gets nothing needs to know WHY. One message
 * covering "never existed / wrong branch / already paid / expired" left nobody
 * able to tell a mistyped branch from a kiosk whose order never reached the
 * server — which is exactly the case that looks like data loss and isn't.
 */
describe('KioskService.lookup — says why a code did not resolve', () => {
    const CODE = '001';
    const HERE = 10;

    function makeService(rows: Array<Record<string, unknown>>) {
        const svc = Object.create(KioskService.prototype) as KioskService & {
            kioskRepo: unknown;
            branchRepo: unknown;
        };
        svc.kioskRepo = {
            // lookup() asks for the pending row at THIS branch; explainMissing()
            // then re-queries by code across the tenant.
            findOne: async () =>
                rows.find(
                    (r) => r.branchId === HERE && r.status === 'pending',
                ) ?? null,
            find: async () => rows,
        };
        svc.branchRepo = {
            findOne: async () => ({ id: 22, name: 'test branch' }),
        };
        return svc as KioskService;
    }

    const lookup = (rows: Array<Record<string, unknown>>) =>
        makeService(rows).lookup(CODE, HERE, 6, null);

    it('tells you the order never reached the server, rather than blaming the code', async () => {
        await expect(lookup([])).rejects.toThrow(/never reached the server/i);
        await expect(lookup([])).rejects.toThrow(/kiosk app/i);
    });

    it('names the branch the cart actually belongs to', async () => {
        const err = await lookup([
            { branchId: 22, tenantId: 6, kioskCode: CODE, status: 'pending' },
        ]).catch((e: Error) => e);
        expect((err as Error).message).toContain('test branch');
        expect((err as Error).message).toMatch(/not this branch/i);
    });

    it('says a paid cart was paid', async () => {
        await expect(
            lookup([
                {
                    branchId: HERE,
                    tenantId: 6,
                    kioskCode: CODE,
                    status: 'finalized',
                },
            ]),
        ).rejects.toThrow(/already been paid/i);
    });

    it('says an expired cart expired, and how long carts are held', async () => {
        const err = await lookup([
            { branchId: HERE, tenantId: 6, kioskCode: CODE, status: 'expired' },
        ]).catch((e: Error) => e);
        expect((err as Error).message).toMatch(/expired/i);
        expect((err as Error).message).toMatch(/12 hours/);
    });

    it('does not confuse another tenant’s cart for yours', async () => {
        // findOne is tenant-blind here; lookup must still reject on tenant.
        await expect(
            lookup([
                {
                    branchId: HERE,
                    tenantId: 999,
                    kioskCode: CODE,
                    status: 'pending',
                },
            ]),
        ).rejects.toThrow();
    });
});
