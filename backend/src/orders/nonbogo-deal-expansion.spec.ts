import { OrdersService } from './orders.service';

/**
 * Integration test for the NON-BOGO (flat-price) deal expansion path — specifically the
 * server-side slot validation added for the "Medium Pizza, Pasta Lunch Offer" (one choice_list
 * slot over [a build-your-own pizza + pastas], size-locked to Medium 10"). Confirms a valid
 * pizza or pasta pick expands at the flat deal price, and that a crafted payload cannot swap in
 * an item that isn't in the slot, use the wrong size, or an undefined slot.
 */
describe('expandDealItems — non-BOGO flat-price deal validation', () => {
  const DEAL_ID = 900;
  const DEAL_PRICE = 899;
  const BYO_ID = 10; // build-your-own pizza (has size variants; '10' is Medium)
  const PASTA_ID = 20; // sizeless pasta
  const XL_PIZZA_ID = 30; // NOT in the slot's source list

  const items = new Map<number, unknown>([
    [DEAL_ID, { id: DEAL_ID, name: 'Medium Deal', categoryId: 99, basePrice: DEAL_PRICE, dealPricingMode: null, availableForOrderTypes: null, availableTimeStart: null, availableTimeEnd: null, availableDaysOfWeek: null, variants: [] }],
    [BYO_ID, { id: BYO_ID, name: 'BYO', categoryId: 2, availableForOrderTypes: null, variants: [
      { id: 107, sizeKey: '7', priceModifier: 0 },
      { id: 110, sizeKey: '10', priceModifier: 750 },
    ] }],
    [PASTA_ID, { id: PASTA_ID, name: 'Pasta', categoryId: 3, availableForOrderTypes: null, variants: [] }],
    [XL_PIZZA_ID, { id: XL_PIZZA_ID, name: 'XL Pizza', categoryId: 1, availableForOrderTypes: null, variants: [{ id: 314, sizeKey: '14', priceModifier: 2090 }] }],
  ]);

  const meta = new Map([
    [0, {
      type: 'choice_list' as const,
      sourceMenuItemId: null,
      sourceCategoryId: null,
      sourceMenuItemIds: [BYO_ID, PASTA_ID],
      slotSizeKey: '10',
      allowedSizeKeys: null,
      mirrorSlotIndex: null,
      mirrorMatchSize: false,
      mirrorMatchCategory: false,
    }],
  ]);

  const makeService = () => {
    const menuService = {
      findMenuItem: jest.fn(async (id: number) => items.get(id) ?? null),
      getEffectiveUnitPrice: jest.fn(async (_b: number, id: number) => (id === DEAL_ID ? DEAL_PRICE : 0)),
      getDealSlotSurcharges: jest.fn(async () => new Map()),
      getDealComponentMeta: jest.fn(async () => meta),
    };
    const branchRepo = { findOne: jest.fn(async () => ({ timezone: 'Asia/Karachi' })) };
    const svc = Object.create(OrdersService.prototype) as OrdersService;
    (svc as unknown as { menuService: unknown }).menuService = menuService;
    (svc as unknown as { branchRepo: unknown }).branchRepo = branchRepo;
    return svc as unknown as {
      expandDealItems: (b: number, items: unknown[], ot: string) => Promise<Array<{ deal_unit_price?: number; menu_item_id: number }>>;
    };
  };

  const deal = (comp: { slot_index: number; menu_item_id: number; variant_id?: number }) => ({
    deal_menu_item_id: DEAL_ID,
    quantity: 1,
    components: [comp],
  });

  it('expands a valid pizza pick (Medium 10") at the flat deal price', async () => {
    const svc = makeService();
    const out = await svc.expandDealItems(1, [deal({ slot_index: 0, menu_item_id: BYO_ID, variant_id: 110 })], 'dine_in');
    expect(out).toHaveLength(1);
    expect(out[0].deal_unit_price).toBe(DEAL_PRICE);
  });

  it('expands a valid pasta pick (sizeless — size lock skipped) at the flat deal price', async () => {
    const svc = makeService();
    const out = await svc.expandDealItems(1, [deal({ slot_index: 0, menu_item_id: PASTA_ID })], 'dine_in');
    expect(out).toHaveLength(1);
    expect(out[0].deal_unit_price).toBe(DEAL_PRICE);
  });

  it('rejects an item not in the slot (tamper: swap in an XL pizza for the flat price)', async () => {
    const svc = makeService();
    await expect(
      svc.expandDealItems(1, [deal({ slot_index: 0, menu_item_id: XL_PIZZA_ID, variant_id: 314 })], 'dine_in'),
    ).rejects.toThrow(/not available/i);
  });

  it('rejects the wrong size on a size-locked slot (7" instead of Medium 10")', async () => {
    const svc = makeService();
    await expect(
      svc.expandDealItems(1, [deal({ slot_index: 0, menu_item_id: BYO_ID, variant_id: 107 })], 'dine_in'),
    ).rejects.toThrow(/correct size/i);
  });

  it('rejects an undefined slot_index', async () => {
    const svc = makeService();
    await expect(
      svc.expandDealItems(1, [deal({ slot_index: 5, menu_item_id: BYO_ID, variant_id: 110 })], 'dine_in'),
    ).rejects.toThrow(/invalid deal selection/i);
  });
});
