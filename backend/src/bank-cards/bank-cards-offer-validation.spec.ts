import { BadRequestException } from '@nestjs/common';
import { BankCardsService } from './bank-cards.service';

/**
 * A card's offer fields are rejected, never coerced.
 *
 * The shared normalisers map anything invalid to null, and null means "no offer"
 * / "no cap" on a card — so coercion turned a typo into silent data loss or a
 * silently uncapped percentage. These pin the loud failures.
 */
describe('BankCardsService — card offer validation', () => {
    const LIVE_OFFER = {
        id: 6,
        tenantId: 6,
        name: 'HBL Premium',
        discountType: 'percentage' as const,
        discountValue: 20,
        minOrderAmount: null,
        maxDiscountAmount: null,
        validFrom: null,
        validUntil: null,
        validTimeStart: null,
        validTimeEnd: null,
        validDaysOfWeek: null,
        eligibilityBrandIds: null,
        eligibilityBranchIds: null,
        isActive: true,
    };

    function makeService() {
        const card = { ...LIVE_OFFER };
        const repo = {
            findOne: jest.fn().mockResolvedValue(card),
            save: jest.fn(async (c: unknown) => c),
            create: jest.fn((c: unknown) => c),
            find: jest.fn().mockResolvedValue([]),
        };
        const noop = {} as never;
        const service = new BankCardsService(repo as never, noop, noop);
        return { service, repo, card };
    }

    const update = (dto: Record<string, unknown>) => {
        const { service, repo, card } = makeService();
        return { promise: service.update(6, 6, dto, null), repo, card };
    };

    describe('money is rejected, not coerced', () => {
        it('refuses a negative discount value instead of deleting the offer', async () => {
            const { promise, repo } = update({ discount_value: -5 });
            await expect(promise).rejects.toBeInstanceOf(BadRequestException);
            // The live 20% offer must survive a typo.
            expect(repo.save).not.toHaveBeenCalled();
        });

        it('refuses a negative cap instead of silently uncapping', async () => {
            await expect(
                update({ max_discount_amount: -1 }).promise,
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('refuses a negative minimum order', async () => {
            await expect(
                update({ min_order_amount: -1 }).promise,
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('refuses a non-numeric value', async () => {
            await expect(
                update({ discount_value: 'free' }).promise,
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('still accepts clearing the offer with an explicit null', async () => {
            const { promise, repo } = update({ discount_value: null });
            await expect(promise).resolves.toBeDefined();
            expect(repo.save).toHaveBeenCalled();
        });
    });

    describe('validity window', () => {
        it('refuses an overnight window, which could never apply', async () => {
            // The schedule check has no midnight wrap: 22:00 <= now <= 02:00 is
            // unsatisfiable, so this would save happily and never fire.
            await expect(
                update({ valid_time_start: '22:00', valid_time_end: '02:00' })
                    .promise,
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('refuses an unparseable time rather than dropping the window', async () => {
            await expect(
                update({ valid_time_start: 'banana' }).promise,
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('accepts a normal evening window', async () => {
            await expect(
                update({ valid_time_start: '18:00', valid_time_end: '23:00' })
                    .promise,
            ).resolves.toBeDefined();
        });

        it('refuses valid_from after valid_until', async () => {
            await expect(
                update({ valid_from: '2026-12-31', valid_until: '2026-01-01' })
                    .promise,
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('days of week', () => {
        it('refuses an out-of-range day instead of meaning "every day"', async () => {
            // [7] (ISO Sunday) used to normalise to null = runs all week.
            await expect(
                update({ valid_days_of_week: [7] }).promise,
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('accepts weekend days', async () => {
            await expect(
                update({ valid_days_of_week: [5, 6] }).promise,
            ).resolves.toBeDefined();
        });

        it('treats an empty list as every day', async () => {
            const { promise, card } = update({ valid_days_of_week: [] });
            await expect(promise).resolves.toBeDefined();
            expect(card.validDaysOfWeek).toBeNull();
        });
    });

    describe('offer shape', () => {
        it('refuses a value with no type, which cannot be priced', async () => {
            await expect(
                update({ discount_value: 20, discount_type: null }).promise,
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('refuses a percentage over 100', async () => {
            await expect(
                update({ discount_value: 150, discount_type: 'percentage' })
                    .promise,
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });
});

/**
 * The customer app identifies a card by its BIN. Only the issuer digits may ever
 * reach this code — never a full card number.
 */
describe('BankCardsService — public BIN detection', () => {
    const cards = [
        {
            id: 5,
            tenantId: 6,
            name: 'Bank Al Habib',
            bank: 'BAHL',
            network: 'Mastercard',
            binPrefixes: ['5321'],
            discountType: 'percentage' as const,
            discountValue: 25,
            eligibilityBrandIds: null,
            isActive: true,
        },
        {
            id: 6,
            tenantId: 6,
            name: 'BAHL Platinum',
            bank: 'BAHL',
            network: 'Mastercard',
            // A longer, more specific range inside the bank's generic 5321 block.
            binPrefixes: ['532199'],
            discountType: 'percentage' as const,
            discountValue: 40,
            eligibilityBrandIds: null,
            isActive: true,
        },
        {
            id: 7,
            tenantId: 6,
            name: 'Catalog only',
            binPrefixes: ['4444'],
            discountType: null,
            discountValue: null,
            eligibilityBrandIds: null,
            isActive: true,
        },
        {
            id: 8,
            tenantId: 6,
            name: 'Retired card',
            binPrefixes: ['4111'],
            discountType: 'percentage' as const,
            discountValue: 10,
            eligibilityBrandIds: null,
            isActive: false,
        },
    ];

    const service = () => {
        const repo = { find: jest.fn().mockResolvedValue(cards) };
        const noop = {} as never;
        return new BankCardsService(repo as never, noop, noop);
    };

    it('matches a card on its BIN', async () => {
        const r = await service().detectByBin(6, '532100');
        expect(r.matched).toBe(true);
        expect(r.card?.name).toBe('Bank Al Habib');
    });

    it('prefers the most specific BIN when ranges overlap', async () => {
        const r = await service().detectByBin(6, '53219912');
        expect(r.card?.name).toBe('BAHL Platinum');
    });

    it('truncates a full card number to its BIN and never echoes the rest', async () => {
        const r = await service().detectByBin(6, '5321001234567890');
        expect(r.bin).toBe('53210012');
        expect(JSON.stringify(r)).not.toContain('1234567890');
    });

    it('strips spaces and dashes the customer typed', async () => {
        const r = await service().detectByBin(6, '5321-00');
        expect(r.matched).toBe(true);
    });

    it('refuses anything too short to be a BIN', async () => {
        await expect(service().detectByBin(6, '532')).rejects.toBeInstanceOf(
            BadRequestException,
        );
    });

    it('does not match a card that carries no offer', async () => {
        const r = await service().detectByBin(6, '444400');
        expect(r.matched).toBe(false);
    });

    it('does not match an inactive card', async () => {
        const r = await service().detectByBin(6, '411100');
        expect(r.matched).toBe(false);
    });

    it('reports no match for an unknown bank', async () => {
        const r = await service().detectByBin(6, '999999');
        expect(r.matched).toBe(false);
        expect(r.card).toBeNull();
    });

    it('lists only cards that actually discount something', async () => {
        const offers = await service().publicOffers(6);
        expect(offers.map((o) => o.id).sort()).toEqual([5, 6]);
    });

    it('never leaks brand targeting or manage scope to the customer', async () => {
        const [offer] = await service().publicOffers(6);
        expect(offer).not.toHaveProperty('eligibility_brand_ids');
        expect(offer).not.toHaveProperty('manage_scope');
    });
});
