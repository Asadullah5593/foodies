import { PromotionsService } from './promotions.service';

/**
 * Focused unit tests for the two behaviours added when promotions moved to
 * award-on-registration: the new_customer assignment filter, and the
 * deactivate-cascade that tears down outstanding customer copies.
 *
 * The repositories are hand-mocked (no DB / DI) — each test wires only the
 * methods the code under test actually calls.
 */
describe('PromotionsService', () => {
    const makeService = (repos: { promo?: any; cp?: any; discount?: any }) =>
        new PromotionsService(
            repos.promo ?? {},
            repos.cp ?? {},
            repos.discount ?? {},
        );

    describe('assignNewCustomerPromotions', () => {
        it('assigns only active, in-window new_customer promos and sets per-customer expiry', async () => {
            const now = Date.now();
            const day = 24 * 60 * 60 * 1000;
            // promoRepo.find already filters isActive + eligibilityType at the DB
            // layer, so it returns active new_customer promos; the service applies
            // the valid_from/valid_until window in JS.
            const promos = [
                { id: 1, validFrom: null, validUntil: null, expiresInDays: 7 }, // open window
                {
                    id: 2,
                    validFrom: new Date(now - 2 * day),
                    validUntil: new Date(now + 2 * day),
                    expiresInDays: null,
                }, // inside window
                {
                    id: 3,
                    validFrom: null,
                    validUntil: new Date(now - day),
                    expiresInDays: 5,
                }, // window ended → skip
                {
                    id: 4,
                    validFrom: new Date(now + day),
                    validUntil: null,
                    expiresInDays: 5,
                }, // not started → skip
            ];
            const saved: any[] = [];
            const svc = makeService({
                promo: { find: jest.fn().mockResolvedValue(promos) },
                cp: {
                    create: (x: any) => x,
                    save: jest.fn(async (x: any) => {
                        saved.push(x);
                        return x;
                    }),
                },
            });

            await svc.assignNewCustomerPromotions(42, 99);

            expect(saved.map((s) => s.promotionId).sort()).toEqual([1, 2]);
            expect(saved.every((s) => s.customerId === 99)).toBe(true);
            expect(saved.every((s) => s.status === 'pending')).toBe(true);
            // promo 1 has expiresInDays → expiresAt set; promo 2 has none → null
            const cp1 = saved.find((s) => s.promotionId === 1);
            const cp2 = saved.find((s) => s.promotionId === 2);
            expect(cp1.expiresAt).toBeInstanceOf(Date);
            expect(cp2.expiresAt).toBeNull();
        });

        it('swallows a per-promo save failure and continues', async () => {
            const promos = [
                {
                    id: 1,
                    validFrom: null,
                    validUntil: null,
                    expiresInDays: null,
                },
                {
                    id: 2,
                    validFrom: null,
                    validUntil: null,
                    expiresInDays: null,
                },
            ];
            const saved: number[] = [];
            const svc = makeService({
                promo: { find: jest.fn().mockResolvedValue(promos) },
                cp: {
                    create: (x: any) => x,
                    save: jest.fn(async (x: any) => {
                        if (x.promotionId === 1)
                            throw Object.assign(new Error('dup'), {
                                code: '23505',
                            });
                        saved.push(x.promotionId);
                        return x;
                    }),
                },
            });

            await expect(
                svc.assignNewCustomerPromotions(1, 2),
            ).resolves.toBeUndefined();
            expect(saved).toEqual([2]);
        });
    });

    describe('deactivate cascade (update with is_active=false)', () => {
        it('expires pending copies, expires+disables claimed coupons, leaves used untouched', async () => {
            const promo = { id: 7, tenantId: 3, isActive: true };
            const copies = [
                {
                    id: 10,
                    status: 'pending',
                    expiresAt: null,
                    discountId: null,
                },
                {
                    id: 11,
                    status: 'claimed',
                    expiresAt: new Date(),
                    discountId: 500,
                },
                {
                    id: 12,
                    status: 'used',
                    expiresAt: new Date(),
                    discountId: 501,
                },
            ];
            const cpSaved: any[] = [];
            const discountUpdates: any[] = [];
            const svc = makeService({
                promo: {
                    findOne: jest.fn().mockResolvedValue(promo),
                    save: jest.fn(async (p: any) => p),
                },
                cp: {
                    find: jest.fn().mockResolvedValue(copies),
                    save: jest.fn(async (cp: any) => {
                        cpSaved.push(cp);
                        return cp;
                    }),
                },
                discount: {
                    update: jest.fn(async (where: any, patch: any) => {
                        discountUpdates.push({ where, patch });
                    }),
                },
            });

            await svc.update(7, 3, { is_active: false });

            // pending + claimed were re-saved as expired; used was not touched
            expect(cpSaved.map((c) => c.id).sort()).toEqual([10, 11]);
            expect(cpSaved.find((c) => c.id === 10).status).toBe('expired');
            expect(cpSaved.find((c) => c.id === 11).status).toBe('expired');
            // only the claimed copy's discount was disabled
            expect(discountUpdates).toEqual([
                { where: { id: 500 }, patch: { isActive: false } },
            ]);
        });

        it('does NOT cascade when the promo was already inactive', async () => {
            const promo = { id: 7, tenantId: 3, isActive: false };
            const cpFind = jest.fn();
            const svc = makeService({
                promo: {
                    findOne: jest.fn().mockResolvedValue(promo),
                    save: jest.fn(async (p: any) => p),
                },
                cp: { find: cpFind },
            });

            await svc.update(7, 3, { is_active: false });
            expect(cpFind).not.toHaveBeenCalled();
        });
    });
});
