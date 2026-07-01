import { OrdersService } from './orders.service';

/**
 * Integration test for BOGO deal expansion (expandDealItems). Bypasses the 19-arg DI
 * constructor with Object.create and injects only the two collaborators the method touches
 * (menuService + branchRepo). Verifies: dynamic full + cheaper-at-half pricing with the size
 * baked into deal_unit_price (so the createOrder and quote paths — which both consume
 * deal_unit_price verbatim — charge exactly what was quoted), and server-side rejection of
 * same-size / same-category / allowed-size violations.
 */
describe('expandDealItems — BOGO deal', () => {
  type V = { id: number; sizeKey: string; mod: number };
  const mkItem = (
    id: number,
    categoryId: number,
    label: string | null,
    base: number,
    variants: V[],
  ) => ({
    id,
    name: `item-${id}`,
    categoryId,
    label,
    basePrice: base,
    availableForOrderTypes: null,
    availableTimeStart: null,
    availableTimeEnd: null,
    availableDaysOfWeek: null,
    variants: variants.map((v) => ({
      id: v.id,
      name: v.sizeKey,
      sizeKey: v.sizeKey,
      priceModifier: v.mod,
    })),
  });

  // Catalog
  const items = new Map<number, ReturnType<typeof mkItem>>();
  // Classic A: 7"=659, 12"=1749, 14"=2749
  items.set(101, mkItem(101, 1, 'Classic', 659, [
    { id: 1017, sizeKey: '7', mod: 0 },
    { id: 1012, sizeKey: '12', mod: 1090 },
    { id: 1014, sizeKey: '14', mod: 2090 },
  ]));
  // Classic B (Margherita-like): 12"=1299, 14"=1999
  items.set(102, mkItem(102, 1, 'Classic', 599, [
    { id: 1022, sizeKey: '12', mod: 700 },
    { id: 1024, sizeKey: '14', mod: 1400 },
  ]));
  // Signature: 12"=1949
  items.set(201, mkItem(201, 1, 'Signature', 699, [
    { id: 2012, sizeKey: '12', mod: 1250 },
  ]));
  // BYO (different category): 12"=1949
  items.set(301, mkItem(301, 2, null, 699, [{ id: 3012, sizeKey: '12', mod: 1250 }]));
  items.set(302, mkItem(302, 2, null, 699, [{ id: 3022, sizeKey: '12', mod: 1250 }]));
  // Item NOT enrolled in the deal (not in SOURCE_IDS) but with a 12" variant.
  items.set(401, mkItem(401, 1, 'Classic', 5000, [{ id: 4012, sizeKey: '12', mod: 0 }]));
  // BOGO deal root
  items.set(999, {
    ...mkItem(999, 9, null, 0, []),
    // @ts-expect-error extra deal-root fields
    dealPricingMode: 'bogo',
    dealBogoBuyQuantity: 1,
    dealBogoGetQuantity: 1,
    dealBogoGetPercent: 50,
  });

  const SOURCE_IDS = [101, 102, 201, 301, 302];
  const slotMeta = (
    o: Partial<{
      mirrorSlotIndex: number | null;
      mirrorMatchSize: boolean;
      mirrorMatchCategory: boolean;
    }>,
  ) => ({
    type: 'choice_list' as const,
    sourceMenuItemId: null,
    sourceCategoryId: null,
    sourceMenuItemIds: SOURCE_IDS,
    allowedSizeKeys: ['12', '14'],
    mirrorSlotIndex: null,
    mirrorMatchSize: false,
    mirrorMatchCategory: false,
    ...o,
  });
  const meta = new Map<number, ReturnType<typeof slotMeta>>([
    [0, slotMeta({})],
    [1, slotMeta({ mirrorSlotIndex: 0, mirrorMatchSize: true, mirrorMatchCategory: true })],
  ]);

  const makeService = () => {
    const menuService = {
      findMenuItem: jest.fn(async (id: number) => items.get(id) ?? null),
      getEffectiveUnitPrice: jest.fn(async (_b: number, id: number) =>
        Number(items.get(id)?.basePrice ?? 0),
      ),
      getDealSlotSurcharges: jest.fn(async () => new Map()),
      getDealComponentMeta: jest.fn(async () => meta),
    };
    const branchRepo = { findOne: jest.fn(async () => ({ timezone: 'Asia/Karachi' })) };
    const svc = Object.create(OrdersService.prototype) as OrdersService;
    (svc as unknown as { menuService: unknown }).menuService = menuService;
    (svc as unknown as { branchRepo: unknown }).branchRepo = branchRepo;
    return svc as unknown as {
      expandDealItems: (
        b: number,
        items: unknown[],
        ot: string,
      ) => Promise<Array<{ deal_unit_price?: number; deal_slot_index?: number; menu_item_id: number }>>;
    };
  };

  const dealLine = (
    c: Array<{ slot_index: number; menu_item_id: number; variant_id: number }>,
    quantity = 1,
  ) => ({ deal_menu_item_id: 999, quantity, components: c });

  it('prices full + cheaper-at-half, size baked into deal_unit_price', async () => {
    const svc = makeService();
    const out = await svc.expandDealItems(
      1,
      [
        dealLine([
          { slot_index: 0, menu_item_id: 101, variant_id: 1012 }, // Classic A 12" = 1749
          { slot_index: 1, menu_item_id: 102, variant_id: 1022 }, // Classic B 12" = 1299
        ]),
      ],
      'dine_in',
    );
    expect(out).toHaveLength(2);
    // A full (1749 incl. the +1090 size modifier — proves variant is baked in), B halved (649.5)
    expect(out[0].deal_unit_price).toBe(1749);
    expect(out[1].deal_unit_price).toBe(649.5);
    expect(out[0].deal_slot_index).toBe(0);
  });

  it('halves the CHEAPER pizza regardless of slot order', async () => {
    const svc = makeService();
    const out = await svc.expandDealItems(
      1,
      [
        dealLine([
          { slot_index: 0, menu_item_id: 102, variant_id: 1022 }, // cheaper (1299) in slot 0
          { slot_index: 1, menu_item_id: 101, variant_id: 1012 }, // dearer (1749) in slot 1
        ]),
      ],
      'dine_in',
    );
    expect(out[0].deal_unit_price).toBe(649.5); // cheaper halved
    expect(out[1].deal_unit_price).toBe(1749); // dearer full
  });

  it('uses the chosen size (14") for pricing', async () => {
    const svc = makeService();
    const out = await svc.expandDealItems(
      1,
      [
        dealLine([
          { slot_index: 0, menu_item_id: 101, variant_id: 1014 }, // A 14" = 2749
          { slot_index: 1, menu_item_id: 102, variant_id: 1024 }, // B 14" = 1999
        ]),
      ],
      'dine_in',
    );
    expect(out[0].deal_unit_price).toBe(2749);
    expect(out[1].deal_unit_price).toBe(999.5); // 1999 / 2
  });

  it('allows BYO + BYO (same category)', async () => {
    const svc = makeService();
    const out = await svc.expandDealItems(
      1,
      [
        dealLine([
          { slot_index: 0, menu_item_id: 301, variant_id: 3012 }, // BYO 12" 1949
          { slot_index: 1, menu_item_id: 302, variant_id: 3022 }, // BYO 12" 1949
        ]),
      ],
      'dine_in',
    );
    expect(out[0].deal_unit_price).toBe(1949);
    expect(out[1].deal_unit_price).toBe(974.5);
  });

  it('rejects different sizes (mirror_match_size)', async () => {
    const svc = makeService();
    await expect(
      svc.expandDealItems(
        1,
        [
          dealLine([
            { slot_index: 0, menu_item_id: 101, variant_id: 1012 }, // 12"
            { slot_index: 1, menu_item_id: 101, variant_id: 1014 }, // 14"
          ]),
        ],
        'dine_in',
      ),
    ).rejects.toThrow(/same size/i);
  });

  it('rejects Classic + Signature (strict same category)', async () => {
    const svc = makeService();
    await expect(
      svc.expandDealItems(
        1,
        [
          dealLine([
            { slot_index: 0, menu_item_id: 101, variant_id: 1012 }, // Classic
            { slot_index: 1, menu_item_id: 201, variant_id: 2012 }, // Signature
          ]),
        ],
        'dine_in',
      ),
    ).rejects.toThrow(/same category/i);
  });

  it('rejects Classic + BYO (different category)', async () => {
    const svc = makeService();
    await expect(
      svc.expandDealItems(
        1,
        [
          dealLine([
            { slot_index: 0, menu_item_id: 101, variant_id: 1012 }, // Classic
            { slot_index: 1, menu_item_id: 301, variant_id: 3012 }, // BYO
          ]),
        ],
        'dine_in',
      ),
    ).rejects.toThrow(/same category/i);
  });

  it('rejects a disallowed size (7" when only 12"/14" allowed)', async () => {
    const svc = makeService();
    await expect(
      svc.expandDealItems(
        1,
        [
          dealLine([
            { slot_index: 0, menu_item_id: 101, variant_id: 1017 }, // 7"
            { slot_index: 1, menu_item_id: 102, variant_id: 1022 }, // 12"
          ]),
        ],
        'dine_in',
      ),
    ).rejects.toThrow(/only available/i);
  });

  it('rejects an unknown slot_index (tamper: drops the size/category gate)', async () => {
    const svc = makeService();
    await expect(
      svc.expandDealItems(
        1,
        [
          dealLine([
            { slot_index: 5, menu_item_id: 101, variant_id: 1012 },
            { slot_index: 5, menu_item_id: 102, variant_id: 1022 },
          ]),
        ],
        'dine_in',
      ),
    ).rejects.toThrow(/invalid deal selection/i);
  });

  it('rejects collapsing both components onto the same slot (duplicate)', async () => {
    const svc = makeService();
    await expect(
      svc.expandDealItems(
        1,
        [
          dealLine([
            { slot_index: 0, menu_item_id: 101, variant_id: 1012 },
            { slot_index: 0, menu_item_id: 102, variant_id: 1022 },
          ]),
        ],
        'dine_in',
      ),
    ).rejects.toThrow(/duplicate/i);
  });

  it('rejects an item not enrolled in the deal slot (membership)', async () => {
    const svc = makeService();
    await expect(
      svc.expandDealItems(
        1,
        [
          dealLine([
            { slot_index: 0, menu_item_id: 401, variant_id: 4012 }, // not in SOURCE_IDS
            { slot_index: 1, menu_item_id: 102, variant_id: 1022 },
          ]),
        ],
        'dine_in',
      ),
    ).rejects.toThrow(/not available/i);
  });

  it('rejects incomplete coverage (only one of two slots filled)', async () => {
    const svc = makeService();
    await expect(
      svc.expandDealItems(
        1,
        [dealLine([{ slot_index: 0, menu_item_id: 101, variant_id: 1012 }])],
        'dine_in',
      ),
    ).rejects.toThrow(/every part/i);
  });

  it('ordering the deal x2 expands two independent priced sets', async () => {
    const svc = makeService();
    const out = await svc.expandDealItems(
      1,
      [
        dealLine(
          [
            { slot_index: 0, menu_item_id: 101, variant_id: 1012 },
            { slot_index: 1, menu_item_id: 102, variant_id: 1022 },
          ],
          2,
        ),
      ],
      'dine_in',
    );
    expect(out).toHaveLength(4);
    expect(out.map((o) => o.deal_unit_price)).toEqual([1749, 649.5, 1749, 649.5]);
  });
});
