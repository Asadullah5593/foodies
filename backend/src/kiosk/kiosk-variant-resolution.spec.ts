import { BadRequestException } from '@nestjs/common';
import { KioskService } from './kiosk.service';

/**
 * The kiosk used to demand an explicit variant on any sized item, while POS and
 * the consumer API required nothing — so a cart POS accepts died here with no row
 * written, which looks like the order vanishing. It now fills the gap with the
 * merchant's default size, exactly as POS does.
 */
describe('KioskService — variant resolution', () => {
    // Pizza: 4 sizes, 7" flagged default. Sprite: none. Fries: one size, no default.
    const VARIANTS = [
        { id: 1657, menuItemId: 3100, isDefault: true, sortOrder: 1 },
        { id: 1658, menuItemId: 3100, isDefault: false, sortOrder: 2 },
        { id: 1659, menuItemId: 3100, isDefault: false, sortOrder: 3 },
        { id: 2001, menuItemId: 4000, isDefault: false, sortOrder: 5 },
        { id: 2002, menuItemId: 4000, isDefault: false, sortOrder: 2 },
    ];

    const svc = () => {
        const s = Object.create(KioskService.prototype) as KioskService & {
            variantRepo: unknown;
            logger: unknown;
        };
        s.variantRepo = { find: async () => VARIANTS };
        // `logger` is a field initializer, so a bare prototype object lacks it.
        s.logger = { warn: jest.fn() };
        return s as KioskService;
    };

    const resolve = (items: unknown) =>
        (
            svc() as unknown as {
                resolveVariantSelections: (i: unknown) => Promise<void>;
            }
        ).resolveVariantSelections(items);

    it('fills a missing size with the item’s default, instead of rejecting the cart', async () => {
        const items = [{ menu_item_id: 3100, quantity: 1 }];
        await resolve(items);
        expect(items[0]).toMatchObject({ variant_id: 1657 });
    });

    it('leaves an item with no sizes alone', async () => {
        // 3166 has no variants at all — it was never the failing case.
        const items = [{ menu_item_id: 3166, quantity: 2 }];
        await resolve(items);
        expect(items[0]).not.toHaveProperty('variant_id');
    });

    it('respects a size the customer did choose', async () => {
        const items = [{ menu_item_id: 3100, quantity: 1, variant_id: 1659 }];
        await resolve(items);
        expect(items[0].variant_id).toBe(1659);
    });

    it('still refuses a size that belongs to another item', async () => {
        // A wrong answer, not a missing one — defaulting would hide a real bug.
        await expect(
            resolve([{ menu_item_id: 3100, quantity: 1, variant_id: 9999 }]),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('falls back to the first size by sort order when nothing is flagged default', async () => {
        const items = [{ menu_item_id: 4000, quantity: 1 }];
        await resolve(items);
        expect(items[0]).toMatchObject({ variant_id: 2002 });
    });

    it('resolves sizes inside a deal’s components too', async () => {
        const items = [
            {
                deal_menu_item_id: 500,
                quantity: 1,
                components: [
                    { slot_index: 0, menu_item_id: 3100, quantity: 1 },
                ],
            },
        ];
        await resolve(items);
        expect(items[0].components[0]).toMatchObject({ variant_id: 1657 });
    });

    it('handles an empty cart without touching the database', async () => {
        await expect(resolve([])).resolves.toBeUndefined();
    });
});
